from document_processing_pipeline.translation_rules import (
    clean_cid_placeholders,
    is_formula_like_text,
    mathify_for_html,
    prettify_inline_math,
    protect_terms,
    restore_terms,
)


def test_clean_cid_placeholders_known_mapping():
    assert clean_cid_placeholders("(cid:18)") == "("
    assert clean_cid_placeholders("(cid:19)") == ")"
    assert clean_cid_placeholders("(cid:135)") == ""


def test_clean_cid_placeholders_unknown_drops():
    assert clean_cid_placeholders("(cid:9999)") == ""


def test_prettify_inline_math_digit_subscript():
    assert "₀" in prettify_inline_math("h0")
    assert "₁₂" in prettify_inline_math("x12")


def test_mathify_for_html_subscript():
    result = mathify_for_html("h0")
    assert "<sub>0</sub>" in result


def test_mathify_for_html_superscript():
    result = mathify_for_html("x^{2}")
    assert "<sup>2</sup>" in result


def test_mathify_for_html_escapes_angle_brackets():
    result = mathify_for_html("a < b > c")
    assert "&lt;" in result
    assert "&gt;" in result


def test_protect_and_restore_round_trip():
    text = "The DenseFormer uses RMSNorm layers."
    protected, replacements = protect_terms(text)
    assert "DenseFormer" not in protected
    assert "RMSNorm" not in protected
    assert "[[TERM_" in protected
    restored = restore_terms(protected, replacements)
    assert restored == text


def test_protect_terms_custom_terms():
    text = "Use MyTerm here."
    protected, replacements = protect_terms(text, terms=["MyTerm"])
    assert "MyTerm" not in protected
    restored = restore_terms(protected, replacements)
    assert restored == text


def test_protect_terms_extra_terms():
    text = "Use ExtraOne and softmax together."
    protected, replacements = protect_terms(text, extra_terms=["ExtraOne"])
    assert "ExtraOne" not in protected
    assert "softmax" not in protected


def test_is_formula_like_text_code_markers():
    assert is_formula_like_text("torch.nn.Linear(10, 20)") is True
    assert is_formula_like_text("def forward(self):") is True


def test_is_formula_like_text_math_markers():
    assert is_formula_like_text("α + β = γ") is True


def test_is_formula_like_text_short_title():
    assert is_formula_like_text("Q", block_type="title") is True
    assert is_formula_like_text("w", block_type="title") is True


def test_is_formula_like_text_cid_pattern():
    assert is_formula_like_text("(cid:18) x (cid:19)") is True


def test_is_formula_like_text_prose_pass_through():
    prose = "This is a long paragraph that contains many words and ends with a period. It should not be considered formula-like text."
    assert is_formula_like_text(prose) is False


def test_is_formula_like_text_header_footer_always_true():
    assert is_formula_like_text("Page 1 of 10", block_type="header") is True
    assert is_formula_like_text("Copyright 2024", block_type="footer") is True
