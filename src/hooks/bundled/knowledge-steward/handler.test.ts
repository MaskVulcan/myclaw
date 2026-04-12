import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  KNOWLEDGE_REVIEW_NUDGE_ROOT,
  KNOWLEDGE_REVIEW_ROOT,
  type KnowledgeReviewNudge,
  type KnowledgeReviewRecord,
} from "../../../agents/knowledge-review-store.js";
import type { OpenClawConfig } from "../../../config/config.js";
import type { SessionEntry } from "../../../config/sessions.js";
import { createHookEvent } from "../../hooks.js";

let handler: typeof import("./handler.js").default;
let suiteWorkspaceRoot = "";
let workspaceCaseCounter = 0;

async function createCaseWorkspace(prefix = "case"): Promise<string> {
  const dir = path.join(suiteWorkspaceRoot, `${prefix}-${workspaceCaseCounter}`);
  workspaceCaseCounter += 1;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function createConfig(workspaceDir: string): OpenClawConfig {
  return {
    agents: {
      defaults: {
        workspace: workspaceDir,
      },
    },
  } satisfies OpenClawConfig;
}

async function runKnowledgeStewardHook(params: {
  workspaceDir: string;
  sessionKey?: string;
  action?: "new" | "reset" | "compact:after";
  type?: "command" | "session";
  previousSessionEntry: SessionEntry;
  cfg?: OpenClawConfig;
  context?: Record<string, unknown>;
}) {
  const event = createHookEvent(
    params.type ?? "command",
    params.action ?? "new",
    params.sessionKey ?? "agent:main:main",
    {
      cfg: params.cfg ?? createConfig(params.workspaceDir),
      workspaceDir: params.workspaceDir,
      previousSessionEntry: params.previousSessionEntry,
      ...params.context,
    },
  );
  await handler(event);
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await listFilesRecursive(fullPath)));
        continue;
      }
      out.push(fullPath);
    }
    return out;
  } catch {
    return [];
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
}

beforeAll(async () => {
  ({ default: handler } = await import("./handler.js"));
  suiteWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-knowledge-steward-"));
});

afterAll(async () => {
  if (!suiteWorkspaceRoot) {
    return;
  }
  await fs.rm(suiteWorkspaceRoot, { recursive: true, force: true });
  suiteWorkspaceRoot = "";
  workspaceCaseCounter = 0;
});

