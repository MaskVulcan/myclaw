from __future__ import annotations

import json
from pathlib import Path

import pytest

from document_processing_pipeline import ocr_local


def test_extract_pdf_text_local_uses_pdftotext_when_available(monkeypatch, tmp_path: Path):
    source = tmp_path / "paper.pdf"
    source.write_bytes(b"%PDF-test")

    monkeypatch.setattr(ocr_local.shutil, "which", lambda name: "/usr/bin/pdftotext" if name == "pdftotext" else None)

    class _Completed:
        returncode = 0
        stdout = "hello world"
        stderr = ""

    monkeypatch.setattr(ocr_local.subprocess, "run", lambda *args, **kwargs: _Completed())

    output = ocr_local.extract_pdf_text_local(source)

    assert output.read_text(encoding="utf-8") == "hello world"


def test_extract_pdf_text_local_supports_page_ranges_and_jsonl(monkeypatch, tmp_path: Path):
    source = tmp_path / "paper.pdf"
    source.write_bytes(b"%PDF-test")

    monkeypatch.setattr(ocr_local.shutil, "which", lambda name: "/usr/bin/pdftotext" if name == "pdftotext" else None)

    def _run(args, **kwargs):
        page_number = int(args[args.index("-f") + 1])

        class _Completed:
            returncode = 0
            stdout = f"page-{page_number}"
            stderr = ""

        return _Completed()

    monkeypatch.setattr(ocr_local.subprocess, "run", _run)

    output = ocr_local.extract_pdf_text_local(source, pages="1,3-4", output_format="jsonl")
    rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]

    assert [row["page_number"] for row in rows] == [1, 3, 4]
    assert rows[1]["text"] == "page-3"


def test_extract_pdf_text_local_supports_image_inputs(monkeypatch, tmp_path: Path):
    source = tmp_path / "scan.png"
    source.write_bytes(b"PNG")
    monkeypatch.setattr(ocr_local.shutil, "which", lambda name: "/usr/bin/tesseract" if name == "tesseract" else None)

    class _Completed:
        returncode = 0
        stdout = "image text"
        stderr = ""

    monkeypatch.setattr(ocr_local.subprocess, "run", lambda *args, **kwargs: _Completed())

    output = ocr_local.extract_pdf_text_local(source, lang="chi_sim")

    assert output.read_text(encoding="utf-8") == "image text"


def test_extract_pdf_text_local_force_ocr_honors_selected_pages(monkeypatch, tmp_path: Path):
    source = tmp_path / "paper.pdf"
    source.write_bytes(b"%PDF-test")
    monkeypatch.setattr(ocr_local.shutil, "which", lambda name: "/usr/bin/tesseract" if name == "tesseract" else None)

    class _FakePix:
        def __init__(self, page_number: int):
            self.page_number = page_number

        def save(self, path: str) -> None:
            Path(path).write_text(str(self.page_number), encoding="utf-8")

    class _FakePage:
        def __init__(self, page_number: int):
            self.page_number = page_number

        def get_pixmap(self, dpi: int, alpha: bool):
            return _FakePix(self.page_number)

    class _FakeDocument:
        page_count = 4

        def __getitem__(self, index: int):
            return _FakePage(index + 1)

        def close(self) -> None:
            return None

    monkeypatch.setattr(ocr_local, "ensure_fitz", lambda: type("FakeFitz", (), {"open": staticmethod(lambda _: _FakeDocument())}))

    def _run(args, **kwargs):
        image_path = Path(args[1])
        page_number = image_path.stem.split("-")[-1]

        class _Completed:
            returncode = 0
            stdout = f"ocr-{page_number}"
            stderr = ""

        return _Completed()

    monkeypatch.setattr(ocr_local.subprocess, "run", _run)

    output = ocr_local.extract_pdf_text_local(source, force_ocr=True, pages="2-3")
    text = output.read_text(encoding="utf-8")

    assert "# Page 2" in text
    assert "ocr-2" in text
    assert "# Page 3" in text


def test_extract_pdf_text_local_raises_without_tools(monkeypatch, tmp_path: Path):
    source = tmp_path / "paper.pdf"
    source.write_bytes(b"%PDF-test")
    monkeypatch.setattr(ocr_local.shutil, "which", lambda name: None)

    with pytest.raises(ocr_local.LocalOCRError):
        ocr_local.extract_pdf_text_local(source)
