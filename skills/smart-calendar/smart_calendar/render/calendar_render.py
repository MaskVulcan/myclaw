"""日历图渲染 — 日历/议程 HTML + Playwright 截图"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from smart_calendar.storage.event_store import Event
from smart_calendar.utils.config import Config


# 视图 → TOAST UI view name
_VIEW_MAP = {
    "month": "month",
    "week": "week",
    "day": "day",
}

# 视图 → 默认截图尺寸
_SIZE_MAP = {
    "month": {"width": 1200, "height": 900},
    "week": {"width": 1200, "height": 1200},
    "day": {"width": 980, "height": 920},
}


class CalendarRender:
    """TOAST UI Calendar → PNG 渲染器"""

    def __init__(self, config: Config | None = None):
        self.config = config or Config()
        template_dir = Path(__file__).parent / "templates"
        self.env = Environment(loader=FileSystemLoader(str(template_dir)))

    @staticmethod
    def _parse_time_range(time_str: str) -> tuple[int, int]:
        """解析时间字符串为 (start_minute, end_minute)。"""
        parts = time_str.split("-")
        try:
            hour, minute = (int(x) for x in parts[0].strip().split(":"))
        except (ValueError, IndexError):
            return 9 * 60, 10 * 60

        start_minute = hour * 60 + minute

        if len(parts) > 1:
            try:
                end_hour, end_minute = (int(x) for x in parts[1].strip().split(":"))
                return start_minute, end_hour * 60 + end_minute
            except (ValueError, IndexError):
                pass

        return start_minute, start_minute + 60

    @staticmethod
    def _normalize_hex_color(color: str) -> str:
        color = (color or "").strip().lstrip("#")
        if len(color) == 3:
            color = "".join(ch * 2 for ch in color)
        if len(color) != 6:
            return "#475569"
        try:
            int(color, 16)
        except ValueError:
            return "#475569"
        return f"#{color.lower()}"

    @classmethod
    def _hex_to_rgb(cls, color: str) -> tuple[int, int, int]:
        normalized = cls._normalize_hex_color(color).lstrip("#")
        return (
            int(normalized[0:2], 16),
            int(normalized[2:4], 16),
            int(normalized[4:6], 16),
        )

    @staticmethod
    def _srgb_channel_to_linear(channel: int) -> float:
        value = channel / 255
        return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4

    @classmethod
    def _relative_luminance(cls, color: str) -> float:
        red, green, blue = cls._hex_to_rgb(color)
        r = cls._srgb_channel_to_linear(red)
        g = cls._srgb_channel_to_linear(green)
        b = cls._srgb_channel_to_linear(blue)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    @classmethod
    def _blend_hex(cls, color: str, target: str, target_ratio: float) -> str:
        target_ratio = min(max(target_ratio, 0.0), 1.0)
        red, green, blue = cls._hex_to_rgb(color)
        target_red, target_green, target_blue = cls._hex_to_rgb(target)
        mixed = (
            round(red * (1 - target_ratio) + target_red * target_ratio),
            round(green * (1 - target_ratio) + target_green * target_ratio),
            round(blue * (1 - target_ratio) + target_blue * target_ratio),
        )
        return "#{:02x}{:02x}{:02x}".format(*mixed)

    @classmethod
    def _normalize_accent_color(cls, color: str) -> str:
        accent = cls._normalize_hex_color(color)
        if cls._relative_luminance(accent) > 0.62:
            return cls._blend_hex(accent, "#334155", 0.58)
        return accent

    @classmethod
    def _readable_text_color(cls, color: str) -> str:
        return "#0f172a" if cls._relative_luminance(color) > 0.42 else "#f8fafc"

    @classmethod
    def _build_color_tokens(cls, color: str) -> dict[str, str]:
        accent = cls._normalize_accent_color(color)
        return {
            "color": accent,
            "text_color": cls._readable_text_color(accent),
            "soft_color": cls._blend_hex(accent, "#ffffff", 0.86),
            "soft_border_color": cls._blend_hex(accent, "#ffffff", 0.62),
            "accent_dark": cls._blend_hex(accent, "#0f172a", 0.18),
        }

    def _build_category_styles(self, events: list[Event]) -> dict[str, dict]:
        configured = self.config.categories
        visible_names: list[str] = []
        for event in events:
            if event.category not in visible_names:
                visible_names.append(event.category)

        category_names = visible_names or list(configured.keys())
        result: dict[str, dict] = {}

        for name in category_names:
            base = configured.get(
                name,
                {
                    "color": self.config.get_category_color(name),
                    "icon": self.config.get_category_icon(name),
                    "heatmap_cmap": self.config.get_category_cmap(name),
                },
            )
            result[name] = {
                **base,
                **self._build_color_tokens(base.get("color", "#475569")),
            }

        return result

    def _compute_week_month_layout(self, events: list[Event]) -> tuple[int, int, int]:
        work_start, work_end = self.config.work_hours
        hour_start = work_start
        hour_end = min(work_end + 1, 24)

        for event in events:
            start_minute, end_minute = self._parse_time_range(event.time)
            event_start_hour = start_minute // 60
            event_end_hour = max(event_start_hour + 1, (end_minute + 59) // 60)
            hour_start = min(hour_start, event_start_hour)
            hour_end = max(hour_end, min(event_end_hour + 1, 24))

        hour_span = max(hour_end - hour_start, 5)
        cal_height = max(560, hour_span * 72)
        return hour_start, hour_end, cal_height

    def _build_event_data(self, events: list[Event]) -> list[dict]:
        """将 Event 转为模板需要的 dict 格式"""
        result = []
        for e in sorted(events, key=lambda item: (item.date, item.start_hour, item.start_minute)):
            icon = self.config.get_category_icon(e.category)
            colors = self._build_color_tokens(self.config.get_category_color(e.category))

            # 解析 start/end ISO 时间
            time_parts = e.time.split("-")
            start_time = time_parts[0].strip()
            end_time = time_parts[1].strip() if len(time_parts) > 1 else None

            # 构建 start datetime
            h, m = (int(x) for x in start_time.split(":"))
            start_dt = datetime(e.date.year, e.date.month, e.date.day, h, m)

            # 构建 end datetime（默认 1 小时）
            if end_time:
                eh, em = (int(x) for x in end_time.split(":"))
                end_dt = datetime(e.date.year, e.date.month, e.date.day, eh, em)
            else:
                end_dt = start_dt + timedelta(hours=1)

            result.append(
                {
                    "id": e.id,
                    "category": e.category,
                    "icon": icon,
                    "title": e.title,
                    "start_iso": start_dt.isoformat(),
                    "end_iso": end_dt.isoformat(),
                    "location": e.location,
                    "participants": e.participants,
                    "notes": e.notes,
                    "time_label": e.time,
                    "date_label": f"{e.date.month}月{e.date.day}日",
                    **colors,
                }
            )
        return result

    def render_html(
        self,
        events: list[Event],
        view: str = "week",
        focus_date: date | None = None,
        title: str = "Smart Calendar",
        date_range: str = "",
    ) -> str:
        """渲染 HTML 字符串"""
        if focus_date is None:
            focus_date = date.today()

        event_data = self._build_event_data(events)
        categories = self._build_category_styles(events)
        resolved_date_range = date_range or focus_date.isoformat()

        if view == "day":
            template = self.env.get_template("day_agenda.html")
            return template.render(
                title=title,
                date_range=resolved_date_range,
                focus_date=focus_date.isoformat(),
                events=event_data,
                categories=categories,
                total_events=len(event_data),
            )

        tui_view = _VIEW_MAP.get(view, "week")
        hour_start, hour_end, cal_height = self._compute_week_month_layout(events)

        template = self.env.get_template("toast_ui.html")
        return template.render(
            title=title,
            date_range=resolved_date_range,
            view=tui_view,
            focus_date=focus_date.isoformat(),
            events=event_data,
            categories=categories,
            height=cal_height,
            hour_start=hour_start,
            hour_end=hour_end,
        )

    def render_png(
        self,
        events: list[Event],
        output_path: str | Path,
        view: str = "week",
        focus_date: date | None = None,
        title: str = "Smart Calendar",
        date_range: str = "",
    ) -> Path:
        """渲染日历图为 PNG 文件"""
        from playwright.sync_api import sync_playwright

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        html = self.render_html(events, view, focus_date, title, date_range)
        size = _SIZE_MAP.get(view, _SIZE_MAP["week"])

        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(
                viewport={"width": size["width"], "height": size["height"]},
                device_scale_factor=2,
            )
            page.set_content(html, wait_until="load")
            try:
                page.wait_for_selector("#capture-root", state="visible", timeout=10000)
                if view != "day":
                    page.wait_for_selector(
                        ".toastui-calendar-layout",
                        state="attached",
                        timeout=10000,
                    )
                page.wait_for_timeout(350)
            except Exception:
                page.wait_for_timeout(1500)
            page.locator("#capture-root").screenshot(path=str(output_path))
            browser.close()

        return output_path
