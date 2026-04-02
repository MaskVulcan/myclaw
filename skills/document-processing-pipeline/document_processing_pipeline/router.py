from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any


PDF_HINT_KEYS = {"prefer_mineru", "ocr_required", "contains_formulas", "complex_tables", "multi_column"}
DOCX_SUFFIXES = {".docx"}
XLSX_SUFFIXES = {".xlsx"}
PPTX_SUFFIXES = {".pptx"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
PDF_DIRECT_TASKS = {"pdf-direct", "merge-pdf", "split-pdf", "rotate-pdf", "watermark-pdf", "form-fill-pdf", "extract-pdf"}
PIPELINE_TASKS = {"translate", "summarize", "simplify", "rebuild", "extract-text", "overlay-pdf", "side-by-side-pdf"}


def infer_mime_type(source_path: str, mime_type: str | None = None) -> str | None:
    if mime_type:
        return mime_type
    guessed, _ = mimetypes.guess_type(source_path)
    return guessed


def _capability(capabilities: dict[str, Any], name: str) -> bool:
    if not capabilities:
        return False
    if name in set(capabilities.get("available", [])):
        return True
    if name in capabilities.get("packages", {}):
        return bool(capabilities["packages"][name])
    if name in capabilities.get("binaries", {}):
        return bool(capabilities["binaries"][name])
    if name in capabilities.get("features", {}):
        return bool(capabilities["features"][name])
    if name in capabilities.get("optional_packages", {}):
        return bool(capabilities["optional_packages"][name])
    if name in capabilities.get("optional_binaries", {}):
        return bool(capabilities["optional_binaries"][name])
    return False


def _checkout_available(capabilities: dict[str, Any], name: str) -> bool:
    local_checkouts = capabilities.get("local_checkouts", {})
    if name == "odl_pdf":
        return bool(local_checkouts.get("opendataloader_pdf_checkout"))
    if name == "mineru":
        return bool(local_checkouts.get("mineru_checkout"))
    return False


def _pdf_backend_available(capabilities: dict[str, Any], backend: str) -> bool:
    backend_support = capabilities.get("backends", {})
    if backend in backend_support:
        return bool(backend_support[backend])
    if backend == "odl_pdf":
        return _capability(capabilities, "opendataloader_pdf") or _checkout_available(capabilities, backend)
    if backend == "mineru":
        return _capability(capabilities, "mineru") or _checkout_available(capabilities, backend)
    return False


def choose_backend(
    source_path: str,
    mime_type: str | None = None,
    hints: dict[str, Any] | None = None,
    capabilities: dict[str, Any] | None = None,
) -> str:
    hints = hints or {}
    capabilities = capabilities or {}

    preferred = hints.get("backend")
    if preferred:
        return str(preferred)

    suffix = Path(source_path).suffix.lower()
    inferred_mime = infer_mime_type(source_path, mime_type) or ""

    if suffix == ".pdf" or inferred_mime == "application/pdf":
        if any(hints.get(key) for key in PDF_HINT_KEYS):
            # When PDF-specific hints are present, strongly prefer MinerU.
            if _pdf_backend_available(capabilities, "mineru"):
                return "mineru"
        if _pdf_backend_available(capabilities, "mineru"):
            return "mineru"
        return "unstructured"

    office_suffixes = {".docx", ".doc", ".odt", ".rtf"}
    web_suffixes = {".html", ".htm", ".xhtml", ".webarchive"}
    text_suffixes = {".txt", ".md", ".rst", ".csv", ".json", ".xml", ".eml"}

    if suffix in office_suffixes or "wordprocessingml" in inferred_mime:
        return "unstructured"
    if suffix in web_suffixes or inferred_mime.startswith("text/html"):
        return "unstructured"
    if suffix in text_suffixes or inferred_mime.startswith("text/"):
        return "unstructured"

    return "unstructured"


def default_run_dir(source_path: str, run_dir: str | None = None) -> str:
    if run_dir:
        return run_dir
    stem = Path(source_path).stem or "run"
    return str(Path("work") / stem)


def route_document_task(
    source_path: str,
    *,
    task: str,
    capabilities: dict[str, Any] | None = None,
    run_dir: str | None = None,
    mime_type: str | None = None,
    output_format: str | None = None,
    source_lang: str | None = None,
    target_lang: str | None = None,
    backend: str | None = None,
    requires_redline: bool = False,
    requires_review: bool = False,
    requires_ocr: bool = False,
    layout_preserving: bool = False,
) -> dict[str, Any]:
    capabilities = capabilities or {}
    suffix = Path(source_path).suffix.lower()
    chosen_run_dir = default_run_dir(source_path, run_dir)

    if task in {"edit-docx", "compare-docx"} or (suffix in DOCX_SUFFIXES and requires_redline):
        commands = [["docpipe", "docx-inspect", source_path]]
        if task == "compare-docx":
            commands.append(["docpipe", "docx-compare", source_path, "REVISED.docx"])
        else:
            commands.extend(
                [
                    ["docpipe", "docx-apply-plan", source_path, "--plan", "edits.jsonl", "--output", "edited.docx"],
                    ["docpipe", "docx-compare", source_path, "edited.docx"],
                ]
            )
        return {
            "lane": "local_docx",
            "available": True,
            "reason": "Existing DOCX edits should use local OOXML inspection, replacement, and compare commands.",
            "commands": commands,
            "warnings": [
                "Local DOCX replacement preserves paragraph-level structure and styles, but changed paragraphs lose original inline run formatting and native tracked-changes markup."
            ],
        }

    if task == "extract-fields" or requires_review or (requires_ocr and (suffix == ".pdf" or suffix in IMAGE_SUFFIXES)):
        if suffix in IMAGE_SUFFIXES:
            available = _capability(capabilities, "tesseract")
        else:
            available = _capability(capabilities, "local_ocr") or _capability(capabilities, "pdftotext")
        return {
            "lane": "local_ocr",
            "available": available,
            "reason": "OCR-first extraction should use local PDF or image OCR commands, then hand the text to the LLM or pipeline.",
            "commands": [
                ["docpipe", "ocr-pdf", source_path, "--output", str(Path(chosen_run_dir) / "ocr.md")],
                ["docpipe", "ingest", str(Path(chosen_run_dir) / "ocr.md"), "--run-dir", chosen_run_dir],
                ["docpipe", "derive-text", "--run-dir", chosen_run_dir],
            ],
            "warnings": [] if available else ["Local OCR is unavailable. Install `pdftotext` for digital PDFs or `tesseract` plus PyMuPDF for scanned PDFs and images."],
        }

    if task in PIPELINE_TASKS:
        chosen_backend = choose_backend(
            source_path,
            mime_type=mime_type,
            hints={
                "backend": backend,
                "ocr_required": requires_ocr,
                "prefer_mineru": layout_preserving,
                "contains_formulas": layout_preserving,
            },
            capabilities=capabilities,
        )
        commands: list[list[str]] = [
            ["docpipe", "ingest", source_path, "--run-dir", chosen_run_dir, "--backend", chosen_backend],
            ["docpipe", "derive-text", "--run-dir", chosen_run_dir],
        ]
        final_output = output_format
        if task == "translate":
            commands.append(
                [
                    "docpipe",
                    "translate-blocks",
                    "--run-dir",
                    chosen_run_dir,
                    "--source-lang",
                    source_lang or "SOURCE_LANG",
                    "--target-lang",
                    target_lang or "TARGET_LANG",
                ]
            )
            commands.append(["docpipe", "merge-translations", "--run-dir", chosen_run_dir])
            final_output = final_output or (
                "overlay-pdf" if suffix == ".pdf" and layout_preserving else ("docx" if suffix in {".doc", ".docx"} else "markdown")
            )
        else:
            final_output = final_output or ("overlay-pdf" if task == "overlay-pdf" else "side-by-side-pdf" if task == "side-by-side-pdf" else "markdown")
        if task not in {"extract-text"}:
            commands.append(["docpipe", "reconcile", "--run-dir", chosen_run_dir])
        if final_output == "overlay-pdf":
            commands.append(["docpipe", "overlay-pdf", "--run-dir", chosen_run_dir, "--source-pdf", source_path])
        elif final_output == "side-by-side-pdf":
            commands.append(["docpipe", "side-by-side-pdf", "--run-dir", chosen_run_dir, "--source-pdf", source_path])
        elif final_output == "docx":
            commands.append(["docpipe", "assemble-docx", "--run-dir", chosen_run_dir])
        elif final_output == "html":
            commands.append(["docpipe", "assemble-html", "--run-dir", chosen_run_dir])
        elif final_output == "pdf":
            commands.append(["docpipe", "assemble-pdf", "--run-dir", chosen_run_dir])
        else:
            commands.append(["docpipe", "assemble-markdown", "--run-dir", chosen_run_dir])
        return {
            "lane": "pipeline",
            "available": True,
            "reason": "Transform-oriented document workflows should use the IR pipeline.",
            "backend": chosen_backend,
            "run_dir": chosen_run_dir,
            "commands": commands,
            "warnings": [],
        }

    if suffix == ".pdf" and task in PDF_DIRECT_TASKS:
        return {
            "lane": "direct_pdf",
            "available": _capability(capabilities, "pypdf") or _capability(capabilities, "pdf_forms") or _capability(capabilities, "pdf_table_extract"),
            "reason": "Direct PDF operations do not need the IR pipeline.",
            "driver": "pypdf/pdfplumber/qpdf",
            "commands": [["docpipe", "doctor"]],
            "warnings": ["Use the local PDF helpers reported by `docpipe doctor` for merge/split/form-fill/extraction tasks."],
        }

    if suffix in XLSX_SUFFIXES:
        return {
            "lane": "direct_xlsx",
            "available": _capability(capabilities, "xlsx_edit") or _capability(capabilities, "xlsx_analysis"),
            "reason": "Spreadsheet edits and analysis should use local workbook helpers instead of the IR pipeline.",
            "driver": "openpyxl/pandas",
            "commands": [["docpipe", "doctor"]],
            "warnings": ["Use `openpyxl` for workbook edits and `pandas` for analysis."],
        }

    if suffix in PPTX_SUFFIXES:
        return {
            "lane": "direct_pptx",
            "available": _capability(capabilities, "pptx_edit"),
            "reason": "Slide authoring and edits should use local PPTX helpers.",
            "driver": "python-pptx",
            "commands": [["docpipe", "doctor"]],
            "warnings": ["Use `python-pptx` for deterministic local slide generation."],
        }

    return {
        "lane": "pipeline",
        "available": True,
        "reason": "Fallback route: use the IR pipeline.",
        "backend": choose_backend(source_path, mime_type=mime_type, capabilities=capabilities),
        "run_dir": chosen_run_dir,
        "commands": [["docpipe", "ingest", source_path, "--run-dir", chosen_run_dir]],
        "warnings": ["No specialized route matched exactly; falling back to the core pipeline."],
    }
