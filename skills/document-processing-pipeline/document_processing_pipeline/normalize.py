from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from document_processing_pipeline.backends.mineru_adapter import normalize_mineru_document
from document_processing_pipeline.backends.odl_pdf_adapter import normalize_odl_document
from document_processing_pipeline.backends.unstructured_adapter import normalize_unstructured_elements
from document_processing_pipeline.models import RichDocument


def load_rich_document(path: str | Path) -> RichDocument:
    return RichDocument.load_json(path)


def write_rich_document(document: RichDocument, path: str | Path) -> None:
    document.write_json(path)


def normalize_payload(payload: Any, backend: str, source_path: str) -> RichDocument:
    if backend == "unstructured":
        if not isinstance(payload, list):
            raise ValueError("Unstructured payload must be a list of element records.")
        return normalize_unstructured_elements(payload, source_path=source_path)
    if backend == "odl_pdf":
        if not isinstance(payload, dict):
            raise ValueError("OpenDataLoader-PDF payload must be a JSON object.")
        return normalize_odl_document(payload, source_path=source_path)
    if backend == "mineru":
        if not isinstance(payload, (dict, list)):
            raise ValueError("MinerU payload must be a JSON object or list.")
        return normalize_mineru_document(payload, source_path=source_path)
    raise ValueError(f"Unsupported backend for normalization: {backend}")


def normalize_payload_file(
    payload_path: str | Path,
    backend: str,
    source_path: str,
    output_path: str | Path,
) -> Path:
    raw_payload = json.loads(Path(payload_path).read_text(encoding="utf-8"))
    document = normalize_payload(raw_payload, backend=backend, source_path=source_path)
    destination = Path(output_path)
    document.write_json(destination)
    return destination
