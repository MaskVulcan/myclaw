from document_processing_pipeline.models import RichDocument


def test_rich_document_round_trip():
    doc = RichDocument.from_dict(
        {
            "document": {"id": "doc-1", "source_path": "sample.pdf", "backend": "test"},
            "pages": [{"page_number": 1, "width": 595, "height": 842}],
            "blocks": [],
            "assets": [],
            "tables": [{"table_id": "table-1", "page_number": 1, "html": "<table><tr><td>x</td></tr></table>"}],
            "figures": [{"figure_id": "figure-1", "page_number": 1, "caption": "Figure"}],
            "formulas": [{"formula_id": "formula-1", "page_number": 1, "latex": "x^2"}],
            "provenance": {"source_backend": "test", "fallback_chain": ["unstructured"], "warnings": ["warn"]},
            "warnings": [],
        }
    )
    payload = doc.model_dump()
    assert payload["document"]["id"] == "doc-1"
    assert payload["tables"][0]["table_id"] == "table-1"
    assert payload["provenance"]["source_backend"] == "test"
