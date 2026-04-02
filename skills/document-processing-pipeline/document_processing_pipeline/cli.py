from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from document_processing_pipeline.assemble_docx import assemble_docx
from document_processing_pipeline.assemble_html import assemble_html
from document_processing_pipeline.assemble_markdown import assemble_markdown
from document_processing_pipeline.assemble_pdf import assemble_pdf
from document_processing_pipeline.dependencies import describe_profiles, install_dependency_profiles
from document_processing_pipeline.docx_local import apply_docx_plan, compare_docx, grep_docx, inspect_docx_json, replace_docx_paragraph
from document_processing_pipeline.derive_text import derive_clean_text
from document_processing_pipeline.doctor import capabilities_as_json, summarize_capabilities
from document_processing_pipeline.ingest import run_ingest
from document_processing_pipeline.normalize import normalize_payload_file
from document_processing_pipeline.ocr_local import extract_pdf_text_local
from document_processing_pipeline.overlay_translate_pdf import overlay_translated_pdf
from document_processing_pipeline.router import route_document_task
from document_processing_pipeline.side_by_side_pdf import side_by_side_pdf
from document_processing_pipeline.reconcile import reconcile_blocks
from document_processing_pipeline.translate_blocks import merge_translations, translate_blocks
from document_processing_pipeline.transform_blocks import apply_transform


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Script-first document processing pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("doctor")

    list_deps_parser = subparsers.add_parser("list-deps")
    list_deps_parser.add_argument("profile", nargs="*")

    install_deps_parser = subparsers.add_parser("install-deps")
    install_deps_parser.add_argument("profile", nargs="*")
    install_deps_parser.add_argument("--dry-run", action="store_true")
    install_mode_group = install_deps_parser.add_mutually_exclusive_group()
    install_mode_group.add_argument("--python-only", action="store_true")
    install_mode_group.add_argument("--system-only", action="store_true")

    ingest_parser = subparsers.add_parser("ingest")
    ingest_parser.add_argument("source")
    ingest_parser.add_argument("--run-dir", required=True)
    ingest_parser.add_argument("--backend")
    ingest_parser.add_argument("--dry-run", action="store_true")

    normalize_parser = subparsers.add_parser("normalize")
    normalize_parser.add_argument("payload")
    normalize_parser.add_argument("--backend", required=True)
    normalize_parser.add_argument("--source-path", required=True)
    normalize_parser.add_argument("--run-dir", required=True)

    derive_parser = subparsers.add_parser("derive-text")
    derive_parser.add_argument("--run-dir", required=True)

    transform_parser = subparsers.add_parser("transform-blocks")
    transform_parser.add_argument("--run-dir", required=True)
    transform_parser.add_argument("--operation", default="copy",
                                     help="Transform operation: copy, uppercase, lowercase, prefix, zh-punct-to-en")
    transform_parser.add_argument("--input-file")
    transform_parser.add_argument("--prefix", default="")

    translate_parser = subparsers.add_parser("translate-blocks")
    translate_parser.add_argument("--run-dir", required=True)
    translate_parser.add_argument("--source-lang", required=True)
    translate_parser.add_argument("--target-lang", required=True)
    translate_parser.add_argument("--input-file")
    translate_parser.add_argument("--engine", default="google")
    translate_parser.add_argument("--batch-size", type=int, default=8)
    translate_parser.add_argument("--retry-count", type=int, default=2)

    merge_parser = subparsers.add_parser("merge-translations")
    merge_parser.add_argument("--run-dir", required=True)
    merge_parser.add_argument("--input-file")
    merge_parser.add_argument("--translated-file")
    merge_parser.add_argument("--codex-fallback-file")
    merge_parser.add_argument("--output-file")

    reconcile_parser = subparsers.add_parser("reconcile")
    reconcile_parser.add_argument("--run-dir", required=True)

    markdown_parser = subparsers.add_parser("assemble-markdown")
    markdown_parser.add_argument("--run-dir", required=True)

    html_parser = subparsers.add_parser("assemble-html")
    html_parser.add_argument("--run-dir", required=True)

    docx_parser = subparsers.add_parser("assemble-docx")
    docx_parser.add_argument("--run-dir", required=True)

    pdf_parser = subparsers.add_parser("assemble-pdf")
    pdf_parser.add_argument("--run-dir", required=True)
    pdf_parser.add_argument("--stirling-url")

    overlay_parser = subparsers.add_parser("overlay-pdf")
    overlay_parser.add_argument("--run-dir", required=True)
    overlay_parser.add_argument("--source-pdf")
    overlay_parser.add_argument("--output")
    overlay_parser.add_argument("--font-path")

    sbs_parser = subparsers.add_parser("side-by-side-pdf")
    sbs_parser.add_argument("--run-dir", required=True)
    sbs_parser.add_argument("--source-pdf")
    sbs_parser.add_argument("--output")
    sbs_parser.add_argument("--font-path")
    sbs_parser.add_argument("--gap", type=float, default=16.0)

    route_parser = subparsers.add_parser("route")
    route_parser.add_argument("source")
    route_parser.add_argument(
        "--task",
        required=True,
        choices=[
            "translate",
            "summarize",
            "simplify",
            "rebuild",
            "extract-text",
            "extract-fields",
            "edit-docx",
            "compare-docx",
            "overlay-pdf",
            "side-by-side-pdf",
            "pdf-direct",
            "merge-pdf",
            "split-pdf",
            "rotate-pdf",
            "watermark-pdf",
            "form-fill-pdf",
            "extract-pdf",
        ],
    )
    route_parser.add_argument("--run-dir")
    route_parser.add_argument("--mime-type")
    route_parser.add_argument("--output-format")
    route_parser.add_argument("--source-lang")
    route_parser.add_argument("--target-lang")
    route_parser.add_argument("--backend")
    route_parser.add_argument("--requires-redline", action="store_true")
    route_parser.add_argument("--requires-review", action="store_true")
    route_parser.add_argument("--requires-ocr", action="store_true")
    route_parser.add_argument("--layout-preserving", action="store_true")

    docx_inspect_parser = subparsers.add_parser("docx-inspect")
    docx_inspect_parser.add_argument("source")

    docx_grep_parser = subparsers.add_parser("docx-grep")
    docx_grep_parser.add_argument("source")
    docx_grep_parser.add_argument("--pattern", action="append", required=True)

    docx_replace_parser = subparsers.add_parser("docx-replace")
    docx_replace_parser.add_argument("source")
    docx_replace_parser.add_argument("--output", required=True)
    docx_replace_parser.add_argument("--paragraph-id")
    docx_replace_parser.add_argument("--old-text")
    docx_replace_parser.add_argument("--new-text", required=True)

    docx_compare_parser = subparsers.add_parser("docx-compare")
    docx_compare_parser.add_argument("original")
    docx_compare_parser.add_argument("revised")

    docx_apply_plan_parser = subparsers.add_parser("docx-apply-plan")
    docx_apply_plan_parser.add_argument("source")
    docx_apply_plan_parser.add_argument("--plan", required=True)
    docx_apply_plan_parser.add_argument("--output", required=True)

    ocr_pdf_parser = subparsers.add_parser("ocr-pdf")
    ocr_pdf_parser.add_argument("source")
    ocr_pdf_parser.add_argument("--output")
    ocr_pdf_parser.add_argument("--lang", default="eng")
    ocr_pdf_parser.add_argument("--force-ocr", action="store_true")
    ocr_pdf_parser.add_argument("--pages")
    ocr_pdf_parser.add_argument("--format", choices=["markdown", "jsonl"], default="markdown")

    return parser


