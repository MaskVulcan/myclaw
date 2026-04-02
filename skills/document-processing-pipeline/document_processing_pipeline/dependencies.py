from __future__ import annotations

from dataclasses import dataclass
import importlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys


@dataclass(frozen=True)
class PythonDependency:
    key: str
    modules: tuple[str, ...]
    pip_packages: tuple[str, ...]
    description: str


@dataclass(frozen=True)
class SystemDependency:
    key: str
    binaries: tuple[str, ...] = ()
    paths: tuple[str, ...] = ()
    apt_packages: tuple[str, ...] = ()
    description: str = ""


@dataclass(frozen=True)
class DependencyProfile:
    key: str
    description: str
    python_dependencies: tuple[str, ...] = ()
    system_dependencies: tuple[str, ...] = ()
    includes: tuple[str, ...] = ()


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered


def _module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _binary_path(candidates: tuple[str, ...]) -> str | None:
    for candidate in candidates:
        path = shutil.which(candidate)
        if path:
            return path
    return None


def _existing_path(candidates: tuple[str, ...]) -> str | None:
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def _in_virtualenv() -> bool:
    return sys.prefix != getattr(sys, "base_prefix", sys.prefix) or hasattr(sys, "real_prefix")


def _pip_break_system_packages_args() -> list[str]:
    return [] if _in_virtualenv() else ["--break-system-packages"]


FONT_PATHS = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
)


PYTHON_DEPENDENCIES: dict[str, PythonDependency] = {
    "unstructured": PythonDependency(
        key="unstructured",
        modules=("unstructured",),
        pip_packages=("unstructured",),
        description="General-purpose local ingest backend.",
    ),
    "opendataloader_pdf": PythonDependency(
        key="opendataloader_pdf",
        modules=("opendataloader_pdf",),
        pip_packages=("opendataloader-pdf",),
        description="Optional Java-backed PDF ingest backend.",
    ),
    "mineru": PythonDependency(
        key="mineru",
        modules=("mineru",),
        pip_packages=("mineru",),
        description="Optional PDF ingest backend for layout-heavy papers.",
    ),
    "deep_translator": PythonDependency(
        key="deep_translator",
        modules=("deep_translator",),
        pip_packages=("deep-translator", "requests", "beautifulsoup4"),
        description="HTTP-first block translation helper and its direct runtime dependencies.",
    ),
    "jinja2": PythonDependency(
        key="jinja2",
        modules=("jinja2",),
        pip_packages=("jinja2",),
        description="Template renderer for HTML assembly.",
    ),
    "python_docx": PythonDependency(
        key="python_docx",
        modules=("docx",),
        pip_packages=("python-docx",),
        description="DOCX writer for rebuilt outputs.",
    ),
    "weasyprint": PythonDependency(
        key="weasyprint",
        modules=("weasyprint",),
        pip_packages=("weasyprint",),
        description="Optional high-fidelity HTML-to-PDF renderer.",
    ),
    "pymupdf": PythonDependency(
        key="pymupdf",
        modules=("fitz", "pymupdf"),
        pip_packages=("PyMuPDF",),
        description="PDF rasterization and overlay support.",
    ),
    "openpyxl": PythonDependency(
        key="openpyxl",
        modules=("openpyxl",),
        pip_packages=("openpyxl",),
        description="Deterministic XLSX edits.",
    ),
    "pandas": PythonDependency(
        key="pandas",
        modules=("pandas",),
        pip_packages=("pandas",),
        description="Spreadsheet analysis and tabular transforms.",
    ),
    "python_pptx": PythonDependency(
        key="python_pptx",
        modules=("pptx",),
        pip_packages=("python-pptx",),
        description="Deterministic PPTX generation and edits.",
    ),
    "pypdf": PythonDependency(
        key="pypdf",
        modules=("pypdf",),
        pip_packages=("pypdf",),
        description="PDF structural operations and forms.",
    ),
    "pdfplumber": PythonDependency(
        key="pdfplumber",
        modules=("pdfplumber",),
        pip_packages=("pdfplumber",),
        description="PDF table extraction.",
    ),
}


SYSTEM_DEPENDENCIES: dict[str, SystemDependency] = {
    "java": SystemDependency(
        key="java",
        binaries=("java",),
        apt_packages=("default-jre-headless",),
        description="Java runtime for the OpenDataLoader-PDF backend.",
    ),
    "textutil": SystemDependency(
        key="textutil",
        binaries=("textutil",),
        description="macOS document conversion helper.",
    ),
    "libreoffice": SystemDependency(
        key="libreoffice",
        binaries=("libreoffice", "soffice"),
        apt_packages=("libreoffice",),
        description="Optional office conversion runtime.",
    ),
    "tesseract": SystemDependency(
        key="tesseract",
        binaries=("tesseract",),
        apt_packages=("tesseract-ocr",),
        description="OCR engine for scanned PDFs and images.",
    ),
    "pdftotext": SystemDependency(
        key="pdftotext",
        binaries=("pdftotext",),
        apt_packages=("poppler-utils",),
        description="Fast text extraction for digital PDFs.",
    ),
    "qpdf": SystemDependency(
        key="qpdf",
        binaries=("qpdf",),
        apt_packages=("qpdf",),
        description="Low-level PDF repair and structural operations.",
    ),
    "noto_cjk_fonts": SystemDependency(
        key="noto_cjk_fonts",
        paths=FONT_PATHS,
        apt_packages=("fonts-noto-cjk",),
        description="CJK font coverage for PDF overlays and exports.",
    ),
}


