from __future__ import annotations

from pathlib import Path
from typing import Any

from document_processing_pipeline.models import BlockRecord, DocumentMeta, PageInfo, ProvenanceRecord, RichDocument, TableRecord


def _extract_bbox(node: dict[str, Any]) -> dict[str, float] | None:
    for key in ("bbox", "boundingBox", "bounding_box"):
        value = node.get(key)
        if isinstance(value, dict):
            return value
    properties = node.get("properties") or {}
    for key in ("bbox", "boundingBox", "bounding_box"):
        value = properties.get(key)
        if isinstance(value, dict):
            return value
    return None


def _walk_nodes(nodes: list[dict[str, Any]], blocks: list[BlockRecord], page_numbers: set[int], page_hint: int = 1) -> None:
    for node in nodes:
        node_type = str(node.get("type") or node.get("name") or "paragraph").lower()
        page_number = int(node.get("page") or node.get("page_number") or page_hint)
        page_numbers.add(page_number)
        text = str(node.get("text") or node.get("content") or "")
        block_id = str(node.get("id") or f"odl-{len(blocks) + 1}")
        children = list(node.get("kids") or node.get("children") or [])
        is_container = node_type in {"document", "page", "section"}
        if text or not is_container:
            blocks.append(
                BlockRecord(
                    block_id=block_id,
                    page_number=page_number,
                    block_type=node_type,
                    reading_order=len(blocks),
                    text=text,
                    bbox=_extract_bbox(node),
                    source_ids=[block_id],
                    metadata={key: value for key, value in node.items() if key not in {"kids", "children", "text", "content"}},
                )
            )
        if children:
            _walk_nodes(children, blocks, page_numbers, page_hint=page_number)


def normalize_odl_document(payload: dict[str, Any], source_path: str) -> RichDocument:
    blocks: list[BlockRecord] = []
    page_numbers: set[int] = set()
    _walk_nodes(list(payload.get("kids") or []), blocks, page_numbers)
    pages = [PageInfo(page_number=page_number, width=595.0, height=842.0) for page_number in sorted(page_numbers or {1})]
    tables = [
        TableRecord(
            table_id=f"table-{block.block_id}",
            page_number=block.page_number,
            block_id=block.block_id,
            html=str(block.metadata.get("html") or block.metadata.get("table_html") or ""),
        )
        for block in blocks
        if block.block_type == "table"
    ]
    return RichDocument(
        document=DocumentMeta(
            id=str(payload.get("documentId") or Path(source_path).stem),
            source_path=source_path,
            backend="odl_pdf",
            mime_type="application/pdf",
        ),
        pages=pages,
        blocks=blocks,
        assets=[],
        tables=tables,
        provenance=ProvenanceRecord(source_backend="odl_pdf"),
        warnings=[],
    )
