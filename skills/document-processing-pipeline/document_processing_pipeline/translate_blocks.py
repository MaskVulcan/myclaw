from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import time
from typing import Protocol

from document_processing_pipeline import bootstrap as dependency_bootstrap
from document_processing_pipeline.io_helpers import load_blocks, load_jsonl, write_jsonl
from document_processing_pipeline.models import TransformBlock
from document_processing_pipeline.translation_rules import is_formula_like_text, protect_terms, restore_terms


DEFAULT_ENGINE = "google"
DEFAULT_BATCH_SIZE = 8
DEFAULT_RETRY_COUNT = 2
DEFAULT_INPUT_NAME = "clean_blocks.jsonl"
DEFAULT_CACHE_NAME = "translation_cache.jsonl"
DEFAULT_TRANSLATED_NAME = "translated_blocks.jsonl"
DEFAULT_PENDING_NAME = "pending_codex_fallback.jsonl"
DEFAULT_CODEX_FALLBACK_NAME = "codex_fallback_blocks.jsonl"
DEFAULT_STATUS_NAME = "translation_status.json"
DEFAULT_OUTPUT_NAME = "transformed_blocks.jsonl"


class TranslatorAdapter(Protocol):
    def translate_batch(self, texts: list[str], source_lang: str, target_lang: str) -> list[str]: ...

    def translate_text(self, text: str, source_lang: str, target_lang: str) -> str: ...


@dataclass(frozen=True)
class PendingFallbackBlock:
    block_id: str
    source_text: str
    source_block_ids: list[str]
    section_path: list[str]
    transform_policy: str
    metadata: dict[str, object]
    failure_reason: str

    def to_dict(self) -> dict[str, object]:
        return {
            "block_id": self.block_id,
            "source_text": self.source_text,
            "source_block_ids": self.source_block_ids,
            "section_path": self.section_path,
            "transform_policy": self.transform_policy,
            "metadata": self.metadata,
            "failure_reason": self.failure_reason,
        }


@dataclass(frozen=True)
class _CacheEntry:
    source_lang: str
    target_lang: str
    engine: str
    source_text_hash: str
    translated_text: str
    source_text: str | None = None

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "source_lang": self.source_lang,
            "target_lang": self.target_lang,
            "engine": self.engine,
            "source_text_hash": self.source_text_hash,
            "translated_text": self.translated_text,
        }
        if self.source_text is not None:
            payload["source_text"] = self.source_text
        return payload


class GoogleHttpTranslator:
    """Scrape Google Translate's mobile endpoint for block-level translation.

    ``deep_translator`` is bootstrapped as a convenience package because it
    pulls in ``requests`` and ``beautifulsoup4`` as transitive dependencies.
    Only those two libraries are used directly here.
    """

    base_url = "https://translate.google.com/m"

    def __init__(self, timeout: tuple[float, float] = (10.0, 20.0)) -> None:
        # Bootstrap deep_translator to ensure requests + bs4 are available.
        dependency_bootstrap.ensure_python_dependency("deep_translator")
        import requests
        from bs4 import BeautifulSoup

        self._BeautifulSoup = BeautifulSoup
        self._requests = requests
        self.timeout = timeout
        self.session = self._requests.Session()
        self.session.headers.update({"User-Agent": "Mozilla/5.0"})

    def _fetch_translation(self, text: str, source_lang: str, target_lang: str) -> str:
        response = self.session.get(
            self.base_url,
            params={"sl": source_lang, "tl": target_lang, "q": text},
            timeout=self.timeout,
        )
        response.raise_for_status()
        soup = self._BeautifulSoup(response.text, "html.parser")
        element = soup.find("div", {"class": "t0"}) or soup.find("div", {"class": "result-container"})
        if element is None:
            raise RuntimeError("Google translation response did not contain a result block.")
        return element.get_text("\n", strip=True)

    def _split_group_translation(self, translated: str, count: int) -> list[str]:
        marker_pattern = re.compile(r"\[\[BLOCK_(\d{4})\]\]")
        matches = list(marker_pattern.finditer(translated))
        if len(matches) < count:
            raise RuntimeError(f"Grouped translation marker mismatch: expected {count}, got {len(matches)}.")
        parts: dict[int, str] = {}
        for index, match in enumerate(matches):
            block_index = int(match.group(1))
            start = match.end()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(translated)
            parts[block_index] = translated[start:end].strip()
        return [parts[index] for index in range(count)]

    def translate_batch(self, texts: list[str], source_lang: str, target_lang: str) -> list[str]:
        if not texts:
            return []
        if len(texts) == 1:
            return [self.translate_text(texts[0], source_lang, target_lang)]
        payload = "\n".join(f"[[BLOCK_{index:04d}]]\n{text}" for index, text in enumerate(texts))
        translated = self._fetch_translation(payload, source_lang, target_lang)
        results = self._split_group_translation(translated, len(texts))
        if any(not item.strip() for item in results):
            raise RuntimeError("Grouped translation returned an empty block.")
        return results

    def translate_text(self, text: str, source_lang: str, target_lang: str) -> str:
        return self._fetch_translation(text, source_lang, target_lang)


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _cache_key(source_lang: str, target_lang: str, engine: str, text: str) -> tuple[str, str, str, str]:
    return (source_lang, target_lang, engine, _hash_text(text))


