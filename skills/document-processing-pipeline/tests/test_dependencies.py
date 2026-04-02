from __future__ import annotations

import subprocess

from document_processing_pipeline import dependencies


def test_resolve_profiles_all_local_contains_expected_groups():
    resolved = dependencies.resolve_profiles(["all-local"])

    assert "pipeline-local" in resolved["resolved_profiles"]
    assert "pymupdf" in resolved["python_dependencies"]
    assert "tesseract" in resolved["system_dependencies"]


def test_resolve_profiles_everything_contains_optional_groups():
    resolved = dependencies.resolve_profiles(["everything"])

    assert "all-local" in resolved["resolved_profiles"]
    assert "all-optional" in resolved["resolved_profiles"]
    assert "weasyprint" in resolved["python_dependencies"]
    assert "java" in resolved["system_dependencies"]
    assert "libreoffice" in resolved["system_dependencies"]


def test_install_dependency_profiles_builds_apt_and_pip_commands(monkeypatch):
    monkeypatch.setattr(dependencies, "python_dependency_available", lambda key: False)
    monkeypatch.setattr(dependencies, "system_dependency_available", lambda key: False)
    monkeypatch.setattr(dependencies.shutil, "which", lambda name: "/usr/bin/apt-get" if name == "apt-get" else None)
    monkeypatch.setattr(dependencies, "_in_virtualenv", lambda: False)

    commands: list[list[str]] = []

    def _run(command, check, **kwargs):
        commands.append(command)
        if command[-2:] == ["pip", "check"]:
            return subprocess.CompletedProcess(command, 0, "", "")
        return None

    monkeypatch.setattr(dependencies.subprocess, "run", _run)

    summary = dependencies.install_dependency_profiles(["ocr-local"], dry_run=False)
    pip_install_command = next(command for command in commands if command[:4] == ["/usr/bin/python3", "-m", "pip", "install"])
    pip_check_command = next(command for command in commands if command[-2:] == ["pip", "check"])

    assert summary["apt_packages"] == ["poppler-utils", "tesseract-ocr"]
    assert summary["pip_packages"] == ["PyMuPDF"]
    assert commands[0][:2] == ["apt-get", "update"]
    assert "--break-system-packages" in pip_install_command
    assert pip_check_command == ["/usr/bin/python3", "-m", "pip", "check"]
    assert summary["post_install_health"]["ok"] is True


def test_pip_check_report_collects_conflicts(monkeypatch):
    monkeypatch.setattr(
        dependencies.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0],
            1,
            "pkg-a has requirement demo==1.0, but you have demo 2.0.\n",
            "",
        ),
    )

    report = dependencies.pip_check_report()

    assert report["ok"] is False
    assert report["conflicts"] == ["pkg-a has requirement demo==1.0, but you have demo 2.0."]
