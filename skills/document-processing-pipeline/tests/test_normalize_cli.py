import json
from pathlib import Path

from document_processing_pipeline.cli import main
from document_processing_pipeline.models import RichDocument


def test_normalize_cli_writes_rich_ir(tmp_path: Path):
    payload = [
        {
            "type": "Title",
            "element_id": "title-1",
            "text": "Hello",
            "metadata": {"page_number": 1},
        }
    ]
    payload_path = tmp_path / "unstructured.json"
    payload_path.write_text(json.dumps(payload), encoding="utf-8")

    exit_code = main(
        [
            "normalize",
            str(payload_path),
            "--backend",
            "unstructured",
            "--source-path",
            "sample.html",
            "--run-dir",
            str(tmp_path),
        ]
    )

    assert exit_code == 0
    document = RichDocument.load_json(tmp_path / "rich_ir.json")
    assert document.document.backend == "unstructured"
    assert document.provenance is not None
