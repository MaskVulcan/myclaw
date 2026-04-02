# Local CLI Workflows

## Contents

1. Local DOCX commands
2. Local OCR
3. Local Office helpers

These workflows are local-script alternatives to hosted connectors. They keep the skill CLI-first and let the LLM work on exported intermediate files instead of remote document handlers.

## Local DOCX Commands

Use the built-in DOCX commands when the user needs:

- clause-by-clause edits without losing surrounding formatting
- paragraph search before targeted edits
- compare / revision extraction between two `.docx` files

### When to Prefer It

- The document is already in `.docx`
- The user expects brownfield editing rather than clean regeneration
- Paragraph-level edits are enough

### Runtime Expectation

The DOCX helpers are built into this skill. They operate directly on OOXML locally.

### Commands

```bash
docpipe docx-inspect contract.docx
docpipe docx-grep contract.docx --pattern "limitation of liability"
docpipe docx-apply-plan contract.docx --plan edits.jsonl --output contract.edited.docx
docpipe docx-compare contract.docx contract.edited.docx
```

### Rules

- Keep edits paragraph-scoped and explicit.
- Prefer `docx-inspect` or `docx-grep` before `docx-apply-plan`.
- Use `docx-apply-plan` for batchable scripted edits and `docx-replace` only for a one-off paragraph rewrite.
- `docx-replace` preserves paragraph-level structure and styles, but changed paragraphs lose original inline run formatting and native tracked-changes markup.

## Local OCR

Use `ocr-pdf` when the user needs:

- scanned-document extraction where plain text is not enough
- OCR text before the LLM extracts fields
- a local first pass over PDFs or images without sending data to a hosted service

### When to Prefer It

- The document is scanned, noisy, or operational rather than publication-oriented
- You want a local intermediate text file for downstream LLM work

### Runtime Expectation

`ocr-pdf` is local. It prefers `pdftotext` for digital PDFs, and falls back to `tesseract` plus page rasterization for scans. It supports page ranges, markdown or JSONL output, and direct image input.

### Commands

```bash
docpipe ocr-pdf invoice.pdf --pages 1-3 --output work/invoice/ocr.md
docpipe ocr-pdf scan.jpg --format jsonl --output work/scan/ocr.jsonl
docpipe ingest work/invoice/ocr.md --run-dir work/invoice
docpipe derive-text --run-dir work/invoice
```

### Rules

- Use `pdftotext` for digital PDFs when it works; use `--force-ocr` only when needed.
- Use `--pages` to keep OCR scoped when only part of the file matters.
- Use `--format jsonl` when the LLM needs page-by-page records instead of a merged markdown file.
- `ocr-pdf` gives you text, not confidence scores or review queues.
- After OCR, let the LLM operate on the extracted markdown/text rather than on images directly.

## Local Office Helpers

For direct authoring and deterministic local edits, this skill now standardizes on:

- `python-docx` for creating new Word files
- `openpyxl` for workbook edits
- `pandas` for spreadsheet analysis
- `python-pptx` for slide generation
- `pypdf`, `pdfplumber`, and `qpdf` for direct PDF work

### Selection Guidance

- If the task is transform-oriented and traceability matters, stay in `docpipe`.
- If the task is surgical editing on an existing `.docx`, prefer the built-in DOCX commands.
- If the task is OCR-first extraction into fields, run `ocr-pdf` first and then hand the result to the LLM or pipeline.
- If the task is local file creation, merge, split, or formula-safe editing, use the direct helpers in [direct-file-tasks.md](./direct-file-tasks.md).
- If you want a deterministic routing decision first, run `docpipe route ...`.