def _load_cache(path: Path) -> dict[tuple[str, str, str, str], str]:
    cache: dict[tuple[str, str, str, str], str] = {}
    for item in load_jsonl(path):
        try:
            key = (
                str(item["source_lang"]),
                str(item["target_lang"]),
                str(item["engine"]),
                str(item["source_text_hash"]),
            )
            cache[key] = str(item["translated_text"])
        except KeyError:
            continue
    return cache



def _load_status(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_status(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _chunked(
    items: list[tuple[TransformBlock, str, dict[str, str], tuple[str, str, str, str]]],
    size: int,
) -> list[list[tuple[TransformBlock, str, dict[str, str], tuple[str, str, str, str]]]]:
    return [items[index : index + size] for index in range(0, len(items), max(1, size))]


def _translated_block(block: TransformBlock, translated_text: str) -> TransformBlock:
    return TransformBlock(
        block_id=block.block_id,
        text=translated_text,
        source_block_ids=list(block.source_block_ids),
        section_path=list(block.section_path),
        transform_policy=block.transform_policy,
        metadata=dict(block.metadata),
    )


def _pending_block(block: TransformBlock, failure_reason: str) -> PendingFallbackBlock:
    return PendingFallbackBlock(
        block_id=block.block_id,
        source_text=block.text,
        source_block_ids=list(block.source_block_ids),
        section_path=list(block.section_path),
        transform_policy=block.transform_policy,
        metadata=dict(block.metadata),
        failure_reason=failure_reason,
    )


def _default_translator(engine: str) -> TranslatorAdapter:
    if engine != DEFAULT_ENGINE:
        raise ValueError(f"Unsupported translation engine: {engine}")
    return GoogleHttpTranslator()


def _translate_single_with_retry(
    translator: TranslatorAdapter,
    text: str,
    source_lang: str,
    target_lang: str,
    retry_count: int,
    replacements: dict[str, str] | None = None,
) -> tuple[str | None, str | None]:
    last_error: str | None = None
    for attempt in range(retry_count + 1):
        try:
            translated = translator.translate_text(text, source_lang, target_lang).strip()
            if replacements:
                translated = restore_terms(translated, replacements)
            if translated:
                return translated, None
            last_error = "empty translation result"
        except Exception as exc:  # pragma: no cover - exercised by tests with RuntimeError
            last_error = str(exc)
        if attempt < retry_count:
            time.sleep(0.1 * (attempt + 1))
    return None, last_error or "translation failed"


def translate_blocks(
    run_dir: str | Path,
    *,
    source_lang: str,
    target_lang: str,
    input_file: str | Path | None = None,
    engine: str = DEFAULT_ENGINE,
    batch_size: int = DEFAULT_BATCH_SIZE,
    retry_count: int = DEFAULT_RETRY_COUNT,
    translator: TranslatorAdapter | None = None,
) -> Path:
    run_path = Path(run_dir)
    source_path = Path(input_file) if input_file else run_path / DEFAULT_INPUT_NAME
    blocks = load_blocks(source_path)
    cache_path = run_path / DEFAULT_CACHE_NAME
    translated_path = run_path / DEFAULT_TRANSLATED_NAME
    pending_path = run_path / DEFAULT_PENDING_NAME
    status_path = run_path / DEFAULT_STATUS_NAME
    output_path = run_path / DEFAULT_OUTPUT_NAME

    cache = _load_cache(cache_path)
    cache_updates: dict[tuple[str, str, str, str], _CacheEntry] = {}
    translated_by_id: dict[str, TransformBlock] = {}
    pending_blocks: list[PendingFallbackBlock] = []
    failures: list[dict[str, str]] = []
    cache_hits = 0
    http_successes = 0
    passthrough_blocks = 0

    unresolved: list[tuple[TransformBlock, str, dict[str, str], tuple[str, str, str, str]]] = []
    for block in blocks:
        if not block.text.strip():
            translated_by_id[block.block_id] = _translated_block(block, block.text)
            passthrough_blocks += 1
            continue
        block_type = block.metadata.get("block_type") if block.metadata else None
        if is_formula_like_text(block.text, block_type=block_type):
            translated_by_id[block.block_id] = _translated_block(block, block.text)
            passthrough_blocks += 1
            continue
        key = _cache_key(source_lang, target_lang, engine, block.text)
        cached_translation = cache.get(key)
        if cached_translation is not None:
            translated_by_id[block.block_id] = _translated_block(block, cached_translation)
            cache_hits += 1
            continue
        protected_text, replacements = protect_terms(block.text)
        unresolved.append((block, protected_text, replacements, key))

    active_translator = translator or _default_translator(engine)
    for chunk in _chunked(unresolved, batch_size):
        chunk_blocks = [block for block, _, _, _ in chunk]
        chunk_texts = [protected_text for _, protected_text, _, _ in chunk]
        chunk_results: list[str] | None = None
        try:
            chunk_results = [str(item).strip() for item in active_translator.translate_batch(chunk_texts, source_lang, target_lang)]
            if len(chunk_results) != len(chunk_blocks) or any(not item for item in chunk_results):
                chunk_results = None
        except Exception:
            chunk_results = None

        if chunk_results is not None:
            for (block, _, replacements, key), translated_text in zip(chunk, chunk_results):
                translated_text = restore_terms(translated_text, replacements)
                translated_by_id[block.block_id] = _translated_block(block, translated_text)
                cache_updates[key] = _CacheEntry(
                    source_lang=source_lang,
                    target_lang=target_lang,
                    engine=engine,
                    source_text_hash=key[3],
                    translated_text=translated_text,
                    source_text=block.text,
                )
                http_successes += 1
            continue

        for block, protected_text, replacements, key in chunk:
            translated_text, failure_reason = _translate_single_with_retry(
                active_translator,
                protected_text,
                source_lang=source_lang,
                target_lang=target_lang,
                retry_count=retry_count,
                replacements=replacements,
            )
            if translated_text is not None:
                translated_by_id[block.block_id] = _translated_block(block, translated_text)
                cache_updates[key] = _CacheEntry(
                    source_lang=source_lang,
                    target_lang=target_lang,
                    engine=engine,
                    source_text_hash=key[3],
                    translated_text=translated_text,
                    source_text=block.text,
                )
                http_successes += 1
            else:
                pending = _pending_block(block, failure_reason or "translation failed")
                pending_blocks.append(pending)
                failures.append({"block_id": block.block_id, "reason": pending.failure_reason})

    translated_rows = [translated_by_id[block.block_id].to_dict() for block in blocks if block.block_id in translated_by_id]
    pending_rows = [item.to_dict() for item in pending_blocks]
    write_jsonl(translated_path, translated_rows)
    write_jsonl(pending_path, pending_rows)

    merged_cache = _load_cache(cache_path)
    for entry in cache_updates.values():
        merged_cache[(entry.source_lang, entry.target_lang, entry.engine, entry.source_text_hash)] = entry.translated_text
    write_jsonl(
        cache_path,
        [
            _CacheEntry(source_lang=key[0], target_lang=key[1], engine=key[2], source_text_hash=key[3], translated_text=value).to_dict()
            for key, value in sorted(merged_cache.items())
        ],
    )

    state = "complete" if not pending_blocks else "needs_codex_fallback"
    if state == "complete":
        write_jsonl(output_path, translated_rows)

    status = {
        "state": state,
        "engine": engine,
        "source_lang": source_lang,
        "target_lang": target_lang,
        "source_file": source_path.name,
        "translated_file": translated_path.name,
        "pending_fallback_file": pending_path.name,
        "codex_fallback_file": DEFAULT_CODEX_FALLBACK_NAME,
        "output_file": output_path.name,
        "cache_file": cache_path.name,
        "total_blocks": len(blocks),
        "successful_blocks": len(translated_rows),
        "http_success_blocks": http_successes,
        "passthrough_blocks": passthrough_blocks,
        "cache_hits": cache_hits,
        "pending_fallback_blocks": len(pending_rows),
        "failures": failures,
    }
    _write_status(status_path, status)
    return translated_path


def merge_translations(
    run_dir: str | Path,
    *,
    input_file: str | Path | None = None,
    translated_file: str | Path | None = None,
    codex_fallback_file: str | Path | None = None,
    output_file: str | Path | None = None,
) -> Path:
    run_path = Path(run_dir)
    source_path = Path(input_file) if input_file else run_path / DEFAULT_INPUT_NAME
    translated_path = Path(translated_file) if translated_file else run_path / DEFAULT_TRANSLATED_NAME
    fallback_path = Path(codex_fallback_file) if codex_fallback_file else run_path / DEFAULT_CODEX_FALLBACK_NAME
    output_path = Path(output_file) if output_file else run_path / DEFAULT_OUTPUT_NAME
    status_path = run_path / DEFAULT_STATUS_NAME

    source_blocks = load_blocks(source_path)
    translated_map = {item.block_id: item for item in (load_blocks(translated_path) if translated_path.exists() else [])}
    fallback_map = {item.block_id: item for item in (load_blocks(fallback_path) if fallback_path.exists() else [])}

    merged_blocks: list[TransformBlock] = []
    missing_block_ids: list[str] = []
    for block in source_blocks:
        merged = fallback_map.get(block.block_id) or translated_map.get(block.block_id)
        if merged is None:
            missing_block_ids.append(block.block_id)
            continue
        merged_blocks.append(merged)

    status = _load_status(status_path)
    status.update(
        {
            "source_file": source_path.name,
            "translated_file": translated_path.name,
            "codex_fallback_file": fallback_path.name,
            "output_file": output_path.name,
        }
    )
    if missing_block_ids:
        status["state"] = "merge_incomplete"
        status["missing_block_ids"] = missing_block_ids
        _write_status(status_path, status)
        raise RuntimeError(f"Missing translated blocks: {', '.join(missing_block_ids)}")

    write_jsonl(output_path, [block.to_dict() for block in merged_blocks])
    status["state"] = "complete"
    status["merged_blocks"] = len(merged_blocks)
    status["missing_block_ids"] = []
    _write_status(status_path, status)
    return output_path
