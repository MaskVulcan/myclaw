from __future__ import annotations

from dataclasses import dataclass, field, fields
import json
from pathlib import Path
from typing import Any


def _strip_none(value: Any) -> Any:
    if isinstance(value, list):
        return [_strip_none(item) for item in value]
    if isinstance(value, dict):
        return {key: _strip_none(item) for key, item in value.items() if item is not None}
    return value


def _build_dataclass(cls: type, payload: dict[str, Any]) -> Any:
    allowed = {item.name for item in fields(cls)}
    data = {key: value for key, value in payload.items() if key in allowed}
    return cls(**data)


class _DictMixin:
    """Shared ``from_dict`` / ``to_dict`` helpers for all IR dataclasses."""

    @classmethod
    def from_dict(cls, payload: dict[str, Any]):
        return _build_dataclass(cls, payload)

    def to_dict(self) -> dict[str, Any]:
        return _strip_none({f.name: getattr(self, f.name) for f in fields(self)})  # type: ignore[arg-type]


@dataclass
class DocumentMeta(_DictMixin):
    id: str
    source_path: str
    backend: str
    mime_type: str | None = None
    source_type: str | None = None
    language: str | None = None
    title: str | None = None
    created_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PageInfo(_DictMixin):
    page_number: int
    width: float
    height: float
    rotation: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class BlockRecord(_DictMixin):
    block_id: str
    page_number: int
    block_type: str
    reading_order: int
    text: str = ""
    bbox: dict[str, float] | None = None
    source_ids: list[str] = field(default_factory=list)
    section_path: list[str] = field(default_factory=list)
    parent_block_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class AssetRecord(_DictMixin):
    asset_id: str
    asset_type: str
    source_path: str | None = None
    page_number: int | None = None
    block_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class TableRecord(_DictMixin):
    table_id: str
    page_number: int
    block_id: str | None = None
    html: str = ""
    caption: str | None = None
    cells: list[list[str]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class FigureRecord(_DictMixin):
    figure_id: str
    page_number: int
    block_id: str | None = None
    asset_id: str | None = None
    caption: str | None = None
    text: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class FormulaRecord(_DictMixin):
    formula_id: str
    page_number: int
    block_id: str | None = None
    latex: str | None = None
    text: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProvenanceRecord(_DictMixin):
    source_backend: str
    source_version: str | None = None
    parser_mode: str | None = None
    fallback_chain: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class TransformBlock(_DictMixin):
    block_id: str
    text: str
    source_block_ids: list[str] = field(default_factory=list)
    section_path: list[str] = field(default_factory=list)
    transform_policy: str = "rewrite"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class RichDocument:
    document: DocumentMeta
    pages: list[PageInfo] = field(default_factory=list)
    blocks: list[BlockRecord] = field(default_factory=list)
    assets: list[AssetRecord] = field(default_factory=list)
    tables: list[TableRecord] = field(default_factory=list)
    figures: list[FigureRecord] = field(default_factory=list)
    formulas: list[FormulaRecord] = field(default_factory=list)
    provenance: ProvenanceRecord | None = None
    warnings: list[str] = field(default_factory=list)

    def model_dump(self) -> dict[str, Any]:
        return {
            "document": self.document.to_dict(),
            "pages": [page.to_dict() for page in self.pages],
            "blocks": [block.to_dict() for block in self.blocks],
            "assets": [asset.to_dict() for asset in self.assets],
            "tables": [table.to_dict() for table in self.tables],
            "figures": [figure.to_dict() for figure in self.figures],
            "formulas": [formula.to_dict() for formula in self.formulas],
            "provenance": self.provenance.to_dict() if self.provenance else None,
            "warnings": list(self.warnings),
        }

    def to_json(self) -> str:
        return json.dumps(self.model_dump(), ensure_ascii=False, indent=2)

    def write_json(self, path: str | Path) -> None:
        Path(path).write_text(self.to_json(), encoding="utf-8")

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "RichDocument":
        return cls(
            document=DocumentMeta.from_dict(payload["document"]),
            pages=[PageInfo.from_dict(page) for page in payload.get("pages", [])],
            blocks=[BlockRecord.from_dict(block) for block in payload.get("blocks", [])],
            assets=[AssetRecord.from_dict(asset) for asset in payload.get("assets", [])],
            tables=[TableRecord.from_dict(table) for table in payload.get("tables", [])],
            figures=[FigureRecord.from_dict(figure) for figure in payload.get("figures", [])],
            formulas=[FormulaRecord.from_dict(formula) for formula in payload.get("formulas", [])],
            provenance=ProvenanceRecord.from_dict(payload["provenance"]) if payload.get("provenance") else None,
            warnings=list(payload.get("warnings", [])),
        )

    @classmethod
    def from_json(cls, text: str) -> "RichDocument":
        return cls.from_dict(json.loads(text))

    @classmethod
    def load_json(cls, path: str | Path) -> "RichDocument":
        return cls.from_json(Path(path).read_text(encoding="utf-8"))


def next_document_id(source_path: str) -> str:
    return Path(source_path).stem or "document"
