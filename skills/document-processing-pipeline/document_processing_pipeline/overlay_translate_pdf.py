from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from document_processing_pipeline.io_helpers import (
    CJK_BOLD_FONT_CANDIDATES,
    CJK_FONT_CANDIDATES,
    CJK_TITLE_FONT_CANDIDATES,
    ensure_fitz as _ensure_fitz,
    load_translations as _load_translations,
    ordered_blocks as _ordered_blocks,
)
from document_processing_pipeline.models import BlockRecord, RichDocument
from document_processing_pipeline.translation_rules import clean_cid_placeholders, is_formula_like_text, prettify_inline_math


SUPPORTED_BLOCK_TYPES = {"title", "heading", "narrativetext", "listitem", "uncategorizedtext"}
SKIPPED_BLOCK_TYPES = {"header", "footer"}
DEFAULT_OUTPUT_NAME = "output.overlay.pdf"
# Re-export for backward compatibility
DEFAULT_BODY_FONT_CANDIDATES = CJK_FONT_CANDIDATES
DEFAULT_TITLE_FONT_CANDIDATES = CJK_TITLE_FONT_CANDIDATES
DEFAULT_BOLD_FONT_CANDIDATES = CJK_BOLD_FONT_CANDIDATES


@dataclass(frozen=True)
class OverlayTextBlock:
    block_id: str
    page_number: int
    block_type: str
    text: str
    rect: tuple[float, float, float, float]
    is_bold: bool = False
    is_code: bool = False


@dataclass(frozen=True)
class OverlayStyle:
    font_key: str
    font_path: Path
    color: tuple[float, float, float]
    size_scale: float



def _normalize_rect(
    bbox: dict[str, float] | None,
    page_width: float,
    page_height: float,
    tolerance: float = 1.0,
) -> tuple[float, float, float, float] | None:
    if not bbox:
        return None
    try:
        x0 = float(bbox["x0"])
        y0 = float(bbox["y0"])
        x1 = float(bbox["x1"])
        y1 = float(bbox["y1"])
    except (KeyError, TypeError, ValueError):
        return None

    if x1 <= x0 or y1 <= y0:
        return None
    if x0 < -tolerance or y0 < -tolerance or x1 > page_width + tolerance or y1 > page_height + tolerance:
        return None

    x0 = max(0.0, min(page_width, x0))
    x1 = max(0.0, min(page_width, x1))
    y0 = max(0.0, min(page_height, y0))
    y1 = max(0.0, min(page_height, y1))
    width = x1 - x0
    height = y1 - y0
    if width < 4 or height < 4:
        return None
    if height / page_height > 0.22:
        return None
    if (width * height) / (page_width * page_height) > 0.33:
        return None
    return (x0, y0, x1, y1)


_MONOSPACE_FONT_PREFIXES = ("SFTT", "Courier", "Consolas", "Menlo", "DejaVuSansMono", "LiberationMono")
# PyMuPDF span flags: bit 4 = bold
_BOLD_FLAG = 1 << 4


def _analyse_block_fonts(
    source_pdf,
    block_rects: dict[str, tuple[int, tuple[float, float, float, float]]],
) -> dict[str, tuple[bool, bool]]:
    """For each block, inspect spans in the source PDF to detect code / bold.

    Returns ``{block_id: (is_bold, is_code)}``.
    """
    import fitz  # type: ignore  # already imported by caller

    # Group blocks by page.
    by_page: dict[int, list[tuple[str, tuple[float, float, float, float]]]] = {}
    for block_id, (page_num, rect) in block_rects.items():
        by_page.setdefault(page_num, []).append((block_id, rect))

    results: dict[str, tuple[bool, bool]] = {}
    for page_num, items in by_page.items():
        page = source_pdf[page_num - 1]
        page_dict = page.get_text("dict")
        # Collect all spans with their rects.
        spans: list[tuple[fitz.Rect, str, int]] = []
        for blk in page_dict.get("blocks", []):
            for line in blk.get("lines", []):
                for span in line.get("spans", []):
                    if not span["text"].strip():
                        continue
                    spans.append((fitz.Rect(span["bbox"]), span["font"], span.get("flags", 0)))

        for block_id, rect in items:
            block_rect = fitz.Rect(rect)
            # Slightly shrink to avoid picking up adjacent spans.
            inner = block_rect + (1, 1, -1, -1)
            total_chars = 0
            code_chars = 0
            bold_chars = 0
            for span_rect, font_name, flags in spans:
                if not inner.intersects(span_rect):
                    continue
                n = max(1, len(font_name))  # proxy for char count
                total_chars += n
                if any(font_name.startswith(p) for p in _MONOSPACE_FONT_PREFIXES):
                    code_chars += n
                if flags & _BOLD_FLAG:
                    bold_chars += n
            is_code = total_chars > 0 and code_chars / total_chars > 0.5
            is_bold = total_chars > 0 and bold_chars / total_chars > 0.4
            results[block_id] = (is_bold, is_code)
    return results


def build_overlay_plan(
    document: RichDocument,
    translations: dict[str, str],
    font_info: dict[str, tuple[bool, bool]] | None = None,
) -> list[OverlayTextBlock]:
    page_sizes = {page.page_number: (page.width, page.height) for page in document.pages}
    plan: list[OverlayTextBlock] = []
    for block in _ordered_blocks(document):
        translated_text = translations.get(block.block_id, "").strip()
        if not translated_text or translated_text == block.text.strip():
            continue
        if block.block_type in SKIPPED_BLOCK_TYPES or block.block_type not in SUPPORTED_BLOCK_TYPES:
            continue
        if is_formula_like_text(block.text, block.block_type):
            continue
        page_size = page_sizes.get(block.page_number)
        if page_size is None:
            continue
        rect = _normalize_rect(block.bbox, *page_size)
        if rect is None:
            continue
        is_bold, is_code = font_info.get(block.block_id, (False, False)) if font_info else (False, False)
        # Skip code / pseudo-code blocks — they should stay in the original language.
        if is_code:
            continue
        plan.append(
            OverlayTextBlock(
                block_id=block.block_id,
                page_number=block.page_number,
                block_type=block.block_type,
                text=translated_text,
                rect=rect,
                is_bold=is_bold,
                is_code=is_code,
            )
        )
    return plan


