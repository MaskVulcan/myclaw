import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KNOWLEDGE_REVIEW_ROOT } from "../agents/knowledge-review-store.js";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../config/config.js";
import { makeRuntime } from "./sessions.test-helpers.js";
import { stewardIngestCommand } from "./steward.js";

process.env.FORCE_COLOR = "0";

function writeTranscript(storePath: string, sessionId: string, lines: unknown[]): string {
  const transcriptPath = path.join(path.dirname(storePath), `${sessionId}.jsonl`);
  fs.writeFileSync(transcriptPath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf-8");
  return transcriptPath;
}

function writeReviewRecord(params: {
  workspaceDir: string;
  sessionId: string;
  title: string;
  summary: string;
  previewItems: string[];
  preferences?: string[];
  commands?: string[];
  tools?: string[];
  suggestedTitle?: string;
  suggestedSlug?: string;
  workflowFingerprint?: string;
}): void {
  const reviewPath = path.join(
    params.workspaceDir,
    KNOWLEDGE_REVIEW_ROOT,
    `${params.sessionId}.json`,
  );
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(
    reviewPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        sessionId: params.sessionId,
        sessionKey: "agent:main:main",
        agentId: "main",
        reviewedAt: new Date("2026-04-02T12:00:00Z").toISOString(),
        title: params.title,
        summary: params.summary,
        tags: ["release", "automation"],
        previewItems: params.previewItems,
        messageCount: 2,
        userMessageCount: 1,
        assistantMessageCount: 1,
        userModel: {
          preferences: params.preferences ?? [],
          contexts: [],
          goals: [],
          notes: [],
        },
        automation: {
          commands: params.commands ?? [],
          tools: params.tools ?? [],
          ...(params.suggestedTitle ? { suggestedTitle: params.suggestedTitle } : {}),
          ...(params.suggestedSlug ? { suggestedSlug: params.suggestedSlug } : {}),
          ...(params.workflowFingerprint
            ? { workflowFingerprint: params.workflowFingerprint }
            : {}),
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

describe("stewardIngestCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T12:00:00Z"));
    clearRuntimeConfigSnapshot();
    clearConfigCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearRuntimeConfigSnapshot();
    clearConfigCache();
  });

  it("emits dry-run JSON without writing staged files", async () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "openclaw-steward-"));
    const workspaceDir = path.join(root, "workspace");
    const sessionsDir = path.join(root, "sessions");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(sessionsDir, { recursive: true });
    const storePath = path.join(sessionsDir, "sessions.json");

    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          "agent:main:main": {
            sessionId: "memory-skill-session",
            updatedAt: Date.now() - 5 * 60_000,
            sessionFile: path.join(sessionsDir, "memory-skill-session.jsonl"),
            model: "pi:opus",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeTranscript(storePath, "memory-skill-session", [
      { type: "session", version: 1, id: "memory-skill-session" },
      { message: { role: "user", content: "记住我偏好中文而且要简洁。" } },
      {
        message: {
          role: "user",
          content:
            "这个流程之后要自动化，命令先用 `openclaw status --json`，再 `git push origin main`。",
        },
      },
      { message: { role: "assistant", content: "好的，我会先做候选梳理。" } },
    ]);

    const { runtime, logs } = makeRuntime();
    try {
      await stewardIngestCommand(
        {
          store: storePath,
          workspace: workspaceDir,
          recent: "3",
          json: true,
        },
        runtime,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    const payload = JSON.parse(logs[0] ?? "{}") as {
      mode?: string;
      memoryCandidates?: number;
      skillCandidates?: number;
      ledgerPaths?: string[];
      sessions?: Array<{
        decision?: string;
        memoryCandidate?: { path?: string } | null;
        skillCandidate?: { path?: string } | null;
      }>;
    };

    expect(payload.mode).toBe("dry-run");
    expect(payload.memoryCandidates).toBe(1);
    expect(payload.skillCandidates).toBe(1);
    expect(payload.ledgerPaths).toEqual([]);
    expect(payload.sessions?.[0]?.decision).toBe("keep");
    expect(payload.sessions?.[0]?.memoryCandidate?.path).toContain("memory/inbox/2026-04-02/");
    expect(payload.sessions?.[0]?.skillCandidate?.path).toContain("skills/_candidates/2026-04-02/");
    expect(fs.existsSync(path.join(workspaceDir, "memory"))).toBe(false);
    expect(fs.existsSync(path.join(workspaceDir, "skills"))).toBe(false);
  });

  it("writes candidates and ledger when --apply is enabled", async () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "openclaw-steward-apply-"));
    const workspaceDir = path.join(root, "workspace");
    const sessionsDir = path.join(root, "sessions");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(sessionsDir, { recursive: true });
    const storePath = path.join(sessionsDir, "sessions.json");

    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          "agent:main:main": {
            sessionId: "apply-session",
            updatedAt: Date.now() - 3 * 60_000,
            sessionFile: path.join(sessionsDir, "apply-session.jsonl"),
            model: "pi:opus",
          },
          chatter: {
            sessionId: "discard-session",
            updatedAt: Date.now() - 2 * 60_000,
            sessionFile: path.join(sessionsDir, "discard-session.jsonl"),
            model: "pi:opus",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeTranscript(storePath, "apply-session", [
      { type: "session", version: 1, id: "apply-session" },
      { message: { role: "user", content: "Remember that I prefer concise changelogs." } },
      {
        message: {
          role: "user",
          content: "We should automate release checks with `openclaw status --json`.",
        },
      },
      {
        message: {
          role: "assistant",
          content: [
            { type: "tool_call", name: "exec" },
            { type: "text", text: "Ran checks." },
          ],
        },
      },
    ]);
    writeReviewRecord({
      workspaceDir,
      sessionId: "apply-session",
      title: "Release Checks Session",
      summary: "Automate release checks with openclaw status before pushing.",
      previewItems: ["Use `openclaw status --json` before `git push origin main`."],
      preferences: ["Remember that I prefer concise changelogs."],
      commands: ["openclaw status --json"],
      tools: ["exec"],
      suggestedTitle: "Release Checks",
      suggestedSlug: "release-checks",
      workflowFingerprint: "fp-release-checks",
    });
    writeTranscript(storePath, "discard-session", [
      { type: "session", version: 1, id: "discard-session" },
      { message: { role: "user", content: "hello there" } },
      { message: { role: "assistant", content: "general kenobi" } },
    ]);

    const { runtime, logs } = makeRuntime();
    try {
      await stewardIngestCommand(
        {
          store: storePath,
          workspace: workspaceDir,
          recent: "5",
          apply: true,
          json: true,
        },
        runtime,
      );
      const payload = JSON.parse(logs[0] ?? "{}") as {
        sessions?: Array<{ key?: string; workspaceDir?: string; decision?: string }>;
        ledgerPaths?: string[];
      };
      const keepSession = payload.sessions?.find((session) => session.key === "agent:main:main");
      expect(keepSession?.decision).toBe("keep");
      expect(keepSession?.workspaceDir).toBe(workspaceDir);
      expect(payload.sessions?.find((session) => session.key === "chatter")?.decision).toBe(
        "discard",
      );

      const inboxDir = path.join(workspaceDir, "memory", "inbox", "2026-04-02");
      const skillDir = path.join(workspaceDir, "skills", "_candidates", "2026-04-02");
      const ledgerPath = path.join(workspaceDir, "memory", "steward", "runs", "2026-04-02.jsonl");

      const inboxFiles = fs.readdirSync(inboxDir);
      const skillFiles = fs.readdirSync(skillDir);
      expect(inboxFiles.length).toBe(1);
      expect(skillFiles.length).toBe(1);
      expect(skillFiles[0]).toContain("release-checks");
      expect(fs.existsSync(ledgerPath)).toBe(true);

      const memoryNote = fs.readFileSync(path.join(inboxDir, inboxFiles[0]), "utf-8");
      const skillNote = fs.readFileSync(path.join(skillDir, skillFiles[0]), "utf-8");
      const ledgerLines = fs.readFileSync(ledgerPath, "utf-8").trim().split("\n");
      const ledgerEntry = JSON.parse(ledgerLines[0] ?? "{}") as {
        keptCount?: number;
        discardedCount?: number;
        memoryCandidates?: string[];
        skillCandidates?: string[];
      };

      expect(memoryNote).toContain("steward-memory-candidate");
      expect(memoryNote).toContain("prefer concise changelogs");
      expect(memoryNote).toContain("[[MEMORY]]");
      expect(skillNote).toContain("steward-skill-candidate");
      expect(skillNote).toContain('suggested_title: "Release Checks"');
      expect(skillNote).toContain('suggested_slug: "release-checks"');
      expect(skillNote).toContain('workflow_fingerprint: "fp-release-checks"');
      expect(skillNote).toContain("Suggested title: `Release Checks`");
      expect(skillNote).toContain("openclaw status --json");
      expect(skillNote).toContain("## Observed Tools");
      expect(skillNote).toContain("`exec`");
      expect(ledgerEntry.keptCount).toBe(1);
      expect(ledgerEntry.discardedCount).toBe(1);
      expect(ledgerEntry.memoryCandidates?.length).toBe(1);
      expect(ledgerEntry.skillCandidates?.length).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
