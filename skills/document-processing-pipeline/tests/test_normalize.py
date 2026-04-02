import json
from pathlib import Path

import pytest

from document_processing_pipeline.normalize import normalize_payload, normalize_payload_file


def test_normalize_payload_unstructured():
    elements = [
        {"type": "NarrativeText", "text": "Hello world.", "element_id": "e1", "metadata": {"page_number": 1}},
    ]
    doc = normalize_payload(elements, backend="unstructured", source_path="test.html")
    assert len(doc.blocks) >= 1
    assert doc.blocks[0].text == "Hello world."


def test_normalize_payload_unsupported_backend():
    with pytest.raises(ValueError, match="Unsupported backend"):
        normalize_payload({}, backend="no_such_backend", source_path="test.txt")


def test_normalize_payload_file_writes_output(tmp_path: Path):
    elements = [
        {"type": "Title", "text": "My Title", "element_id": "e1", "metadata": {"page_number": 1}},
    ]
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps(elements), encoding="utf-8")
    output_path = tmp_path / "rich_ir.json"
    result = normalize_payload_file(payload_path, backend="unstructured", source_path="test.html", output_path=output_path)
    assert result == output_path
    assert output_path.exists()
    data = json.loads(output_path.read_text(encoding="utf-8"))
    assert data["blocks"][0]["text"] == "My Title"
