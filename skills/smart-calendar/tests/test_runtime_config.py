from pathlib import Path

from smart_calendar.cli import _Services
from smart_calendar.utils.config import Config


def test_config_prefers_runtime_home_from_env(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("SMART_CALENDAR_HOME", str(tmp_path))

    config = Config()

    assert config.base_dir == tmp_path
    assert config.events_dir == tmp_path / "data" / "events"
    assert config.people_dir == tmp_path / "data" / "people"


def test_services_prefers_runtime_home_from_env(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("SMART_CALENDAR_HOME", str(tmp_path))

    services = _Services()

    assert services.config.base_dir == tmp_path
