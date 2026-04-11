import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubagentSpawnTestConfig,
  loadSubagentSpawnModuleForTest,
  setupAcceptedSubagentGatewayMock,
} from "./subagent-spawn.test-helpers.js";

const hoisted = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
  configOverride: {} as Record<string, unknown>,
  registerSubagentRunMock: vi.fn(),
  prepareSubagentGitWorktreeMock: vi.fn(),
  removeSubagentGitWorktreeMock: vi.fn(),
  materializeSubagentAttachmentsMock: vi.fn(),
  hookRunner: {
    hasHooks: vi.fn(() => false),
    runSubagentSpawning: vi.fn(),
  },
}));

let spawnSubagentDirect: typeof import("./subagent-spawn.js").spawnSubagentDirect;
let resetSubagentRegistryForTests: typeof import("./subagent-registry.js").resetSubagentRegistryForTests;

describe("spawnSubagentDirect git worktree isolation", () => {
  beforeEach(async () => {
    hoisted.configOverride = createSubagentSpawnTestConfig("/repo", {
      agents: {
        list: [
          {
            id: "main",
            workspace: "/repo",
          },
        ],
      },
    });
    hoisted.callGatewayMock.mockClear();
    hoisted.registerSubagentRunMock.mockClear();
    hoisted.prepareSubagentGitWorktreeMock.mockReset().mockResolvedValue({
      repoDir: "/repo",
      worktreeDir: "/state/subagent-worktrees/main/child",
      workspaceDir: "/state/subagent-worktrees/main/child/packages/app",
    });
    hoisted.removeSubagentGitWorktreeMock.mockReset().mockResolvedValue(undefined);
    hoisted.materializeSubagentAttachmentsMock.mockReset().mockResolvedValue(null);
    hoisted.hookRunner.hasHooks.mockReset();
    hoisted.hookRunner.hasHooks.mockImplementation(() => false);
    hoisted.hookRunner.runSubagentSpawning.mockReset();

    ({ resetSubagentRegistryForTests, spawnSubagentDirect } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: hoisted.callGatewayMock,
      loadConfig: () => hoisted.configOverride,
      registerSubagentRunMock: hoisted.registerSubagentRunMock,
      prepareSubagentGitWorktreeMock: hoisted.prepareSubagentGitWorktreeMock,
      removeSubagentGitWorktreeMock: hoisted.removeSubagentGitWorktreeMock,
      materializeSubagentAttachmentsMock: hoisted.materializeSubagentAttachmentsMock,
      hookRunner: hoisted.hookRunner,
      resolveAgentConfig: (cfg, agentId) =>
        (
          cfg as { agents?: { list?: Array<{ id?: string; workspace?: string }> } }
        ).agents?.list?.find((entry) => entry.id === agentId),
      resolveAgentWorkspaceDir: (cfg, agentId) =>
        (
          cfg as { agents?: { list?: Array<{ id?: string; workspace?: string }> } }
        ).agents?.list?.find((entry) => entry.id === agentId)?.workspace ?? "/repo",
    }));
    resetSubagentRegistryForTests();
    setupAcceptedSubagentGatewayMock(hoisted.callGatewayMock);
  });

  it("switches spawned workspace and attachment materialization to the prepared worktree", async () => {
    const result = await spawnSubagentDirect(
      {
        task: "inspect repo",
        worktree: "git",
        attachments: [{ name: "notes.txt", content: "hello", encoding: "utf8" }],
      },
      {
        agentSessionKey: "agent:main:main",
        workspaceDir: "/repo/packages/app",
      },
    );

    expect(result.status).toBe("accepted");
    expect(hoisted.prepareSubagentGitWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        workspaceDir: "/repo/packages/app",
      }),
    );
    expect(hoisted.materializeSubagentAttachmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDir: "/state/subagent-worktrees/main/child/packages/app",
      }),
    );

    const registerCall = hoisted.registerSubagentRunMock.mock.calls.at(0)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(registerCall).toMatchObject({
      workspaceDir: "/state/subagent-worktrees/main/child/packages/app",
      worktreeDir: "/state/subagent-worktrees/main/child",
      worktreeRepoDir: "/repo",
    });

    const lineagePatch = hoisted.callGatewayMock.mock.calls.find(
      ([request]) =>
        (request as { method?: string; params?: { spawnedBy?: string } }).method ===
          "sessions.patch" &&
        typeof (request as { params?: { spawnedBy?: string } }).params?.spawnedBy === "string",
    )?.[0] as { params?: { spawnedWorkspaceDir?: string } } | undefined;
    expect(lineagePatch?.params?.spawnedWorkspaceDir).toBe(
      "/state/subagent-worktrees/main/child/packages/app",
    );
  });

  it("removes a prepared worktree when agent startup fails", async () => {
    hoisted.callGatewayMock.mockImplementation(
      async (request: { method?: string; params?: { key?: string } }) => {
        if (request.method === "sessions.patch") {
          return { ok: true };
        }
        if (request.method === "agent") {
          throw new Error("spawn startup failed");
        }
        if (request.method === "sessions.delete") {
          return { ok: true };
        }
        return {};
      },
    );

    const result = await spawnSubagentDirect(
      {
        task: "fail startup",
        worktree: "git",
      },
      {
        agentSessionKey: "agent:main:main",
        workspaceDir: "/repo/packages/app",
      },
    );

    expect(result).toMatchObject({
      status: "error",
      error: "spawn startup failed",
    });
    expect(hoisted.removeSubagentGitWorktreeMock).toHaveBeenCalledWith({
      repoDir: "/repo",
      worktreeDir: "/state/subagent-worktrees/main/child",
    });
    expect(hoisted.registerSubagentRunMock).not.toHaveBeenCalled();
  });
});
