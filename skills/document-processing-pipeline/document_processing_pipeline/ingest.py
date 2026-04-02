from __future__ import annotations

from html.parser import HTMLParser
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable

from document_processing_pipeline import bootstrap as dependency_bootstrap
from document_processing_pipeline.bootstrap import import_from_checkout, workspace_root
from document_processing_pipeline.backends.mineru_adapter import normalize_mineru_document
from document_processing_pipeline.backends.odl_pdf_adapter import normalize_odl_document
from document_processing_pipeline.backends.unstructured_adapter import normalize_unstructured_elements
from document_processing_pipeline.doctor import summarize_capabilities
from document_processing_pipeline.models import BlockRecord, DocumentMeta, PageInfo, ProvenanceRecord, RichDocument, next_document_id
from document_processing_pipeline.router import choose_backend, infer_mime_type


class DocumentProcessingError(RuntimeError):
    pass


def _manual_install_message(capabilities: dict[str, Any], source_path: str) -> str:
    manual = capabilities.get("manual_install", {})
    system_dependencies = list(manual.get("system_dependencies") or [])
    notes = list(manual.get("notes") or [])
    dependency_text = ", ".join(system_dependencies) if system_dependencies else "required system dependencies"
    note_text = f" {' '.join(notes)}" if notes else ""
    return (
        f"Automatic Python package installation could not enable processing for {source_path}. "
        f"These non-Python dependencies must be installed by the user: {dependency_text}.{note_text}"
    )


class _HTMLBlockParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[dict[str, str]] = []
        self.current_tag: str | None = None
        self.current_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6"}:
            self._flush()
            self.current_tag = tag

    def handle_endtag(self, tag: str) -> None:
        if self.current_tag == tag:
            self._flush()

    def handle_data(self, data: str) -> None:
        if self.current_tag:
            self.current_text.append(data)

    def _flush(self) -> None:
        if self.current_tag and "".join(self.current_text).strip():
            text = " ".join("".join(self.current_text).split())
            self.blocks.append({"tag": self.current_tag, "text": text})
        self.current_tag = None
        self.current_text = []


def _build_document_from_blocks(source_path: str, backend: str, block_specs: list[dict[str, Any]], mime_type: str | None = None) -> RichDocument:
    blocks: list[BlockRecord] = []
    for index, spec in enumerate(block_specs):
        blocks.append(
            BlockRecord(
                block_id=str(spec.get("block_id") or f"block-{index + 1}"),
                page_number=int(spec.get("page_number") or 1),
                block_type=str(spec.get("block_type") or "paragraph"),
                reading_order=index,
                text=str(spec.get("text") or ""),
                source_ids=[str(spec.get("source_id") or f"source-{index + 1}")],
                section_path=list(spec.get("section_path") or []),
                metadata=dict(spec.get("metadata") or {}),
            )
        )
    return RichDocument(
        document=DocumentMeta(
            id=next_document_id(source_path),
            source_path=source_path,
            backend=backend,
            mime_type=mime_type,
        ),
        pages=[PageInfo(page_number=1, width=595.0, height=842.0)],
        blocks=blocks,
        assets=[],
        provenance=ProvenanceRecord(
            source_backend=backend,
            parser_mode="local-fallback",
            fallback_chain=[backend],
            metadata={"mime_type": mime_type},
        ),
        warnings=[],
    )


def _plain_text_blocks(text: str) -> list[dict[str, Any]]:
    paragraphs = [part.strip() for part in text.replace("\r\n", "\n").split("\n\n") if part.strip()]
    blocks: list[dict[str, Any]] = []
    for index, paragraph in enumerate(paragraphs):
        if index == 0 and len(paragraph) <= 80 and "\n" not in paragraph:
            blocks.append({"block_type": "title", "text": paragraph, "section_path": [paragraph]})
        else:
            blocks.append({"block_type": "paragraph", "text": " ".join(paragraph.split())})
    return blocks or [{"block_type": "paragraph", "text": text.strip()}]


def _html_blocks(html_text: str) -> list[dict[str, Any]]:
    parser = _HTMLBlockParser()
    parser.feed(html_text)
    parser.close()

    results: list[dict[str, Any]] = []
    for item in parser.blocks:
        tag = item["tag"]
        block_type = "paragraph"
        metadata: dict[str, Any] = {}
        section_path: list[str] = []
        if tag.startswith("h") and len(tag) == 2 and tag[1].isdigit():
            level = int(tag[1])
            block_type = "title" if level == 1 else "heading"
            metadata["heading_level"] = level
            section_path = [item["text"]]
        elif tag == "li":
            block_type = "list_item"
        results.append({"block_type": block_type, "text": item["text"], "section_path": section_path, "metadata": metadata})
    return results or _plain_text_blocks(html_text)


