from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from document_processing_pipeline.io_helpers import ordered_blocks as _ordered_blocks
from document_processing_pipeline.models import RichDocument, TransformBlock


def _render_block_markdown(block_type: str, text: str, metadata: dict[str, Any]) -> str:
    if block_type == "title":
        level = int(metadata.get("heading_level", 1))
        return f"{'#' * max(1, min(level, 6))} {text}".strip()
    if block_type == "heading":
        level = int(metadata.get("heading_level", 2))
        return f"{'#' * max(1, min(level, 6))} {text}".strip()
    if block_type == "list_item":
        return f"- {text}".strip()
    return text


def derive_clean_text(run_dir: str | Path) -> None:
    run_path = Path(run_dir)
    document = RichDocument.load_json(run_path / "rich_ir.json")
    sorted_blocks = _ordered_blocks(document)

    markdown_parts: list[str] = []
    transform_blocks: list[TransformBlock] = []
    for block in sorted_blocks:
        rendered = _render_block_markdown(block.block_type, block.text, block.metadata)
        markdown_parts.append(rendered)
        transform_blocks.append(
            TransformBlock(
                block_id=block.block_id,
                text=block.text,
                source_block_ids=list(block.source_ids or [block.block_id]),
                section_path=list(block.section_path),
                transform_policy="rewrite",
                metadata={"block_type": block.block_type},
            )
        )

    (run_path / "clean_text.md").write_text("\n\n".join(part for part in markdown_parts if part.strip()) + "\n", encoding="utf-8")
    with (run_path / "clean_blocks.jsonl").open("w", encoding="utf-8") as handle:
        for item in transform_blocks:
            handle.write(json.dumps(item.to_dict(), ensure_ascii=False) + "\n")

    manifest = {
        "source_file": "rich_ir.json",
        "transform_file": "transformed_blocks.jsonl",
        "block_count": len(transform_blocks),
        "policies": sorted({item.transform_policy for item in transform_blocks}),
    }
    (run_path / "transform_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
