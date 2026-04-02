from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_skill_mentions_dual_ir():
    text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert "rich_ir.json" in text
    assert "clean_text.md" in text
