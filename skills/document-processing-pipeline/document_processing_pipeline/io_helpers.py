"""Shared IO helpers used across pipeline stages."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from document_processing_pipeline.models import BlockRecord, RichDocument, TransformBlock


# ---------------------------------------------------------------------------
# CJK font candidate lists (shared by overlay_translate_pdf & assemble_pdf)
# ---------------------------------------------------------------------------

CJK_FONT_CANDIDATES = (
    # macOS
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    # Linux (Noto CJK)
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
)

CJK_BOLD_FONT_CANDIDATES = (
    # macOS
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    # Linux (Noto CJK Bold)
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
)

# Title font prefers Medium weight first, then falls back to the same
# regular candidates.
CJK_TITLE_FONT_CANDIDATES = (
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
)


def find_cjk_font(candidates: tuple[str, ...] = CJK_FONT_CANDIDATES) -> Path | None:
    """Return the first existing font path from *candidates*, or ``None``."""
    for c in candidates:
        p = Path(c)
        if p.exists():
            return p
    return None


# ---------------------------------------------------------------------------
# Document & block loading
# ---------------------------------------------------------------------------

def load_document(run_path: Path) -> RichDocument:
    """Load the best available IR document from a run directory.

    Prefers ``rich_ir.transformed.json`` when it exists, otherwise falls back
    to ``rich_ir.json``.
    """
    transformed = run_path / "rich_ir.transformed.json"
    if transformed.exists():
        return RichDocument.load_json(transformed)
    return RichDocument.load_json(run_path / "rich_ir.json")


def load_blocks(path: Path) -> list[TransformBlock]:
    """Read a JSONL file of :class:`TransformBlock` records."""
    blocks: list[TransformBlock] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                blocks.append(TransformBlock.from_dict(json.loads(line)))
    return blocks


def ordered_blocks(document: RichDocument) -> list[BlockRecord]:
    """Return blocks sorted by page number, reading order, and block id."""
    return sorted(
        document.blocks,
        key=lambda b: (b.page_number, b.reading_order, b.block_id),
    )


# ---------------------------------------------------------------------------
# JSONL read / write
# ---------------------------------------------------------------------------

def load_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read a JSONL file and return a list of dicts.  Returns ``[]`` if *path* does not exist."""
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    """Write a list of dicts to a JSONL file."""
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def load_translations(path: Path) -> dict[str, str]:
    """Read a JSONL translations file and return ``{block_id: text}``."""
    result: dict[str, str] = {}
    for item in load_jsonl(path):
        result[str(item["block_id"])] = str(item.get("text", ""))
    return result


# ---------------------------------------------------------------------------
# PyMuPDF (fitz) bootstrapping
# ---------------------------------------------------------------------------

def ensure_fitz():
    """Import and return the ``fitz`` module, auto-installing PyMuPDF if needed."""
    try:
        import fitz  # type: ignore
    except ImportError:
        from document_processing_pipeline import bootstrap
        bootstrap.ensure_python_dependency("pymupdf")
        import fitz  # type: ignore
    return fitz


# ---------------------------------------------------------------------------
# Source PDF resolution
# ---------------------------------------------------------------------------

def resolve_source_pdf(source_pdf: str | Path | None, run_path: Path) -> Path:
    """Determine the source PDF path from an explicit argument or the IR metadata."""
    if source_pdf is not None:
        return Path(source_pdf)
    document = RichDocument.load_json(run_path / "rich_ir.json")
    return Path(document.document.source_path)
