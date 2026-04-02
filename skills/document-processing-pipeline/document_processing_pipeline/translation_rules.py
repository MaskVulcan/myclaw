from __future__ import annotations

import re
from typing import Sequence


# Default protected terms shipped with the pipeline.  Override entirely by
# passing ``terms=`` to :func:`protect_terms`, or extend via ``extra_terms=``.
# These are common ML / deep-learning terms that translation engines tend to
# mangle; adjust to your domain as needed.
DEFAULT_PROTECTED_TERMS: tuple[str, ...] = (
    "Block AttnRes",
    "Attention Residuals",
    "AttnRes",
    "DenseFormer",
    "ConvPool",
    "RMSNorm",
    "PreNorm",
    "PostNorm",
    "softmax",
    "LLM",
)

_CODE_MARKERS = ("torch.", "einsum(", "return ", "def ", "class ", "//", "/*", "*/")
_MATH_MARKERS = ("⊙", "α", "β", "γ", "λ", "ϕ", "∑", "→", "∝", "≤", "≥", "cid:", "Norm(", "RMSNorm(", "ConvPool(", "⊤", "∥", "⟨", "⟩", "∇", "∂", "∈", "∀", "∃")
_CID_PATTERN = re.compile(r"\(cid:\d+\)")

# Common CID→Unicode mappings for Computer Modern / LaTeX fonts.
_CID_UNICODE_MAP: dict[int, str] = {
    18: "(", 19: ")",
    26: "{",
    80: "∑", 81: "∏",
    88: "∑", 89: "∏",
    122: "{", 123: "{", 124: "|", 125: "}",
    135: "",  # decorative glyph, drop silently
}
_SUBSCRIPT_MAP = str.maketrans("0123456789+-=()aehijklmnoprstuvx", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ")
_SUPERSCRIPT_MAP = str.maketrans("0123456789+-=()in", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ")


def clean_cid_placeholders(text: str) -> str:
    """Replace ``(cid:XX)`` placeholders with their Unicode equivalents."""
    def _replace_cid(m: re.Match[str]) -> str:
        num = int(m.group(1))
        return _CID_UNICODE_MAP.get(num, "")
    return re.sub(r"\(cid:(\d+)\)", _replace_cid, text)


def prettify_inline_math(text: str) -> str:
    """Best-effort Unicode subscript/superscript for common inline math patterns.

    Handles patterns like ``h_l``, ``x_{i+1}``, ``f^{2}``, ``α_{i→l}`` that
    appear in plain-text formula extractions from PDFs.
    """
    result = text
    # Subscript patterns: single-char subscripts like hl -> h_l, fl-1
    # Match: letter followed by digits or short subscript-like tokens
    # E.g. "hl" after a space/boundary, "fl−1", "αi→l"
    # We use a targeted approach: convert known patterns
    def _sub_digit_suffix(m: re.Match[str]) -> str:
        base = m.group(1)
        sub = m.group(2).translate(_SUBSCRIPT_MAP)
        return base + sub

    # Pattern: single letter + subscript digits/letters at word boundary
    # e.g. "h0" -> "h₀", "bl−1" -> "b_{l−1}"
    result = re.sub(r"\b([a-zA-Z])(\d+)\b", _sub_digit_suffix, result)
    return result


def mathify_for_html(text: str) -> str:
    """Convert inline math patterns to HTML ``<sub>``/``<sup>`` tags.

    Similar to :func:`prettify_inline_math` but outputs HTML markup instead of
    Unicode subscript/superscript characters.  Used by the reflow-PDF renderer.
    """
    from html import escape as _esc

    result = clean_cid_placeholders(text)
    # Escape HTML entities first so we don't double-escape later,
    # but we need to be careful not to escape our own tags.
    result = _esc(result, quote=False)
    # letter + digits at word boundary → subscript: h0 → h<sub>0</sub>
    result = re.sub(r"\b([a-zA-Z])(\d+)\b", r"\1<sub>\2</sub>", result)
    # x_{...} → x<sub>...</sub>
    result = re.sub(r"_\{([^}]+)\}", r"<sub>\1</sub>", result)
    # x^{...} → x<sup>...</sup>
    result = re.sub(r"\^\{([^}]+)\}", r"<sup>\1</sup>", result)
    return result


def _build_pattern(terms: Sequence[str]) -> re.Pattern[str] | None:
    if not terms:
        return None
    return re.compile("|".join(re.escape(term) for term in terms))


def protect_terms(
    text: str,
    *,
    terms: Sequence[str] | None = None,
    extra_terms: Sequence[str] | None = None,
) -> tuple[str, dict[str, str]]:
    """Replace protected terms in *text* with numbered placeholders.

    Parameters
    ----------
    terms:
        Explicit term list.  When provided, *only* these terms are protected
        (``DEFAULT_PROTECTED_TERMS`` is ignored).
    extra_terms:
        Additional terms appended to the defaults.
    """
    effective: list[str] = list(terms) if terms is not None else list(DEFAULT_PROTECTED_TERMS)
    if extra_terms:
        effective.extend(extra_terms)

    pattern = _build_pattern(effective)
    if pattern is None:
        return text, {}

    term_to_placeholder: dict[str, str] = {}
    placeholder_to_term: dict[str, str] = {}

    def replace(match: re.Match[str]) -> str:
        term = match.group(0)
        placeholder = term_to_placeholder.get(term)
        if placeholder is None:
            placeholder = f"[[TERM_{len(term_to_placeholder)}]]"
            term_to_placeholder[term] = placeholder
            placeholder_to_term[placeholder] = term
        return placeholder

    return pattern.sub(replace, text), placeholder_to_term


def restore_terms(text: str, replacements: dict[str, str]) -> str:
    restored = text
    for placeholder, term in replacements.items():
        restored = restored.replace(placeholder, term)
    return restored


def _is_short_label(text: str) -> bool:
    """True for very short fragments that are figure / table labels, not prose."""
    return len(text) <= 10 and len(re.findall(r"[A-Za-z]{3,}", text)) <= 1


def _is_prose(text: str) -> bool:
    """True when *text* looks like a natural-language sentence (not a formula)."""
    words = re.findall(r"[A-Za-z]{3,}", text)
    return len(words) >= 8 and bool(re.search(r"[.!?]", text))


def is_formula_like_text(text: str, block_type: str | None = None) -> bool:
    candidate = text.strip()
    if not candidate:
        return False

    if any(marker in candidate for marker in _CODE_MARKERS):
        return True

    # Headers and footers are page chrome — never translate.
    if block_type in {"header", "footer"}:
        return True

    # Short fragments from uncategorizedtext are almost always formula debris.
    if block_type == "uncategorizedtext":
        # Long natural-language sentences (8+ words with punctuation) pass through.
        if _is_prose(candidate):
            return False
        return True

    # (cid:XX) patterns are PDF font-encoding artefacts.
    # In short blocks they signal a pure formula fragment; in long narrative
    # paragraphs they are just inline math references — let those through.
    if _CID_PATTERN.search(candidate):
        if _is_prose(candidate):
            pass  # fall through — this is a paragraph with inline math
        else:
            return True

    # Very short title fragments are typically figure/table annotations (e.g. "w",
    # "α α", "Q", "K V") — skip them.
    if block_type == "title" and _is_short_label(candidate):
        return True

    if block_type in {"title"} and len(candidate) <= 20 and ("=" in candidate or candidate.endswith("=")):
        return True
    if len(candidate) <= 80 and re.search(r"\b(?:Norm|RMSNorm|ConvPool|softmax)\s*\(", candidate):
        return True

    alphabetic_tokens = re.findall(r"[A-Za-z]+", candidate)
    if candidate.count("=") >= 2 and len(alphabetic_tokens) <= 40 and not re.search(r"[.!?]", candidate):
        return True
    if len(candidate) <= 180:
        math_hits = sum(1 for marker in _MATH_MARKERS if marker in candidate) + int("=" in candidate)
        if re.match(r"^(?:[A-Za-z][A-Za-z0-9_]*\s*=|//|/\*)", candidate):
            return True
        if math_hits >= 2 and len(alphabetic_tokens) <= 18 and not re.search(r"[.!?]", candidate):
            return True

    return False