def _find_font_path(font_path: str | Path | None = None, *, candidates: tuple[str, ...]) -> Path:
    if font_path is not None:
        path = Path(font_path)
        if path.exists():
            return path
        raise FileNotFoundError(f"Font file does not exist: {path}")
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return path
    raise FileNotFoundError("No usable CJK font found for PDF overlay translation.")


def _style_for_block(block: OverlayTextBlock, font_path: str | Path | None = None) -> OverlayStyle:
    is_title = block.block_type in {"title", "heading"}
    is_bold = getattr(block, "is_bold", False) or is_title
    if is_bold:
        candidates = CJK_BOLD_FONT_CANDIDATES
        font_key = "dpp_bold"
    elif is_title:
        candidates = CJK_TITLE_FONT_CANDIDATES
        font_key = "dpp_title"
    else:
        candidates = CJK_FONT_CANDIDATES
        font_key = "dpp_body"
    resolved_font = _find_font_path(font_path, candidates=candidates)
    return OverlayStyle(
        font_key=font_key,
        font_path=resolved_font,
        color=(0.15, 0.15, 0.15) if is_title else (0.18, 0.18, 0.18),
        size_scale=1.0,
    )


def _initial_font_size(block: OverlayTextBlock) -> float:
    height = block.rect[3] - block.rect[1]
    if block.block_type in {"title", "heading"}:
        return min(18.0, max(10.0, height * 0.72))
    if height >= 80:
        return 9.0
    if height >= 45:
        return 9.5
    if height >= 28:
        return 10.0
    return 10.5


def _pick_font_size(page, rect, text: str, font_name: str, start_size: float, min_size: float = 6.0) -> float | None:
    size = start_size
    while size >= min_size:
        shape = page.new_shape()
        remainder = shape.insert_textbox(rect, text, fontname=font_name, fontsize=size, lineheight=1.15)
        if remainder >= 0:
            return size
        size -= 0.5
    return None


def _overlay_blocks(doc, blocks: Iterable[OverlayTextBlock], font_path: str | Path | None = None) -> None:
    import fitz  # type: ignore

    by_page: dict[int, list[OverlayTextBlock]] = {}
    for block in blocks:
        by_page.setdefault(block.page_number, []).append(block)

    for page_number, page_blocks in by_page.items():
        page = doc[page_number - 1]
        inserted_fonts: set[str] = set()
        for block in page_blocks:
            style = _style_for_block(block, font_path=font_path)
            if style.font_key not in inserted_fonts:
                page.insert_font(fontname=style.font_key, fontfile=str(style.font_path))
                inserted_fonts.add(style.font_key)
            rect = fitz.Rect(block.rect)
            # Clean up CID placeholders and prettify inline math for display.
            display_text = prettify_inline_math(clean_cid_placeholders(block.text))
            font_size = _pick_font_size(page, rect, display_text, style.font_key, _initial_font_size(block) * style.size_scale)
            if font_size is None:
                continue
            cover_rect = fitz.Rect(max(0, rect.x0 - 0.5), max(0, rect.y0 - 0.5), min(page.rect.width, rect.x1 + 0.5), min(page.rect.height, rect.y1 + 0.5))
            page.draw_rect(cover_rect, color=None, fill=(1, 1, 1), overlay=True)
            shape = page.new_shape()
            shape.insert_textbox(rect, display_text, fontname=style.font_key, fontsize=font_size, lineheight=1.15, color=style.color)
            shape.commit(overlay=True)


def _strip_all_links(doc) -> None:
    for page in doc:
        for link in list(page.get_links()):
            page.delete_link(link)


def overlay_translated_pdf(
    source_pdf: str | Path | None,
    run_dir: str | Path,
    output_path: str | Path | None = None,
    font_path: str | Path | None = None,
) -> Path:
    fitz = _ensure_fitz()

    run_path = Path(run_dir)
    document = RichDocument.load_json(run_path / "rich_ir.json")
    translations = _load_translations(run_path / "transformed_blocks.jsonl")
    source_path = Path(source_pdf) if source_pdf is not None else Path(document.document.source_path)
    if not source_path.exists():
        raise FileNotFoundError(f"Source PDF does not exist: {source_path}")

    # Pre-scan the source PDF to detect code fonts and bold text per block.
    page_sizes = {page.page_number: (page.width, page.height) for page in document.pages}
    block_rects: dict[str, tuple[int, tuple[float, float, float, float]]] = {}
    for block in document.blocks:
        ps = page_sizes.get(block.page_number)
        if ps is None:
            continue
        rect = _normalize_rect(block.bbox, *ps)
        if rect is not None:
            block_rects[block.block_id] = (block.page_number, rect)

    source_doc = fitz.open(str(source_path))
    try:
        font_info = _analyse_block_fonts(source_doc, block_rects)
    finally:
        source_doc.close()

    plan = build_overlay_plan(document, translations, font_info=font_info)
    output = Path(output_path) if output_path is not None else run_path / DEFAULT_OUTPUT_NAME
    pdf = fitz.open(str(source_path))
    try:
        _overlay_blocks(pdf, plan, font_path=font_path)
        _strip_all_links(pdf)
        pdf.save(str(output), garbage=3, deflate=True)
    finally:
        pdf.close()
    return output
