from pathlib import Path

import fitz
from pypdf import PdfReader

from document_processing_pipeline.models import BlockRecord, DocumentMeta, PageInfo, RichDocument
from document_processing_pipeline.overlay_translate_pdf import _style_for_block, build_overlay_plan, overlay_translated_pdf


def test_build_overlay_plan_skips_unstable_blocks():
    document = RichDocument(
        document=DocumentMeta(id="doc", source_path="sample.pdf", backend="unstructured"),
        pages=[PageInfo(page_number=1, width=200, height=200)],
        blocks=[
            BlockRecord(
                block_id="keep-body",
                page_number=1,
                block_type="narrativetext",
                reading_order=0,
                text="Body",
                bbox={"x0": 20, "y0": 20, "x1": 150, "y1": 60},
            ),
            BlockRecord(
                block_id="skip-header",
                page_number=1,
                block_type="header",
                reading_order=1,
                text="Header",
                bbox={"x0": 20, "y0": 5, "x1": 180, "y1": 40},
            ),
            BlockRecord(
                block_id="skip-negative",
                page_number=1,
                block_type="narrativetext",
                reading_order=2,
                text="Negative",
                bbox={"x0": 20, "y0": -10, "x1": 150, "y1": 20},
            ),
            BlockRecord(
                block_id="skip-huge",
                page_number=1,
                block_type="title",
                reading_order=3,
                text="Huge",
                bbox={"x0": 0, "y0": 0, "x1": 198, "y1": 190},
            ),
        ],
    )

    plan = build_overlay_plan(
        document,
        {
            "keep-body": "正文",
            "skip-header": "页眉",
            "skip-negative": "负坐标",
            "skip-huge": "大块",
        },
    )

    assert [item.block_id for item in plan] == ["keep-body"]
    assert plan[0].text == "正文"
    assert tuple(round(value, 2) for value in plan[0].rect) == (20.0, 20.0, 150.0, 60.0)


def test_build_overlay_plan_skips_duplicate_large_title_rectangles():
    shared_rect = {"x0": 20, "y0": 60, "x1": 190, "y1": 150}
    document = RichDocument(
        document=DocumentMeta(id="doc", source_path="sample.pdf", backend="unstructured"),
        pages=[PageInfo(page_number=1, width=200, height=200)],
        blocks=[
            BlockRecord(
                block_id="dup-1",
                page_number=1,
                block_type="title",
                reading_order=0,
                text="Conceptual Question",
                bbox=shared_rect,
            ),
            BlockRecord(
                block_id="dup-2",
                page_number=1,
                block_type="title",
                reading_order=1,
                text="Code Reading",
                bbox=shared_rect,
            ),
            BlockRecord(
                block_id="caption",
                page_number=1,
                block_type="narrativetext",
                reading_order=2,
                text="Figure 1 caption",
                bbox={"x0": 20, "y0": 160, "x1": 180, "y1": 180},
            ),
        ],
    )

    plan = build_overlay_plan(
        document,
        {
            "dup-1": "概念题",
            "dup-2": "代码阅读",
            "caption": "图1：图注",
        },
    )

    assert [item.block_id for item in plan] == ["caption"]


def test_build_overlay_plan_skips_formula_like_blocks():
    document = RichDocument(
        document=DocumentMeta(id="doc", source_path="sample.pdf", backend="unstructured"),
        pages=[PageInfo(page_number=1, width=200, height=200)],
        blocks=[
            BlockRecord(
                block_id="skip-short-formula-title",
                page_number=1,
                block_type="title",
                reading_order=0,
                text="hl =",
                bbox={"x0": 30, "y0": 20, "x1": 80, "y1": 40},
            ),
            BlockRecord(
                block_id="skip-formula-text",
                page_number=1,
                block_type="uncategorizedtext",
                reading_order=1,
                text="Norm(hl−1)",
                bbox={"x0": 30, "y0": 50, "x1": 120, "y1": 70},
            ),
            BlockRecord(
                block_id="keep-body",
                page_number=1,
                block_type="narrativetext",
                reading_order=2,
                text="Residual connections are standard.",
                bbox={"x0": 20, "y0": 100, "x1": 180, "y1": 140},
            ),
        ],
    )

    plan = build_overlay_plan(
        document,
        {
            "skip-short-formula-title": "HL=",
            "skip-formula-text": "范数(hl−1)",
            "keep-body": "残差连接是标准做法。",
        },
    )

    assert [item.block_id for item in plan] == ["keep-body"]


