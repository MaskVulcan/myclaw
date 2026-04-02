from __future__ import annotations

import importlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

from document_processing_pipeline import bootstrap as dependency_bootstrap
from document_processing_pipeline.bootstrap import _module_available, temporary_sys_path, workspace_root
from document_processing_pipeline.dependencies import (
    DEFAULT_PROFILE,
    DEPENDENCY_PROFILES,
    PYTHON_DEPENDENCIES,
    SYSTEM_DEPENDENCIES,
    pip_check_report,
    resolve_profiles,
)


PACKAGE_CHECKS = (
    "unstructured",
    "opendataloader_pdf",
    "mineru",
    "deep_translator",
    "jinja2",
    "python_docx",
    "weasyprint",
)


OPTIONAL_PACKAGE_CHECKS = ("openpyxl", "pandas", "python_pptx", "pypdf", "pdfplumber", "pymupdf")


BINARY_CHECKS = ("java", "textutil", "libreoffice", "tesseract", "pdftotext")


OPTIONAL_BINARY_CHECKS = ("qpdf", "noto_cjk_fonts")


def _recommended_command_prefix() -> list[str]:
    raw = os.environ.get("DOCUMENT_PROCESSING_PIPELINE_COMMAND", "").strip()
    if not raw:
        return ["docpipe"]
    try:
        parsed = shlex.split(raw)
    except ValueError:
        return ["docpipe"]
    return parsed or ["docpipe"]


def _binary_path(candidates: list[str]) -> str | None:
    for candidate in candidates:
        path = shutil.which(candidate)
        if path:
            return path
    return None


def _check_stirling(url: str, timeout: float) -> bool:
    try:
        with urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 500
    except (URLError, ValueError):
        return False


def _java_runtime_available(java_path: str | None) -> bool:
    if not java_path:
        return False
    try:
        result = subprocess.run([java_path, "-version"], capture_output=True, text=True, check=False)
    except OSError:
        return False
    return result.returncode == 0


def _module_from_checkout_available(module_name: str, checkout_path: Path | None) -> bool:
    if checkout_path is None or not checkout_path.exists():
        return False
    try:
        with temporary_sys_path(checkout_path):
            importlib.import_module(module_name)
    except Exception:
        return False
    return True


def _python_dependency_installed(label: str) -> bool:
    return any(_module_available(module_name) for module_name in PYTHON_DEPENDENCIES[label].modules)


def _system_dependency_path(label: str) -> str | None:
    spec = SYSTEM_DEPENDENCIES[label]
    path = _binary_path(list(spec.binaries))
    if path:
        return path
    for candidate in spec.paths:
        if Path(candidate).exists():
            return candidate
    return None


def _detect_local_checkouts(root: Path | None = None) -> dict[str, str | None]:
    base = root or workspace_root()
    odl_checkout = base / "opendataloader-pdf"
    mineru_checkout = base / "MinerU"
    return {
        "opendataloader_pdf_checkout": str(odl_checkout) if odl_checkout.exists() else None,
        "mineru_checkout": str(mineru_checkout) if mineru_checkout.exists() else None,
    }


def _backend_runtime_support(
    packages: dict[str, bool],
    binaries: dict[str, str | None],
    local_checkouts: dict[str, str | None],
) -> dict[str, bool]:
    odl_checkout = local_checkouts.get("opendataloader_pdf_checkout")
    mineru_checkout = local_checkouts.get("mineru_checkout")
    odl_importable = packages["opendataloader_pdf"] or _module_from_checkout_available(
        "opendataloader_pdf",
        Path(odl_checkout) / "python" / "opendataloader-pdf" / "src" if odl_checkout else None,
    )
    mineru_importable = packages["mineru"] or _module_from_checkout_available(
        "mineru.cli.common",
        Path(mineru_checkout) if mineru_checkout else None,
    )
    return {
        "odl_pdf": binaries["java"] is not None and odl_importable,
        "mineru": mineru_importable,
    }


def _manual_install_requirements(
    binaries: dict[str, str | None],
    packages: dict[str, bool],
    backends: dict[str, bool],
    optional_packages: dict[str, bool],
    optional_binaries: dict[str, str | None],
    dependency_profiles: dict[str, object],
) -> dict[str, object]:
    default_profile = dependency_profiles["profiles"][DEFAULT_PROFILE]
    blocking_notes: list[str] = []
    if not backends.get("odl_pdf", False) and binaries.get("java") is None:
        blocking_notes.append("OpenDataLoader-PDF is optional and requires a working Java runtime if you choose that backend.")
    if not packages.get("python_docx", False) and binaries.get("textutil") is None:
        blocking_notes.append("DOCX export can fall back to python-docx if installed automatically, but no system DOCX helper is available.")
    if binaries.get("pdftotext") is None and (binaries.get("tesseract") is None or not optional_packages.get("pymupdf", False)):
        blocking_notes.append("Local OCR works best with `pdftotext` for digital PDFs or `tesseract` plus PyMuPDF for scanned PDFs and images.")
    return {
        "owner": "user",
        "recommended_profile": DEFAULT_PROFILE,
        "recommended_command": [*_recommended_command_prefix(), "install-deps", DEFAULT_PROFILE],
        "python_dependencies": list(default_profile["missing_python_dependencies"]),
        "system_dependencies": list(default_profile["missing_system_dependencies"]),
        "optional_python_packages": sorted(label for label, installed in optional_packages.items() if not installed),
        "optional_binaries": sorted(label for label, path in optional_binaries.items() if path is None),
        "notes": blocking_notes,
    }


