from __future__ import annotations

from dataclasses import dataclass
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from document_processing_pipeline.io_helpers import ensure_fitz


class LocalOCRError(RuntimeError):
    pass


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}


@dataclass(frozen=True)
class OCRPageRecord:
    page_number: int
    text: str
    engine: str

    def to_dict(self) -> dict[str, object]:
        return {"page_number": self.page_number, "text": self.text, "engine": self.engine}


def _normalize_text(text: str) -> str:
    return text.replace("\f", "").strip()


def _parse_page_selection(selection: str | None, total_pages: int | None = None) -> list[int]:
    if not selection:
        if total_pages is None:
            return []
        return list(range(1, total_pages + 1))

    pages: set[int] = set()
    for chunk in selection.split(","):
        part = chunk.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            if not start_text.strip() or not end_text.strip():
                raise LocalOCRError(f"Invalid page range: {part}")
            start = int(start_text)
            end = int(end_text)
            if start <= 0 or end <= 0 or end < start:
                raise LocalOCRError(f"Invalid page range: {part}")
            pages.update(range(start, end + 1))
        else:
            value = int(part)
            if value <= 0:
                raise LocalOCRError(f"Invalid page number: {part}")
            pages.add(value)

    ordered = sorted(pages)
    if total_pages is not None and ordered and ordered[-1] > total_pages:
        raise LocalOCRError(f"Page selection exceeds document length ({total_pages} pages).")
    return ordered


def _default_output_path(source: Path, output_format: str) -> Path:
    return source.with_suffix(".ocr.jsonl" if output_format == "jsonl" else ".ocr.md")


def _write_output(records: list[OCRPageRecord], output_path: Path, output_format: str) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "jsonl":
        with output_path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")
        return output_path

    if len(records) == 1:
        output_path.write_text(records[0].text, encoding="utf-8")
        return output_path

    body = "\n\n".join(f"# Page {record.page_number}\n\n{record.text}".rstrip() for record in records).strip()
    output_path.write_text(body, encoding="utf-8")
    return output_path


def _extract_pdf_with_pdftotext(source: Path, page_numbers: list[int]) -> list[OCRPageRecord]:
    records: list[OCRPageRecord] = []
    for page_number in page_numbers:
        completed = subprocess.run(
            ["pdftotext", "-layout", "-f", str(page_number), "-l", str(page_number), str(source), "-"],
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise LocalOCRError(completed.stderr.strip() or f"pdftotext failed on page {page_number}")
        records.append(
            OCRPageRecord(page_number=page_number, text=_normalize_text(completed.stdout), engine="pdftotext")
        )
    return records


def _extract_full_pdf_with_pdftotext(source: Path) -> list[OCRPageRecord]:
    completed = subprocess.run(
        ["pdftotext", "-layout", str(source), "-"],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise LocalOCRError(completed.stderr.strip() or "pdftotext failed.")
    parts = completed.stdout.split("\f")
    records = [
        OCRPageRecord(page_number=index, text=_normalize_text(part), engine="pdftotext")
        for index, part in enumerate(parts, start=1)
        if part.strip() or len(parts) == 1
    ]
    return records or [OCRPageRecord(page_number=1, text="", engine="pdftotext")]


def _ocr_pdf_with_tesseract(source: Path, page_numbers: list[int], lang: str, tesseract: str) -> list[OCRPageRecord]:
    fitz = ensure_fitz()
    document = fitz.open(str(source))
    records: list[OCRPageRecord] = []
    try:
        with tempfile.TemporaryDirectory(prefix="docpipe-ocr-") as temp_dir:
            for page_number in page_numbers:
                page = document[page_number - 1]
                pix = page.get_pixmap(dpi=200, alpha=False)
                image_path = Path(temp_dir) / f"page-{page_number}.png"
                pix.save(str(image_path))
                completed = subprocess.run(
                    [tesseract, str(image_path), "stdout", "-l", lang],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if completed.returncode != 0:
                    raise LocalOCRError(completed.stderr.strip() or f"tesseract failed on page {page_number}")
                records.append(
                    OCRPageRecord(page_number=page_number, text=_normalize_text(completed.stdout), engine="tesseract")
                )
    finally:
        document.close()
    return records


def _ocr_image_with_tesseract(source: Path, lang: str, tesseract: str) -> list[OCRPageRecord]:
    completed = subprocess.run(
        [tesseract, str(source), "stdout", "-l", lang],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise LocalOCRError(completed.stderr.strip() or f"tesseract failed on image {source.name}")
    return [OCRPageRecord(page_number=1, text=_normalize_text(completed.stdout), engine="tesseract")]


def extract_text_local(
    source_path: str | Path,
    *,
    output_path: str | Path | None = None,
    lang: str = "eng",
    force_ocr: bool = False,
    pages: str | None = None,
    output_format: str = "markdown",
) -> Path:
    source = Path(source_path)
    if not source.exists():
        raise FileNotFoundError(f"Source file not found: {source}")
    if output_format not in {"markdown", "jsonl"}:
        raise LocalOCRError(f"Unsupported OCR output format: {output_format}")

    output = Path(output_path) if output_path is not None else _default_output_path(source, output_format)
    suffix = source.suffix.lower()

    if suffix in IMAGE_SUFFIXES:
        selected_pages = _parse_page_selection(pages, total_pages=1) if pages else [1]
        if selected_pages != [1]:
            raise LocalOCRError("Image OCR only supports page 1.")
        tesseract = shutil.which("tesseract")
        if not tesseract:
            raise LocalOCRError("tesseract is not available. Install `tesseract` for local image OCR.")
        return _write_output(_ocr_image_with_tesseract(source, lang, tesseract), output, output_format)

    if suffix != ".pdf":
        raise LocalOCRError(f"Local OCR supports PDF or image inputs, got: {source.suffix or source.name}")

    page_numbers = _parse_page_selection(pages, total_pages=None)
    pdftotext = shutil.which("pdftotext")
    if not force_ocr and pdftotext:
        records = _extract_pdf_with_pdftotext(source, page_numbers) if page_numbers else _extract_full_pdf_with_pdftotext(source)
        if any(record.text for record in records):
            return _write_output(records, output, output_format)

    tesseract = shutil.which("tesseract")
    if not tesseract:
        raise LocalOCRError("tesseract is not available. Install `tesseract` or use pdftotext for digital PDFs.")

    if not page_numbers:
        fitz = ensure_fitz()
        document = fitz.open(str(source))
        try:
            page_numbers = list(range(1, document.page_count + 1))
        finally:
            document.close()

    return _write_output(_ocr_pdf_with_tesseract(source, page_numbers, lang, tesseract), output, output_format)


def extract_pdf_text_local(
    source_path: str | Path,
    *,
    output_path: str | Path | None = None,
    lang: str = "eng",
    force_ocr: bool = False,
    pages: str | None = None,
    output_format: str = "markdown",
) -> Path:
    return extract_text_local(
        source_path,
        output_path=output_path,
        lang=lang,
        force_ocr=force_ocr,
        pages=pages,
        output_format=output_format,
    )