describe("knowledge-steward hook", () => {
  it("ingests the previous session and maintains curated memory automatically", async () => {
    const workspaceDir = await createCaseWorkspace("workspace");
    const sessionFile = path.join(workspaceDir, "sessions", "steward-session-1.jsonl");
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(
      sessionFile,
      [
        { type: "session", version: 1, id: "steward-session-1" },
        { message: { role: "user", content: "Remember that I prefer concise Chinese updates." } },
        {
          message: {
            role: "user",
            content: "Automate release checks with `openclaw status --json`.",
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf-8",
    );

    await runKnowledgeStewardHook({
      workspaceDir,
      previousSessionEntry: {
        sessionId: "steward-session-1",
        sessionFile,
        updatedAt: Date.now(),
      },
    });

    const topicFiles = await listFilesRecursive(path.join(workspaceDir, "memory", "topics"));
    const inboxFiles = await listFilesRecursive(path.join(workspaceDir, "memory", "inbox"));
    const incubatorFiles = await listFilesRecursive(
      path.join(workspaceDir, "skills", "_incubator"),
    );
    const skillFiles = await listFilesRecursive(path.join(workspaceDir, "skills"));
    const memoryIndex = await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf-8");
    const ledgerPath = path.join(workspaceDir, "memory", "steward", "runs");
    const ledgerFiles = await listFilesRecursive(ledgerPath);
    const reviewPath = path.join(workspaceDir, KNOWLEDGE_REVIEW_ROOT, "steward-session-1.json");
    const review = await readJsonFile<KnowledgeReviewRecord>(reviewPath);

    expect(topicFiles.length).toBe(1);
    expect(inboxFiles.length).toBe(1);
    expect(incubatorFiles.length).toBe(1);
    expect(skillFiles.filter((file) => file.endsWith("SKILL.md")).length).toBe(0);
    expect(memoryIndex).toContain("Curated Topics");
    expect(ledgerFiles.length).toBe(1);
    expect(review.sessionId).toBe("steward-session-1");
    expect(review.userModel.preferences).toContain(
      "Remember that I prefer concise Chinese updates.",
    );
    expect(review.automation.commands).toContain("openclaw status --json");

    const topicNote = await fs.readFile(topicFiles[0], "utf-8");
    const incubatorNote = await fs.readFile(incubatorFiles[0], "utf-8");
    expect(topicNote).toContain("Remember that I prefer concise Chinese updates.");
    expect(topicNote).toContain("## Durable Facts");
    expect(incubatorNote).toContain("openclaw status --json");
  });

  it("promotes a skill after repeated sessions confirm the workflow", async () => {
    const workspaceDir = await createCaseWorkspace("workspace");
    const firstSessionFile = path.join(workspaceDir, "sessions", "release-1.jsonl");
    const secondSessionFile = path.join(workspaceDir, "sessions", "release-2.jsonl");
    await fs.mkdir(path.dirname(firstSessionFile), { recursive: true });
    await fs.writeFile(
      firstSessionFile,
      [
        { type: "session", version: 1, id: "release-1" },
        { message: { role: "user", content: "Remember release checks should stay concise." } },
        {
          message: {
            role: "user",
            content:
              "Automate release checks with `openclaw status --json` and `git push origin main`.",
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      secondSessionFile,
      [
        { type: "session", version: 1, id: "release-2" },
        { message: { role: "user", content: "Remember release checks should stay concise." } },
        {
          message: {
            role: "user",
            content:
              "Keep the release checks reusable as a CLI workflow with `openclaw status --json`.",
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf-8",
    );

    await runKnowledgeStewardHook({
      workspaceDir,
      previousSessionEntry: {
        sessionId: "release-1",
        sessionFile: firstSessionFile,
        updatedAt: Date.now() - 60_000,
      },
    });
    await runKnowledgeStewardHook({
      workspaceDir,
      previousSessionEntry: {
        sessionId: "release-2",
        sessionFile: secondSessionFile,
        updatedAt: Date.now(),
      },
    });

    const promotedSkillFiles = (await listFilesRecursive(path.join(workspaceDir, "skills"))).filter(
      (file) => file.endsWith("SKILL.md") && !file.includes("/_incubator/"),
    );
    const firstReview = await readJsonFile<KnowledgeReviewRecord>(
      path.join(workspaceDir, KNOWLEDGE_REVIEW_ROOT, "release-1.json"),
    );
    const secondReview = await readJsonFile<KnowledgeReviewRecord>(
      path.join(workspaceDir, KNOWLEDGE_REVIEW_ROOT, "release-2.json"),
    );

    expect(promotedSkillFiles.length).toBe(1);
    expect(firstReview.automation.commands).toContain("openclaw status --json");
    expect(secondReview.automation.commands).toContain("openclaw status --json");
    const skillContent = await fs.readFile(promotedSkillFiles[0], "utf-8");
    expect(skillContent).toContain("## Suggested Workflow");
    expect(skillContent).toContain("## Source Candidates");
    expect(skillContent).toContain("openclaw status --json");
  });

  it("writes a compact-after review nudge without running the full steward cycle", async () => {
    const workspaceDir = await createCaseWorkspace("workspace");
    const sessionFile = path.join(workspaceDir, "sessions", "compacted-session-1.jsonl");
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, "", "utf-8");

    await runKnowledgeStewardHook({
      workspaceDir,
      type: "session",
      action: "compact:after",
      previousSessionEntry: {
        sessionId: "placeholder",
      },
      context: {
        agentId: "main",
        sessionId: "compacted-session-1",
        sessionFile,
      },
    });

    const nudgePath = path.join(
      workspaceDir,
      KNOWLEDGE_REVIEW_NUDGE_ROOT,
      "compacted-session-1.json",
    );
    const nudge = await readJsonFile<KnowledgeReviewNudge>(nudgePath);
    const reviewPath = path.join(workspaceDir, KNOWLEDGE_REVIEW_ROOT, "compacted-session-1.json");

    expect(nudge.sessionId).toBe("compacted-session-1");
    expect(nudge.transcriptFile).toBe(sessionFile);
    expect(nudge.reasons).toEqual(["session:compact:after"]);
    await expect(fs.stat(reviewPath)).rejects.toThrow();
  });
});