def _dependency_profile_summary(profile_names: list[str] | None = None) -> dict[str, object]:
    selected = profile_names or list(DEPENDENCY_PROFILES)
    profiles: dict[str, object] = {}
    for profile_name in selected:
        profile = DEPENDENCY_PROFILES[profile_name]
        resolved = resolve_profiles([profile_name])
        missing_python_dependencies = [
            key for key in resolved["python_dependencies"] if not _python_dependency_installed(key)
        ]
        missing_system_dependencies = [
            key for key in resolved["system_dependencies"] if _system_dependency_path(key) is None
        ]
        profiles[profile_name] = {
            "description": profile.description,
            "includes": list(profile.includes),
            "python_dependencies": list(resolved["python_dependencies"]),
            "system_dependencies": list(resolved["system_dependencies"]),
            "pip_packages": list(resolved["pip_packages"]),
            "apt_packages": list(resolved["apt_packages"]),
            "missing_python_dependencies": missing_python_dependencies,
            "missing_system_dependencies": missing_system_dependencies,
        }
    return {"default_profile": DEFAULT_PROFILE, "profiles": profiles}


def summarize_capabilities(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    available = ["python"]
    missing: list[str] = []

    packages: dict[str, bool] = {}
    for label in PACKAGE_CHECKS:
        installed = _python_dependency_installed(label)
        packages[label] = installed
        if installed:
            available.append(label)
        else:
            missing.append(label)

    optional_packages: dict[str, bool] = {}
    for label in OPTIONAL_PACKAGE_CHECKS:
        installed = _python_dependency_installed(label)
        optional_packages[label] = installed
        if installed:
            available.append(label)
        else:
            missing.append(label)

    binaries: dict[str, str | None] = {}
    for label in BINARY_CHECKS:
        path = _system_dependency_path(label)
        if label == "java" and not _java_runtime_available(path):
            path = None
        binaries[label] = path
        if path:
            available.append(label)
        else:
            missing.append(label)

    optional_binaries: dict[str, str | None] = {}
    for label in OPTIONAL_BINARY_CHECKS:
        path = _system_dependency_path(label)
        optional_binaries[label] = path
        if path:
            available.append(label)
        else:
            missing.append(label)

    stirling_url = config.get("stirling_url")
    stirling_available = False
    if stirling_url:
        stirling_available = _check_stirling(stirling_url, float(config.get("stirling_timeout", 2.0)))
        if stirling_available:
            available.append("stirling")
        else:
            missing.append("stirling")

    local_checkouts = _detect_local_checkouts()
    backends = _backend_runtime_support(packages, binaries, local_checkouts)
    dependency_profiles = _dependency_profile_summary()
    dependency_conflicts = pip_check_report()
    manual_install = _manual_install_requirements(
        binaries,
        packages,
        backends,
        optional_packages,
        optional_binaries,
        dependency_profiles,
    )

    features = {
        "multi_format_ingest": packages["unstructured"] or binaries["textutil"] is not None or binaries["libreoffice"] is not None,
        "pdf_ingest": packages["unstructured"] or any(backends.values()),
        "pdf_layout_ingest": any(backends.values()),
        "docx_ingest": packages["unstructured"] or binaries["textutil"] is not None or binaries["libreoffice"] is not None,
        "html_export": True,
        "docx_export": packages["python_docx"] or binaries["textutil"] is not None,
        # Always True: weasyprint/stirling give high-fidelity output, but the
        # built-in basic PDF writer is always available as a last resort.
        "pdf_export": True,
        "docx_local_edit": True,
        "local_ocr": binaries["pdftotext"] is not None or (binaries["tesseract"] is not None and optional_packages["pymupdf"]),
        "xlsx_edit": optional_packages["openpyxl"],
        "xlsx_analysis": optional_packages["pandas"],
        "pptx_edit": optional_packages["python_pptx"],
        "pdf_forms": optional_packages["pypdf"],
        "pdf_table_extract": optional_packages["pdfplumber"],
    }

    optional_integrations = {
        "docx_local": {
            "available": True,
            "scope": "existing DOCX inspect, search, replace, compare using local OOXML scripts",
        },
        "ocr_local": {
            "pdftotext": binaries["pdftotext"] is not None,
            "tesseract": binaries["tesseract"] is not None,
            "pymupdf": optional_packages["pymupdf"],
            "image_ocr": binaries["tesseract"] is not None,
            "remote": False,
            "scope": "local PDF and image OCR using pdftotext, tesseract, and PyMuPDF",
        },
        "office_local": {
            "openpyxl": optional_packages["openpyxl"],
            "pandas": optional_packages["pandas"],
            "python_pptx": optional_packages["python_pptx"],
        },
        "pdf_local": {
            "pymupdf": optional_packages["pymupdf"],
            "pypdf": optional_packages["pypdf"],
            "pdfplumber": optional_packages["pdfplumber"],
            "qpdf": optional_binaries["qpdf"] is not None,
        },
    }

    return {
        "available": sorted(set(available)),
        "missing": sorted(set(missing)),
        "packages": packages,
        "optional_packages": optional_packages,
        "binaries": binaries,
        "optional_binaries": optional_binaries,
        "services": {"stirling": {"url": stirling_url, "available": stirling_available}},
        "optional_integrations": optional_integrations,
        "bootstrap": dependency_bootstrap.bootstrap_policy(),
        "dependency_profiles": dependency_profiles,
        "dependency_conflicts": dependency_conflicts,
        "manual_install": manual_install,
        "local_checkouts": local_checkouts,
        "backends": backends,
        "features": features,
    }


def capabilities_as_json(config: dict[str, Any] | None = None) -> str:
    return json.dumps(summarize_capabilities(config), ensure_ascii=False, indent=2)
