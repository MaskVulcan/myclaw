# Examples

For direct PDF / Office file manipulation, read [direct-file-tasks.md](./direct-file-tasks.md).
For local `.docx` inspect/edit/compare and local OCR workflows, read [sidecar-integrations.md](./sidecar-integrations.md).

## Bootstrap A New Environment

```bash
docpipe list-deps all-local
docpipe install-deps all-local
docpipe doctor
```

## Ingest And Translate A DOCX

```bash
docpipe doctor
docpipe ingest report.docx --run-dir work/report
docpipe derive-text --run-dir work/report
docpipe translate-blocks --run-dir work/report --source-lang en --target-lang zh-CN
# if translation_status.json says needs_codex_fallback:
# 1. translate pending_codex_fallback.jsonl in the current Codex conversation
# 2. save codex_fallback_blocks.jsonl into work/report
docpipe merge-translations --run-dir work/report
docpipe reconcile --run-dir work/report
docpipe assemble-docx --run-dir work/report
```

## Translate A DOCX With Punctuation Cleanup

```bash
docpipe ingest report.docx --run-dir work/report
docpipe derive-text --run-dir work/report
docpipe translate-blocks --run-dir work/report --source-lang en --target-lang zh-CN
docpipe merge-translations --run-dir work/report
# Replace Chinese punctuation (，。！？etc.) with English equivalents (, . ! ? etc.)
docpipe transform-blocks --run-dir work/report --operation zh-punct-to-en --input-file work/report/transformed_blocks.jsonl
docpipe reconcile --run-dir work/report
docpipe assemble-docx --run-dir work/report
```

## Summarize An HTML File

```bash
docpipe ingest page.html --run-dir work/page
docpipe derive-text --run-dir work/page
docpipe transform-blocks --run-dir work/page --operation copy
docpipe reconcile --run-dir work/page
docpipe assemble-markdown --run-dir work/page
```

## Translate A Figure-Heavy PDF (Overlay — Preserves Layout)

```bash
docpipe ingest paper.pdf --run-dir work/paper
docpipe derive-text --run-dir work/paper
docpipe translate-blocks --run-dir work/paper --source-lang en --target-lang zh-CN
# if translation_status.json says needs_codex_fallback:
# 1. translate pending_codex_fallback.jsonl in the current Codex conversation
# 2. save codex_fallback_blocks.jsonl into work/paper
docpipe merge-translations --run-dir work/paper
docpipe overlay-pdf --run-dir work/paper --source-pdf paper.pdf
```

## Translate A PDF With Side-By-Side Comparison

```bash
docpipe ingest paper.pdf --run-dir work/paper
docpipe derive-text --run-dir work/paper
docpipe translate-blocks --run-dir work/paper --source-lang en --target-lang zh-CN
docpipe merge-translations --run-dir work/paper
# Overlay first (auto-generated if missing)
docpipe side-by-side-pdf --run-dir work/paper --source-pdf paper.pdf
# Output: work/paper/output.side_by_side.pdf (original left, translated right)
```

## Process A .doc File (Legacy Word)

```bash
# .doc files are automatically handled via textutil (macOS) or Unstructured
docpipe ingest legacy.doc --run-dir work/legacy
docpipe derive-text --run-dir work/legacy
docpipe translate-blocks --run-dir work/legacy --source-lang en --target-lang zh-CN
docpipe merge-translations --run-dir work/legacy
docpipe reconcile --run-dir work/legacy
docpipe assemble-docx --run-dir work/legacy
```