def _read_docx_via_textutil(source_path: str) -> str:
    if not shutil_which("textutil"):
        raise DocumentProcessingError("DOCX ingest requires either Unstructured or macOS textutil.")
    with tempfile.TemporaryDirectory(prefix="docproc-docx-") as temp_dir:
        html_path = Path(temp_dir) / "converted.html"
        subprocess.run(
            ["textutil", "-convert", "html", source_path, "-output", str(html_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        if not html_path.exists() or html_path.stat().st_size == 0:
            raise DocumentProcessingError(f"textutil did not produce HTML output for {source_path}.")
        return html_path.read_text(encoding="utf-8", errors="ignore")


def _read_docx_via_libreoffice(source_path: str) -> str:
    office_binary = shutil_which("libreoffice") or shutil_which("soffice")
    if not office_binary:
        raise DocumentProcessingError("DOCX ingest requires either Unstructured, macOS textutil, or LibreOffice.")
    source = Path(source_path)
    with tempfile.TemporaryDirectory(prefix="docproc-office-") as temp_dir:
        completed = subprocess.run(
            [office_binary, "--headless", "--convert-to", "html", "--outdir", temp_dir, source_path],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            raise DocumentProcessingError(completed.stderr.strip() or completed.stdout.strip() or f"LibreOffice failed for {source_path}.")
        candidates = sorted(Path(temp_dir).glob(f"{source.stem}*.html")) or sorted(Path(temp_dir).glob("*.html"))
        if not candidates:
            raise DocumentProcessingError(f"LibreOffice did not produce HTML output for {source_path}.")
        html_path = candidates[0]
        if html_path.stat().st_size == 0:
            raise DocumentProcessingError(f"LibreOffice produced an empty HTML file for {source_path}.")
        return html_path.read_text(encoding="utf-8", errors="ignore")


def _read_docx_via_local_converter(source_path: str) -> str:
    if shutil_which("textutil"):
        return _read_docx_via_textutil(source_path)
    if shutil_which("libreoffice") or shutil_which("soffice"):
        return _read_docx_via_libreoffice(source_path)
    raise DocumentProcessingError("DOCX ingest requires Unstructured, macOS textutil, or LibreOffice.")


def shutil_which(name: str) -> str | None:
    from shutil import which

    return which(name)


def _local_unstructured_fallback(source_path: str, mime_type: str | None = None) -> RichDocument:
    path = Path(source_path)
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md", ".rst", ".csv", ".json", ".xml", ".eml"}:
        return _build_document_from_blocks(source_path, "unstructured", _plain_text_blocks(path.read_text(encoding="utf-8")), mime_type=mime_type)
    if suffix in {".html", ".htm", ".xhtml"}:
        return _build_document_from_blocks(source_path, "unstructured", _html_blocks(path.read_text(encoding="utf-8")), mime_type=mime_type)
    if suffix in {".docx", ".doc", ".odt", ".rtf"}:
        html_text = _read_docx_via_local_converter(source_path)
        return _build_document_from_blocks(source_path, "unstructured", _html_blocks(html_text), mime_type=mime_type)
    raise DocumentProcessingError(f"Unsupported local fallback for {source_path}")


def _ingest_with_unstructured(source_path: str, mime_type: str | None = None) -> RichDocument:
    if Path(source_path).suffix.lower() in {".txt", ".md", ".rst", ".csv", ".json", ".xml", ".eml", ".html", ".htm", ".xhtml"}:
        return _local_unstructured_fallback(source_path, mime_type=mime_type)
    try:
        dependency_bootstrap.ensure_python_dependency("unstructured")
        from unstructured.partition.auto import partition
    except (ImportError, dependency_bootstrap.DependencyBootstrapError):
        return _local_unstructured_fallback(source_path, mime_type=mime_type)
    elements = []
    for element in partition(filename=source_path):
        metadata = {}
        if hasattr(element, "metadata") and hasattr(element.metadata, "to_dict"):
            metadata = element.metadata.to_dict()
        elements.append(
            {
                "type": element.category if hasattr(element, "category") else element.__class__.__name__,
                "element_id": getattr(element, "id", None),
                "text": str(element),
                "metadata": metadata,
            }
        )
    return normalize_unstructured_elements(elements, source_path=source_path, mime_type=mime_type)


def _load_odl_convert() -> Callable[..., Any]:
    try:
        from opendataloader_pdf import convert  # type: ignore
        return convert
    except ImportError:
        try:
            dependency_bootstrap.ensure_python_dependency("opendataloader_pdf")
            from opendataloader_pdf import convert  # type: ignore
            return convert
        except (ImportError, dependency_bootstrap.DependencyBootstrapError):
            pass
    source_dir = workspace_root() / "opendataloader-pdf" / "python" / "opendataloader-pdf" / "src"
    module = import_from_checkout("opendataloader_pdf", source_dir)
    convert = getattr(module, "convert", None)
    if convert is None:
        raise DocumentProcessingError("OpenDataLoader-PDF is not importable from the environment or local checkout.")
    return convert


def _load_mineru_do_parse() -> Callable[..., Any]:
    try:
        from mineru.cli.common import do_parse  # type: ignore
        return do_parse
    except ImportError:
        pass
    try:
        dependency_bootstrap.ensure_python_dependency("mineru")
        from mineru.cli.common import do_parse  # type: ignore
        return do_parse
    except (ImportError, dependency_bootstrap.DependencyBootstrapError):
        pass
    checkout_root = workspace_root() / "MinerU"
    module = import_from_checkout("mineru.cli.common", checkout_root)
    do_parse = getattr(module, "do_parse", None)
    if do_parse is None:
        raise DocumentProcessingError("MinerU is not importable from the environment or local checkout.")
    return do_parse




def _find_output_json(output_root: Path, preferred_names: list[str], patterns: list[str] | None = None) -> Path:
    for name in preferred_names:
        candidate = output_root / name
        if candidate.exists():
            return candidate
    for pattern in patterns or []:
        matches = sorted(output_root.rglob(pattern))
        if matches:
            return matches[0]
    matches = sorted(output_root.rglob("*.json"))
    if matches:
        return matches[0]
    raise DocumentProcessingError(f"No JSON payload was produced under {output_root}.")


def _ingest_with_odl_pdf(source_path: str) -> RichDocument:
    convert = _load_odl_convert()
    with tempfile.TemporaryDirectory(prefix="docproc-odl-") as temp_dir:
        output_root = Path(temp_dir)
        try:
            convert(input_path=source_path, output_dir=str(output_root), format="json", quiet=True)
        except Exception as exc:
            raise DocumentProcessingError(f"OpenDataLoader-PDF failed for {source_path}: {exc}") from exc
        payload_path = _find_output_json(output_root, [f"{Path(source_path).stem}.json"])
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        return normalize_odl_document(payload, source_path=source_path)


def _ingest_with_mineru(source_path: str) -> RichDocument:
    do_parse = _load_mineru_do_parse()
    with tempfile.TemporaryDirectory(prefix="docproc-mineru-") as temp_dir:
        output_root = Path(temp_dir)
        pdf_bytes = Path(source_path).read_bytes()
        try:
            do_parse(
                str(output_root),
                [Path(source_path).stem],
                [pdf_bytes],
                ["ch"],
                backend="pipeline",
                parse_method="auto",
                f_dump_md=False,
                f_dump_middle_json=True,
                f_dump_model_output=False,
                f_dump_orig_pdf=False,
                f_dump_content_list=True,
            )
        except Exception as exc:
            raise DocumentProcessingError(f"MinerU failed for {source_path}: {exc}") from exc
        stem = Path(source_path).stem
        payload_path = _find_output_json(
            output_root,
            [f"{stem}_content_list.json", f"{stem}_content_list_v2.json", f"{stem}_middle.json"],
            patterns=["*_content_list*.json", "*_middle.json"],
        )
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        return normalize_mineru_document(payload, source_path=source_path)


def ingest_source(source_path: str, backend: str, capabilities: dict[str, Any] | None = None, hints: dict[str, Any] | None = None) -> RichDocument:
    mime_type = infer_mime_type(source_path)
    if backend == "unstructured":
        return _ingest_with_unstructured(source_path, mime_type=mime_type)
    if backend == "odl_pdf":
        return _ingest_with_odl_pdf(source_path)
    if backend == "mineru":
        return _ingest_with_mineru(source_path)
    raise DocumentProcessingError(f"Unknown backend: {backend}")


def run_ingest(
    source_path: str,
    run_dir: str | Path,
    backend_override: str | None = None,
    dry_run: bool = False,
    hints: dict[str, Any] | None = None,
) -> Path:
    run_path = Path(run_dir)
    run_path.mkdir(parents=True, exist_ok=True)
    source = Path(source_path)
    capabilities = summarize_capabilities({})
    backend = backend_override or choose_backend(str(source), hints=hints, capabilities=capabilities)
    mime_type = infer_mime_type(str(source))

    if backend == "odl_pdf" and capabilities.get("binaries", {}).get("java") is None:
        raise DocumentProcessingError(_manual_install_message(capabilities, str(source)))

    if dry_run:
        document = _build_document_from_blocks(str(source), backend, [{"block_type": "paragraph", "text": f"Dry run for {source.name}"}], mime_type=mime_type)
    else:
        document = ingest_source(str(source), backend, capabilities=capabilities, hints=hints)

    manifest = {
        "source_path": str(source),
        "backend": backend,
        "dry_run": dry_run,
        "mime_type": mime_type,
    }
    (run_path / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    document.write_json(run_path / "rich_ir.json")
    return run_path
