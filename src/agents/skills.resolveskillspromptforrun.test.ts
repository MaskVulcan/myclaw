import { describe, expect, it } from "vitest";
import { resolveSkillsPromptForRun } from "./skills.js";
import { createCanonicalFixtureSkill } from "./skills.test-helpers.js";
import type { ResolvedPromptSkill, SkillEntry } from "./skills/types.js";

describe("resolveSkillsPromptForRun", () => {
  it("prefers snapshot prompt when available", () => {
    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: { prompt: "SNAPSHOT", skills: [] },
      workspaceDir: "/tmp/openclaw",
    });
    expect(prompt).toBe("SNAPSHOT");
  });
  it("builds prompt from entries when snapshot is missing", () => {
    const entry: SkillEntry = {
      skill: createFixtureSkill({
        name: "demo-skill",
        description: "Demo",
        filePath: "/app/skills/demo-skill/SKILL.md",
        baseDir: "/app/skills/demo-skill",
        source: "openclaw-bundled",
      }),
      frontmatter: {},
    };
    const prompt = resolveSkillsPromptForRun({
      entries: [entry],
      workspaceDir: "/tmp/openclaw",
    });
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("/app/skills/demo-skill/SKILL.md");
  });

  it("rebuilds a compact prompt from resolved snapshot skills for runtime use", () => {
    const skill: ResolvedPromptSkill = {
      ...createFixtureSkill({
        name: "demo-skill",
        description: "Demo description",
        filePath: "/app/skills/demo-skill/SKILL.md",
        baseDir: "/app/skills/demo-skill",
        source: "openclaw-bundled",
      }),
      lightweightSummary: "Use /app/skills/demo-skill/scripts/demo for terse requests.",
      lightweightUsage: "Run /app/skills/demo-skill/scripts/demo add <original text>.",
    };
    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: { prompt: "FULL SNAPSHOT", skills: [], resolvedSkills: [skill] },
      workspaceDir: "/tmp/openclaw",
      promptMode: "compact",
    });

    expect(prompt).not.toBe("FULL SNAPSHOT");
    expect(prompt).toContain("<skill_quick_guide>");
    expect(prompt).toContain("Use /app/skills/demo-skill/scripts/demo for terse requests.");
    expect(prompt).toContain("Run /app/skills/demo-skill/scripts/demo add &lt;original text&gt;.");
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>demo-skill</name>");
    expect(prompt).toContain("/app/skills/demo-skill/SKILL.md");
    expect(prompt).not.toContain("Demo description");
  });

  it("returns an empty prompt when runtime skills are disabled", () => {
    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: { prompt: "SNAPSHOT", skills: [] },
      workspaceDir: "/tmp/openclaw",
      promptMode: "off",
    });

    expect(prompt).toBe("");
  });
});

function createFixtureSkill(params: {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: string;
}): SkillEntry["skill"] {
  return createCanonicalFixtureSkill(params);
}
