import json
from pathlib import Path

from document_processing_pipeline.io_helpers import (
    load_blocks,
    load_document,
    load_jsonl,
    load_translations,
    ordered_blocks,
    write_jsonl,
)
from document_processing_pipeline.models import RichDocument


_MINIMAL_IR = {
    "document": {"id": "doc", "backend": "test", "source_path": "x"},
    "pages": [{"page_number": 1, "width": 100, "height": 100}],
    "blocks": [
        {"block_id": "b2", "page_number": 1, "block_type": "paragraph", "reading_order": 2, "text": "second", "bbox": None, "source_ids": ["x"], "metadata": {}},
        {"block_id": "b1", "page_number": 1, "block_type": "title", "reading_order": 1, "text": "first", "bbox": None, "source_ids": ["x"], "metadata": {}},
    ],
    "assets": [],
    "warnings": [],
}


def test_load_document_prefers_transformed(tmp_path: Path):
    (tmp_path / "rich_ir.json").write_text(json.dumps(_MINIMAL_IR), encoding="utf-8")
    ir2 = dict(_MINIMAL_IR)
    ir2 = json.loads(json.dumps(_MINIMAL_IR))
    ir2["blocks"][0]["text"] = "transformed"
    (tmp_path / "rich_ir.transformed.json").write_text(json.dumps(ir2), encoding="utf-8")
    doc = load_document(tmp_path)
    assert doc.blocks[0].text == "transformed"


def test_load_document_falls_back_to_rich_ir(tmp_path: Path):
    (tmp_path / "rich_ir.json").write_text(json.dumps(_MINIMAL_IR), encoding="utf-8")
    doc = load_document(tmp_path)
    assert doc.blocks[0].text == "second"


def test_load_blocks_from_jsonl(tmp_path: Path):
    rows = [
        {"block_id": "b1", "text": "hello", "source_block_ids": ["b1"], "section_path": [], "transform_policy": "rewrite", "metadata": {}},
    ]
    p = tmp_path / "blocks.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    blocks = load_blocks(p)
    assert len(blocks) == 1
    assert blocks[0].block_id == "b1"
    assert blocks[0].text == "hello"


def test_ordered_blocks_sort_order(tmp_path: Path):
    (tmp_path / "rich_ir.json").write_text(json.dumps(_MINIMAL_IR), encoding="utf-8")
    doc = load_document(tmp_path)
    result = ordered_blocks(doc)
    assert result[0].block_id == "b1"
    assert result[1].block_id == "b2"


def test_load_jsonl_missing_file(tmp_path: Path):
    result = load_jsonl(tmp_path / "nonexistent.jsonl")
    assert result == []


def test_write_jsonl_round_trip(tmp_path: Path):
    rows = [{"block_id": "b1", "text": "你好"}, {"block_id": "b2", "text": "world"}]
    p = tmp_path / "out.jsonl"
    write_jsonl(p, rows)
    loaded = load_jsonl(p)
    assert loaded == rows


def test_load_translations(tmp_path: Path):
    rows = [{"block_id": "b1", "text": "hello"}, {"block_id": "b2", "text": "world"}]
    p = tmp_path / "t.jsonl"
    write_jsonl(p, rows)
    result = load_translations(p)
    assert result == {"b1": "hello", "b2": "world"}
