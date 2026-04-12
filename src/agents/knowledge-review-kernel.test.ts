import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  runSessionStewardCycle: vi.fn(async () => ({
    keptSessions: 1,
    memoryCandidates: 2,
    skillCandidates: 1,
  })),
}));

vi.mock("./memory-provider-kernel.js", () => ({
  resolveDefaultMemoryProviderKernel: () => ({
    runSessionStewardCycle: (...args: unknown[]) => hoisted.runSessionStewardCycle(...args),
  }),
}));

let resolveDefaultKnowledgeReviewKernel: typeof import("./knowledge-review-kernel.js").resolveDefaultKnowledgeReviewKernel;
let loadKnowledgeReviewRecord: typeof import("./knowledge-review-store.js").loadKnowledgeReviewRecord;
let loadKnowledgeReviewNudge: typeof import("./knowledge-review-store.js").loadKnowledgeReviewNudge;
let suiteWorkspaceRoot = "";
let workspaceCaseCounter = 0;

async function createCaseWorkspace(prefix = "case"): Promise<string> {
  const dir = path.join(suiteWorkspaceRoot, `${prefix}-${workspaceCaseCounter}`);
  workspaceCaseCounter += 1;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeTranscript(
  workspaceDir: string,
  sessionId: string,
  lines: unknown[],
): Promise<string> {
  const sessionFile = path.join(workspaceDir, "sessions", `${sessionId}.jsonl`);
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await fs.writeFile(
    sessionFile,
    [{ type: "session", version: 1, id: sessionId }, ...lines]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf-8",
  );
  return sessionFile;
}

beforeEach(async () => {
  vi.resetModules();
  hoisted.runSessionStewardCycle.mockReset();
  hoisted.runSessionStewardCycle.mockResolvedValue({
    keptSessions: 1,
    memoryCandidates: 2,
    skillCandidates: 1,
  });

  ({ resolveDefaultKnowledgeReviewKernel } = await import("./knowledge-review-kernel.js"));
  ({ loadKnowledgeReviewRecord, loadKnowledgeReviewNudge } =
    await import("./knowledge-review-store.js"));

  if (!suiteWorkspaceRoot) {
    suiteWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-knowledge-review-"));
  }
});

afterAll(async () => {
  if (!suiteWorkspaceRoot) {
    return;
  }
  await fs.rm(suiteWorkspaceRoot, { recursive: true, force: true });
  suiteWorkspaceRoot = "";
  workspaceCaseCounter = 0;
});

describe("knowledge-review-kernel", () => {
  it("writes a review record with user and automation signals and clears stale nudges", async () => {
    const workspaceDir = await createCaseWorkspace("workspace");
    const sessionId = "review-session-1";
    const sessionFile = await writeTranscript(workspaceDir, sessionId, [
      {
        message: {
          role: "user",
          content: [
            "我叫小王",
            "时区: Asia/Shanghai",
            "请用中文回复，保持简洁。",
            "当前项目是 myclaw 知识环重构。",
            "目标：把 session search 做好。",
          ].join("\n"),
        },
      },
      {
        message: {
          role: "assistant",
          toolName: "exec_command",
          content: [
            {
              type: "tool_call",
              name: "memory_search",
            },
            {
              type: "text",
              text: "接下来跑 `openclaw status --json`。",
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: "已经整理 roadmap 和实现顺序。",
        },
      },
    ]);

    const kernel = resolveDefaultKnowledgeReviewKernel();
    await kernel.nudgeSession({
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionId,
      transcriptFile: sessionFile,
      reason: "session:compact:after",
    });

    const result = await kernel.reviewSession({
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      entry: {
        sessionId,
        sessionFile,
        updatedAt: Date.now(),
      },
    });

    expect(result).not.toBeNull();
    expect(result?.recordPath).toContain(`${sessionId}.json`);
    expect(result?.record.title).toBe("我叫小王");
    expect(result?.record.userModel.name).toBe("小王");
    expect(result?.record.userModel.timezone).toBe("Asia/Shanghai");
    expect(result?.record.userModel.preferences).toContain("请用中文回复，保持简洁。");
    expect(result?.record.userModel.contexts).toContain("当前项目是 myclaw 知识环重构。");
    expect(result?.record.userModel.goals).toContain("目标：把 session search 做好。");
    expect(result?.record.automation.commands).toContain("openclaw status --json");
    expect(result?.record.automation.tools).toEqual(
      expect.arrayContaining(["exec_command", "memory_search"]),
    );
    expect(result?.record.previewItems.length).toBeGreaterThan(0);

    const persistedRecord = await loadKnowledgeReviewRecord(workspaceDir, sessionId);
    const persistedNudge = await loadKnowledgeReviewNudge(workspaceDir, sessionId);
    expect(persistedRecord?.sessionId).toBe(sessionId);
    expect(persistedNudge).toBeNull();
  });

  it("writes the review before delegating to the steward cycle", async () => {
    const workspaceDir = await createCaseWorkspace("workspace");
    const sessionId = "review-session-2";
    const sessionFile = await writeTranscript(workspaceDir, sessionId, [
      {
        message: {
          role: "user",
          content: "Keep release checks reusable with `openclaw status --json`.",
        },
      },
    ]);

    hoisted.runSessionStewardCycle.mockImplementationOnce(async () => {
      const persistedRecord = await loadKnowledgeReviewRecord(workspaceDir, sessionId);
      expect(persistedRecord?.sessionId).toBe(sessionId);
      return {
        keptSessions: 1,
        memoryCandidates: 3,
        skillCandidates: 2,
      };
    });

    const kernel = resolveDefaultKnowledgeReviewKernel();
    const result = await kernel.runSessionEndCycle({
      workspaceDir,
      agentId: "main",
      sessionKey: "agent:main:main",
      entry: {
        sessionId,
        sessionFile,
        updatedAt: Date.now(),
      },
      curateLimit: "7",
      incubateLimit: "8",
      promoteLimit: "9",
      minCandidates: "3",
    });

    expect(result?.record.sessionId).toBe(sessionId);
    expect(result?.steward).toEqual({
      keptSessions: 1,
      memoryCandidates: 3,
      skillCandidates: 2,
    });
    expect(hoisted.runSessionStewardCycle).toHaveBeenCalledWith({
      sessionKey: "agent:main:main",
      agentId: "main",
      workspaceDir,
      entry: {
        sessionId,
        sessionFile,
        updatedAt: expect.any(Number),
      },
      curateLimit: "7",
      incubateLimit: "8",
      promoteLimit: "9",
      minCandidates: "3",
    });
  });
});
