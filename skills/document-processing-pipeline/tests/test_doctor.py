from pathlib import Path

from document_processing_pipeline import doctor


def test_doctor_reports_local_pdf_checkout_capability(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        doctor,
        "_detect_local_checkouts",
        lambda root=None: {
            "opendataloader_pdf_checkout": str(tmp_path / "opendataloader-pdf"),
            "mineru_checkout": None,
        },
    )
    monkeypatch.setattr(doctor, "_module_available", lambda name: False)
    monkeypatch.setattr(doctor, "_backend_runtime_support", lambda packages, binaries, local_checkouts: {"odl_pdf": True, "mineru": False})

    capabilities = doctor.summarize_capabilities({})

    assert capabilities["local_checkouts"]["opendataloader_pdf_checkout"] == str(tmp_path / "opendataloader-pdf")
    assert capabilities["features"]["pdf_ingest"] is True


def test_doctor_reports_python_only_environment():
    capabilities = doctor.summarize_capabilities({})
    assert "python" in capabilities["available"]
    assert "missing" in capabilities


def test_doctor_reports_auto_install_policy(monkeypatch):
    monkeypatch.setenv("DOCUMENT_PROCESSING_PIPELINE_AUTO_INSTALL", "1")
    monkeypatch.setattr(doctor, "pip_check_report", lambda: {"available": True, "ok": True, "conflicts": [], "returncode": 0})
    capabilities = doctor.summarize_capabilities({})
    assert capabilities["bootstrap"]["auto_install_python_packages"] is True


def test_doctor_reports_manual_user_installs(monkeypatch):
    monkeypatch.setattr(doctor, "_module_available", lambda name: False)
    monkeypatch.setattr(
        doctor,
        "_detect_local_checkouts",
        lambda root=None: {
            "opendataloader_pdf_checkout": None,
            "mineru_checkout": None,
        },
    )
    monkeypatch.setattr(doctor, "_backend_runtime_support", lambda packages, binaries, local_checkouts: {"odl_pdf": False, "mineru": False})
    monkeypatch.setattr(doctor, "pip_check_report", lambda: {"available": True, "ok": True, "conflicts": [], "returncode": 0})
    paths = {
        ("textutil",): "/usr/bin/textutil",
    }
    monkeypatch.setattr(doctor, "_binary_path", lambda candidates: paths.get(tuple(candidates)))

    capabilities = doctor.summarize_capabilities({})

    assert capabilities["manual_install"]["owner"] == "user"
    assert capabilities["manual_install"]["recommended_profile"] == "all-local"
    assert capabilities["manual_install"]["recommended_command"] == ["docpipe", "install-deps", "all-local"]


def test_doctor_uses_wrapper_command_hint_when_present(monkeypatch):
    monkeypatch.setenv(
        "DOCUMENT_PROCESSING_PIPELINE_COMMAND",
        "/tmp/openclaw/skills/document-processing-pipeline/scripts/docpipe",
    )
    monkeypatch.setattr(doctor, "_module_available", lambda name: False)
    monkeypatch.setattr(
        doctor,
        "_detect_local_checkouts",
        lambda root=None: {
            "opendataloader_pdf_checkout": None,
            "mineru_checkout": None,
        },
    )
    monkeypatch.setattr(doctor, "_backend_runtime_support", lambda packages, binaries, local_checkouts: {"odl_pdf": False, "mineru": False})
    monkeypatch.setattr(doctor, "pip_check_report", lambda: {"available": True, "ok": True, "conflicts": [], "returncode": 0})
    monkeypatch.setattr(doctor, "_binary_path", lambda candidates: None)

    capabilities = doctor.summarize_capabilities({})

    assert capabilities["manual_install"]["recommended_command"] == [
        "/tmp/openclaw/skills/document-processing-pipeline/scripts/docpipe",
        "install-deps",
        "all-local",
    ]


def test_doctor_reports_optional_integrations(monkeypatch):
    installed_modules = {"openpyxl", "pandas", "pptx", "pypdf", "pdfplumber", "fitz"}
    monkeypatch.setattr(doctor, "_module_available", lambda name: name in installed_modules)
    monkeypatch.setattr(doctor, "pip_check_report", lambda: {"available": True, "ok": False, "conflicts": ["pkg-a conflict"], "returncode": 1})
    monkeypatch.setattr(
        doctor,
        "_detect_local_checkouts",
        lambda root=None: {
            "opendataloader_pdf_checkout": None,
            "mineru_checkout": None,
        },
    )
    monkeypatch.setattr(doctor, "_backend_runtime_support", lambda packages, binaries, local_checkouts: {"odl_pdf": False, "mineru": False})
    paths = {
        ("tesseract",): "/usr/bin/tesseract",
        ("pdftotext",): "/usr/bin/pdftotext",
        ("qpdf",): "/usr/bin/qpdf",
    }
    monkeypatch.setattr(doctor, "_binary_path", lambda candidates: paths.get(tuple(candidates)))

    capabilities = doctor.summarize_capabilities({})

    assert capabilities["features"]["docx_local_edit"] is True
    assert capabilities["features"]["local_ocr"] is True
    assert capabilities["features"]["xlsx_edit"] is True
    assert capabilities["features"]["pdf_ingest"] is False
    assert capabilities["features"]["pdf_layout_ingest"] is False
    assert capabilities["optional_integrations"]["docx_local"]["available"] is True
    assert capabilities["optional_integrations"]["ocr_local"]["tesseract"] is True
    assert capabilities["optional_integrations"]["ocr_local"]["pymupdf"] is True
    assert capabilities["dependency_profiles"]["default_profile"] == "all-local"
    assert "pymupdf" not in capabilities["dependency_profiles"]["profiles"]["all-local"]["missing_python_dependencies"]
    assert capabilities["dependency_conflicts"]["conflicts"] == ["pkg-a conflict"]


def test_doctor_reports_unstructured_pdf_ingest(monkeypatch):
    monkeypatch.setattr(doctor, "_module_available", lambda name: name == "unstructured")
    monkeypatch.setattr(doctor, "pip_check_report", lambda: {"available": True, "ok": True, "conflicts": [], "returncode": 0})
    monkeypatch.setattr(
        doctor,
        "_detect_local_checkouts",
        lambda root=None: {
            "opendataloader_pdf_checkout": None,
            "mineru_checkout": None,
        },
    )
    monkeypatch.setattr(doctor, "_backend_runtime_support", lambda packages, binaries, local_checkouts: {"odl_pdf": False, "mineru": False})
    monkeypatch.setattr(doctor, "_binary_path", lambda candidates: None)

    capabilities = doctor.summarize_capabilities({})

    assert capabilities["features"]["pdf_ingest"] is True
    assert capabilities["features"]["pdf_layout_ingest"] is False
