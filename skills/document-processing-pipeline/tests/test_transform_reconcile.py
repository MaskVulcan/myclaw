import json
from pathlib import Path

from document_processing_pipeline.reconcile import reconcile_blocks
from document_processing_pipeline.transform_blocks import _replace_zh_punct, apply_transform


def test_reconcile_updates_target_blocks(tmp_path: Path):
    run_dir = tmp_path
    (run_dir / "rich_ir.json").write_text(
        '{"document":{"id":"doc","backend":"test","source_path":"x"},"pages":[{"page_number":1,"width":1,"height":1}],"blocks":[{"block_id":"b1","page_number":1,"block_type":"paragraph","reading_order":0,"text":"Hello","bbox":null,"source_ids":["x"],"metadata":{}}],"assets":[],"warnings":[]}',
        encoding="utf-8",
    )
    (run_dir / "transformed_blocks.jsonl").write_text('{"block_id":"b1","text":"你好"}\n', encoding="utf-8")
    reconcile_blocks(run_dir)
    assert "你好" in (run_dir / "rich_ir.transformed.json").read_text(encoding="utf-8")


# -- Chinese punctuation → English punctuation tests --


def test_replace_zh_punct_basic():
    """Basic Chinese punctuation marks are replaced."""
    assert _replace_zh_punct("你好，世界。") == "你好, 世界."
    assert _replace_zh_punct("为什么？因为！") == "为什么? 因为!"
    assert _replace_zh_punct("项目：测试；通过") == "项目: 测试; 通过"


def test_replace_zh_punct_quotes():
    """Chinese quotes are converted to ASCII quotes."""
    assert _replace_zh_punct("\u201c引用\u201d") == '"引用"'
    assert _replace_zh_punct("\u2018单引\u2019") == "'单引'"


def test_replace_zh_punct_brackets():
    """Chinese brackets are converted."""
    assert _replace_zh_punct("（括号）") == "(括号)"
    assert _replace_zh_punct("【方括号】") == "[方括号]"
    assert _replace_zh_punct("《书名》") == "<书名>"


def test_replace_zh_punct_special():
    """Special multi-char and single-char marks."""
    assert _replace_zh_punct("a——b") == "a -- b"
    assert _replace_zh_punct("等等…") == "等等..."
    assert _replace_zh_punct("约～100") == "约~100"
    assert _replace_zh_punct("A、B、C") == "A, B, C"


def test_replace_zh_punct_collapses_spaces():
    """Multiple consecutive spaces after replacement are collapsed."""
    # "，  " already has trailing space; after replacement we get ", " + extra → collapsed
    assert "  " not in _replace_zh_punct("A，  B")
    assert _replace_zh_punct("A，  B") == "A, B"


def test_replace_zh_punct_preserves_newlines():
    """Newlines are preserved during space collapsing."""
    result = _replace_zh_punct("第一行，\n第二行。")
    assert "\n" in result
    assert result == "第一行,\n第二行."


def test_replace_zh_punct_no_change_for_english():
    """Pure English text passes through unchanged."""
    original = "Hello, world. How are you?"
    assert _replace_zh_punct(original) == original


def test_zh_punct_to_en_transform_integration(tmp_path: Path):
    """End-to-end: apply_transform with zh-punct-to-en operation."""
    run_dir = tmp_path
    blocks = [
        {"block_id": "b1", "text": "这是一个测试，包含中文标点。"},
        {"block_id": "b2", "text": "为什么？因为需要！"},
        {"block_id": "b3", "text": "No Chinese punctuation here."},
    ]
    with (run_dir / "clean_blocks.jsonl").open("w", encoding="utf-8") as f:
        for block in blocks:
            f.write(json.dumps(block, ensure_ascii=False) + "\n")

    output_path = apply_transform(run_dir, operation="zh-punct-to-en")
    assert output_path.exists()

    results: list[dict] = []
    with output_path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                results.append(json.loads(line))

    assert len(results) == 3
    assert results[0]["text"] == "这是一个测试, 包含中文标点."
    assert results[1]["text"] == "为什么? 因为需要!"
    assert results[2]["text"] == "No Chinese punctuation here."
