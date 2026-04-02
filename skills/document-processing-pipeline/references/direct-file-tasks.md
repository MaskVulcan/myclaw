# Direct File Tasks

## Contents

1. PDF
2. DOCX
3. PPTX
4. XLSX

Use these recipes when the user needs direct document manipulation and does not need the full `rich_ir.json` -> transform -> rebuild pipeline.

## PDF

### Default Tool Choice

| Task                                         | Preferred tool    |
| -------------------------------------------- | ----------------- |
| Merge / split / rotate / watermark / encrypt | `pypdf`           |
| Extract text or tables                       | `pdfplumber`      |
| Create a new PDF from code                   | `reportlab`       |
| CLI-heavy merge/split/encrypt                | `qpdf`            |
| OCR scanned PDFs or images                   | `docpipe ocr-pdf` |
| Fill native AcroForm fields                  | `pypdf`           |

### Merge / Split

```python
from pypdf import PdfReader, PdfWriter

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf"]:
    for page in PdfReader(pdf_file).pages:
        writer.add_page(page)
with open("merged.pdf", "wb") as f:
    writer.write(f)
```

### Extract Text / Tables

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        tables = page.extract_tables()
```

### Create a PDF

```python
from reportlab.lib.pagesizes import letter
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from reportlab.lib.styles import getSampleStyleSheet

styles = getSampleStyleSheet()
doc = SimpleDocTemplate("report.pdf", pagesize=letter)
doc.build([
    Paragraph("Report Title", styles["Title"]),
    Spacer(1, 12),
    Paragraph("Body text here.", styles["Normal"]),
])
```

Avoid Unicode subscript or superscript characters in ReportLab output. Use `<sub>` and `<super>` tags instead.

### CLI

```bash
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf
qpdf input.pdf --pages . 1-5 -- extract.pdf
pdftotext -layout input.pdf output.txt
pdfimages -j input.pdf output_prefix
```

### Routing Notes

- For figure-heavy PDF translation or rebuild, go back to `docpipe`.
- For OCR-first field extraction with confidence or review, read [sidecar-integrations.md](./sidecar-integrations.md).

## DOCX

### Default Tool Choice

| Task                                         | Preferred tool            |
| -------------------------------------------- | ------------------------- |
| Create a new document                        | `python-docx`             |
| Inspect / edit / compare an existing `.docx` | `docpipe docx-*`          |
| Clean rebuild from transformed IR            | `docpipe assemble-docx`   |
| Convert `.doc` to `.docx`                    | LibreOffice or `textutil` |

### Create a New DOCX

```python
from docx import Document

doc = Document()
doc.add_heading("Report Title", level=1)
doc.add_paragraph("Body text here.")
doc.add_heading("Section", level=2)
doc.add_paragraph("More content.")
doc.save("output.docx")
```

### Brownfield Rules

- If the user gives you an existing `.docx`, inspect first with `docpipe docx-inspect` or `docpipe docx-grep`.
- For scripted local edits, use `docpipe docx-apply-plan`.
- For a one-off paragraph swap, use `docpipe docx-replace`.
- For local comparison after edits, use `docpipe docx-compare`.

## PPTX

### Default Tool Choice

| Task                          | Preferred tool         |
| ----------------------------- | ---------------------- |
| Read or inspect slide text    | `python -m markitdown` |
| Create or edit slides locally | `python-pptx`          |
| Node-first slide generation   | `pptxgenjs`            |

### Read Slide Text

```bash
python -m markitdown presentation.pptx
```

### Create a Slide Deck with `python-pptx`

```python
from pptx import Presentation

prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[1])
slide.shapes.title.text = "Title"
slide.placeholders[1].text = "Body text"
prs.save("output.pptx")
```

### Slide Design Rules

- Do not repeat the same layout on every slide.
- Every slide should carry a visual element, stat, chart, icon, or diagram.
- Use presentation-specific typography and color choices instead of default Office blue.

## XLSX

### Default Tool Choice

| Task                     | Preferred tool |
| ------------------------ | -------------- |
| Data analysis            | `pandas`       |
| Formula-preserving edits | `openpyxl`     |
| Recalculate formulas     | LibreOffice    |

### Read with `pandas`

```python
import pandas as pd

df = pd.read_excel("file.xlsx")
summary = df.describe(include="all")
```

### Create or Edit with `openpyxl`

```python
from openpyxl import Workbook
from openpyxl.styles import Font

wb = Workbook()
ws = wb.active
ws["A1"] = "Revenue"
ws["A1"].font = Font(bold=True)
ws["B1"] = 100000
ws["B2"] = "=SUM(B1:B1)"
wb.save("output.xlsx")
```

### Spreadsheet Rules

- Always leave calculations in sheet formulas rather than hardcoding totals in Python.
- Preserve number formats, merged cells, and formulas unless the user explicitly wants normalization.
- For translation-style edits, never overwrite formulas, chart series, or hidden support sheets with plain text.
