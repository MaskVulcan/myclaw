from pathlib import Path

from document_processing_pipeline.cli import main


def test_smoke_ingest_to_markdown(tmp_path: Path):
    sample = Path(__file__).resolve().parent / "fixtures" / "sample.txt"
    exit_code = main(["ingest", str(sample), "--run-dir", str(tmp_path)])
    assert exit_code == 0
    exit_code = main(["derive-text", "--run-dir", str(tmp_path)])
    assert exit_code == 0
    exit_code = main(["assemble-markdown", "--run-dir", str(tmp_path)])
    assert exit_code == 0