DEPENDENCY_PROFILES: dict[str, DependencyProfile] = {
    "pipeline-local": DependencyProfile(
        key="pipeline-local",
        description="Core local pipeline dependencies for ingest, HTML, and DOCX rebuild.",
        python_dependencies=("unstructured", "jinja2", "python_docx"),
    ),
    "translate-local": DependencyProfile(
        key="translate-local",
        description="HTTP-first translation dependencies for block translation.",
        python_dependencies=("deep_translator",),
    ),
    "office-local": DependencyProfile(
        key="office-local",
        description="Local spreadsheet and slide helpers.",
        python_dependencies=("python_docx", "openpyxl", "pandas", "python_pptx"),
    ),
    "pdf-local": DependencyProfile(
        key="pdf-local",
        description="Local PDF helpers for overlays, forms, and extraction.",
        python_dependencies=("pymupdf", "pypdf", "pdfplumber"),
        system_dependencies=("qpdf", "noto_cjk_fonts"),
    ),
    "ocr-local": DependencyProfile(
        key="ocr-local",
        description="Local PDF and image OCR stack.",
        python_dependencies=("pymupdf",),
        system_dependencies=("pdftotext", "tesseract"),
    ),
    "pdf-export": DependencyProfile(
        key="pdf-export",
        description="Optional higher-fidelity PDF export stack.",
        python_dependencies=("weasyprint", "pymupdf"),
        system_dependencies=("noto_cjk_fonts",),
    ),
    "local-python": DependencyProfile(
        key="local-python",
        description="Recommended Python package bundle for the local CLI-first workflow.",
        python_dependencies=(
            "unstructured",
            "jinja2",
            "python_docx",
            "deep_translator",
            "pymupdf",
            "openpyxl",
            "pandas",
            "python_pptx",
            "pypdf",
            "pdfplumber",
        ),
    ),
    "local-system": DependencyProfile(
        key="local-system",
        description="Recommended system packages for local OCR, PDF work, and CJK rendering.",
        system_dependencies=("pdftotext", "tesseract", "qpdf", "noto_cjk_fonts"),
    ),
    "pdf-backends": DependencyProfile(
        key="pdf-backends",
        description="Optional heavyweight PDF ingest backends.",
        python_dependencies=("mineru", "opendataloader_pdf"),
        system_dependencies=("java",),
    ),
    "office-conversion": DependencyProfile(
        key="office-conversion",
        description="Optional office conversion runtime for broader local document conversion.",
        system_dependencies=("libreoffice",),
    ),
    "all-optional": DependencyProfile(
        key="all-optional",
        description="Optional heavyweight local add-ons: richer PDF export, extra PDF backends, and office conversion runtime.",
        includes=("pdf-export", "pdf-backends", "office-conversion"),
    ),
    "all-local": DependencyProfile(
        key="all-local",
        description="Recommended local CLI-first stack for this skill.",
        includes=("pipeline-local", "translate-local", "office-local", "pdf-local", "ocr-local", "local-system"),
    ),
    "everything": DependencyProfile(
        key="everything",
        description="Install the full local stack, including optional heavyweight backends and conversion runtimes.",
        includes=("all-local", "all-optional"),
    ),
}


DEFAULT_PROFILE = "all-local"


class DependencyInstallError(RuntimeError):
    pass


def python_dependency_available(key: str) -> bool:
    spec = PYTHON_DEPENDENCIES[key]
    return any(_module_available(module_name) for module_name in spec.modules)


def system_dependency_path(key: str) -> str | None:
    spec = SYSTEM_DEPENDENCIES[key]
    return _binary_path(spec.binaries) or _existing_path(spec.paths)


def system_dependency_available(key: str) -> bool:
    return system_dependency_path(key) is not None


def resolve_profiles(profile_names: list[str] | tuple[str, ...] | None = None) -> dict[str, object]:
    requested = list(profile_names or [DEFAULT_PROFILE])
    resolved_profiles: list[str] = []
    python_dependencies: list[str] = []
    system_dependencies: list[str] = []
    seen_profiles: set[str] = set()

    def visit(profile_name: str) -> None:
        if profile_name in seen_profiles:
            return
        if profile_name not in DEPENDENCY_PROFILES:
            raise KeyError(f"Unknown dependency profile: {profile_name}")
        seen_profiles.add(profile_name)
        profile = DEPENDENCY_PROFILES[profile_name]
        for included in profile.includes:
            visit(included)
        resolved_profiles.append(profile_name)
        python_dependencies.extend(profile.python_dependencies)
        system_dependencies.extend(profile.system_dependencies)

    for profile_name in requested:
        visit(profile_name)

    python_keys = _dedupe(python_dependencies)
    system_keys = _dedupe(system_dependencies)
    pip_packages = _dedupe(
        [package for key in python_keys for package in PYTHON_DEPENDENCIES[key].pip_packages]
    )
    apt_packages = _dedupe(
        [package for key in system_keys for package in SYSTEM_DEPENDENCIES[key].apt_packages]
    )
    return {
        "requested_profiles": requested,
        "resolved_profiles": resolved_profiles,
        "python_dependencies": python_keys,
        "system_dependencies": system_keys,
        "pip_packages": pip_packages,
        "apt_packages": apt_packages,
    }


