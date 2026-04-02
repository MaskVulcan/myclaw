#!/usr/bin/env python3
"""Legacy entry point.  Prefer ``docpipe`` (after ``pip install -e .``)
or ``python -m document_processing_pipeline``."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from document_processing_pipeline.cli import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
