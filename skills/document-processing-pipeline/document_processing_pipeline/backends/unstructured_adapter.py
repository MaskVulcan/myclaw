from __future__ import annotations

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
    next_document_id,
)


def _bbox_from_metadata(metadata: dict[str, Any]) -> dict[str, float] | None:
    if not metadata:
        return None
    if isinstance(metadata.get("bbox"), dict):
        return metadata["bbox"]
    coordinates = metadata.get("coordinates") or {}
    points = coordinates.get("points")
    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}


def normalize_unstructured_elements(
    elements: list[dict[str, Any]],
    source_path: str,
    mime_type: str | None = None,
) -> RichDocument:
    pages_seen: set[int] = set()
    blocks: list[BlockRecord] = []
    assets: list[AssetRecord] = []
    tables: list[TableRecord] = []
    figures: list[FigureRecord] = []
    formulas: list[FormulaRecord] = []

    for index, element in enumerate(elements):
        metadata = dict(element.get("metadata") or {})
        page_number = int(metadata.get("page_number") or 1)
        pages_seen.add(page_number)
        block_type = str(element.get("type") or "NarrativeText").lower()
        block_id = str(element.get("element_id") or f"unstructured-{index + 1}")
        bbox = _bbox_from_metadata(metadata)
        text = str(element.get("text") or "")

        if block_type == "image":
            asset_id = f"asset-{block_id}"
            assets.append(
                AssetRecord(
                    asset_id=asset_id,
                    asset_type="image",
                    source_path=metadata.get("image_path"),
                    page_number=page_number,
                    block_id=block_id,
                    metadata={key: value for key, value in metadata.items() if key != "page_number"},
                )
            )
            figures.append(
                FigureRecord(
                    figure_id=f"figure-{block_id}",
                    page_number=page_number,
                    block_id=block_id,
                    asset_id=asset_id,
                    caption=metadata.get("caption"),
                    metadata={key: value for key, value in metadata.items() if key != "page_number"},
                )
            )
        if block_type == "table":
            tables.append(
                TableRecord(
                    table_id=f"table-{block_id}",
                    page_number=page_number,
                    block_id=block_id,
                    html=str(metadata.get("text_as_html") or metadata.get("table_html") or ""),
                    caption=metadata.get("caption"),
                    metadata={key: value for key, value in metadata.items() if key != "page_number"},
                )
            )
        if block_type in {"formula", "equation"}:
            formulas.append(
                FormulaRecord(
                    formula_id=f"formula-{block_id}",
                    page_number=page_number,
                    block_id=block_id,
                    latex=metadata.get("latex"),
                    text=text,
                    metadata={key: value for key, value in metadata.items() if key != "page_number"},
                )
            )

        blocks.append(
            BlockRecord(
                block_id=block_id,
                page_number=page_number,
                block_type=block_type,
                reading_order=index,
                text=text,
                bbox=bbox,
                source_ids=[block_id],
                metadata={key: value for key, value in metadata.items() if key != "page_number"},
            )
        )

    pages = [PageInfo(page_number=page_number, width=595.0, height=842.0) for page_number in sorted(pages_seen or {1})]
    return RichDocument(
        document=DocumentMeta(
            id=next_document_id(source_path),
            source_path=source_path,
            backend="unstructured",
            mime_type=mime_type,
        ),
        pages=pages,
        blocks=blocks,
        assets=assets,
        tables=tables,
        figures=figures,
        formulas=formulas,
        provenance=ProvenanceRecord(source_backend="unstructured"),
        warnings=[],
    )
