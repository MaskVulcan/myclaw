import json
from pathlib import Path

import pytest

from document_processing_pipeline.transform_blocks import apply_transform


def _write_blocks(path: Path, blocks: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for b in blocks:
            f.write(json.dumps(b, ensure_ascii=False) + "\n")


def _read_blocks(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


_SAMPLE_BLOCK = {
    "block_id": "b1",
    "text": "Hello World",
    "source_block_ids": ["b1"],
    "section_path": [],
    "transform_policy": "rewrite",
    "metadata": {},
}


def test_apply_transform_copy(tmp_path: Path):
    _write_blocks(tmp_path / "clean_blocks.jsonl", [_SAMPLE_BLOCK])
    apply_transform(tmp_path, operation="copy")
    result = _read_blocks(tmp_path / "transformed_blocks.jsonl")
    assert result[0]["text"] == "Hello World"


def test_apply_transform_uppercase(tmp_path: Path):
    _write_blocks(tmp_path / "clean_blocks.jsonl", [_SAMPLE_BLOCK])
    apply_transform(tmp_path, operation="uppercase")
    result = _read_blocks(tmp_path / "transformed_blocks.jsonl")
    assert result[0]["text"] == "HELLO WORLD"


def test_apply_transform_lowercase(tmp_path: Path):
    _write_blocks(tmp_path / "clean_blocks.jsonl", [_SAMPLE_BLOCK])
    apply_transform(tmp_path, operation="lowercase")
    result = _read_blocks(tmp_path / "transformed_blocks.jsonl")
    assert result[0]["text"] == "hello world"


def test_apply_transform_prefix(tmp_path: Path):
    _write_blocks(tmp_path / "clean_blocks.jsonl", [_SAMPLE_BLOCK])
    apply_transform(tmp_path, operation="prefix", prefix=">>")
    result = _read_blocks(tmp_path / "transformed_blocks.jsonl")
    assert result[0]["text"] == ">>Hello World"


def test_apply_transform_unsupported_operation(tmp_path: Path):
    _write_blocks(tmp_path / "clean_blocks.jsonl", [_SAMPLE_BLOCK])
    with pytest.raises(ValueError, match="Unsupported operation"):
        apply_transform(tmp_path, operation="nonexistent")
