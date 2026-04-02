from __future__ import annotations

import re
from pathlib import Path

from document_processing_pipeline.io_helpers import load_blocks, write_jsonl
from document_processing_pipeline.models import TransformBlock

# Chinese punctuation → English punctuation mapping.
# Multi-char entries (like "——") must be checked first, so we use a list of
# tuples sorted by key length (longest first) to avoid partial matches.
_ZH_TO_EN_PUNCT: list[tuple[str, str]] = sorted(
    [
        ("，", ", "),
        ("。", ". "),
        ("！", "! "),
        ("？", "? "),
        ("；", "; "),
        ("：", ": "),
        ("\u201c", '"'),   # "
        ("\u201d", '"'),   # "
        ("\u2018", "'"),   # '
        ("\u2019", "'"),   # '
        ("（", "("),
        ("）", ")"),
        ("【", "["),
        ("】", "]"),
        ("《", "<"),
        ("》", ">"),
        ("、", ", "),
        ("——", " -- "),
        ("…", "..."),
        ("～", "~"),
    ],
    key=lambda pair: len(pair[0]),
    reverse=True,
)


def _replace_zh_punct(text: str) -> str:
    """Replace Chinese punctuation marks with their English equivalents.

    After substitution, consecutive whitespace is collapsed to a single space
    and leading/trailing whitespace on each line is stripped.
    """
    result = text
    for zh, en in _ZH_TO_EN_PUNCT:
        result = result.replace(zh, en)
    # Collapse multiple spaces into one (but preserve newlines).
    result = re.sub(r"[^\S\n]+", " ", result)
    # Strip leading/trailing whitespace on each line.
    result = "\n".join(line.strip() for line in result.split("\n"))
    return result


def apply_transform(
    run_dir: str | Path,
    operation: str = "copy",
    input_file: str | Path | None = None,
    prefix: str = "",
) -> Path:
    run_path = Path(run_dir)
    source_path = Path(input_file) if input_file else run_path / "clean_blocks.jsonl"
    blocks = load_blocks(source_path)

    transformed: list[TransformBlock] = []
    for block in blocks:
        text = block.text
        if operation == "copy":
            pass
        elif operation == "uppercase":
            text = text.upper()
        elif operation == "lowercase":
            text = text.lower()
        elif operation == "prefix":
            text = f"{prefix}{text}"
        elif operation == "zh-punct-to-en":
            text = _replace_zh_punct(text)
        else:
            raise ValueError(f"Unsupported operation: {operation}")
        transformed.append(
            TransformBlock(
                block_id=block.block_id,
                text=text,
                source_block_ids=block.source_block_ids,
                section_path=block.section_path,
                transform_policy=block.transform_policy,
                metadata=block.metadata,
            )
        )

    output_path = run_path / "transformed_blocks.jsonl"
    write_jsonl(output_path, [block.to_dict() for block in transformed])
    return output_path
