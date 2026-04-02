from __future__ import annotations

import json
from pathlib import Path

import pytest

from document_processing_pipeline.cli import build_parser
from document_processing_pipeline.models import TransformBlock
from document_processing_pipeline.translate_blocks import merge_translations, translate_blocks


class FakeTranslator:
    def __init__(self, translations: dict[str, str], fail_texts: set[str] | None = None) -> None:
        self.translations = translations
        self.fail_texts = fail_texts or set()
        self.batch_calls = 0
        self.single_calls = 0
        self.seen_texts: list[str] = []

    def translate_batch(self, texts: list[str], source_lang: str, target_lang: str) -> list[str]:
        self.batch_calls += 1
        self.seen_texts.extend(texts)
        if any(text in self.fail_texts for text in texts):
            raise RuntimeError("batch translation failed")
        return [self.translations[text] for text in texts]

    def translate_text(self, text: str, source_lang: str, target_lang: str) -> str:
        self.single_calls += 1
        self.seen_texts.append(text)
        if text in self.fail_texts:
            raise RuntimeError(f"translation failed for {text}")
        return self.translations[text]


def _write_clean_blocks(path: Path, blocks: list[TransformBlock]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for block in blocks:
            handle.write(json.dumps(block.to_dict(), ensure_ascii=False) + "\n")


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def test_translate_blocks_separates_successes_and_pending_failures(tmp_path: Path):
    run_dir = tmp_path
    _write_clean_blocks(
        run_dir / "clean_blocks.jsonl",
        [
            TransformBlock(block_id="b1", text="Hello"),
            TransformBlock(block_id="b2", text="Fail me"),
        ],
    )
    translator = FakeTranslator({"Hello": "你好"}, fail_texts={"Fail me"})

    translate_blocks(
        run_dir,
        source_lang="en",
        target_lang="zh-CN",
        translator=translator,
        batch_size=8,
        retry_count=0,
    )

    translated = _read_jsonl(run_dir / "translated_blocks.jsonl")
    pending = _read_jsonl(run_dir / "pending_codex_fallback.jsonl")
    status = json.loads((run_dir / "translation_status.json").read_text(encoding="utf-8"))

    assert translated == [{"block_id": "b1", "text": "你好", "source_block_ids": [], "section_path": [], "transform_policy": "rewrite", "metadata": {}}]
    assert pending[0]["block_id"] == "b2"
    assert pending[0]["source_text"] == "Fail me"
    assert pending[0]["failure_reason"] == "translation failed for Fail me"
    assert status["state"] == "needs_codex_fallback"
    assert status["successful_blocks"] == 1
    assert status["pending_fallback_blocks"] == 1
    assert translator.batch_calls == 1
    assert translator.single_calls == 2


def test_translate_blocks_uses_cache_before_calling_translator(tmp_path: Path):
    run_dir = tmp_path
    _write_clean_blocks(run_dir / "clean_blocks.jsonl", [TransformBlock(block_id="b1", text="Hello")])
    (run_dir / "translation_cache.jsonl").write_text(
        json.dumps(
            {
                "source_lang": "en",
                "target_lang": "zh-CN",
                "engine": "google",
                "source_text_hash": "185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969",
                "translated_text": "你好",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    translator = FakeTranslator({"Hello": "不会被调用"})

    translate_blocks(run_dir, source_lang="en", target_lang="zh-CN", translator=translator)

    translated = _read_jsonl(run_dir / "translated_blocks.jsonl")
    status = json.loads((run_dir / "translation_status.json").read_text(encoding="utf-8"))

    assert translated[0]["text"] == "你好"
    assert status["state"] == "complete"
    assert status["cache_hits"] == 1
    assert translator.batch_calls == 0
    assert translator.single_calls == 0


def test_merge_translations_prefers_codex_fallback_blocks(tmp_path: Path):
    run_dir = tmp_path
    _write_clean_blocks(
        run_dir / "clean_blocks.jsonl",
        [
            TransformBlock(block_id="b1", text="Hello"),
            TransformBlock(block_id="b2", text="World"),
        ],
    )
    (run_dir / "translated_blocks.jsonl").write_text(
        '{"block_id":"b1","text":"你好"}\n{"block_id":"b2","text":"世界-HTTP"}\n',
        encoding="utf-8",
    )
    (run_dir / "codex_fallback_blocks.jsonl").write_text('{"block_id":"b2","text":"世界-Codex"}\n', encoding="utf-8")
    (run_dir / "translation_status.json").write_text('{"state":"needs_codex_fallback"}\n', encoding="utf-8")

    output_path = merge_translations(run_dir)

    merged = _read_jsonl(output_path)
    status = json.loads((run_dir / "translation_status.json").read_text(encoding="utf-8"))

    assert [item["text"] for item in merged] == ["你好", "世界-Codex"]
    assert status["state"] == "complete"
    assert status["merged_blocks"] == 2


def test_merge_translations_marks_run_incomplete_when_blocks_are_missing(tmp_path: Path):
    run_dir = tmp_path
    _write_clean_blocks(
        run_dir / "clean_blocks.jsonl",
        [
            TransformBlock(block_id="b1", text="Hello"),
            TransformBlock(block_id="b2", text="World"),
        ],
    )
    (run_dir / "translated_blocks.jsonl").write_text('{"block_id":"b1","text":"你好"}\n', encoding="utf-8")
    (run_dir / "translation_status.json").write_text('{"state":"needs_codex_fallback"}\n', encoding="utf-8")

    with pytest.raises(RuntimeError, match="Missing translated blocks: b2"):
        merge_translations(run_dir)

    status = json.loads((run_dir / "translation_status.json").read_text(encoding="utf-8"))
    assert status["state"] == "merge_incomplete"
    assert status["missing_block_ids"] == ["b2"]


def test_translate_blocks_protects_core_model_terms_before_translation(tmp_path: Path):
    run_dir = tmp_path
    source_text = "Standard residual connections are the de facto building block of modern LLMs with PreNorm and softmax."
    _write_clean_blocks(run_dir / "clean_blocks.jsonl", [TransformBlock(block_id="b1", text=source_text)])
    translator = FakeTranslator({"Standard residual connections are the de facto building block of modern [[TERM_0]]s with [[TERM_1]] and [[TERM_2]].": "译文：现代 [[TERM_0]] 使用 [[TERM_1]] 和 [[TERM_2]]。"})

    translate_blocks(run_dir, source_lang="en", target_lang="zh-CN", translator=translator)

    translated = _read_jsonl(run_dir / "translated_blocks.jsonl")

    assert translator.seen_texts == ["Standard residual connections are the de facto building block of modern [[TERM_0]]s with [[TERM_1]] and [[TERM_2]]."]
    assert translated[0]["text"] == "译文：现代 LLM 使用 PreNorm 和 softmax。"


def test_translate_blocks_skips_formula_like_text(tmp_path: Path):
    run_dir = tmp_path
    formula_text = "hl = hl−1 + fl−1(hl−1)"
    body_text = "Standard residual connections are common in modern LLMs."
    _write_clean_blocks(
        run_dir / "clean_blocks.jsonl",
        [
            TransformBlock(block_id="formula", text=formula_text),
            TransformBlock(block_id="body", text=body_text),
        ],
    )
    translator = FakeTranslator(
        {
            formula_text: "公式被翻译了",
            "Standard residual connections are common in modern [[TERM_0]]s.": "标准残差连接在现代 [[TERM_0]] 中很常见。",
        }
    )

    translate_blocks(run_dir, source_lang="en", target_lang="zh-CN", translator=translator)

    translated = _read_jsonl(run_dir / "translated_blocks.jsonl")
    pending = _read_jsonl(run_dir / "pending_codex_fallback.jsonl")

    assert [item["text"] for item in translated] == [formula_text, "标准残差连接在现代 LLM 中很常见。"]
    assert pending == []
    assert formula_text not in translator.seen_texts


def test_translate_blocks_skips_long_formula_chains(tmp_path: Path):
    run_dir = tmp_path
    formula_text = "hl = hl−1 + fl−1(hl−1) hl = hl−1 + αl · fl−1(hl−1) hl = hl−1 + diag(λl) · fl−1(hl−1) hl = (1−gl) ⊙ hl−1 + gl ⊙ fl−1(hl−1) hl = Norm(αhl−1 + fl−1(hl−1)) hl = Norm(αhl−1 + fl−1(Norm(hl−1)))"
    _write_clean_blocks(run_dir / "clean_blocks.jsonl", [TransformBlock(block_id="formula", text=formula_text)])
    translator = FakeTranslator({formula_text: "长公式被翻译了"})

    translate_blocks(run_dir, source_lang="en", target_lang="zh-CN", translator=translator)

    translated = _read_jsonl(run_dir / "translated_blocks.jsonl")

    assert translated[0]["text"] == formula_text
    assert formula_text not in translator.seen_texts


def test_translate_blocks_passthroughs_empty_blocks(tmp_path: Path):
    run_dir = tmp_path
    _write_clean_blocks(run_dir / "clean_blocks.jsonl", [TransformBlock(block_id="empty", text="")])
    translator = FakeTranslator({})

    translate_blocks(run_dir, source_lang="en", target_lang="zh-CN", translator=translator)

    translated = _read_jsonl(run_dir / "translated_blocks.jsonl")
    pending = _read_jsonl(run_dir / "pending_codex_fallback.jsonl")

    assert translated == [{"block_id": "empty", "text": "", "source_block_ids": [], "section_path": [], "transform_policy": "rewrite", "metadata": {}}]
    assert pending == []
    assert translator.seen_texts == []


def test_cli_parser_supports_translate_and_merge_commands():
    parser = build_parser()

    translate_args = parser.parse_args(["translate-blocks", "--run-dir", "work/run", "--source-lang", "en", "--target-lang", "zh-CN"])
    merge_args = parser.parse_args(["merge-translations", "--run-dir", "work/run"])

    assert translate_args.command == "translate-blocks"
    assert translate_args.source_lang == "en"
    assert translate_args.target_lang == "zh-CN"
    assert merge_args.command == "merge-translations"
