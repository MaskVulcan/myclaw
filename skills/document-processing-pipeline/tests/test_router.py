from document_processing_pipeline.router import choose_backend, route_document_task


def test_pdf_does_not_route_to_odl_from_java_alone():
    backend = choose_backend(
        "paper.pdf",
        mime_type="application/pdf",
        hints={},
        capabilities={"available": ["java"], "features": {"pdf_ingest": False}},
    )
    assert backend == "unstructured"


def test_pdf_defaults_to_mineru_when_available():
    backend = choose_backend(
        "paper.pdf",
        mime_type="application/pdf",
        hints={},
        capabilities={"packages": {"mineru": True}, "backends": {"mineru": True, "odl_pdf": True}, "features": {"pdf_ingest": True}},
    )
    assert backend == "mineru"


def test_pdf_falls_back_to_unstructured_when_only_odl_is_available():
    backend = choose_backend(
        "paper.pdf",
        mime_type="application/pdf",
        hints={},
        capabilities={"packages": {"opendataloader_pdf": True}, "backends": {"mineru": False, "odl_pdf": True}, "features": {"pdf_ingest": True}},
    )
    assert backend == "unstructured"


def test_pdf_prefers_mineru_for_formula_hint():
    backend = choose_backend(
        "paper.pdf",
        mime_type="application/pdf",
        hints={"contains_formulas": True},
        capabilities={"packages": {"mineru": True}, "features": {"pdf_ingest": True}},
    )
    assert backend == "mineru"


def test_pdf_allows_explicit_odl_override():
    backend = choose_backend(
        "paper.pdf",
        mime_type="application/pdf",
        hints={"backend": "odl_pdf"},
        capabilities={},
    )
    assert backend == "odl_pdf"


def test_docx_defaults_to_unstructured():
    backend = choose_backend(
        "report.docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        hints={},
    )
    assert backend == "unstructured"


def test_route_translate_pdf_prefers_pipeline():
    route = route_document_task(
        "paper.pdf",
        task="translate",
        capabilities={"packages": {"mineru": True}, "backends": {"mineru": True}, "features": {"pdf_ingest": True}},
        layout_preserving=True,
    )

    assert route["lane"] == "pipeline"
    assert route["backend"] == "mineru"
    assert route["commands"][-1][1] == "overlay-pdf"


def test_route_docx_redline_prefers_local_docx():
    route = route_document_task(
        "contract.docx",
        task="edit-docx",
        capabilities={"features": {"docx_local_edit": True}},
    )

    assert route["lane"] == "local_docx"
    assert route["available"] is True
    assert route["commands"][1][1] == "docx-apply-plan"


def test_route_extract_fields_prefers_local_ocr():
    route = route_document_task(
        "invoice.pdf",
        task="extract-fields",
        capabilities={"features": {"local_ocr": True}},
    )

    assert route["lane"] == "local_ocr"
    assert route["available"] is True
