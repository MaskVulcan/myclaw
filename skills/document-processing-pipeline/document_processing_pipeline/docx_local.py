from __future__ import annotations

from dataclasses import dataclass
import difflib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"
NS = {"w": W_NS}


class DocxLocalError(RuntimeError):
    pass


@dataclass(frozen=True)
class ParagraphRecord:
    paragraph_id: str
    index: int
    style: str | None
    text: str

    def to_dict(self) -> dict[str, object]:
        return {
            "paragraph_id": self.paragraph_id,
            "index": self.index,
            "style": self.style,
            "text": self.text,
        }


@dataclass(frozen=True)
class ParagraphEdit:
    paragraph_id: str | None
    old_text: str | None
    new_text: str
    note: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "paragraph_id": self.paragraph_id,
            "old_text": self.old_text,
            "new_text": self.new_text,
            "note": self.note,
        }


def _read_document_tree(source_path: str | Path) -> tuple[ET.ElementTree, ET.Element]:
    path = Path(source_path)
    if not path.exists():
        raise FileNotFoundError(f"DOCX file not found: {path}")
    with ZipFile(path) as archive:
        try:
            xml_bytes = archive.read("word/document.xml")
        except KeyError as exc:
            raise DocxLocalError(f"Missing word/document.xml in DOCX: {path}") from exc
    root = ET.fromstring(xml_bytes)
    return ET.ElementTree(root), root


def _paragraph_text(paragraph: ET.Element) -> str:
    pieces: list[str] = []
    for node in paragraph.iter():
        if node.tag == f"{{{W_NS}}}t":
            pieces.append(node.text or "")
        elif node.tag in {f"{{{W_NS}}}tab"}:
            pieces.append("\t")
        elif node.tag in {f"{{{W_NS}}}br", f"{{{W_NS}}}cr"}:
            pieces.append("\n")
    return "".join(pieces)


def _paragraph_style(paragraph: ET.Element) -> str | None:
    style = paragraph.find("w:pPr/w:pStyle", NS)
    if style is None:
        return None
    return style.attrib.get(f"{{{W_NS}}}val")


def _paragraphs(root: ET.Element) -> list[ET.Element]:
    body = root.find("w:body", NS)
    if body is None:
        return []
    return list(body.iterfind(".//w:p", NS))


def inspect_docx(source_path: str | Path) -> list[ParagraphRecord]:
    _tree, root = _read_document_tree(source_path)
    records: list[ParagraphRecord] = []
    for index, paragraph in enumerate(_paragraphs(root), start=1):
        records.append(
            ParagraphRecord(
                paragraph_id=f"p{index:04d}",
                index=index,
                style=_paragraph_style(paragraph),
                text=_paragraph_text(paragraph),
            )
        )
    return records


def inspect_docx_json(source_path: str | Path) -> str:
    return json.dumps([record.to_dict() for record in inspect_docx(source_path)], ensure_ascii=False, indent=2)


def grep_docx(source_path: str | Path, patterns: list[str]) -> list[dict[str, object]]:
    regexes = [re.compile(pattern) for pattern in patterns]
    matches: list[dict[str, object]] = []
    for record in inspect_docx(source_path):
        for regex in regexes:
            if regex.search(record.text):
                matches.append(
                    {
                        "paragraph_id": record.paragraph_id,
                        "index": record.index,
                        "style": record.style,
                        "pattern": regex.pattern,
                        "text": record.text,
                    }
                )
    return matches


def _clear_paragraph_content(paragraph: ET.Element) -> ET.Element | None:
    properties = paragraph.find("w:pPr", NS)
    for child in list(paragraph):
        if child is not properties:
            paragraph.remove(child)
    return properties


def _append_text_run(paragraph: ET.Element, text: str) -> None:
    run = ET.SubElement(paragraph, f"{{{W_NS}}}r")
    if not text:
        ET.SubElement(run, f"{{{W_NS}}}t")
        return
    segments = text.split("\n")
    for idx, segment in enumerate(segments):
        text_node = ET.SubElement(run, f"{{{W_NS}}}t")
        text_node.attrib[f"{{{XML_NS}}}space"] = "preserve"
        text_node.text = segment
        if idx < len(segments) - 1:
            ET.SubElement(run, f"{{{W_NS}}}br")


def _resolve_target_index(
    paragraphs: list[ET.Element],
    *,
    paragraph_id: str | None = None,
    old_text: str | None = None,
) -> int:
    if paragraph_id:
        if not re.fullmatch(r"p\d{4}", paragraph_id):
            raise DocxLocalError(f"Invalid paragraph id: {paragraph_id}")
        target_index = int(paragraph_id[1:]) - 1
        if target_index < 0 or target_index >= len(paragraphs):
            raise DocxLocalError(f"Paragraph id out of range: {paragraph_id}")
        if old_text is not None and _paragraph_text(paragraphs[target_index]) != old_text:
            raise DocxLocalError("Paragraph text does not match --old-text.")
        return target_index

    if old_text is None:
        raise DocxLocalError("Use either --paragraph-id or --old-text to identify the target paragraph.")

    matches = [idx for idx, paragraph in enumerate(paragraphs) if _paragraph_text(paragraph) == old_text]
    if len(matches) != 1:
        raise DocxLocalError(f"Expected exactly one paragraph match for --old-text, found {len(matches)}.")
    return matches[0]


