from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from document_processing_pipeline.docx_local import apply_docx_plan, compare_docx, grep_docx, inspect_docx, replace_docx_paragraph


DOC_TEMPLATE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>
    <w:p><w:r><w:t>Alpha clause</w:t></w:r></w:p>
    <w:p><w:r><w:t>Beta clause</w:t></w:r></w:p>
  </w:body>
</w:document>
"""


def _write_docx(path: Path, document_xml: str = DOC_TEMPLATE) -> None:
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>")
        archive.writestr("_rels/.rels", "<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'/>")
        archive.writestr("word/document.xml", document_xml)


def test_inspect_docx_reads_paragraphs(tmp_path: Path):
    source = tmp_path / "sample.docx"
    _write_docx(source)

    rows = inspect_docx(source)

    assert [row.paragraph_id for row in rows] == ["p0001", "p0002", "p0003"]
    assert rows[0].style == "Heading1"
    assert rows[1].text == "Alpha clause"


def test_grep_docx_matches_patterns(tmp_path: Path):
    source = tmp_path / "sample.docx"
    _write_docx(source)

    matches = grep_docx(source, ["Alpha", "Beta"])

    assert len(matches) == 2
    assert matches[0]["paragraph_id"] == "p0002"


def test_replace_docx_paragraph_preserves_other_content(tmp_path: Path):
    source = tmp_path / "sample.docx"
    output = tmp_path / "edited.docx"
    _write_docx(source)

    replace_docx_paragraph(source, output_path=output, paragraph_id="p0002", new_text="Rewritten clause")

    rows = inspect_docx(output)
    assert rows[1].text == "Rewritten clause"
    assert rows[0].text == "Title"
    assert rows[2].text == "Beta clause"


def test_compare_docx_reports_changes(tmp_path: Path):
    original = tmp_path / "original.docx"
    revised = tmp_path / "revised.docx"
    _write_docx(original)
    _write_docx(revised, DOC_TEMPLATE.replace("Beta clause", "Gamma clause"))

    diff = compare_docx(original, revised)

    assert diff["changes"]
    assert "Gamma clause" in diff["unified_diff"]


def test_apply_docx_plan_applies_multiple_edits(tmp_path: Path):
    source = tmp_path / "source.docx"
    output = tmp_path / "planned.docx"
    plan = tmp_path / "edits.jsonl"
    _write_docx(source)
    plan.write_text(
        "\n".join(
            [
                '{"paragraph_id":"p0002","new_text":"Alpha rewritten"}',
                '{"old_text":"Beta clause","new_text":"Beta rewritten","note":"cleanup"}',
            ]
        ),
        encoding="utf-8",
    )

    result = apply_docx_plan(source, output_path=output, plan_path=plan)

    rows = inspect_docx(output)
    assert result["count"] == 2
    assert rows[1].text == "Alpha rewritten"
    assert rows[2].text == "Beta rewritten"
