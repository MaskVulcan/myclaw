import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const ensureOpenClawModelsJsonMock = vi.fn<
  (config: unknown, agentDir: unknown) => Promise<{ agentDir: string; wrote: boolean }>
>(async () => ({ agentDir: "/tmp/agent", wrote: false }));
const ensureRuntimePluginsLoadedMock = vi.fn();
const listAgentIdsMock = vi.fn<(cfg: unknown) => string[]>(() => ["main"]);
const resolveModelAsyncMock = vi.fn<
  (
    provider: unknown,
    modelId: unknown,
    agentDir: unknown,
    cfg: unknown,
    options?: unknown,
  ) => Promise<{ model: { id: string; provider: string; api: string } }>
>(async () => ({
  model: {
    id: "gpt-5.4",
    provider: "openai-codex",
    api: "openai-codex-responses",
  },
}));
const resolveAgentWorkspaceDirMock = vi.fn<(cfg: unknown, agentId: unknown) => string>(
  (_cfg, agentId) => (agentId === "main" ? "/tmp/default-workspace" : `/tmp/${String(agentId)}`),
);

vi.mock("../agents/agent-paths.js", () => ({
  resolveOpenClawAgentDir: () => "/tmp/agent",
}));

vi.mock("../agents/agent-scope.js", () => ({
  listAgentIds: (cfg: unknown) => listAgentIdsMock(cfg),
  resolveAgentWorkspaceDir: (cfg: unknown, agentId: unknown) =>
    resolveAgentWorkspaceDirMock(cfg, agentId),
}));

vi.mock("../agents/models-config.js", () => ({
  ensureOpenClawModelsJson: (config: unknown, agentDir: unknown) =>
    ensureOpenClawModelsJsonMock(config, agentDir),
}));

vi.mock("../agents/pi-embedded-runner/model.js", () => ({
  resolveModelAsync: (
    provider: unknown,
    modelId: unknown,
    agentDir: unknown,
    cfg: unknown,
    options?: unknown,
  ) => resolveModelAsyncMock(provider, modelId, agentDir, cfg, options),
}));

vi.mock("../agents/runtime-plugins.js", () => ({
  ensureRuntimePluginsLoaded: (params: unknown) => ensureRuntimePluginsLoadedMock(params),
}));

describe("gateway startup primary model warmup", () => {
  beforeEach(() => {
    ensureOpenClawModelsJsonMock.mockClear();
    ensureRuntimePluginsLoadedMock.mockClear();
    listAgentIdsMock.mockReset().mockReturnValue(["main"]);
    resolveModelAsyncMock.mockClear();
    resolveAgentWorkspaceDirMock
      .mockReset()
      .mockImplementation((_cfg, agentId) =>
        agentId === "main" ? "/tmp/default-workspace" : `/tmp/${String(agentId)}`,
      );
  });

  it("prewarms an explicit configured primary model", async () => {
    const { __testing } = await import("./server-startup.js");
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "openai-codex/gpt-5.4",
          },
        },
      },
    } as OpenClawConfig;

    await __testing.prewarmConfiguredPrimaryModel({
      cfg,
      log: { warn: vi.fn() },
    });

    expect(ensureOpenClawModelsJsonMock).toHaveBeenCalledWith(cfg, "/tmp/agent");
    expect(resolveModelAsyncMock).toHaveBeenCalledWith(
      "openai-codex",
      "gpt-5.4",
      "/tmp/agent",
      cfg,
      {
        retryTransientProviderRuntimeMiss: true,
      },
    );
  });

  it("skips warmup when no explicit primary model is configured", async () => {
    const { __testing } = await import("./server-startup.js");

    await __testing.prewarmConfiguredPrimaryModel({
      cfg: {} as OpenClawConfig,
      log: { warn: vi.fn() },
    });

    expect(ensureOpenClawModelsJsonMock).not.toHaveBeenCalled();
    expect(resolveModelAsyncMock).not.toHaveBeenCalled();
  });
});

describe("gateway startup runtime plugin warmup", () => {
  beforeEach(() => {
    ensureRuntimePluginsLoadedMock.mockClear();
    listAgentIdsMock.mockReset().mockReturnValue(["main"]);
    resolveAgentWorkspaceDirMock
      .mockReset()
      .mockImplementation((_cfg, agentId) =>
        agentId === "main" ? "/tmp/default-workspace" : `/tmp/${String(agentId)}`,
      );
  });

  it("prewarms distinct agent workspaces and leaves the default workspace active last", async () => {
    const { __testing } = await import("./server-startup.js");
    const cfg = {} as OpenClawConfig;
    listAgentIdsMock.mockReturnValue(["main", "ops", "support"]);
    resolveAgentWorkspaceDirMock.mockImplementation((_cfg, agentId) => {
      switch (agentId) {
        case "main":
          return "/tmp/default-workspace";
        case "ops":
          return "/tmp/ops-workspace";
        case "support":
          return "/tmp/default-workspace";
        default:
          return `/tmp/${String(agentId)}`;
      }
    });

    __testing.prewarmGatewayRuntimePlugins({
      cfg,
      defaultWorkspaceDir: "/tmp/default-workspace",
      log: { warn: vi.fn() },
    });

    expect(ensureRuntimePluginsLoadedMock).toHaveBeenCalledTimes(2);
    expect(ensureRuntimePluginsLoadedMock).toHaveBeenNthCalledWith(1, {
      config: cfg,
      workspaceDir: "/tmp/ops-workspace",
      allowGatewaySubagentBinding: true,
    });
    expect(ensureRuntimePluginsLoadedMock).toHaveBeenNthCalledWith(2, {
      config: cfg,
      workspaceDir: "/tmp/default-workspace",
      allowGatewaySubagentBinding: true,
    });
  });

  it("logs a warning and continues warming remaining workspaces after a failure", async () => {
    const { __testing } = await import("./server-startup.js");
    const cfg = {} as OpenClawConfig;
    const warn = vi.fn();
    listAgentIdsMock.mockReturnValue(["main", "ops"]);
    ensureRuntimePluginsLoadedMock
      .mockImplementationOnce(() => {
        throw new Error("boom");
      })
      .mockImplementation(() => undefined);

    __testing.prewarmGatewayRuntimePlugins({
      cfg,
      defaultWorkspaceDir: "/tmp/default-workspace",
      log: { warn },
    });

    expect(ensureRuntimePluginsLoadedMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "startup runtime plugin warmup failed for /tmp/ops: Error: boom",
    );
    expect(ensureRuntimePluginsLoadedMock).toHaveBeenLastCalledWith({
      config: cfg,
      workspaceDir: "/tmp/default-workspace",
      allowGatewaySubagentBinding: true,
    });
  });
});
