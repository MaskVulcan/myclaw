import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../config/config.js";
import { makeRuntime } from "./sessions.test-helpers.js";
import { stewardCycleCommand } from "./steward.js";

process.env.FORCE_COLOR = "0";

function writeTranscript(storePath: string, sessionId: string, lines: unknown[]): string {
  const transcriptPath = path.join(path.dirname(storePath), `${sessionId}.jsonl`);
  fs.writeFileSync(transcriptPath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf-8");
  return transcriptPath;
}

describe("stewardCycleCommand", () => {
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

  it("produces a meaningful dry-run pipeline without mutating the real workspace", async () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "openclaw-steward-cycle-"));
    const workspaceDir = path.join(root, "workspace");
    const sessionsDir = path.join(root, "sessions");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(sessionsDir, { recursive: true });
    const storePath = path.join(sessionsDir, "sessions.json");

    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          "agent:main:first": {
            sessionId: "cycle-session-1",
            updatedAt: Date.now() - 5 * 60_000,
            sessionFile: path.join(sessionsDir, "cycle-session-1.jsonl"),
            model: "pi:opus",
          },
          "agent:main:second": {
            sessionId: "cycle-session-2",
            updatedAt: Date.now() - 3 * 60_000,
            sessionFile: path.join(sessionsDir, "cycle-session-2.jsonl"),
            model: "pi:opus",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeTranscript(storePath, "cycle-session-1", [
      { type: "session", version: 1, id: "cycle-session-1" },
      {
        message: {
          role: "user",
          content: "Remember concise Chinese release-check workflow preferences.",
        },
      },
      {
        message: {
          role: "user",
          content: "Automate it with `openclaw status --json` and `git push origin main`.",
        },
      },
    ]);
    writeTranscript(storePath, "cycle-session-2", [
      { type: "session", version: 1, id: "cycle-session-2" },
      {
        message: {
          role: "user",
          content: "Remember concise Chinese release-check workflow preferences.",
        },
      },
      {
        message: {
          role: "user",
          content: "Keep the release-check workflow reusable and automate it again.",
        },
      },
    ]);

    const { runtime, logs } = makeRuntime();
    try {
      await stewardCycleCommand(
        {
          store: storePath,
          workspace: workspaceDir,
          recent: "5",
          json: true,
        },
        runtime,
      );

      const payload = JSON.parse(logs[0] ?? "{}") as {
        mode?: string;
        workspaceDir?: string | null;
        ingest?: { memoryCandidates?: number; skillCandidates?: number; ledgerPaths?: string[] };
        curate?: { createdNotes?: number; ledgerPaths?: string[] };
        maintain?: { ledgerPaths?: string[] };
        incubateSkills?: { readyClusters?: number; ledgerPaths?: string[] };
        promoteSkills?: { promotedSkills?: number; ledgerPaths?: string[] };
      };

      expect(payload.mode).toBe("dry-run");
      expect(payload.workspaceDir).toBe(workspaceDir);
      expect(payload.ingest?.memoryCandidates).toBe(2);
      expect(payload.ingest?.skillCandidates).toBe(2);
      expect(payload.curate?.createdNotes).toBe(1);
      expect(payload.incubateSkills?.readyClusters).toBe(1);
      expect(payload.promoteSkills?.promotedSkills).toBe(1);
      expect(payload.ingest?.ledgerPaths).toEqual([]);
      expect(payload.curate?.ledgerPaths).toEqual([]);
      expect(payload.maintain?.ledgerPaths).toEqual([]);
      expect(payload.incubateSkills?.ledgerPaths).toEqual([]);
      expect(payload.promoteSkills?.ledgerPaths).toEqual([]);
      expect(fs.existsSync(path.join(workspaceDir, "memory"))).toBe(false);
      expect(fs.existsSync(path.join(workspaceDir, "skills"))).toBe(false);
      expect(fs.existsSync(path.join(workspaceDir, "MEMORY.md"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
