import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRuntime } from "./sessions.test-helpers.js";
import { stewardMaintainCommand } from "./steward.js";

process.env.FORCE_COLOR = "0";

function writeTopicNote(params: {
  workspaceDir: string;
  relativePath: string;
  title: string;
  facts: string[];
  evidence: string[];
  sourceCandidates: string[];
}): void {
  const absolutePath = path.join(params.workspaceDir, params.relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    [
      "---",
      'type: "steward-topic-note"',
      'source: "openclaw-steward-curate"',
      'updated_at: "2026-04-02T12:00:00.000Z"',
      "tags:",
      '  - "steward/topic"',
      "---",
      "",
      `# ${params.title}`,
      "",
      "## Durable Facts",
      ...params.facts.map((fact) => `- ${fact}`),
      "",
      "## Supporting Evidence",
      ...params.evidence.map((item) => `- ${item}`),
      "",
      "## Source Candidates",
      ...params.sourceCandidates.map((candidatePath) => `- [[${candidatePath}]]`),
      "",
      "## Related",
      "- [[MEMORY]]",
      "",
    ].join("\n"),
    "utf-8",
  );
}

describe("stewardMaintainCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("splits oversized evidence, rebuilds MEMORY.md, and deletes malformed candidates", async () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "openclaw-steward-maintain-"));
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });

    writeTopicNote({
      workspaceDir,
      relativePath: "memory/topics/user-preferences.md",
      title: "User Preferences",
      facts: ["Prefer concise changelogs.", "Respond in Chinese."],
      evidence: Array.from({ length: 10 }, (_, index) => `user: evidence ${index + 1}`),
      sourceCandidates: ["memory/inbox/2026-04-02/user-preferences-a1b2c3d4"],
    });
    fs.writeFileSync(
      path.join(workspaceDir, "MEMORY.md"),
      "# MEMORY\n\n## Curated Topics\n- [[memory/topics/old-topic|Old Topic]]\n",
      "utf-8",
    );
    const badMemoryCandidate = path.join(
      workspaceDir,
      "memory",
      "inbox",
      "2026-04-02",
      "bad-memory.md",
    );
    fs.mkdirSync(path.dirname(badMemoryCandidate), { recursive: true });
    fs.writeFileSync(badMemoryCandidate, "", "utf-8");
    const badSkillCandidate = path.join(
      workspaceDir,
      "skills",
      "_candidates",
      "2026-04-02",
      "bad-skill.md",
    );
    fs.mkdirSync(path.dirname(badSkillCandidate), { recursive: true });
    fs.writeFileSync(badSkillCandidate, "", "utf-8");

    const { runtime, logs } = makeRuntime();
    try {
      await stewardMaintainCommand(
        {
          workspace: workspaceDir,
          apply: true,
          json: true,
        },
        runtime,
      );

      const payload = JSON.parse(logs[0] ?? "{}") as {
        splitTopics?: number;
        evidenceChunksWritten?: number;
        deletedPaths?: string[];
        memoryIndexUpdated?: boolean;
        ledgerPaths?: string[];
      };

      expect(payload.splitTopics).toBe(1);
      expect(payload.evidenceChunksWritten).toBe(1);
      expect(payload.deletedPaths).toEqual([
        "memory/inbox/2026-04-02/bad-memory.md",
        "skills/_candidates/2026-04-02/bad-skill.md",
      ]);
      expect(payload.memoryIndexUpdated).toBe(true);
      expect(payload.ledgerPaths?.length).toBe(1);

      const topicNote = fs.readFileSync(
        path.join(workspaceDir, "memory", "topics", "user-preferences.md"),
        "utf-8",
      );
      const evidenceChunk = fs.readFileSync(
        path.join(workspaceDir, "memory", "topics", "user-preferences-evidence.md"),
        "utf-8",
      );
      const memoryIndex = fs.readFileSync(path.join(workspaceDir, "MEMORY.md"), "utf-8");
      const ledgerPath = path.join(workspaceDir, "memory", "steward", "runs", "2026-04-02.jsonl");
      const ledgerEntry = JSON.parse(fs.readFileSync(ledgerPath, "utf-8").trim()) as {
        command?: string;
        splitTopics?: number;
      };

      expect(topicNote).toContain("[[memory/topics/user-preferences-evidence]]");
      expect(topicNote).toContain("user: evidence 8");
      expect(topicNote).not.toContain("user: evidence 9");
      expect(evidenceChunk).toContain("user: evidence 9");
      expect(evidenceChunk).toContain("user: evidence 10");
      expect(memoryIndex).toContain("[[memory/topics/user-preferences|User Preferences]]");
      expect(memoryIndex).not.toContain("old-topic");
      expect(fs.existsSync(badMemoryCandidate)).toBe(false);
      expect(fs.existsSync(badSkillCandidate)).toBe(false);
      expect(ledgerEntry.command).toBe("maintain");
      expect(ledgerEntry.splitTopics).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
