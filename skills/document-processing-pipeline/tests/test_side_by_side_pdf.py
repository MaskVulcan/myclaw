"""Tests for side_by_side_pdf module."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from document_processing_pipeline.side_by_side_pdf import side_by_side_pdf


def _write_ir(run_dir: Path, source_path: str = "input.pdf") -> None:
    ir = {
        "document": {"id": "doc", "backend": "test", "source_path": source_path},
        "pages": [{"page_number": 1, "width": 200, "height": 300}],
        "blocks": [
            {
                "block_id": "b1",
                "page_number": 1,
                "block_type": "title",
                "reading_order": 0,
                "text": "Hello",
                "bbox": {"x0": 10, "y0": 10, "x1": 190, "y1": 30},
                "source_ids": ["x"],
                "metadata": {},
            },
        ],
        "assets": [],
        "warnings": [],
    }
    (run_dir / "rich_ir.json").write_text(json.dumps(ir), encoding="utf-8")


def _write_translations(run_dir: Path) -> None:
    row = {"block_id": "b1", "text": "你好"}
    (run_dir / "transformed_blocks.jsonl").write_text(
        json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8"
    )


class _FakeRect:
    """Minimal fitz.Rect stand-in for testing."""
    def __init__(self, *args):
        if len(args) == 4:
            self.x0, self.y0, self.x1, self.y1 = args
        elif len(args) == 1 and hasattr(args[0], '__iter__'):
            self.x0, self.y0, self.x1, self.y1 = args[0]
        else:
            self.x0 = self.y0 = 0
            self.x1 = self.y1 = 100
        self.width = self.x1 - self.x0
        self.height = self.y1 - self.y0


class _FakePage:
    def __init__(self, width: float = 200, height: float = 300):
        self.rect = _FakeRect(0, 0, width, height)

    def show_pdf_page(self, *args, **kwargs):
        pass

    def draw_line(self, *args, **kwargs):
        pass


class _FakeDoc:
    def __init__(self, pages=None):
        self._pages = pages or [_FakePage()]
        self.page_count = len(self._pages)
        self._saved = False
        self._save_path = None

    def __getitem__(self, idx):
        return self._pages[idx]

    def new_page(self, width=595, height=842):
        page = _FakePage(width, height)
        self._pages.append(page)
        return page

    def save(self, path, **kwargs):
        self._saved = True
        self._save_path = path
        Path(path).write_bytes(b"%PDF-stub")

    def close(self):
        pass


def test_side_by_side_generates_wider_pages(tmp_path: Path):
    run_dir = tmp_path
    source_pdf = tmp_path / "input.pdf"
    source_pdf.write_bytes(b"%PDF-stub")
    overlay_pdf = tmp_path / "output.overlay.pdf"
    overlay_pdf.write_bytes(b"%PDF-stub")
    _write_ir(run_dir, str(source_pdf))

    orig_doc = _FakeDoc([_FakePage(200, 300)])
    over_doc = _FakeDoc([_FakePage(200, 300)])

    def fake_open(path=None, *args, **kwargs):
        if path is None:
            d = _FakeDoc([])
            d._pages = []
            return d
        p = str(path)
        if "overlay" in p:
            return over_doc
        return orig_doc

    fake_fitz = MagicMock()
    fake_fitz.open = fake_open
    fake_fitz.Rect = _FakeRect
    fake_fitz.Point = lambda x, y: (x, y)

    with patch("document_processing_pipeline.side_by_side_pdf._ensure_fitz", return_value=fake_fitz):
        out = side_by_side_pdf(run_dir, source_pdf=str(source_pdf))

    assert out.exists()


def test_side_by_side_auto_generates_overlay(tmp_path: Path):
    """When overlay PDF doesn't exist, side_by_side_pdf should call overlay_translated_pdf."""
    run_dir = tmp_path
    source_pdf = tmp_path / "input.pdf"
    source_pdf.write_bytes(b"%PDF-stub")
    _write_ir(run_dir, str(source_pdf))
    _write_translations(run_dir)

    # The overlay PDF doesn't exist yet
    assert not (run_dir / "output.overlay.pdf").exists()

    with patch("document_processing_pipeline.side_by_side_pdf.overlay_translated_pdf") as mock_overlay, \
         patch("document_processing_pipeline.side_by_side_pdf._ensure_fitz") as mock_fitz:

        # After overlay_translated_pdf runs, the overlay file should exist
        def create_overlay(*args, **kwargs):
            (run_dir / "output.overlay.pdf").write_bytes(b"%PDF-stub")
            return run_dir / "output.overlay.pdf"
        mock_overlay.side_effect = create_overlay

        fake_fitz = MagicMock()
        orig_doc = _FakeDoc([_FakePage(200, 300)])
        over_doc = _FakeDoc([_FakePage(200, 300)])

        call_count = [0]
        def fake_open(path=None, *a, **kw):
            call_count[0] += 1
            if path is None:
                d = _FakeDoc([])
                d._pages = []
                return d
            p = str(path)
            if "overlay" in p:
                return over_doc
            return orig_doc

        fake_fitz.open = fake_open
        fake_fitz.Rect = _FakeRect
        fake_fitz.Point = lambda x, y: (x, y)
        mock_fitz.return_value = fake_fitz

        out = side_by_side_pdf(run_dir, source_pdf=str(source_pdf))

    mock_overlay.assert_called_once()
