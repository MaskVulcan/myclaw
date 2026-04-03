---
name: document-processing-pipeline
description: Use when you need local CLI-first document processing for PDF, Word, HTML, text, slides, or spreadsheets: stable ingest into structured artifacts, block-by-block LLM transforms, local OCR, brownfield DOCX inspection/edit/compare, and rebuild into PDF, DOCX, HTML, or Markdown.
---

# Document Processing Pipeline

## Overview

Run a script-first document workflow that produces two core artifacts:

- `rich_ir.json` for structure-preserving rebuilds
- `clean_text.md` plus `clean_blocks.jsonl` for block-scoped transforms such as translation or simplification

Keep the core flow deterministic: ingest, normalize, project, reconcile, and export. Only use model-backed steps when OCR enhancement, translation, or semantic rewriting is actually required.

This skill now covers three local lanes:

- `docpipe` core pipeline for parse -> transform -> rebuild
- direct file tasks for PDF / DOCX / PPTX / XLSX work that does not need IR
- local helper commands for brownfield `.docx` editing and local OCR before LLM interaction

## Trigger Boundary

Use this skill when the human partner asks to:

- read or parse `pdf`, `docx`, `doc`, `html`, `txt`, `md`, `rst`, `csv`, `json`, `xml`, `eml`, `pptx`, or `xlsx`
- extract standard text from a document without losing structural traceability
- translate, summarize, simplify, or rewrite document content block by block
- rebuild outputs into `pdf`, `docx`, `html`, or `markdown`
- manipulate PDFs directly: merge, split, rotate, watermark, encrypt, form-fill, OCR, or extract images/tables
- inspect, search, replace, or compare paragraphs inside an existing `.docx`
- OCR a local PDF into text or markdown before handing the result to the LLM
- create or edit PowerPoint presentations (`.pptx`) or Excel workbooks (`.xlsx`) with deterministic local tools
- replace Chinese punctuation with English punctuation in translated text

Do not use this skill for one-off shell conversions when no stable intermediate representation is needed and no direct document-file manipulation is involved.

## Route First

1. If the user wants translation, summarization, simplification, or rebuild with traceability, use the `docpipe` pipeline.
2. If the user wants edits to an existing `.docx`, use the local `docx-inspect`, `docx-grep`, `docx-apply-plan`, and `docx-compare` commands.
3. If the user wants OCR-first extraction from a local PDF or image, use `ocr-pdf` first, then feed the output into the pipeline or the LLM.
4. If the user wants merge/split/form-fill PDFs or scratch Office authoring, use the focused direct-file tools in [direct-file-tasks.md](./references/direct-file-tasks.md).
5. If the request is only format conversion and no stable IR is needed, prefer the smallest direct tool that gets the job done.

Read [sidecar-integrations.md](./references/sidecar-integrations.md) for the local CLI helper workflows.

## OpenClaw Runtime

Inside MyClaw / OpenClaw, do not assume `docpipe` is installed globally. Use the bundled wrapper at `{baseDir}/scripts/docpipe`.

- The wrapper keeps its virtualenv under `$OPENCLAW_STATE_DIR/skills-runtime/document-processing-pipeline`.
- It exports `DOCUMENT_PROCESSING_PIPELINE_COMMAND` so `doctor` and install hints point back to the wrapper command.
- In the command examples below, replace bare `docpipe` with `{baseDir}/scripts/docpipe` when running from the bundled skill.

## Conversation Routing Rules

- In MyClaw / OpenClaw chat flows, prefer one direct CLI command or one short deterministic pipeline over ad hoc prose reasoning.
- Ground every extraction, summary, translation target, and file reference in the actual user message, attached files, or resolved local paths. Do not pretend a file exists if it was not provided.
- For simple read/convert/summarize/edit requests, prefer the smallest direct command that satisfies the task.
- Only escalate to larger multi-step flows when the document task truly needs OCR, IR rebuild, or block-by-block transforms.

## Automation Commands

Use the CLI route engine instead of relying on ad hoc judgment when possible:

```bash
docpipe route path/to/file.pdf --task translate --layout-preserving
docpipe route path/to/invoice.pdf --task extract-fields
docpipe route path/to/contract.docx --task edit-docx --requires-redline
```

For local DOCX editing:

```bash
docpipe docx-inspect contract.docx
docpipe docx-grep contract.docx --pattern "termination"
docpipe docx-apply-plan contract.docx --plan edits.jsonl --output contract.edited.docx
docpipe docx-compare contract.docx contract.edited.docx
```

For local OCR:

```bash
docpipe ocr-pdf invoice.pdf --pages 1-3 --output work/invoice/ocr.md
docpipe ocr-pdf scan.png --format jsonl --output work/scan/ocr.jsonl
```

## Core Workflow

1. Run capability detection first.
   - Command:
     ```bash
     docpipe doctor
     ```
   - Install the recommended local stack up front when the environment is new:
     ```bash
     docpipe install-deps all-local
     ```
   - Inspect dependency profiles with:
     ```bash
     docpipe list-deps all-local
     ```

- Python package gaps are auto-bootstrapped by default at runtime, but `install-deps` keeps the environment predictable.
- On apt-based Linux hosts, `install-deps` also installs supported system packages such as `tesseract`, `poppler-utils`, `qpdf`, fonts, Java, or LibreOffice when the selected profile includes them.

2. Ingest the source document into `rich_ir.json`.
   - Command:
     ```bash
     docpipe ingest path/to/input.docx --run-dir work/run
     ```
   - Force a specific backend with `--backend`:
     ```bash
     docpipe ingest path/to/input.pdf --run-dir work/run --backend mineru
     ```
   - Supported input formats: `.pdf`, `.docx`, `.doc`, `.odt`, `.rtf`, `.html`, `.htm`, `.txt`, `.md`, `.rst`, `.csv`, `.json`, `.xml`, `.eml`