def _cmd_doctor(args) -> int:
    print(capabilities_as_json({}))
    return 0


def _cmd_list_deps(args) -> int:
    print(json.dumps(describe_profiles(args.profile or None), ensure_ascii=False, indent=2))
    return 0


def _cmd_install_deps(args) -> int:
    summary = install_dependency_profiles(
        args.profile or None,
        include_python=not args.system_only,
        include_system=not args.python_only,
        dry_run=args.dry_run,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def _cmd_ingest(args) -> int:
    run_path = run_ingest(args.source, args.run_dir, backend_override=args.backend, dry_run=args.dry_run)
    print(json.dumps({"run_dir": str(run_path)}, ensure_ascii=False))
    return 0


def _cmd_normalize(args) -> int:
    run_path = Path(args.run_dir)
    run_path.mkdir(parents=True, exist_ok=True)
    output_path = normalize_payload_file(
        args.payload,
        backend=args.backend,
        source_path=args.source_path,
        output_path=run_path / "rich_ir.json",
    )
    print(json.dumps({"run_dir": str(run_path), "rich_ir": str(output_path)}, ensure_ascii=False))
    return 0


def _cmd_derive_text(args) -> int:
    derive_clean_text(args.run_dir)
    return 0


def _cmd_transform_blocks(args) -> int:
    apply_transform(args.run_dir, operation=args.operation, input_file=args.input_file, prefix=args.prefix)
    return 0


def _cmd_translate_blocks(args) -> int:
    translate_blocks(
        args.run_dir,
        source_lang=args.source_lang,
        target_lang=args.target_lang,
        input_file=args.input_file,
        engine=args.engine,
        batch_size=args.batch_size,
        retry_count=args.retry_count,
    )
    return 0


def _cmd_merge_translations(args) -> int:
    merge_translations(
        args.run_dir,
        input_file=args.input_file,
        translated_file=args.translated_file,
        codex_fallback_file=args.codex_fallback_file,
        output_file=args.output_file,
    )
    return 0


def _cmd_reconcile(args) -> int:
    reconcile_blocks(args.run_dir)
    return 0


def _cmd_assemble_markdown(args) -> int:
    assemble_markdown(args.run_dir)
    return 0


def _cmd_assemble_html(args) -> int:
    assemble_html(args.run_dir)
    return 0


def _cmd_assemble_docx(args) -> int:
    assemble_docx(args.run_dir)
    return 0


def _cmd_assemble_pdf(args) -> int:
    assemble_pdf(args.run_dir, stirling_url=args.stirling_url)
    return 0


def _cmd_overlay_pdf(args) -> int:
    overlay_translated_pdf(args.source_pdf, args.run_dir, output_path=args.output, font_path=args.font_path)
    return 0


def _cmd_side_by_side_pdf(args) -> int:
    side_by_side_pdf(args.run_dir, source_pdf=args.source_pdf, output_path=args.output, font_path=args.font_path, gap=args.gap)
    return 0


def _cmd_route(args) -> int:
    decision = route_document_task(
        args.source,
        task=args.task,
        capabilities=summarize_capabilities({}),
        run_dir=args.run_dir,
        mime_type=args.mime_type,
        output_format=args.output_format,
        source_lang=args.source_lang,
        target_lang=args.target_lang,
        backend=args.backend,
        requires_redline=args.requires_redline,
        requires_review=args.requires_review,
        requires_ocr=args.requires_ocr,
        layout_preserving=args.layout_preserving,
    )
    print(json.dumps(decision, ensure_ascii=False, indent=2))
    return 0


def _cmd_docx_inspect(args) -> int:
    print(inspect_docx_json(args.source))
    return 0


def _cmd_docx_grep(args) -> int:
    print(json.dumps(grep_docx(args.source, args.pattern), ensure_ascii=False, indent=2))
    return 0


def _cmd_docx_replace(args) -> int:
    output = replace_docx_paragraph(
        args.source,
        output_path=args.output,
        new_text=args.new_text,
        paragraph_id=args.paragraph_id,
        old_text=args.old_text,
    )
    print(json.dumps({"output_path": str(output)}, ensure_ascii=False, indent=2))
    return 0


def _cmd_docx_compare(args) -> int:
    print(json.dumps(compare_docx(args.original, args.revised), ensure_ascii=False, indent=2))
    return 0


def _cmd_docx_apply_plan(args) -> int:
    print(json.dumps(apply_docx_plan(args.source, output_path=args.output, plan_path=args.plan), ensure_ascii=False, indent=2))
    return 0


def _cmd_ocr_pdf(args) -> int:
    output = extract_pdf_text_local(
        args.source,
        output_path=args.output,
        lang=args.lang,
        force_ocr=args.force_ocr,
        pages=args.pages,
        output_format=args.format,
    )
    print(json.dumps({"output_path": str(output)}, ensure_ascii=False, indent=2))
    return 0


_COMMANDS: dict[str, object] = {
    "doctor": _cmd_doctor,
    "list-deps": _cmd_list_deps,
    "install-deps": _cmd_install_deps,
    "ingest": _cmd_ingest,
    "normalize": _cmd_normalize,
    "derive-text": _cmd_derive_text,
    "transform-blocks": _cmd_transform_blocks,
    "translate-blocks": _cmd_translate_blocks,
    "merge-translations": _cmd_merge_translations,
    "reconcile": _cmd_reconcile,
    "assemble-markdown": _cmd_assemble_markdown,
    "assemble-html": _cmd_assemble_html,
    "assemble-docx": _cmd_assemble_docx,
    "assemble-pdf": _cmd_assemble_pdf,
    "overlay-pdf": _cmd_overlay_pdf,
    "side-by-side-pdf": _cmd_side_by_side_pdf,
    "route": _cmd_route,
    "docx-inspect": _cmd_docx_inspect,
    "docx-grep": _cmd_docx_grep,
    "docx-replace": _cmd_docx_replace,
    "docx-compare": _cmd_docx_compare,
    "docx-apply-plan": _cmd_docx_apply_plan,
    "ocr-pdf": _cmd_ocr_pdf,
}


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    handler = _COMMANDS.get(args.command)
    if handler is None:
        parser.error(f"Unsupported command: {args.command}")
        return 2
    return handler(args)


def cli() -> None:
    """Console script entry point (registered as ``docpipe``)."""
    raise SystemExit(main())
