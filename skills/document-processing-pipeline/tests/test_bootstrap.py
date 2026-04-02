import subprocess
import sys

from document_processing_pipeline import bootstrap


def test_ensure_python_dependency_runs_pip_for_missing_package(monkeypatch):
    state = {"available": False}
    calls: list[list[str]] = []

    monkeypatch.setattr(
        bootstrap,
        "_module_available",
        lambda name: state["available"],
    )

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        state["available"] = True
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(bootstrap.subprocess, "run", fake_run)

    assert bootstrap.ensure_python_dependency("unstructured", auto_install=True) is True
    assert calls[0][:5] == [sys.executable, "-m", "pip", "install", "--disable-pip-version-check"]
    assert calls[0][-1] == "unstructured"
    assert "--break-system-packages" in calls[0]


def test_ensure_python_dependency_can_be_disabled(monkeypatch):
    calls: list[list[str]] = []

    monkeypatch.setattr(bootstrap, "_module_available", lambda name: False)
    monkeypatch.setenv("DOCUMENT_PROCESSING_PIPELINE_AUTO_INSTALL", "0")

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(bootstrap.subprocess, "run", fake_run)

    assert bootstrap.ensure_python_dependency("unstructured") is False
    assert calls == []
