# Backend Selection

Use this policy when choosing an ingestion backend.

## Defaults

- `pdf` -> `mineru`
- `docx`, `html`, `txt`, `md`, `csv`, `json`, `xml`, `eml` -> `unstructured`

## Prefer MinerU For PDF When

- OCR is explicitly required
- formulas matter
- complex tables matter
- multi-column research-paper layouts matter

## Prefer OpenDataLoader-PDF For PDF When

- you explicitly choose `odl_pdf`
- deterministic coordinate-rich extraction is the priority
- the PDF is digital and structurally regular
- Java is acceptable in the environment

## Use Stirling-PDF Only As A Sidecar

Use `Stirling-PDF` for:

- optional conversion enhancement
- optional post-processing or repair
- optional HTML-to-PDF service export

Do not treat Stirling-PDF as the canonical ingestion source for the IR.

## Non-Backend Sidecars

These are useful additions to the skill, but they are not canonical ingest backends:

- local `docx-*` commands -> existing `.docx` inspect, targeted replace, compare
- local `ocr-pdf` -> OCR-first text extraction from PDFs or images before LLM transformation
