import builtins
import subprocess
import sys
import types
from pathlib import Path

import pytest

from document_processing_pipeline import ingest
from document_processing_pipeline.ingest import run_ingest


def _import_raising_for(prefixes: tuple[str, ...]):
    original_import = builtins.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if any(name == prefix or name.startswith(f"{prefix}.") for prefix in prefixes):
            raise ImportError(name)
        return original_import(name, globals, locals, fromlist, level)

    return fake_import


def test_ingest_writes_rich_ir(tmp_path: Path):
    sample = Path(__file__).resolve().parent / "fixtures" / "sample.txt"
    out_dir = run_ingest(str(sample), tmp_path, backend_override="unstructured")
    assert (out_dir / "rich_ir.json").exists()
    assert (out_dir / "manifest.json").exists()


def test_read_docx_via_textutil_requires_generated_output(monkeypatch, tmp_path: Path):
    source = tmp_path / "sample.docx"
    source.write_bytes(b"PK\x03\x04")
    monkeypatch.setattr(ingest, "shutil_which", lambda name: "/usr/bin/textutil")
    monkeypatch.setattr(
        ingest.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, "", ""),
    )

    with pytest.raises(ingest.DocumentProcessingError):
        ingest._read_docx_via_textutil(str(source))


def test_read_docx_via_libreoffice_requires_generated_output(monkeypatch, tmp_path: Path):
    source = tmp_path / "sample.docx"
    source.write_bytes(b"PK\x03\x04")
    monkeypatch.setattr(ingest, "shutil_which", lambda name: "/usr/bin/libreoffice" if name in {"libreoffice", "soffice"} else None)
    monkeypatch.setattr(
        ingest.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, "", ""),
    )

    with pytest.raises(ingest.DocumentProcessingError):
        ingest._read_docx_via_libreoffice(str(source))


def test_unstructured_ingest_uses_local_fast_path_for_text(monkeypatch, tmp_path: Path):
    source = tmp_path / "sample.txt"
    source.write_text("Hello\n\nWorld", encoding="utf-8")
    calls: list[str] = []

    monkeypatch.setattr(
        ingest,
        "dependency_bootstrap",
        types.SimpleNamespace(
            ensure_python_dependency=lambda key, auto_install=None: calls.append(key) or False,
            DependencyBootstrapError=RuntimeError,
        ),
    )

    document = ingest._ingest_with_unstructured(str(source), mime_type="text/plain")

    assert document.document.backend == "unstructured"
    assert calls == []


def test_local_unstructured_fallback_uses_libreoffice_for_office_files(monkeypatch, tmp_path: Path):
    source = tmp_path / "sample.docx"
    source.write_bytes(b"PK\x03\x04")
    monkeypatch.setattr(ingest, "shutil_which", lambda name: None if name == "textutil" else "/usr/bin/libreoffice")
    monkeypatch.setattr(ingest, "_read_docx_via_libreoffice", lambda source_path: "<h1>Title</h1><p>Body</p>")

    document = ingest._local_unstructured_fallback(str(source))

    assert document.blocks[0].text == "Title"
    assert document.blocks[1].text == "Body"


def test_ingest_source_dispatches_to_odl_wrapper(monkeypatch, tmp_path: Path):
    source = tmp_path / "sample.pdf"
    source.write_bytes(b"%PDF-1.4\n")
    sentinel = object()
    calls: list[str] = []

    def fake_wrapper(path: str):
        calls.append(path)
        return sentinel

    monkeypatch.setattr(ingest, "_ingest_with_odl_pdf", fake_wrapper)

    assert ingest.ingest_source(str(source), "odl_pdf") is sentinel
    assert calls == [str(source)]


def test_load_odl_convert_attempts_bootstrap_before_checkout(monkeypatch):
    sentinel = object()
    calls: list[str] = []
    monkeypatch.delitem(sys.modules, "opendataloader_pdf", raising=False)
    monkeypatch.setattr(builtins, "__import__", _import_raising_for(("opendataloader_pdf",)))

    monkeypatch.setattr(
        ingest,
        "dependency_bootstrap",
        types.SimpleNamespace(
            ensure_python_dependency=lambda key, auto_install=None: calls.append(key) or False,
            DependencyBootstrapError=RuntimeError,
        ),
    )
    monkeypatch.setattr(ingest, "import_from_checkout", lambda module_name, checkout_path: types.SimpleNamespace(convert=sentinel))

    assert ingest._load_odl_convert() is sentinel
    assert calls == ["opendataloader_pdf"]


def test_ingest_source_dispatches_to_mineru_wrapper(monkeypatch, tmp_path: Path):
    source = tmp_path / "sample.pdf"
    source.write_bytes(b"%PDF-1.4\n")
    sentinel = object()
    calls: list[str] = []

    def fake_wrapper(path: str):
        calls.append(path)
        return sentinel

    monkeypatch.setattr(ingest, "_ingest_with_mineru", fake_wrapper)

    assert ingest.ingest_source(str(source), "mineru") is sentinel
    assert calls == [str(source)]


def test_load_mineru_do_parse_attempts_bootstrap_before_checkout(monkeypatch):
    sentinel = object()
    calls: list[str] = []
    monkeypatch.delitem(sys.modules, "mineru", raising=False)
    monkeypatch.delitem(sys.modules, "mineru.cli", raising=False)
    monkeypatch.delitem(sys.modules, "mineru.cli.common", raising=False)
    monkeypatch.setattr(builtins, "__import__", _import_raising_for(("mineru",)))

    monkeypatch.setattr(
        ingest,
        "dependency_bootstrap",
        types.SimpleNamespace(
            ensure_python_dependency=lambda key, auto_install=None: calls.append(key) or False,
            DependencyBootstrapError=RuntimeError,
        ),
    )
    monkeypatch.setattr(ingest, "import_from_checkout", lambda module_name, checkout_path: types.SimpleNamespace(do_parse=sentinel))

    assert ingest._load_mineru_do_parse() is sentinel
    assert calls == ["mineru"]


def test_run_ingest_reports_missing_manual_pdf_dependencies_for_explicit_odl(monkeypatch, tmp_path: Path):
    source = tmp_path / "sample.pdf"
    source.write_bytes(b"%PDF-1.4\n")
    monkeypatch.setattr(
        ingest,
        "summarize_capabilities",
        lambda config=None: {
                "binaries": {"java": None},
                "manual_install": {"owner": "user", "system_dependencies": ["java"]},
            },
        )

    with pytest.raises(ingest.DocumentProcessingError) as excinfo:
        run_ingest(str(source), tmp_path / "out", backend_override="odl_pdf")

    message = str(excinfo.value)
    assert "user" in message
    assert "java" in message
