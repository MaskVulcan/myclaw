from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_skill_scaffold_exists():
    assert (ROOT / "SKILL.md").exists()
    assert (ROOT / "agents" / "openai.yaml").exists()
    assert (ROOT / "scripts" / "pipeline.py").exists()
