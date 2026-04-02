from __future__ import annotations

from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


def stirling_healthcheck(base_url: str, timeout: float = 2.0) -> bool:
    try:
        with urlopen(base_url, timeout=timeout) as response:
            return 200 <= response.status < 500
    except (URLError, ValueError):
        return False


def submit_stirling_html_to_pdf(base_url: str, html_path: str | Path, output_path: str | Path, timeout: float = 30.0) -> Path:
    request = Request(f"{base_url.rstrip('/')}/api/v1/convert/html/pdf", method="POST")
    request.add_header("Content-Type", "text/html; charset=utf-8")
    payload = Path(html_path).read_text(encoding="utf-8").encode("utf-8")
    with urlopen(request, data=payload, timeout=timeout) as response:
        Path(output_path).write_bytes(response.read())
    return Path(output_path)
