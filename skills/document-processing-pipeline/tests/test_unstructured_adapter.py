from document_processing_pipeline.backends.unstructured_adapter import normalize_unstructured_elements


def test_unstructured_elements_become_blocks():
    elements = [
        {"type": "Title", "element_id": "a", "text": "Hello", "metadata": {"page_number": 1}},
        {"type": "NarrativeText", "element_id": "b", "text": "World", "metadata": {"page_number": 1}},
    ]
    doc = normalize_unstructured_elements(elements, source_path="sample.docx")
    assert len(doc.blocks) == 2