3. Derive deterministic transform artifacts.
   - Command:
     ```bash
     docpipe derive-text --run-dir work/run
     ```
4. Perform the content transformation.
   - Deterministic transforms:
     ```bash
     docpipe transform-blocks --run-dir work/run --operation copy
     ```
   - Available operations: `copy`, `uppercase`, `lowercase`, `prefix`, `zh-punct-to-en`
   - HTTP-first block translation:
     ```bash
     docpipe translate-blocks --run-dir work/run --source-lang en --target-lang zh-CN
     ```
   - If `translation_status.json` reports `needs_codex_fallback`, translate only the rows in `pending_codex_fallback.jsonl` in the current conversation and write `codex_fallback_blocks.jsonl`.
   - Merge HTTP results and Codex fallback results:
     ```bash
     docpipe merge-translations --run-dir work/run
     ```
   - For other transformations such as summarization, generate `transformed_blocks.jsonl` with the same `block_id` values.
5. Reconcile transformed blocks back into structural IR.
   - Command:
     ```bash
     docpipe reconcile --run-dir work/run
     ```
6. Assemble the final output.
   - Markdown:
     ```bash
     docpipe assemble-markdown --run-dir work/run
     ```
   - HTML:
     ```bash
     docpipe assemble-html --run-dir work/run
     ```
   - DOCX:
     ```bash
     docpipe assemble-docx --run-dir work/run
     ```
   - PDF:
     ```bash
     docpipe assemble-pdf --run-dir work/run
     ```
   - Layout-preserving PDF overlay:
     ```bash
     docpipe overlay-pdf --run-dir work/run --source-pdf path/to/input.pdf
     ```
   - Side-by-side PDF:
     ```bash
     docpipe side-by-side-pdf --run-dir work/run --source-pdf path/to/input.pdf
     ```

## Backend Selection

Read [backend-selection.md](./references/backend-selection.md) when backend choice matters.

Default policy:

- `pdf` -> prefer `MinerU`, fall back to `Unstructured` when you want a Python-only path
- `docx`, `doc`, `odt`, `rtf` -> `Unstructured` with local fallbacks where available
- `html`, `txt`, and similar -> prefer `Unstructured`
- use `OpenDataLoader-PDF` only when deterministic coordinate-rich extraction is worth the Java dependency
- use `Stirling-PDF` only as an optional sidecar for conversion, repair, or HTML-to-PDF export

## Output Contract

Always expect these core artifacts:

- `manifest.json`
- `rich_ir.json`
- `clean_text.md`
- `clean_blocks.jsonl`
- `transform_manifest.json`
- for HTTP-first translation runs:
  - `translated_blocks.jsonl`
  - `pending_codex_fallback.jsonl`
  - `translation_status.json`
- after Codex fallback merge:
  - `transformed_blocks.jsonl`

After reconciliation:

- `rich_ir.transformed.json`

After assembly:

- `output.md`, `output.html`, `output.docx`, or `output.pdf`
- for layout-preserving PDF translation: `output.overlay.pdf`
- for side-by-side comparison: `output.side_by_side.pdf`
- for `assemble-pdf`: `pdf_export_report.json` describing the renderer used, fallbacks attempted, and any export degradation warnings

Read [ir-contract.md](./references/ir-contract.md) for the canonical schema.

## Determinism Rules

- Never let a model rewrite the entire document in one free-form pass.
- Keep all transforms block-scoped with stable `block_id` values.
- Rebuild outputs from IR, not directly from model prose.
- For translation, prefer deterministic HTTP translation first and only hand failed blocks to the current Codex conversation through `pending_codex_fallback.jsonl`.
- Preserve formula-like blocks, code snippets, and protected technical terms rather than forcing them through generic translation.
- For figure-heavy PDFs where layout matters, prefer `overlay-pdf` and leave unstable regions untranslated in the source PDF.
- For existing brownfield `.docx`, prefer local inspect/replace/compare commands over full rebuilds when the user is editing a few paragraphs.
- For existing brownfield `.docx`, prefer `docx-apply-plan` for multi-paragraph scripted edits and `docx-replace` for one-off paragraph changes.
- For local OCR, run `ocr-pdf` before asking the LLM to extract fields from a scan.
- Auto-install only applies to Python packages during normal command execution.
- For repeatable setup, prefer `docpipe install-deps <profile>` because it can install both Python packages and supported apt-managed system packages for the selected profile.

## Capability Detection

Run `docpipe doctor` before choosing the lane. The doctor report includes:

- core pipeline readiness
- optional PDF helper availability such as `pypdf`, `pdfplumber`, and `qpdf`
- optional Office helper availability such as `openpyxl`, `pandas`, and `python-pptx`
- local OCR readiness via `pdftotext` and `tesseract`
- local DOCX edit capability and route hints
- dependency profile coverage and `pip check` conflict reporting
- enough capability data for `docpipe route` to produce deterministic next-step commands

## Auto Install Control

- Default: missing Python packages are auto-installed on first use.
- Disable for a process: set `DOCUMENT_PROCESSING_PIPELINE_AUTO_INSTALL=0`.

## Installation

```bash
pip install -e path/to/skills/document-processing-pipeline
```

After installation the `docpipe` command is available globally. You can also invoke via `python -m document_processing_pipeline`.

> Legacy: `python3 scripts/pipeline.py <command>` still works for local use without installation.

## References

- [backend-selection.md](./references/backend-selection.md)
- [examples.md](./references/examples.md)
- [direct-file-tasks.md](./references/direct-file-tasks.md)
- [sidecar-integrations.md](./references/sidecar-integrations.md)
- [ir-contract.md](./references/ir-contract.md)
