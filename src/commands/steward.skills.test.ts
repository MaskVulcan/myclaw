import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRuntime } from "./sessions.test-helpers.js";
import { stewardIncubateSkillsCommand, stewardPromoteSkillsCommand } from "./steward.js";

process.env.FORCE_COLOR = "0";

function writeSkillCandidate(params: {
  workspaceDir: string;
  relativePath: string;
  title: string;
  slug: string;
  workflowFingerprint?: string;
  signals: string[];
  commands: string[];
  tools: string[];
  evidence: string[];
}): void {
  const absolutePath = path.join(params.workspaceDir, params.relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    [
      "---",
      'type: "steward-skill-candidate"',
      'source: "openclaw-steward-ingest"',
      'agent_id: "main"',
      'session_key: "agent:main:main"',
      'session_id: "session-test"',
      'updated_at: "2026-04-02T12:00:00.000Z"',
      `suggested_title: ${JSON.stringify(params.title)}`,
      `suggested_slug: ${JSON.stringify(params.slug)}`,
      ...(params.workflowFingerprint
        ? [`workflow_fingerprint: ${JSON.stringify(params.workflowFingerprint)}`]
        : []),
      "tags:",
      '  - "steward/skills"',
      '  - "candidate/skill"',
      "---",
      "",
      `# Skill Candidate: ${params.title}`,
      "",
      "## Why This Looks Reusable",
      ...params.signals.map((signal) => `- ${signal}`),
      "",
      "## Observed Commands",
      ...params.commands.map((command) => `- \`${command}\``),
      "",
      "## Observed Tools",
      ...params.tools.map((toolName) => `- \`${toolName}\``),
      "",
      "## Proposed Promotion Sketch",
      `- Suggested title: \`${params.title}\``,
      `- Suggested slug: \`${params.slug}\``,
      "- Candidate output target: `skills/<slug>/SKILL.md`",
      "",
      "## Evidence",
      ...params.evidence.map((item) => `- ${item}`),
      "",
    ].join("\n"),
    "utf-8",
  );
}

