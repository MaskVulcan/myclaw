import json
from pathlib import Path

from document_processing_pipeline.assemble_html import assemble_html
from document_processing_pipeline.assemble_markdown import assemble_markdown


def _write_ir(run_dir: Path, blocks: list[dict]) -> None:
    ir = {
        "document": {"id": "doc", "backend": "test", "source_path": "x"},
        "pages": [{"page_number": 1, "width": 100, "height": 100}],
        "blocks": blocks,
        "assets": [],
        "warnings": [],
    }
    (run_dir / "rich_ir.transformed.json").write_text(json.dumps(ir, ensure_ascii=False), encoding="utf-8")


def _block(block_id: str, block_type: str, text: str, reading_order: int = 0, metadata: dict | None = None) -> dict:
    return {
        "block_id": block_id,
        "page_number": 1,
        "block_type": block_type,
        "reading_order": reading_order,
        "text": text,
        "bbox": None,
        "source_ids": ["x"],
        "metadata": metadata or {},
    }


def test_markdown_export_uses_transformed_ir(tmp_path: Path):
    run_dir = tmp_path
    _write_ir(run_dir, [_block("b1", "title", "标题")])
    assemble_markdown(run_dir)
    assemble_html(run_dir)
    assert "# 标题" in (run_dir / "output.md").read_text(encoding="utf-8")
    assert "<h1" in (run_dir / "output.html").read_text(encoding="utf-8")


def test_html_export_sanitizes_table_html(tmp_path: Path):
    run_dir = tmp_path
    _write_ir(run_dir, [_block("b1", "table", "Table", metadata={"table_html": '<table onclick="evil()"><tr><td>ok<script>alert(1)</script></td></tr></table>'})])
    assemble_html(run_dir)
    html = (run_dir / "output.html").read_text(encoding="utf-8")
    assert "<table>" in html
    assert "onclick" not in html
    assert "<script" not in html


# ── B7: HTML assembly detail tests ──


def test_html_list_items_wrapped_in_ul(tmp_path: Path):
    _write_ir(tmp_path, [
        _block("l1", "list_item", "Item A", reading_order=0),
        _block("l2", "list_item", "Item B", reading_order=1),
    ])
    assemble_html(tmp_path)
    html = (tmp_path / "output.html").read_text(encoding="utf-8")
    assert "<ul>" in html
    assert "</ul>" in html
    assert "<li" in html
    assert "Item A" in html
    assert "Item B" in html


def test_html_heading_levels(tmp_path: Path):
    _write_ir(tmp_path, [
        _block("h1", "title", "Main Title", reading_order=0, metadata={"heading_level": 1}),
        _block("h2", "heading", "Sub Heading", reading_order=1, metadata={"heading_level": 3}),
    ])
    assemble_html(tmp_path)
    html = (tmp_path / "output.html").read_text(encoding="utf-8")
    assert "<h1" in html
    assert "Main Title" in html
    assert "<h3" in html
    assert "Sub Heading" in html


def test_html_mixed_blocks(tmp_path: Path):
    _write_ir(tmp_path, [
        _block("b1", "title", "Title", reading_order=0),
        _block("b2", "paragraph", "Some text.", reading_order=1),
        _block("b3", "list_item", "Bullet", reading_order=2),
        _block("b4", "table", "Table", reading_order=3, metadata={"table_html": "<table><tr><td>data</td></tr></table>"}),
    ])
    assemble_html(tmp_path)
    html = (tmp_path / "output.html").read_text(encoding="utf-8")
    assert "<h1" in html
    assert "<p " in html
    assert "<li" in html
    assert "<table>" in html


# ── B8: Markdown assembly detail tests ──


def test_markdown_heading_levels(tmp_path: Path):
    _write_ir(tmp_path, [
        _block("h1", "title", "Title One", reading_order=0, metadata={"heading_level": 1}),
        _block("h2", "heading", "Sub Three", reading_order=1, metadata={"heading_level": 3}),
    ])
    assemble_markdown(tmp_path)
    md = (tmp_path / "output.md").read_text(encoding="utf-8")
    assert "# Title One" in md
    assert "### Sub Three" in md


def test_markdown_list_items(tmp_path: Path):
    _write_ir(tmp_path, [
        _block("l1", "list_item", "Alpha", reading_order=0),
        _block("l2", "list_item", "Beta", reading_order=1),
    ])
    assemble_markdown(tmp_path)
    md = (tmp_path / "output.md").read_text(encoding="utf-8")
    assert "- Alpha" in md
    assert "- Beta" in md


def test_markdown_image_blocks(tmp_path: Path):
    _write_ir(tmp_path, [
        _block("img1", "image", "", reading_order=0, metadata={"caption": "Figure 1", "image_path": "images/fig1.png"}),
    ])
    assemble_markdown(tmp_path)
    md = (tmp_path / "output.md").read_text(encoding="utf-8")
    assert "![Figure 1](images/fig1.png)" in md


def test_markdown_table_html_passthrough(tmp_path: Path):
    table_html = "<table><tr><td>cell</td></tr></table>"
    _write_ir(tmp_path, [
        _block("t1", "table", "Table", reading_order=0, metadata={"table_html": table_html}),
    ])
    assemble_markdown(tmp_path)
    md = (tmp_path / "output.md").read_text(encoding="utf-8")
    assert table_html in md
