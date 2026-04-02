import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRuntime } from "./sessions.test-helpers.js";
import { stewardCurateCommand } from "./steward.js";

process.env.FORCE_COLOR = "0";

function writeMemoryCandidate(params: {
  workspaceDir: string;
  relativePath: string;
  title: string;
  facts: string[];
  evidence: string[];
}): void {
  const absolutePath = path.join(params.workspaceDir, params.relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    [
      "---",
      'type: "steward-memory-candidate"',
      'source: "openclaw-steward-ingest"',
      'agent_id: "main"',
      'session_key: "agent:main:main"',
      'session_id: "session-test"',
      'session_kind: "direct"',
      'updated_at: "2026-04-02T12:00:00.000Z"',
      "tags:",
      '  - "steward/inbox"',
      '  - "candidate/memory"',
      "---",
      "",
      `# ${params.title}`,
      "",
      "## Candidate Durable Facts",
      ...params.facts.map((fact) => `- ${fact}`),
      "",
      "## Evidence",
      ...params.evidence.map((item) => `- ${item}`),
      "",
      "## Suggested Links",
      "- [[MEMORY]]",
      "",
    ].join("\n"),
    "utf-8",
  );
}

describe("stewardCurateCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits a dry-run plan without writing curated notes", async () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "openclaw-steward-curate-"));
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    writeMemoryCandidate({
      workspaceDir,
      relativePath: "memory/inbox/2026-04-02/user-preferences-a1b2c3d4.md",
      title: "User Preferences",
      facts: ["Prefer concise changelogs.", "Respond in Chinese."],
      evidence: ["user: Remember that I prefer concise changelogs."],
    });

    const { runtime, logs } = makeRuntime();
    try {
      await stewardCurateCommand(
        {
          workspace: workspaceDir,
          limit: "10",
          json: true,
        },
        runtime,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    const payload = JSON.parse(logs[0] ?? "{}") as {
      mode?: string;
      workspaceDir?: string;
      scannedCandidates?: number;
      curatedCandidates?: number;
      createdNotes?: number;
      updatedNotes?: number;
      memoryIndexUpdated?: boolean;
      candidates?: Array<{ action?: string; targetPath?: string }>;
    };

    expect(payload.mode).toBe("dry-run");
    expect(payload.workspaceDir).toBe(workspaceDir);
    expect(payload.scannedCandidates).toBe(1);
    expect(payload.curatedCandidates).toBe(1);
    expect(payload.createdNotes).toBe(1);
    expect(payload.updatedNotes).toBe(0);
    expect(payload.memoryIndexUpdated).toBe(true);
    expect(payload.candidates?.[0]?.action).toBe("create");
    expect(payload.candidates?.[0]?.targetPath).toBe("memory/topics/user-preferences.md");
    expect(fs.existsSync(path.join(workspaceDir, "memory", "topics"))).toBe(false);
    expect(fs.existsSync(path.join(workspaceDir, "MEMORY.md"))).toBe(false);
  });

  it("merges staged candidates into curated topic notes and updates MEMORY.md", async () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "openclaw-steward-curate-apply-"),
    );
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    writeMemoryCandidate({
      workspaceDir,
      relativePath: "memory/inbox/2026-04-02/user-preferences-a1b2c3d4.md",
      title: "User Preferences",
      facts: ["Prefer concise changelogs.", "Respond in Chinese."],
      evidence: ["user: Remember that I prefer concise changelogs."],
    });
    writeMemoryCandidate({
      workspaceDir,
      relativePath: "memory/inbox/2026-04-03/user-preferences-e5f6g7h8.md",
      title: "User Preferences",
      facts: ["Respond in Chinese.", "Avoid UI-heavy flows."],
      evidence: ["user: Avoid UI-heavy workflows when automation is enough."],
    });
    const existingTopicPath = path.join(workspaceDir, "memory", "topics", "user-preferences.md");
    fs.mkdirSync(path.dirname(existingTopicPath), { recursive: true });
    fs.writeFileSync(
      existingTopicPath,
      [
        "---",
        'type: "steward-topic-note"',
        "---",
        "",
        "# User Preferences",
        "",
        "## Durable Facts",
        "- Prefer concise changelogs.",
        "",
        "## Supporting Evidence",
        "- user: Prefer concise changelogs.",
        "",
        "## Source Candidates",
        "- [[memory/inbox/2026-04-01/user-preferences-old1111]]",
        "",
        "## Related",
        "- [[MEMORY]]",
        "",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(workspaceDir, "MEMORY.md"),
      "# MEMORY\n\n## Curated Topics\n- [[memory/topics/user-preferences|User Preferences]]\n",
      "utf-8",
    );

    const { runtime, logs } = makeRuntime();
    try {
      await stewardCurateCommand(
        {
          workspace: workspaceDir,
          limit: "10",
          apply: true,
          json: true,
        },
        runtime,
      );

      const payload = JSON.parse(logs[0] ?? "{}") as {
        createdNotes?: number;
        updatedNotes?: number;
        memoryIndexUpdated?: boolean;
        ledgerPaths?: string[];
      };

      expect(payload.createdNotes).toBe(0);
      expect(payload.updatedNotes).toBe(1);
      expect(payload.memoryIndexUpdated).toBe(false);
      expect(payload.ledgerPaths?.length).toBe(1);

      const topicNote = fs.readFileSync(existingTopicPath, "utf-8");
      const memoryIndex = fs.readFileSync(path.join(workspaceDir, "MEMORY.md"), "utf-8");
      const ledgerPath = path.join(workspaceDir, "memory", "steward", "runs", "2026-04-02.jsonl");
      const ledgerEntry = JSON.parse(fs.readFileSync(ledgerPath, "utf-8").trim()) as {
        command?: string;
        createdNotes?: number;
        updatedNotes?: number;
      };

      expect(topicNote).toContain("Respond in Chinese.");
      expect(topicNote).toContain("Avoid UI-heavy flows.");
      expect(topicNote).toContain("[[memory/inbox/2026-04-02/user-preferences-a1b2c3d4]]");
      expect(topicNote).toContain("[[memory/inbox/2026-04-03/user-preferences-e5f6g7h8]]");
      expect(topicNote.match(/^- Prefer concise changelogs\.$/gmu)?.length).toBe(1);
      expect(
        memoryIndex.match(/\[\[memory\/topics\/user-preferences\|User Preferences\]\]/g)?.length,
      ).toBe(1);
      expect(ledgerEntry.command).toBe("curate");
      expect(ledgerEntry.createdNotes).toBe(0);
      expect(ledgerEntry.updatedNotes).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
