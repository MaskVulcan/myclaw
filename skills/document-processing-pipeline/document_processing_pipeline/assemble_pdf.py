from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from document_processing_pipeline import bootstrap as dependency_bootstrap
from document_processing_pipeline.assemble_html import assemble_html
from document_processing_pipeline.assemble_markdown import render_markdown_lines
from document_processing_pipeline.backends.stirling_adapter import stirling_healthcheck, submit_stirling_html_to_pdf
from document_processing_pipeline.io_helpers import find_cjk_font, load_document

def _wrap_text(text: str, width: int = 90) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        if len(current) + 1 + len(word) <= width:
            current = f"{current} {word}"
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _content_streams(lines: Iterable[str]) -> list[str]:
    page_lines: list[list[str]] = [[]]
    for line in lines:
        wrapped = _wrap_text(line)
        for piece in wrapped:
            if len(page_lines[-1]) >= 46:
                page_lines.append([])
            page_lines[-1].append(piece)
        if len(page_lines[-1]) >= 46:
            page_lines.append([])
        page_lines[-1].append("")
    return [
        "BT\n/F1 12 Tf\n50 792 Td\n14 TL\n" + "\n".join([f"({_escape_pdf_text(line)}) Tj\nT*" for line in page if line is not None]) + "\nET"
        for page in page_lines
        if page
    ]


def _write_basic_pdf(lines: list[str], output_path: Path) -> Path:
    streams = _content_streams(lines)
    objects: list[bytes] = []

    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{index + 3} 0 R" for index in range(len(streams)))
    objects.append(f"<< /Type /Pages /Count {len(streams)} /Kids [{kids}] >>".encode())

    page_object_ids: list[int] = []
    for index, _stream in enumerate(streams):
        content_id = len(objects) + len(streams) + 1 + index
        page_object_ids.append(content_id)

    for index in range(len(streams)):
        content_object_number = 3 + len(streams) + index
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {3 + (len(streams) * 2)} 0 R >> >> /Contents {content_object_number} 0 R >>".encode()
        )

    for stream in streams:
        encoded = stream.encode("utf-8")
        objects.append(f"<< /Length {len(encoded)} >>\nstream\n".encode() + encoded + b"\nendstream")

    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode())
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode())
    output_path.write_bytes(bytes(output))
    return output_path


def _pymupdf_html_to_pdf(html_path: Path, output_path: Path) -> Path | None:
    """Use PyMuPDF Story API to render HTML to PDF with CJK font support."""
    try:
        dependency_bootstrap.ensure_python_dependency("pymupdf")
        import fitz  # type: ignore
    except (ImportError, dependency_bootstrap.DependencyBootstrapError):
        return None

    if not hasattr(fitz, "Story"):
        return None

    html_text = html_path.read_text(encoding="utf-8")

    # Inject a CSS @font-face for CJK coverage via system fonts.
    cjk_css = ""
    cjk_font = find_cjk_font()
    if cjk_font is not None:
        cjk_css = (
            f'@font-face {{ font-family: "DPP-CJK"; src: url("{cjk_font}"); }}\n'
            f"body {{ font-family: 'DPP-CJK', Georgia, serif; }}\n"
        )

    try:
        story = fitz.Story(html_text, user_css=cjk_css)
        writer = fitz.DocumentWriter(str(output_path))
        mediabox = fitz.paper_rect("a4")
        where = mediabox + (36, 36, -36, -36)  # 0.5-inch margins

        more = True
        while more:
            device = writer.begin_page(mediabox)
            more, _ = story.place(where)
            story.draw(device)
            writer.end_page()

        writer.close()
        return output_path
    except Exception:
        return None


def _write_pdf_export_report(
    run_path: Path,
    *,
    renderer: str,
    output_path: Path,
    attempts: list[dict[str, object]],
    warnings: list[str],
) -> None:
    report_path = run_path / "pdf_export_report.json"
    payload = {
        "renderer": renderer,
        "output_path": str(output_path),
        "attempts": attempts,
        "warnings": warnings,
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def assemble_pdf(run_dir: str | Path, stirling_url: str | None = None) -> Path:
    run_path = Path(run_dir)
    output_path = run_path / "output.pdf"
    html_path = assemble_html(run_path)
    attempts: list[dict[str, object]] = []
    warnings: list[str] = []

    # 1. Try WeasyPrint (high-fidelity but needs system libs for CJK).
    try:
        dependency_bootstrap.ensure_python_dependency("weasyprint")
        from weasyprint import HTML  # type: ignore

        HTML(filename=str(html_path)).write_pdf(str(output_path))
        # Verify the output is non-trivial (WeasyPrint can silently produce
        # empty or broken PDFs when system font libraries are incomplete).
        if output_path.exists() and output_path.stat().st_size > 1024:
            attempts.append({"renderer": "weasyprint", "status": "ok"})
            _write_pdf_export_report(run_path, renderer="weasyprint", output_path=output_path, attempts=attempts, warnings=warnings)
            return output_path
        attempts.append({"renderer": "weasyprint", "status": "failed", "reason": "output_too_small"})
        warnings.append("WeasyPrint produced a very small PDF; falling back to the next renderer.")
    except (ImportError, OSError, dependency_bootstrap.DependencyBootstrapError, Exception):
        attempts.append({"renderer": "weasyprint", "status": "failed"})

    # 2. Try PyMuPDF Story API (good CJK support via system fonts).
    result = _pymupdf_html_to_pdf(html_path, output_path)
    if result is not None:
        attempts.append({"renderer": "pymupdf", "status": "ok"})
        _write_pdf_export_report(run_path, renderer="pymupdf", output_path=output_path, attempts=attempts, warnings=warnings)
        return result
    attempts.append({"renderer": "pymupdf", "status": "failed"})

    # 3. Try Stirling-PDF sidecar.
    if stirling_url and stirling_healthcheck(stirling_url):
        result = submit_stirling_html_to_pdf(stirling_url, html_path, output_path)
        attempts.append({"renderer": "stirling", "status": "ok"})
        _write_pdf_export_report(run_path, renderer="stirling", output_path=output_path, attempts=attempts, warnings=warnings)
        return result
    if stirling_url:
        attempts.append({"renderer": "stirling", "status": "failed", "reason": "healthcheck_failed"})

    # 4. Last resort: basic PDF writer (ASCII only, no CJK support).
    document = load_document(run_path)
    lines: list[str] = []
    for chunk in render_markdown_lines(document):
        lines.extend(chunk.splitlines() or [""])
    warnings.append("Fell back to the basic PDF writer; layout fidelity and CJK coverage may be reduced.")
    result = _write_basic_pdf(lines, output_path)
    attempts.append({"renderer": "basic", "status": "ok"})
    _write_pdf_export_report(run_path, renderer="basic", output_path=output_path, attempts=attempts, warnings=warnings)
    return result
