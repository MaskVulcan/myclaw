"""配置加载器 — 读取 data/config.yml"""

import copy
import os
from pathlib import Path
from typing import Any

import yaml


_DEFAULT_CONFIG = {
    "categories": {
        "会议": {
            "color": "#F97316",
            "icon": "🤝",
            "heatmap_cmap": "Oranges",
        },
        "技术": {
            "color": "#14B8A6",
            "icon": "💻",
            "heatmap_cmap": "Blues",
        },
        "学习": {
            "color": "#6366F1",
            "icon": "📚",
            "heatmap_cmap": "Purples",
        },
        "出行": {
            "color": "#2563EB",
            "icon": "🚄",
            "heatmap_cmap": "Blues",
        },
        "健康": {
            "color": "#16A34A",
            "icon": "🩺",
            "heatmap_cmap": "Greens",
        },
        "家庭": {
            "color": "#E11D48",
            "icon": "🏠",
            "heatmap_cmap": "Reds",
        },
        "社交": {
            "color": "#D97706",
            "icon": "☕",
            "heatmap_cmap": "YlOrBr",
        },
        "其他": {
            "color": "#475569",
            "icon": "📌",
            "heatmap_cmap": "Greys",
        },
    },
    "defaults": {
        "timezone": "Asia/Shanghai",
        "locale": "zh",
        "work_hours": [9, 18],
        "data_dir": "./data",
        "output_dir": "./output",
    },
}


_BASE_DIR_ENV_KEYS = ("SMART_CALENDAR_HOME", "SMART_CALENDAR_BASE_DIR")


class Config:
    """全局配置，从 config.yml 加载"""

    def __init__(self, base_dir: str | Path | None = None):
        if base_dir is None:
            for env_key in _BASE_DIR_ENV_KEYS:
                raw_value = os.environ.get(env_key, "").strip()
                if raw_value:
                    base_dir = Path(raw_value).expanduser()
                    break
            if base_dir is None:
                base_dir = Path(__file__).resolve().parent.parent.parent
        self.base_dir = Path(base_dir)
        self._data: dict[str, Any] = {}
        self._load()

    def _load(self):
        config_path = self.base_dir / "data" / "config.yml"
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                self._data = yaml.safe_load(f) or {}
        else:
            self._data = copy.deepcopy(_DEFAULT_CONFIG)

    @property
    def categories(self) -> dict[str, dict]:
        categories = copy.deepcopy(_DEFAULT_CONFIG["categories"])
        configured = self._data.get("categories", {})
        for name, info in configured.items():
            base = categories.get(name, {})
            categories[name] = {**base, **(info or {})}
        return categories

    @property
    def timezone(self) -> str:
        return self._data.get("defaults", {}).get("timezone", "Asia/Shanghai")

    @property
    def data_dir(self) -> Path:
        rel = self._data.get("defaults", {}).get("data_dir", "./data")
        return self.base_dir / rel

    @property
    def output_dir(self) -> Path:
        rel = self._data.get("defaults", {}).get("output_dir", "./output")
        return self.base_dir / rel

    @property
    def events_dir(self) -> Path:
        return self.data_dir / "events"

    @property
    def people_dir(self) -> Path:
        return self.data_dir / "people"

    @property
    def work_hours(self) -> tuple[int, int]:
        """返回工作时间范围 (start_hour, end_hour)"""
        wh = self._data.get("defaults", {}).get("work_hours", [9, 18])
        return wh[0], wh[1]

    def get_category_icon(self, category: str) -> str:
        return self.categories.get(category, {}).get("icon", "📌")

    def get_category_color(self, category: str) -> str:
        return self.categories.get(category, {}).get("color", "#475569")

    def get_category_cmap(self, category: str) -> str:
        return self.categories.get(category, {}).get("heatmap_cmap", "Greys")

    def list_categories(self) -> list[str]:
        return list(self.categories.keys())
