from __future__ import annotations

from contextlib import contextmanager
import importlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys

from document_processing_pipeline.dependencies import PYTHON_DEPENDENCIES

AUTO_INSTALL_ENV = "DOCUMENT_PROCESSING_PIPELINE_AUTO_INSTALL"


DEPENDENCY_SPECS: dict[str, dict[str, object]] = {
    key: {"modules": spec.modules, "pip_packages": spec.pip_packages}
    for key, spec in PYTHON_DEPENDENCIES.items()
}


class DependencyBootstrapError(RuntimeError):
    pass


def _module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def auto_install_enabled() -> bool:
    value = os.environ.get(AUTO_INSTALL_ENV, "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def bootstrap_policy() -> dict[str, object]:
    return {
        "auto_install_python_packages": auto_install_enabled(),
        "env_var": AUTO_INSTALL_ENV,
    }


def _dependency_available(dependency_key: str) -> bool:
    spec = DEPENDENCY_SPECS[dependency_key]
    modules = tuple(spec["modules"])
    return any(_module_available(module_name) for module_name in modules)


def _pip_install_command(dependency_key: str) -> list[str]:
    spec = DEPENDENCY_SPECS[dependency_key]
    packages = list(spec["pip_packages"])
    command = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check"]
    if sys.prefix == getattr(sys, "base_prefix", sys.prefix):
        command.append("--break-system-packages")
    command.extend(packages)
    return command


def ensure_python_dependency(dependency_key: str, auto_install: bool | None = None) -> bool:
    if dependency_key not in DEPENDENCY_SPECS:
        raise KeyError(f"Unknown dependency: {dependency_key}")

    if _dependency_available(dependency_key):
        return True

    if auto_install is None:
        auto_install = auto_install_enabled()
    if not auto_install:
        return False

    command = _pip_install_command(dependency_key)
    try:
        subprocess.run(command, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as exc:
        raise DependencyBootstrapError(
            f"Automatic install failed for {dependency_key}: {exc.stderr.strip() or exc.stdout.strip() or exc}"
        ) from exc

    importlib.invalidate_caches()
    if _dependency_available(dependency_key):
        return True

    raise DependencyBootstrapError(f"Automatic install completed but {dependency_key} is still not importable.")


def workspace_root() -> Path:
    """Return the workspace root (three levels above this file)."""
    return Path(__file__).resolve().parents[3]


@contextmanager
def temporary_sys_path(path: Path):
    """Temporarily prepend *path* to ``sys.path``, cleaning up on exit."""
    importlib.invalidate_caches()
    sys.path.insert(0, str(path))
    try:
        yield
    finally:
        while str(path) in sys.path:
            sys.path.remove(str(path))
        importlib.invalidate_caches()


def import_from_checkout(module_name: str, checkout_path: Path):
    """Import *module_name* from a local checkout directory."""
    if not checkout_path.exists():
        raise ImportError(f"Checkout not found: {checkout_path}")
    with temporary_sys_path(checkout_path):
        return importlib.import_module(module_name)