describe("steward skill automation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clusters repeated skill candidates in dry-run mode", async () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "openclaw-steward-skills-"));
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });

    writeSkillCandidate({
      workspaceDir,
      relativePath: "skills/_candidates/2026-04-02/release-checks-a1.md",
      title: "Release Checks",
      slug: "release-checks",
      signals: ["Automate release checks for every deploy."],
      commands: ["openclaw status --json"],
      tools: ["exec"],
      evidence: ["user: automate release checks"],
    });
    writeSkillCandidate({
      workspaceDir,
      relativePath: "skills/_candidates/2026-04-03/release-checks-b2.md",
      title: "Release Checks",
      slug: "release-checks",
      signals: ["Keep release checks as a reusable CLI workflow."],
      commands: ["git push origin main"],
      tools: ["exec"],
      evidence: ["user: reuse the release-check workflow"],
    });

    const { runtime, logs } = makeRuntime();
    try {
      await stewardIncubateSkillsCommand(
        {
          workspace: workspaceDir,
          limit: "10",
          json: true,
        },
        runtime,
      );

      const payload = JSON.parse(logs[0] ?? "{}") as {
        mode?: string;
        scannedCandidates?: number;
        incubators?: number;
        readyClusters?: number;
        clusters?: Array<{ slug?: string; action?: string; targetPath?: string }>;
      };

      expect(payload.mode).toBe("dry-run");
      expect(payload.scannedCandidates).toBe(2);
      expect(payload.incubators).toBe(1);
      expect(payload.readyClusters).toBe(1);
      expect(payload.clusters?.[0]).toEqual(
        expect.objectContaining({
          slug: "release-checks",
          action: "create",
          targetPath: "skills/_incubator/release-checks.md",
        }),
      );
      expect(fs.existsSync(path.join(workspaceDir, "skills", "_incubator"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("clusters by workflow fingerprint before falling back to slug", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "openclaw-steward-skills-fingerprint-"),
    );
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });

    writeSkillCandidate({
      workspaceDir,
      relativePath: "skills/_candidates/2026-04-02/release-checks-a1.md",
      title: "Release Checks",
      slug: "release-checks",
      workflowFingerprint: "fp-release-checks",
      signals: ["Automate release checks for every deploy."],
      commands: ["openclaw status --json"],
      tools: ["exec"],
      evidence: ["user: automate release checks"],
    });
    writeSkillCandidate({
      workspaceDir,
      relativePath: "skills/_candidates/2026-04-03/deploy-checks-b2.md",
      title: "Deploy Checks",
      slug: "deploy-checks",
      workflowFingerprint: "fp-release-checks",
      signals: ["Keep deploy checks reusable as the same workflow."],
      commands: ["openclaw status --json"],
      tools: ["exec"],
      evidence: ["user: reuse the workflow"],
    });

    const { runtime, logs } = makeRuntime();
    try {
      await stewardIncubateSkillsCommand(
        {
          workspace: workspaceDir,
          limit: "10",
          json: true,
        },
        runtime,
      );

      const payload = JSON.parse(logs[0] ?? "{}") as {
        incubators?: number;
        readyClusters?: number;
        clusters?: Array<{ slug?: string; candidateCount?: number; targetPath?: string }>;
      };

      expect(payload.incubators).toBe(1);
      expect(payload.readyClusters).toBe(1);
      expect(payload.clusters?.[0]).toEqual(
        expect.objectContaining({
          slug: "deploy-checks",
          candidateCount: 2,
          targetPath: "skills/_incubator/deploy-checks.md",
        }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("promotes ready incubators into real skills", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "openclaw-steward-skills-apply-"),
    );
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });

    writeSkillCandidate({
      workspaceDir,
      relativePath: "skills/_candidates/2026-04-02/release-checks-a1.md",
      title: "Release Checks",
      slug: "release-checks",
      signals: ["Automate release checks for every deploy."],
      commands: ["openclaw status --json"],
      tools: ["exec"],
      evidence: ["user: automate release checks"],
    });
    writeSkillCandidate({
      workspaceDir,
      relativePath: "skills/_candidates/2026-04-03/release-checks-b2.md",
      title: "Release Checks",
      slug: "release-checks",
      signals: ["Keep release checks as a reusable CLI workflow."],
      commands: ["git push origin main"],
      tools: ["exec"],
      evidence: ["user: reuse the release-check workflow"],
    });

    const incubateRuntime = makeRuntime();
    const promoteRuntime = makeRuntime();
    try {
      await stewardIncubateSkillsCommand(
        {
          workspace: workspaceDir,
          limit: "10",
          apply: true,
          json: true,
        },
        incubateRuntime.runtime,
      );
      await stewardPromoteSkillsCommand(
        {
          workspace: workspaceDir,
          limit: "10",
          minCandidates: "2",
          apply: true,
          json: true,
        },
        promoteRuntime.runtime,
      );

      const promotePayload = JSON.parse(promoteRuntime.logs[0] ?? "{}") as {
        promotedSkills?: number;
        updatedSkills?: number;
        skippedClusters?: number;
        ledgerPaths?: string[];
      };
      const incubatorPath = path.join(workspaceDir, "skills", "_incubator", "release-checks.md");
      const skillPath = path.join(workspaceDir, "skills", "release-checks", "SKILL.md");

      expect(promotePayload.promotedSkills).toBe(1);
      expect(promotePayload.updatedSkills).toBe(0);
      expect(promotePayload.skippedClusters).toBe(0);
      expect(promotePayload.ledgerPaths?.length).toBe(1);
      expect(fs.existsSync(incubatorPath)).toBe(true);
      expect(fs.existsSync(skillPath)).toBe(true);

      const incubator = fs.readFileSync(incubatorPath, "utf-8");
      const skill = fs.readFileSync(skillPath, "utf-8");
      expect(incubator).toContain("[[skills/_candidates/2026-04-02/release-checks-a1]]");
      expect(incubator).toContain("[[skills/_candidates/2026-04-03/release-checks-b2]]");
      expect(skill).toContain('name: "release-checks"');
      expect(skill).toContain('progressive-disclosure: "capabilities-first"');
      expect(skill).toContain(
        'capability-summary: "Prefer structured capabilities and inspect schema on demand before running commands."',
      );
      expect(skill).toContain("## Suggested Workflow");
      expect(skill).toContain("## Structured Capabilities");
      expect(skill).toContain("openclaw capabilities list");
      expect(skill).toContain("[[skills/_candidates/2026-04-02/release-checks-a1]]");
      expect(skill).toContain("[[skills/_candidates/2026-04-03/release-checks-b2]]");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