def test_overlay_translated_pdf_writes_translated_text(tmp_path: Path):
    source_pdf = tmp_path / "source.pdf"
    document = fitz.open()
    page = document.new_page(width=200, height=200)
    page.insert_text((30, 50), "Hello world", fontsize=12)
    document.save(source_pdf)
    document.close()

    run_dir = tmp_path / "run"
    run_dir.mkdir()
    RichDocument(
        document=DocumentMeta(id="doc", source_path=str(source_pdf), backend="unstructured"),
        pages=[PageInfo(page_number=1, width=200, height=200)],
        blocks=[
            BlockRecord(
                block_id="b1",
                page_number=1,
                block_type="narrativetext",
                reading_order=0,
                text="Hello world",
                bbox={"x0": 20, "y0": 30, "x1": 170, "y1": 70},
            )
        ],
    ).write_json(run_dir / "rich_ir.json")
    (run_dir / "transformed_blocks.jsonl").write_text('{"block_id":"b1","text":"你好，世界"}\n', encoding="utf-8")

    output_path = run_dir / "overlay.pdf"
    result = overlay_translated_pdf(source_pdf=source_pdf, run_dir=run_dir, output_path=output_path)

    assert result == output_path
    assert output_path.exists()
    reader = PdfReader(str(output_path))
    assert len(reader.pages) == 1
    assert "你好" in (reader.pages[0].extract_text() or "")


def test_overlay_translated_pdf_strips_source_links(tmp_path: Path):
    source_pdf = tmp_path / "source-with-link.pdf"
    document = fitz.open()
    page = document.new_page(width=200, height=200)
    page.insert_text((30, 50), "Hello world", fontsize=12)
    page.insert_link(
        {
            "kind": fitz.LINK_URI,
            "from": fitz.Rect(20, 30, 120, 60),
            "uri": "https://example.com",
        }
    )
    document.save(source_pdf)
    document.close()

    run_dir = tmp_path / "run"
    run_dir.mkdir()
    RichDocument(
        document=DocumentMeta(id="doc", source_path=str(source_pdf), backend="unstructured"),
        pages=[PageInfo(page_number=1, width=200, height=200)],
        blocks=[
            BlockRecord(
                block_id="b1",
                page_number=1,
                block_type="narrativetext",
                reading_order=0,
                text="Hello world",
                bbox={"x0": 20, "y0": 30, "x1": 170, "y1": 70},
            )
        ],
    ).write_json(run_dir / "rich_ir.json")
    (run_dir / "transformed_blocks.jsonl").write_text('{"block_id":"b1","text":"你好，世界"}\n', encoding="utf-8")

    output_path = run_dir / "overlay.pdf"
    overlay_translated_pdf(source_pdf=source_pdf, run_dir=run_dir, output_path=output_path)

    output = fitz.open(output_path)
    try:
        assert output[0].get_links() == []
    finally:
        output.close()


def test_body_overlay_style_is_not_pure_black():
    style = _style_for_block(
        type(
            "Block",
            (),
            {
                "block_type": "narrativetext",
                "rect": (20.0, 20.0, 180.0, 60.0),
                "text": "正文",
            },
        )()
    )

    assert style.color != (0.0, 0.0, 0.0)
    assert style.font_path.exists()
    assert style.font_path.suffix.lower() in {".ttc", ".ttf", ".otf", ".otc"}
