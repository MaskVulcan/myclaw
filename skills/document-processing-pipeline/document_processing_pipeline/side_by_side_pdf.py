"""Create a side-by-side PDF with original pages on the left and translated
overlay pages on the right."""

from __future__ import annotations

from pathlib import Path

from document_processing_pipeline.io_helpers import ensure_fitz as _ensure_fitz, resolve_source_pdf
from document_processing_pipeline.overlay_translate_pdf import overlay_translated_pdf


def side_by_side_pdf(
    run_dir: str | Path,
    source_pdf: str | Path | None = None,
    output_path: str | Path | None = None,
    font_path: str | Path | None = None,
    gap: float = 16.0,
) -> Path:
    """Build a side-by-side PDF: original on left, translated overlay on right.

    If no overlay PDF exists yet, one is generated automatically via
    :func:`overlay_translated_pdf`.
    """
    fitz = _ensure_fitz()
    run_path = Path(run_dir)
    source_path = resolve_source_pdf(source_pdf, run_path)

    # Generate overlay if needed.
    overlay_path = run_path / "output.overlay.pdf"
    if not overlay_path.exists():
        overlay_translated_pdf(
            source_pdf=str(source_path),
            run_dir=run_path,
            output_path=overlay_path,
            font_path=font_path,
        )

    output = Path(output_path) if output_path else run_path / "output.side_by_side.pdf"

    orig = fitz.open(str(source_path))
    over = fitz.open(str(overlay_path))
    result = fitz.open()

    try:
        for i in range(min(orig.page_count, over.page_count)):
            w = orig[i].rect.width
            h = orig[i].rect.height

            page = result.new_page(width=2 * w + gap, height=h)

            # Left = original.
            page.show_pdf_page(fitz.Rect(0, 0, w, h), orig, i)

            # Thin divider.
            mid = w + gap / 2
            page.draw_line(
                fitz.Point(mid, 0),
                fitz.Point(mid, h),
                color=(0.75, 0.75, 0.75),
                width=0.5,
            )

            # Right = translated overlay.
            page.show_pdf_page(fitz.Rect(w + gap, 0, 2 * w + gap, h), over, i)

        result.save(str(output), garbage=3, deflate=True)
    finally:
        result.close()
        orig.close()
        over.close()

    return output
