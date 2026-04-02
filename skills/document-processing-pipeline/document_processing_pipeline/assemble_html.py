from __future__ import annotations

from html import escape
from html.parser import HTMLParser
from pathlib import Path

from document_processing_pipeline.io_helpers import load_document, ordered_blocks
from document_processing_pipeline.models import RichDocument


ALLOWED_TABLE_TAGS = {"table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col"}


class _SafeTableHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.skipped_tags: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in ALLOWED_TABLE_TAGS and not self.skipped_tags:
            self.parts.append(f"<{tag}>")
            return
        self.skipped_tags.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if self.skipped_tags:
            if self.skipped_tags[-1] == tag:
                self.skipped_tags.pop()
            return
        if tag in ALLOWED_TABLE_TAGS:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.skipped_tags:
            self.parts.append(escape(data))

    def handle_entityref(self, name: str) -> None:
        if not self.skipped_tags:
            self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if not self.skipped_tags:
            self.parts.append(f"&#{name};")


def _sanitize_table_html(html: str) -> str:
    parser = _SafeTableHTMLParser()
    parser.feed(html)
    parser.close()
    return "".join(parser.parts)


def _render_template(title: str, body: str, lang: str = "en") -> str:
    template_path = Path(__file__).resolve().parents[1] / "assets" / "html_template.html.j2"
    if template_path.exists():
        template_text = template_path.read_text(encoding="utf-8")
        try:
            from jinja2 import Template  # type: ignore
        except ImportError:
            return (
                template_text.replace("{{ title }}", escape(title))
                .replace("{{ lang }}", escape(lang))
                .replace("{{ body }}", body)
            )
        return Template(template_text).render(title=title, body=body, lang=lang)
    return f"""<!doctype html>
<html lang="{escape(lang)}">
<head>
  <meta charset="utf-8">
  <title>{escape(title)}</title>
  <style>
    body {{ font-family: Georgia, serif; margin: 3rem auto; max-width: 48rem; line-height: 1.6; }}
    h1, h2, h3, h4, h5, h6 {{ line-height: 1.25; }}
    li {{ margin: 0.25rem 0; }}
    section table {{ border-collapse: collapse; width: 100%; }}
    section td, section th {{ border: 1px solid #ccc; padding: 0.35rem; }}
  </style>
</head>
<body>
{body}
</body>
</html>
"""


def _render_blocks(document: RichDocument) -> str:
    chunks: list[str] = []
    in_list = False
    for block in ordered_blocks(document):
        text = escape(block.text)
        if block.block_type == "list_item":
            if not in_list:
                chunks.append("<ul>")
                in_list = True
            chunks.append(f'<li data-block-id="{block.block_id}">{text}</li>')
            continue
        # Close any open list before emitting a non-list element.
        if in_list:
            chunks.append("</ul>")
            in_list = False
        if block.block_type == "title":
            level = int(block.metadata.get("heading_level", 1))
            chunks.append(f'<h{level} data-block-id="{block.block_id}">{text}</h{level}>')
        elif block.block_type == "heading":
            level = int(block.metadata.get("heading_level", 2))
            chunks.append(f'<h{level} data-block-id="{block.block_id}">{text}</h{level}>')
        elif block.block_type == "table" and block.metadata.get("table_html"):
            safe_table_html = _sanitize_table_html(str(block.metadata["table_html"]))
            chunks.append(f'<section data-block-id="{block.block_id}">{safe_table_html}</section>')
        else:
            chunks.append(f'<p data-block-id="{block.block_id}">{text}</p>')
    if in_list:
        chunks.append("</ul>")
    return "\n".join(chunks)


def assemble_html(run_dir: str | Path) -> Path:
    run_path = Path(run_dir)
    document = load_document(run_path)
    body = _render_blocks(document)
    html = _render_template(document.document.title or document.document.id, body, lang=document.document.language or "en")
    output_path = run_path / "output.html"
    output_path.write_text(html, encoding="utf-8")
    return output_path
