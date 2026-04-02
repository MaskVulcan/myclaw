from __future__ import annotations

from pathlib import Path

from document_processing_pipeline.io_helpers import load_translations
from document_processing_pipeline.models import RichDocument


def reconcile_blocks(run_dir: str | Path) -> Path:
    run_path = Path(run_dir)
    rich_document = RichDocument.load_json(run_path / "rich_ir.json")
    replacements = load_translations(run_path / "transformed_blocks.jsonl")

    for block in rich_document.blocks:
        if block.block_id in replacements:
            block.text = replacements[block.block_id]

    output_path = run_path / "rich_ir.transformed.json"
    rich_document.write_json(output_path)
    return output_path