def _write_docx_tree(source_path: Path, output_path: Path, tree: ET.ElementTree) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    document_xml = ET.tostring(tree.getroot(), encoding="utf-8", xml_declaration=True)
    with ZipFile(source_path) as source_archive, ZipFile(output_path, "w", compression=ZIP_DEFLATED) as target_archive:
        for info in source_archive.infolist():
            data = document_xml if info.filename == "word/document.xml" else source_archive.read(info.filename)
            target_archive.writestr(info, data)


def load_docx_plan(plan_path: str | Path) -> list[ParagraphEdit]:
    path = Path(plan_path)
    if not path.exists():
        raise FileNotFoundError(f"DOCX edit plan not found: {path}")
    raw_text = path.read_text(encoding="utf-8")
    stripped = raw_text.strip()
    if not stripped:
        raise DocxLocalError(f"Plan file is empty: {path}")

    if stripped.startswith("["):
        payload = json.loads(stripped)
        if not isinstance(payload, list):
            raise DocxLocalError(f"DOCX plan must be a JSON array or JSONL file: {path}")
        entries = payload
    else:
        entries = [json.loads(line) for line in raw_text.splitlines() if line.strip()]

    edits: list[ParagraphEdit] = []
    for index, entry in enumerate(entries, start=1):
        if not isinstance(entry, dict):
            raise DocxLocalError(f"Plan row {index} must be an object.")
        paragraph_id = entry.get("paragraph_id")
        old_text = entry.get("old_text")
        new_text = entry.get("new_text")
        note = entry.get("note")
        if paragraph_id is not None and not isinstance(paragraph_id, str):
            raise DocxLocalError(f"Plan row {index} has a non-string paragraph_id.")
        if old_text is not None and not isinstance(old_text, str):
            raise DocxLocalError(f"Plan row {index} has a non-string old_text.")
        if not isinstance(new_text, str):
            raise DocxLocalError(f"Plan row {index} must include a string new_text.")
        if note is not None and not isinstance(note, str):
            raise DocxLocalError(f"Plan row {index} has a non-string note.")
        if paragraph_id is None and old_text is None:
            raise DocxLocalError(f"Plan row {index} must include paragraph_id or old_text.")
        edits.append(
            ParagraphEdit(
                paragraph_id=paragraph_id,
                old_text=old_text,
                new_text=new_text,
                note=note,
            )
        )
    return edits


def apply_docx_edits(
    source_path: str | Path,
    *,
    output_path: str | Path,
    edits: list[ParagraphEdit],
) -> dict[str, object]:
    path = Path(source_path)
    output = Path(output_path)
    tree, root = _read_document_tree(path)
    paragraphs = _paragraphs(root)

    applied: list[dict[str, object]] = []
    for plan_index, edit in enumerate(edits, start=1):
        target_index = _resolve_target_index(
            paragraphs,
            paragraph_id=edit.paragraph_id,
            old_text=edit.old_text,
        )
        paragraph = paragraphs[target_index]
        previous_text = _paragraph_text(paragraph)
        _clear_paragraph_content(paragraph)
        _append_text_run(paragraph, edit.new_text)
        applied.append(
            {
                "plan_index": plan_index,
                "paragraph_id": f"p{target_index + 1:04d}",
                "old_text": previous_text,
                "new_text": edit.new_text,
                "note": edit.note,
            }
        )

    _write_docx_tree(path, output, tree)
    return {"output_path": str(output), "applied": applied, "count": len(applied)}


def apply_docx_plan(
    source_path: str | Path,
    *,
    output_path: str | Path,
    plan_path: str | Path,
) -> dict[str, object]:
    return apply_docx_edits(source_path, output_path=output_path, edits=load_docx_plan(plan_path))


def replace_docx_paragraph(
    source_path: str | Path,
    *,
    output_path: str | Path,
    new_text: str,
    paragraph_id: str | None = None,
    old_text: str | None = None,
) -> Path:
    apply_docx_edits(
        source_path,
        output_path=output_path,
        edits=[ParagraphEdit(paragraph_id=paragraph_id, old_text=old_text, new_text=new_text)],
    )
    return Path(output_path)


def compare_docx(original_path: str | Path, revised_path: str | Path) -> dict[str, object]:
    original = inspect_docx(original_path)
    revised = inspect_docx(revised_path)
    original_texts = [item.text for item in original]
    revised_texts = [item.text for item in revised]

    changes: list[dict[str, object]] = []
    matcher = difflib.SequenceMatcher(a=original_texts, b=revised_texts)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        changes.append(
            {
                "op": tag,
                "original_range": [i1 + 1, i2],
                "revised_range": [j1 + 1, j2],
                "original": original_texts[i1:i2],
                "revised": revised_texts[j1:j2],
            }
        )

    unified = "\n".join(
        difflib.unified_diff(
            original_texts,
            revised_texts,
            fromfile=str(original_path),
            tofile=str(revised_path),
            lineterm="",
        )
    )
    return {
        "original_paragraphs": len(original_texts),
        "revised_paragraphs": len(revised_texts),
        "changes": changes,
        "unified_diff": unified,
    }
