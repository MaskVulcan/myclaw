from __future__ import annotations

from pathlib import Path
from typing import Any

from document_processing_pipeline.models import (
    AssetRecord,
    BlockRecord,
    DocumentMeta,
    FigureRecord,
    FormulaRecord,
    PageInfo,
    ProvenanceRecord,
    RichDocument,
    TableRecord,
)


def _as_bbox(item: dict[str, Any]) -> dict[str, float] | None:
    bbox = item.get("bbox") or item.get("bounding_box")
    if isinstance(bbox, dict):
        return bbox
    return None


def normalize_mineru_document(payload: dict[str, Any] | list[dict[str, Any]], source_path: str) -> RichDocument:
    if isinstance(payload, list):
        payload = {"content_list": payload}

    blocks: list[BlockRecord] = []
    assets: list[AssetRecord] = []
    pages: list[PageInfo] = []
    tables: list[TableRecord] = []
    figures: list[FigureRecord] = []
    formulas: list[FormulaRecord] = []

    if "pdf_info" in payload:
        for page_index, page in enumerate(payload.get("pdf_info") or [], start=1):
            page_number = int(page.get("page_no") or page.get("page_idx") or page_index)
            pages.append(
                PageInfo(
                    page_number=page_number,
                    width=float(page.get("width") or 595.0),
                    height=float(page.get("height") or 842.0),
                )
            )
            for item in page.get("para_blocks") or page.get("blocks") or page.get("layout_dets") or []:
                block_id = str(item.get("block_id") or item.get("id") or f"mineru-{len(blocks) + 1}")
                block_type = str(item.get("type") or item.get("block_type") or "paragraph").lower()
                text = str(item.get("text") or item.get("content") or item.get("html") or "")
                blocks.append(
                    BlockRecord(
                        block_id=block_id,
                        page_number=page_number,
                        block_type=block_type,
                        reading_order=len(blocks),
                        text=text,
                        bbox=_as_bbox(item),
                        source_ids=[block_id],
                        metadata={key: value for key, value in item.items() if key not in {"text", "content"}},
                    )
                )
                image_path = item.get("image_path")
                if image_path:
                    asset_id = f"asset-{block_id}"
                    assets.append(
                        AssetRecord(
                            asset_id=asset_id,
                            asset_type="image",
                            source_path=image_path,
                            page_number=page_number,
                            block_id=block_id,
                        )
                    )
                    figures.append(
                        FigureRecord(
                            figure_id=f"figure-{block_id}",
                            page_number=page_number,
                            block_id=block_id,
                            asset_id=asset_id,
                            caption=item.get("caption"),
                        )
                    )
                if block_type == "table":
                    tables.append(
                        TableRecord(
                            table_id=f"table-{block_id}",
                            page_number=page_number,
                            block_id=block_id,
                            html=str(item.get("html") or item.get("table_body") or ""),
                            caption=item.get("caption"),
                        )
                    )
                if block_type in {"formula", "equation"} or item.get("latex"):
                    formulas.append(
                        FormulaRecord(
                            formula_id=f"formula-{block_id}",
                            page_number=page_number,
                            block_id=block_id,
                            latex=item.get("latex"),
                            text=text,
                        )
                    )
    else:
        content_list = payload.get("content_list") or []
        pages_seen: set[int] = set()
        for item in content_list:
            page_number = int(item.get("page_no") or item.get("page_idx") or 1)
            pages_seen.add(page_number)
            block_id = str(item.get("id") or item.get("block_id") or f"mineru-{len(blocks) + 1}")
            block_type = str(item.get("type") or item.get("category_type") or "paragraph").lower()
            blocks.append(
                BlockRecord(
                    block_id=block_id,
                    page_number=page_number,
                    block_type=block_type,
                    reading_order=len(blocks),
                    text=str(item.get("text") or item.get("content") or ""),
                    bbox=_as_bbox(item),
                    source_ids=[block_id],
                    metadata={key: value for key, value in item.items() if key not in {"text", "content"}},
                )
            )
        pages = [PageInfo(page_number=page_number, width=595.0, height=842.0) for page_number in sorted(pages_seen or {1})]

    return RichDocument(
        document=DocumentMeta(
            id=Path(source_path).stem,
            source_path=source_path,
            backend="mineru",
            mime_type="application/pdf",
            metadata={"version": payload.get("version") or payload.get("_version_name")},
        ),
        pages=pages or [PageInfo(page_number=1, width=595.0, height=842.0)],
        blocks=blocks,
        assets=assets,
        tables=tables,
        figures=figures,
        formulas=formulas,
        provenance=ProvenanceRecord(
            source_backend=str(payload.get("_backend") or "mineru"),
            source_version=payload.get("version") or payload.get("_version_name"),
        ),
        warnings=[],
    )
