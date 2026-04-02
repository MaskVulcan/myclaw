from pathlib import Path
import builtins
from shutil import which
import subprocess
import sys
import types
from zipfile import ZipFile

import pytest

from document_processing_pipeline.assemble_docx import assemble_docx
from document_processing_pipeline import assemble_pdf as assemble_pdf_module
from document_processing_pipeline.assemble_pdf import assemble_pdf


def _import_raising_for(prefixes: tuple[str, ...]):
    original_import = builtins.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if any(name == prefix or name.startswith(f"{prefix}.") for prefix in prefixes):
            raise ImportError(name)
        return original_import(name, globals, locals, fromlist, level)

    return fake_import


def _write_fixture(run_dir: Path) -> None:
    (run_dir / "rich_ir.transformed.json").write_text(
        '{"document":{"id":"doc","backend":"test","source_path":"x"},"pages":[{"page_number":1,"width":1,"height":1}],"blocks":[{"block_id":"b1","page_number":1,"block_type":"paragraph","reading_order":0,"text":"Hello","bbox":null,"source_ids":["x"],"metadata":{}}],"assets":[],"warnings":[]}',
        encoding="utf-8",
    )


@pytest.mark.skipif(which("textutil") is None, reason="textutil is required for fallback DOCX export")
def test_docx_export_creates_file(tmp_path: Path):
    _write_fixture(tmp_path)
    assemble_docx(tmp_path)
    output_path = tmp_path / "output.docx"
    assert output_path.exists()
    with ZipFile(output_path) as archive:
        assert "[Content_Types].xml" in archive.namelist()
        document_xml = archive.read("word/document.xml").decode("utf-8")
    assert "Hello" in document_xml


def test_docx_export_attempts_bootstrap_before_basic_writer(monkeypatch, tmp_path: Path):
    _write_fixture(tmp_path)
    calls: list[str] = []
    monkeypatch.delitem(sys.modules, "docx", raising=False)
    monkeypatch.setattr(
        sys.modules["document_processing_pipeline.assemble_docx"],
        "dependency_bootstrap",
        types.SimpleNamespace(
            ensure_python_dependency=lambda key, auto_install=None: calls.append(key) or False,
            DependencyBootstrapError=RuntimeError,
        ),
    )

    assemble_docx(tmp_path)

    assert calls == ["python_docx"]
    assert (tmp_path / "output.docx").exists()


@pytest.mark.skipif(which("swift") is None, reason="swift is required for PDFKit validation")
def test_pdf_export_creates_file(tmp_path: Path):
    _write_fixture(tmp_path)
    assemble_pdf(tmp_path)
    payload = (tmp_path / "output.pdf").read_bytes()
    assert payload.startswith(b"%PDF-")
    cache_root = tmp_path / ".swift-cache"
    cache_root.mkdir()
    result = subprocess.run(
        [
            "swift",
            "-e",
            "import Foundation; import PDFKit; let url = URL(fileURLWithPath: CommandLine.arguments[1]); guard let doc = PDFDocument(url: url) else { Foundation.exit(2) }; print(doc.pageCount); Foundation.exit(doc.pageCount > 0 ? 0 : 1)",
            str(tmp_path / "output.pdf"),
        ],
        capture_output=True,
        text=True,
        check=False,
        env={
            "HOME": str(tmp_path),
            "XDG_CACHE_HOME": str(cache_root),
            "CLANG_MODULE_CACHE_PATH": str(cache_root / "clang"),
            "SWIFT_MODULECACHE_PATH": str(cache_root / "swift"),
            "PATH": str(Path("/usr/bin")) + ":" + str(Path("/bin")) + ":" + str(Path("/usr/sbin")) + ":" + str(Path("/sbin")),
        },
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_pdf_export_attempts_bootstrap_before_basic_writer(monkeypatch, tmp_path: Path):
    _write_fixture(tmp_path)
    calls: list[str] = []
    monkeypatch.delitem(sys.modules, "weasyprint", raising=False)
    monkeypatch.setattr(builtins, "__import__", _import_raising_for(("weasyprint",)))
    monkeypatch.setattr(
        sys.modules["document_processing_pipeline.assemble_pdf"],
        "dependency_bootstrap",
        types.SimpleNamespace(
            ensure_python_dependency=lambda key, auto_install=None: calls.append(key) or False,
            DependencyBootstrapError=RuntimeError,
        ),
    )

    assemble_pdf(tmp_path)

    assert calls == ["weasyprint", "pymupdf"]
    assert (tmp_path / "output.pdf").exists()
    assert (tmp_path / "pdf_export_report.json").exists()


def test_pdf_export_writes_basic_fallback_report(monkeypatch, tmp_path: Path):
    _write_fixture(tmp_path)
    monkeypatch.delitem(sys.modules, "weasyprint", raising=False)
    monkeypatch.setattr(builtins, "__import__", _import_raising_for(("weasyprint",)))
    monkeypatch.setattr(assemble_pdf_module, "_pymupdf_html_to_pdf", lambda html_path, output_path: None)
    monkeypatch.setattr(
        assemble_pdf_module,
        "dependency_bootstrap",
        types.SimpleNamespace(
            ensure_python_dependency=lambda key, auto_install=None: False,
            DependencyBootstrapError=RuntimeError,
        ),
    )

    assemble_pdf(tmp_path)

    report = (tmp_path / "pdf_export_report.json").read_text(encoding="utf-8")
    assert '"renderer": "basic"' in report
    assert '"weasyprint"' in report
    assert '"pymupdf"' in report