def describe_profiles(profile_names: list[str] | tuple[str, ...] | None = None) -> dict[str, object]:
    selected = list(profile_names) if profile_names else list(DEPENDENCY_PROFILES)
    profiles: dict[str, object] = {}
    for profile_name in selected:
        profile = DEPENDENCY_PROFILES[profile_name]
        resolved = resolve_profiles([profile_name])
        profiles[profile_name] = {
            "description": profile.description,
            "includes": list(profile.includes),
            "python_dependencies": [
                {
                    "key": key,
                    "installed": python_dependency_available(key),
                    "modules": list(PYTHON_DEPENDENCIES[key].modules),
                    "pip_packages": list(PYTHON_DEPENDENCIES[key].pip_packages),
                    "description": PYTHON_DEPENDENCIES[key].description,
                }
                for key in resolved["python_dependencies"]
            ],
            "system_dependencies": [
                {
                    "key": key,
                    "installed": system_dependency_available(key),
                    "path": system_dependency_path(key),
                    "apt_packages": list(SYSTEM_DEPENDENCIES[key].apt_packages),
                    "description": SYSTEM_DEPENDENCIES[key].description,
                }
                for key in resolved["system_dependencies"]
            ],
            "pip_packages": list(resolved["pip_packages"]),
            "apt_packages": list(resolved["apt_packages"]),
        }
    return {"default_profile": DEFAULT_PROFILE, "profiles": profiles}


def pip_check_report(python_executable: str | None = None) -> dict[str, object]:
    command = [python_executable or sys.executable, "-m", "pip", "check"]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as exc:
        return {
            "available": False,
            "ok": False,
            "command": command,
            "returncode": None,
            "conflicts": [],
            "error": str(exc),
        }

    output = "\n".join(part for part in [completed.stdout.strip(), completed.stderr.strip()] if part).strip()
    conflicts = [line.strip() for line in output.splitlines() if line.strip()] if completed.returncode != 0 else []
    return {
        "available": True,
        "ok": completed.returncode == 0,
        "command": command,
        "returncode": completed.returncode,
        "conflicts": conflicts,
    }


def install_dependency_profiles(
    profile_names: list[str] | tuple[str, ...] | None = None,
    *,
    include_python: bool = True,
    include_system: bool = True,
    dry_run: bool = False,
    python_executable: str | None = None,
) -> dict[str, object]:
    resolved = resolve_profiles(profile_names)
    python_keys = list(resolved["python_dependencies"]) if include_python else []
    system_keys = list(resolved["system_dependencies"]) if include_system else []

    missing_python_dependencies = [key for key in python_keys if not python_dependency_available(key)]
    missing_system_dependencies = [key for key in system_keys if not system_dependency_available(key)]

    pip_packages = _dedupe(
        [package for key in missing_python_dependencies for package in PYTHON_DEPENDENCIES[key].pip_packages]
    )
    installable_system_dependencies = [
        key for key in missing_system_dependencies if SYSTEM_DEPENDENCIES[key].apt_packages
    ]
    unsupported_system_dependencies = [
        key for key in missing_system_dependencies if not SYSTEM_DEPENDENCIES[key].apt_packages
    ]
    apt_packages = _dedupe(
        [package for key in installable_system_dependencies for package in SYSTEM_DEPENDENCIES[key].apt_packages]
    )

    commands: list[list[str]] = []
    if apt_packages:
        if shutil.which("apt-get") is None:
            raise DependencyInstallError("apt-get is not available for system dependency installation.")
        commands.append(["apt-get", "update"])
        commands.append(["apt-get", "install", "-y", "--no-install-recommends", *apt_packages])
    if pip_packages:
        commands.append(
            [
                python_executable or sys.executable,
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                *_pip_break_system_packages_args(),
                *pip_packages,
            ]
        )

    if not dry_run:
        for command in commands:
            subprocess.run(command, check=True)
        importlib.invalidate_caches()

    post_install_health = None if dry_run else pip_check_report(python_executable or sys.executable)

    return {
        "requested_profiles": resolved["requested_profiles"],
        "resolved_profiles": resolved["resolved_profiles"],
        "include_python": include_python,
        "include_system": include_system,
        "dry_run": dry_run,
        "missing_python_dependencies": missing_python_dependencies,
        "missing_system_dependencies": missing_system_dependencies,
        "unsupported_system_dependencies": unsupported_system_dependencies,
        "pip_packages": pip_packages,
        "apt_packages": apt_packages,
        "commands": commands,
        "post_install_health": post_install_health,
    }
