import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  buildMemoryPromptSection: vi.fn(() => ["memory-section"]),
  resolveMemoryFlushPlan: vi.fn(() => ({
    softThresholdTokens: 1,
    forceFlushTranscriptBytes: 2,
    reserveTokensFloor: 3,
    prompt: "prompt",
    systemPrompt: "system",
    relativePath: "memory/test.md",
  })),
  getActiveMemorySearchManager: vi.fn(async () => ({ manager: null, error: "missing" })),
  resolveActiveMemoryBackendConfig: vi.fn(() => ({ backend: "builtin" as const })),
  closeActiveMemorySearchManagers: vi.fn(async () => {}),
  runAttemptContextEngineBootstrap: vi.fn(async () => undefined),
  finalizeAttemptContextEngineTurn: vi.fn(async () => ({
    postTurnFinalizationSucceeded: true,
  })),
  runContextEngineMaintenance: vi.fn(async () => undefined),
  loadConfig: vi.fn(() => ({ memory: { enabled: true } })),
  ensureRuntimePluginsLoaded: vi.fn(),
  ensureContextEnginesInitialized: vi.fn(),
  resolveContextEngine: vi.fn(),
  stewardIngestExplicitSession: vi.fn(async () => ({
    keptSessions: 1,
    memoryCandidates: 2,
    skillCandidates: 1,
  })),
  stewardCurateCommand: vi.fn(async () => undefined),
  stewardMaintainCommand: vi.fn(async () => undefined),
  stewardIncubateSkillsCommand: vi.fn(async () => undefined),
  stewardPromoteSkillsCommand: vi.fn(async () => undefined),
}));

vi.mock("../plugins/memory-state.js", () => ({
  buildMemoryPromptSection: (...args: unknown[]) => hoisted.buildMemoryPromptSection(...args),
  resolveMemoryFlushPlan: (...args: unknown[]) => hoisted.resolveMemoryFlushPlan(...args),
}));

vi.mock("../plugins/memory-runtime.js", () => ({
  getActiveMemorySearchManager: (...args: unknown[]) =>
    hoisted.getActiveMemorySearchManager(...args),
  resolveActiveMemoryBackendConfig: (...args: unknown[]) =>
    hoisted.resolveActiveMemoryBackendConfig(...args),
  closeActiveMemorySearchManagers: (...args: unknown[]) =>
    hoisted.closeActiveMemorySearchManagers(...args),
}));

vi.mock("./pi-embedded-runner/run/attempt.context-engine-helpers.js", () => ({
  runAttemptContextEngineBootstrap: (...args: unknown[]) =>
    hoisted.runAttemptContextEngineBootstrap(...args),
  finalizeAttemptContextEngineTurn: (...args: unknown[]) =>
    hoisted.finalizeAttemptContextEngineTurn(...args),
}));

vi.mock("./pi-embedded-runner/context-engine-maintenance.js", () => ({
  runContextEngineMaintenance: (...args: unknown[]) => hoisted.runContextEngineMaintenance(...args),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: (...args: unknown[]) => hoisted.loadConfig(...args),
}));

vi.mock("./runtime-plugins.js", () => ({
  ensureRuntimePluginsLoaded: (...args: unknown[]) => hoisted.ensureRuntimePluginsLoaded(...args),
}));

vi.mock("../context-engine/init.js", () => ({
  ensureContextEnginesInitialized: (...args: unknown[]) =>
    hoisted.ensureContextEnginesInitialized(...args),
}));

vi.mock("../context-engine/registry.js", () => ({
  resolveContextEngine: (...args: unknown[]) => hoisted.resolveContextEngine(...args),
}));

vi.mock("../commands/steward.js", () => ({
  stewardIngestExplicitSession: (...args: unknown[]) =>
    hoisted.stewardIngestExplicitSession(...args),
  stewardCurateCommand: (...args: unknown[]) => hoisted.stewardCurateCommand(...args),
  stewardMaintainCommand: (...args: unknown[]) => hoisted.stewardMaintainCommand(...args),
  stewardIncubateSkillsCommand: (...args: unknown[]) =>
    hoisted.stewardIncubateSkillsCommand(...args),
  stewardPromoteSkillsCommand: (...args: unknown[]) => hoisted.stewardPromoteSkillsCommand(...args),
}));

let resolveDefaultMemoryProviderKernel: typeof import("./memory-provider-kernel.js").resolveDefaultMemoryProviderKernel;

