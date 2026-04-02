from pathlib import Path

from document_processing_pipeline.derive_text import derive_clean_text


def test_derive_clean_text_emits_markdown_and_blocks(tmp_path: Path):
    run_dir = tmp_path
    (run_dir / "rich_ir.json").write_text(
        '{"document":{"id":"doc","backend":"test","source_path":"x"},"pages":[{"page_number":1,"width":1,"height":1}],"blocks":[{"block_id":"b1","page_number":1,"block_type":"paragraph","reading_order":0,"text":"Hello world","bbox":null,"source_ids":["x"],"metadata":{}}],"assets":[],"warnings":[]}',
        encoding="utf-8",
    )
    derive_clean_text(run_dir)
    assert (run_dir / "clean_text.md").exists()
    assert (run_dir / "clean_blocks.jsonl").exists()
