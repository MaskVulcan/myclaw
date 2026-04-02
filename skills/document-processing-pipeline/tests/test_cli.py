from document_processing_pipeline.cli import build_parser, _COMMANDS


def test_build_parser_all_commands():
    parser = build_parser()
    expected_commands = {
        "doctor", "list-deps", "install-deps", "ingest", "normalize", "derive-text", "transform-blocks",
        "translate-blocks", "merge-translations", "reconcile",
        "assemble-markdown", "assemble-html", "assemble-docx", "assemble-pdf",
        "overlay-pdf", "side-by-side-pdf", "route",
        "docx-inspect", "docx-grep", "docx-replace", "docx-compare", "docx-apply-plan", "ocr-pdf",
    }
    assert expected_commands == set(_COMMANDS.keys())


def test_transform_blocks_operation_choices():
    parser = build_parser()
    args = parser.parse_args(["transform-blocks", "--run-dir", "/tmp/run", "--operation", "zh-punct-to-en"])
    assert args.command == "transform-blocks"
    assert args.operation == "zh-punct-to-en"


def test_overlay_pdf_args():
    parser = build_parser()
    args = parser.parse_args(["overlay-pdf", "--run-dir", "/tmp/run", "--source-pdf", "input.pdf", "--font-path", "/usr/share/fonts/f.ttc"])
    assert args.command == "overlay-pdf"
    assert args.source_pdf == "input.pdf"
    assert args.font_path == "/usr/share/fonts/f.ttc"


def test_side_by_side_pdf_args():
    parser = build_parser()
    args = parser.parse_args(["side-by-side-pdf", "--run-dir", "/tmp/run", "--source-pdf", "input.pdf", "--gap", "20.0"])
    assert args.command == "side-by-side-pdf"
    assert args.source_pdf == "input.pdf"
    assert args.gap == 20.0


def test_side_by_side_pdf_default_gap():
    parser = build_parser()
    args = parser.parse_args(["side-by-side-pdf", "--run-dir", "/tmp/run"])
    assert args.gap == 16.0


def test_route_args():
    parser = build_parser()
    args = parser.parse_args(["route", "paper.pdf", "--task", "translate", "--layout-preserving"])
    assert args.command == "route"
    assert args.task == "translate"
    assert args.layout_preserving is True


def test_docx_replace_args():
    parser = build_parser()
    args = parser.parse_args(["docx-replace", "contract.docx", "--paragraph-id", "p0002", "--new-text", "New text", "--output", "edited.docx"])
    assert args.command == "docx-replace"
    assert args.paragraph_id == "p0002"


def test_docx_apply_plan_args():
    parser = build_parser()
    args = parser.parse_args(["docx-apply-plan", "contract.docx", "--plan", "edits.jsonl", "--output", "edited.docx"])
    assert args.command == "docx-apply-plan"
    assert args.plan == "edits.jsonl"


def test_ocr_pdf_args():
    parser = build_parser()
    args = parser.parse_args(["ocr-pdf", "scan.pdf", "--force-ocr", "--lang", "chi_sim", "--pages", "1-3,5", "--format", "jsonl"])
    assert args.command == "ocr-pdf"
    assert args.force_ocr is True
    assert args.lang == "chi_sim"
    assert args.pages == "1-3,5"
    assert args.format == "jsonl"


def test_install_deps_args():
    parser = build_parser()
    args = parser.parse_args(["install-deps", "all-local", "--system-only", "--dry-run"])
    assert args.command == "install-deps"
    assert args.profile == ["all-local"]
    assert args.system_only is True
    assert args.dry_run is True