describe("memory-provider-kernel facade", () => {
  beforeEach(async () => {
    vi.resetModules();
    Object.values(hoisted).forEach((value) => {
      (value as { mockReset?: () => void }).mockReset?.();
    });

    hoisted.buildMemoryPromptSection.mockReturnValue(["memory-section"]);
    hoisted.resolveMemoryFlushPlan.mockReturnValue({
      softThresholdTokens: 1,
      forceFlushTranscriptBytes: 2,
      reserveTokensFloor: 3,
      prompt: "prompt",
      systemPrompt: "system",
      relativePath: "memory/test.md",
    });
    hoisted.getActiveMemorySearchManager.mockResolvedValue({ manager: null, error: "missing" });
    hoisted.resolveActiveMemoryBackendConfig.mockReturnValue({ backend: "builtin" });
    hoisted.closeActiveMemorySearchManagers.mockResolvedValue(undefined);
    hoisted.runAttemptContextEngineBootstrap.mockResolvedValue(undefined);
    hoisted.finalizeAttemptContextEngineTurn.mockResolvedValue({
      postTurnFinalizationSucceeded: true,
    });
    hoisted.runContextEngineMaintenance.mockResolvedValue(undefined);
    hoisted.loadConfig.mockReturnValue({ memory: { enabled: true } });
    hoisted.ensureRuntimePluginsLoaded.mockImplementation(() => undefined);
    hoisted.ensureContextEnginesInitialized.mockImplementation(() => undefined);
    hoisted.resolveContextEngine.mockResolvedValue({
      prepareSubagentSpawn: vi.fn(async () => undefined),
      onSubagentEnded: vi.fn(async () => undefined),
    });
    hoisted.stewardIngestExplicitSession.mockResolvedValue({
      keptSessions: 1,
      memoryCandidates: 2,
      skillCandidates: 1,
    });
    hoisted.stewardCurateCommand.mockResolvedValue(undefined);
    hoisted.stewardMaintainCommand.mockResolvedValue(undefined);
    hoisted.stewardIncubateSkillsCommand.mockResolvedValue(undefined);
    hoisted.stewardPromoteSkillsCommand.mockResolvedValue(undefined);

    ({ resolveDefaultMemoryProviderKernel } = await import("./memory-provider-kernel.js"));
  });

  it("delegates system prompt and flush plan resolution to the memory plugin state", () => {
    const kernel = resolveDefaultMemoryProviderKernel();

    expect(
      kernel.systemPromptBlock({
        availableTools: new Set(["memory_search"]),
        citationsMode: "off",
      }),
    ).toEqual(["memory-section"]);
    expect(hoisted.buildMemoryPromptSection).toHaveBeenCalledWith({
      availableTools: new Set(["memory_search"]),
      citationsMode: "off",
    });

    expect(kernel.resolveFlushPlan({ cfg: {} as never })?.relativePath).toBe("memory/test.md");
    expect(hoisted.resolveMemoryFlushPlan).toHaveBeenCalledWith({
      cfg: {},
    });
  });

  it("delegates prefetch, backend config, bootstrap, turn sync, maintenance, and shutdown", async () => {
    const kernel = resolveDefaultMemoryProviderKernel();
    const bootstrapParams = {
      hadSessionFile: true,
      sessionId: "session-1",
      sessionFile: "/tmp/session.jsonl",
      sessionManager: {},
      runMaintenance: vi.fn(),
      warn: vi.fn(),
    } as Parameters<typeof kernel.bootstrap>[0];
    const turnSyncParams = {
      promptError: false,
      aborted: false,
      yieldAborted: false,
      sessionIdUsed: "session-1",
      sessionFile: "/tmp/session.jsonl",
      messagesSnapshot: [],
      prePromptMessageCount: 0,
      sessionManager: {},
      runMaintenance: vi.fn(),
      warn: vi.fn(),
    } as Parameters<typeof kernel.syncTurn>[0];
    const maintenanceParams = {
      sessionId: "session-1",
      sessionFile: "/tmp/session.jsonl",
      reason: "turn",
    } as Parameters<typeof kernel.maintain>[0];

    await expect(kernel.prefetch({ cfg: {} as never, agentId: "main" })).resolves.toEqual({
      manager: null,
      error: "missing",
    });
    expect(kernel.resolveBackendConfig({ cfg: {} as never, agentId: "main" })).toEqual({
      backend: "builtin",
    });
    await kernel.bootstrap(bootstrapParams);
    await kernel.syncTurn(turnSyncParams);
    await kernel.maintain(maintenanceParams);
    await kernel.shutdown({} as never);

    expect(hoisted.getActiveMemorySearchManager).toHaveBeenCalledWith({
      cfg: {},
      agentId: "main",
    });
    expect(hoisted.resolveActiveMemoryBackendConfig).toHaveBeenCalledWith({
      cfg: {},
      agentId: "main",
    });
    expect(hoisted.runAttemptContextEngineBootstrap).toHaveBeenCalledWith(bootstrapParams);
    expect(hoisted.finalizeAttemptContextEngineTurn).toHaveBeenCalledWith(turnSyncParams);
    expect(hoisted.runContextEngineMaintenance).toHaveBeenCalledWith(maintenanceParams);
    expect(hoisted.closeActiveMemorySearchManagers).toHaveBeenCalledWith({});
  });

  it("prepares delegation through the resolved context-engine lifecycle", async () => {
    const preparation = { rollback: vi.fn(async () => {}) };
    const prepareSubagentSpawn = vi.fn(async () => preparation);
    hoisted.resolveContextEngine.mockResolvedValue({
      prepareSubagentSpawn,
    });

    const kernel = resolveDefaultMemoryProviderKernel();
    const result = await kernel.prepareDelegation({
      config: { agents: {} } as never,
      parentSessionKey: "agent:main:main",
      childSessionKey: "agent:main:subagent:child",
      workspaceDir: "/tmp/workspace",
      ttlMs: 5000,
    });

    expect(result).toBe(preparation);
    expect(hoisted.ensureRuntimePluginsLoaded).toHaveBeenCalledWith({
      config: { agents: {} },
      workspaceDir: "/tmp/workspace",
      allowGatewaySubagentBinding: true,
    });
    expect(hoisted.ensureContextEnginesInitialized).toHaveBeenCalledTimes(1);
    expect(prepareSubagentSpawn).toHaveBeenCalledWith({
      parentSessionKey: "agent:main:main",
      childSessionKey: "agent:main:subagent:child",
      ttlMs: 5000,
    });
  });

  it("notifies delegation end through the resolved context engine", async () => {
    const onSubagentEnded = vi.fn(async () => undefined);
    hoisted.resolveContextEngine.mockResolvedValue({
      onSubagentEnded,
    });

    const kernel = resolveDefaultMemoryProviderKernel();
    await kernel.onDelegationEnded({
      childSessionKey: "agent:main:subagent:child",
      reason: "completed",
      workspaceDir: "/tmp/workspace",
    });

    expect(onSubagentEnded).toHaveBeenCalledWith({
      childSessionKey: "agent:main:subagent:child",
      reason: "completed",
      workspaceDir: "/tmp/workspace",
    });
  });

  it("runs the steward session-end cycle and skips follow-up passes when nothing durable was kept", async () => {
    const kernel = resolveDefaultMemoryProviderKernel();

    await expect(
      kernel.runSessionStewardCycle({
        sessionKey: "agent:main:main",
        agentId: "main",
        workspaceDir: "/tmp/workspace",
        entry: { sessionId: "session-1" } as never,
        curateLimit: "7",
        incubateLimit: "8",
        promoteLimit: "9",
        minCandidates: "3",
      }),
    ).resolves.toEqual({
      keptSessions: 1,
      memoryCandidates: 2,
      skillCandidates: 1,
    });

    expect(hoisted.stewardIngestExplicitSession).toHaveBeenCalledWith({
      sessionKey: "agent:main:main",
      agentId: "main",
      workspaceDir: "/tmp/workspace",
      entry: { sessionId: "session-1" },
      apply: true,
    });
    expect(hoisted.stewardCurateCommand).toHaveBeenCalledWith(
      {
        workspace: "/tmp/workspace",
        agent: "main",
        limit: "7",
        apply: true,
      },
      expect.any(Object),
    );
    expect(hoisted.stewardMaintainCommand).toHaveBeenCalledTimes(1);
    expect(hoisted.stewardIncubateSkillsCommand).toHaveBeenCalledTimes(1);
    expect(hoisted.stewardPromoteSkillsCommand).toHaveBeenCalledWith(
      {
        workspace: "/tmp/workspace",
        agent: "main",
        limit: "9",
        minCandidates: "3",
        apply: true,
      },
      expect.any(Object),
    );

    hoisted.stewardCurateCommand.mockClear();
    hoisted.stewardMaintainCommand.mockClear();
    hoisted.stewardIncubateSkillsCommand.mockClear();
    hoisted.stewardPromoteSkillsCommand.mockClear();
    hoisted.stewardIngestExplicitSession.mockResolvedValueOnce({
      keptSessions: 0,
      memoryCandidates: 0,
      skillCandidates: 0,
    });

    await expect(
      kernel.runSessionStewardCycle({
        sessionKey: "agent:main:main",
        agentId: "main",
        workspaceDir: "/tmp/workspace",
        entry: { sessionId: "session-2" } as never,
      }),
    ).resolves.toEqual({
      keptSessions: 0,
      memoryCandidates: 0,
      skillCandidates: 0,
    });

    expect(hoisted.stewardCurateCommand).not.toHaveBeenCalled();
    expect(hoisted.stewardMaintainCommand).not.toHaveBeenCalled();
    expect(hoisted.stewardIncubateSkillsCommand).not.toHaveBeenCalled();
    expect(hoisted.stewardPromoteSkillsCommand).not.toHaveBeenCalled();
  });
});
