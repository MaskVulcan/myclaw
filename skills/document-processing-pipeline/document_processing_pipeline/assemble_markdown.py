from __future__ import annotations

from pathlib import Path

from document_processing_pipeline.io_helpers import load_document, ordered_blocks
from document_processing_pipeline.models import RichDocument


def _render_markdown_block(block) -> str:
    if block.block_type == "title":
        level = int(block.metadata.get("heading_level", 1))
        return f"{'#' * max(1, min(level, 6))} {block.text}".strip()
    if block.block_type == "heading":
        level = int(block.metadata.get("heading_level", 2))
        return f"{'#' * max(1, min(level, 6))} {block.text}".strip()
    if block.block_type == "list_item":
        return f"- {block.text}".strip()
    if block.block_type == "table" and block.metadata.get("table_html"):
        return block.metadata["table_html"]
    if block.block_type in {"image", "figure"}:
        caption = block.metadata.get("caption") or block.text or f"Image {block.block_id}"
        image_path = block.metadata.get("image_path") or block.metadata.get("source_path")
        if image_path:
            return f"![{caption}]({image_path})"
        return f"[Image: {caption}]"
    return block.text


def render_markdown_lines(document: RichDocument) -> list[str]:
    return [rendered for block in ordered_blocks(document) if (rendered := _render_markdown_block(block))]


def assemble_markdown(run_dir: str | Path) -> Path:
    run_path = Path(run_dir)
    document = load_document(run_path)
    content = "\n\n".join(render_markdown_lines(document)).strip() + "\n"
    output_path = run_path / "output.md"
    output_path.write_text(content, encoding="utf-8")
    return output_path
