from document_processing_pipeline.backends.mineru_adapter import normalize_mineru_document
from document_processing_pipeline.backends.odl_pdf_adapter import normalize_odl_document


def test_odl_payload_normalizes():
    payload = {"documentId": "doc", "kids": []}
    doc = normalize_odl_document(payload, source_path="sample.pdf")
    assert doc.document.backend == "odl_pdf"


def test_mineru_payload_normalizes():
    payload = {"pdf_info": [], "version": "x"}
    doc = normalize_mineru_document(payload, source_path="sample.pdf")
    assert doc.document.backend == "mineru"
