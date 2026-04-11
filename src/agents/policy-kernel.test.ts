import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  resolveEffectiveToolPolicy: vi.fn(),
  resolveGroupToolPolicy: vi.fn(),
  resolveSubagentToolPolicy: vi.fn(),
  resolveSubagentToolPolicyForSession: vi.fn(),
  isToolAllowedByPolicies: vi.fn(() => true),
  applyToolPolicyPipeline: vi.fn(({ tools }: { tools: unknown[] }) => tools),
  buildDefaultToolPolicyPipelineSteps: vi.fn(() => [
    {
      label: "default tools.allow",
      policy: { allow: ["default-step"] },
    },
  ]),
  resolveToolProfilePolicy: vi.fn((profile?: string) =>
    profile ? { allow: [`${profile}-tool`] } : undefined,
  ),
  runBeforeToolCallHook: vi.fn(async ({ params }: { params: unknown }) => ({
    blocked: false as const,
    params,
  })),
  assertSandboxPath: vi.fn(
    async (params: {
      filePath: string;
      cwd: string;
      root: string;
      allowFinalSymlinkForUnlink?: boolean;
      allowFinalHardlinkForUnlink?: boolean;
    }) => ({
      resolved: `${params.root}/${params.filePath}`,
      relative: String(params.filePath),
    }),
  ),
  resolveNodeCommandAllowlist: vi.fn(() => new Set(["canvas.present"])),
  isNodeCommandAllowed: vi.fn(() => ({ ok: true as const })),
}));

vi.mock("./pi-tools.policy.js", () => ({
  resolveEffectiveToolPolicy: (...args: unknown[]) => hoisted.resolveEffectiveToolPolicy(...args),
  resolveGroupToolPolicy: (...args: unknown[]) => hoisted.resolveGroupToolPolicy(...args),
  resolveSubagentToolPolicy: (...args: unknown[]) => hoisted.resolveSubagentToolPolicy(...args),
  resolveSubagentToolPolicyForSession: (...args: unknown[]) =>
    hoisted.resolveSubagentToolPolicyForSession(...args),
  isToolAllowedByPolicies: (...args: unknown[]) => hoisted.isToolAllowedByPolicies(...args),
}));

vi.mock("./tool-policy-pipeline.js", () => ({
  applyToolPolicyPipeline: (...args: unknown[]) => hoisted.applyToolPolicyPipeline(...args),
  buildDefaultToolPolicyPipelineSteps: (...args: unknown[]) =>
    hoisted.buildDefaultToolPolicyPipelineSteps(...args),
}));

vi.mock("./tool-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tool-policy.js")>();
  return {
    ...actual,
    resolveToolProfilePolicy: (...args: unknown[]) => hoisted.resolveToolProfilePolicy(...args),
  };
});

vi.mock("./pi-tools.before-tool-call.js", () => ({
  runBeforeToolCallHook: (...args: unknown[]) => hoisted.runBeforeToolCallHook(...args),
}));

vi.mock("./sandbox-paths.js", () => ({
  assertSandboxPath: (...args: unknown[]) => hoisted.assertSandboxPath(...args),
}));

vi.mock("../gateway/node-command-policy.js", () => ({
  resolveNodeCommandAllowlist: (...args: unknown[]) => hoisted.resolveNodeCommandAllowlist(...args),
  isNodeCommandAllowed: (...args: unknown[]) => hoisted.isNodeCommandAllowed(...args),
}));

let resolveDefaultPolicyKernel: typeof import("./policy-kernel.js").resolveDefaultPolicyKernel;

describe("policy-kernel facade", () => {
  beforeEach(async () => {
    vi.resetModules();
    Object.values(hoisted).forEach((value) => {
      (value as { mockReset?: () => void }).mockReset?.();
    });

    hoisted.resolveEffectiveToolPolicy.mockReturnValue({
      agentId: "main",
      globalPolicy: { allow: ["global-tool"] },
      globalProviderPolicy: { allow: ["provider-tool"] },
      agentPolicy: { allow: ["agent-tool"] },
      agentProviderPolicy: { allow: ["agent-provider-tool"] },
      profile: "minimal",
      providerProfile: "provider-minimal",
      profileAlsoAllow: ["agents_list"],
      providerProfileAlsoAllow: ["web_search"],
    });
    hoisted.resolveGroupToolPolicy.mockReturnValue({ allow: ["group-tool"] });
    hoisted.resolveSubagentToolPolicy.mockReturnValue({ deny: ["sessions_spawn"] });
    hoisted.resolveSubagentToolPolicyForSession.mockReturnValue({ deny: ["sessions_send"] });
    hoisted.isToolAllowedByPolicies.mockReturnValue(true);
    hoisted.applyToolPolicyPipeline.mockImplementation(({ tools }: { tools: unknown[] }) => tools);
    hoisted.buildDefaultToolPolicyPipelineSteps.mockReturnValue([
      {
        label: "default tools.allow",
        policy: { allow: ["default-step"] },
      },
    ]);
    hoisted.resolveToolProfilePolicy.mockImplementation((profile?: string) =>
      profile ? { allow: [`${profile}-tool`] } : undefined,
    );
    hoisted.runBeforeToolCallHook.mockImplementation(async ({ params }: { params: unknown }) => ({
      blocked: false,
      params,
    }));
    hoisted.assertSandboxPath.mockImplementation(
      async (params: {
        filePath: string;
        cwd: string;
        root: string;
        allowFinalSymlinkForUnlink?: boolean;
        allowFinalHardlinkForUnlink?: boolean;
      }) => ({
        resolved: `${params.root}/${params.filePath}`,
        relative: String(params.filePath),
      }),
    );
    hoisted.resolveNodeCommandAllowlist.mockReturnValue(new Set(["canvas.present"]));
    hoisted.isNodeCommandAllowed.mockReturnValue({ ok: true });

    ({ resolveDefaultPolicyKernel } = await import("./policy-kernel.js"));
  });

  it("resolves layered tool policy once and builds allowlists, match policies, and pipeline steps", () => {
    const kernel = resolveDefaultPolicyKernel();
    const resolved = kernel.resolveToolPolicy({
      config: { tools: {} } as never,
      sessionKey: "agent:main:subagent:child",
      agentId: "main",
      modelProvider: "openai",
      modelId: "gpt-5.4",
      spawnedBy: "agent:main:main",
      messageProvider: "slack",
      groupId: "g-1",
      groupChannel: "#ops",
      groupSpace: "space-1",
      accountId: "acct-1",
      senderId: "user-1",
      senderName: "User One",
      senderUsername: "user1",
      senderE164: "+10000000000",
      sandboxToolPolicy: { allow: ["sandbox-tool"] },
      subagentPolicyMode: "session",
    });

    expect(hoisted.resolveEffectiveToolPolicy).toHaveBeenCalledWith({
      config: { tools: {} },
      sessionKey: "agent:main:subagent:child",
      agentId: "main",
      modelProvider: "openai",
      modelId: "gpt-5.4",
    });
    expect(hoisted.resolveGroupToolPolicy).toHaveBeenCalledWith({
      config: { tools: {} },
      sessionKey: "agent:main:subagent:child",
      spawnedBy: "agent:main:main",
      messageProvider: "slack",
      groupId: "g-1",
      groupChannel: "#ops",
      groupSpace: "space-1",
      accountId: "acct-1",
      senderId: "user-1",
      senderName: "User One",
      senderUsername: "user1",
      senderE164: "+10000000000",
    });
    expect(hoisted.resolveSubagentToolPolicyForSession).toHaveBeenCalledWith(
      { tools: {} },
      "agent:main:subagent:child",
    );
    expect(hoisted.buildDefaultToolPolicyPipelineSteps).toHaveBeenCalledWith({
      profilePolicy: { allow: ["minimal-tool", "agents_list"] },
      profile: "minimal",
      profileAlsoAllow: ["agents_list"],
      providerProfilePolicy: { allow: ["provider-minimal-tool", "web_search"] },
      providerProfile: "provider-minimal",
      providerProfileAlsoAllow: ["web_search"],
      globalPolicy: { allow: ["global-tool"] },
      globalProviderPolicy: { allow: ["provider-tool"] },
      agentPolicy: { allow: ["agent-tool"] },
      agentProviderPolicy: { allow: ["agent-provider-tool"] },
      groupPolicy: { allow: ["group-tool"] },
      agentId: "main",
    });

    expect(resolved).toMatchObject({
      agentId: "main",
      profile: "minimal",
      providerProfile: "provider-minimal",
      globalPolicy: { allow: ["global-tool"] },
      globalProviderPolicy: { allow: ["provider-tool"] },
      agentPolicy: { allow: ["agent-tool"] },
      agentProviderPolicy: { allow: ["agent-provider-tool"] },
      groupPolicy: { allow: ["group-tool"] },
      sandboxPolicy: { allow: ["sandbox-tool"] },
      subagentPolicy: { deny: ["sessions_send"] },
    });
    expect(resolved.explicitAllowlist).toEqual([
      "minimal-tool",
      "provider-minimal-tool",
      "global-tool",
      "provider-tool",
      "agent-tool",
      "agent-provider-tool",
      "group-tool",
      "sandbox-tool",
    ]);
    expect(resolved.matchPolicies).toEqual([
      { allow: ["minimal-tool", "agents_list"] },
      { allow: ["provider-minimal-tool", "web_search"] },
      { allow: ["global-tool"] },
      { allow: ["provider-tool"] },
      { allow: ["agent-tool"] },
      { allow: ["agent-provider-tool"] },
      { allow: ["group-tool"] },
      { allow: ["sandbox-tool"] },
      { deny: ["sessions_send"] },
    ]);
    expect(resolved.pipelineSteps).toEqual([
      {
        label: "default tools.allow",
        policy: { allow: ["default-step"] },
      },
      { label: "sandbox tools.allow", policy: { allow: ["sandbox-tool"] } },
      { label: "subagent tools.allow", policy: { deny: ["sessions_send"] } },
    ]);
  });

  it("supports default subagent policy mode and delegates tool filtering", () => {
    const kernel = resolveDefaultPolicyKernel();
    const resolved = kernel.resolveToolPolicy({
      config: { tools: {} } as never,
      sessionKey: "agent:main:subagent:child",
      subagentPolicyMode: "default",
    });

    expect(hoisted.resolveSubagentToolPolicy).toHaveBeenCalledWith({ tools: {} });
    expect(hoisted.resolveSubagentToolPolicyForSession).not.toHaveBeenCalled();

    const tools = [{ name: "read" }, { name: "write" }] as never;
    const filtered = kernel.applyToolPolicy({
      tools,
      toolMeta: () => undefined,
      warn: vi.fn(),
      resolvedPolicy: resolved,
    });

    expect(filtered).toBe(tools);
    expect(hoisted.applyToolPolicyPipeline).toHaveBeenCalledWith({
      tools,
      toolMeta: expect.any(Function),
      warn: expect.any(Function),
      steps: resolved.pipelineSteps,
    });
  });

  it("delegates hook, tool allow, workspace path, and node command decisions", async () => {
    const kernel = resolveDefaultPolicyKernel();

    await expect(
      kernel.runBeforeToolCall({
        toolName: "read",
        params: { filePath: "README.md" },
        toolCallId: "call-1",
      }),
    ).resolves.toEqual({
      blocked: false,
      params: { filePath: "README.md" },
    });
    expect(kernel.isToolAllowed("process", [{ allow: ["process"] }])).toBe(true);
    expect(hoisted.isToolAllowedByPolicies).toHaveBeenCalledWith("process", [
      { allow: ["process"] },
    ]);

    await expect(
      kernel.assertWorkspacePath({
        filePath: "src/index.ts",
        cwd: "/workspace",
        workspaceRoot: "/workspace",
        allowFinalSymlinkForUnlink: true,
      }),
    ).resolves.toEqual({
      resolved: "/workspace/src/index.ts",
      relative: "src/index.ts",
    });
    expect(hoisted.assertSandboxPath).toHaveBeenCalledWith({
      filePath: "src/index.ts",
      cwd: "/workspace",
      root: "/workspace",
      allowFinalSymlinkForUnlink: true,
      allowFinalHardlinkForUnlink: undefined,
    });

    expect(kernel.resolveNodeCommandAllowlist({} as never, { platform: "ios" } as never)).toEqual(
      new Set(["canvas.present"]),
    );
    expect(
      kernel.isNodeCommandAllowed({
        command: "canvas.present",
        declaredCommands: ["canvas.present"],
        allowlist: new Set(["canvas.present"]),
      }),
    ).toEqual({ ok: true });
    expect(hoisted.isNodeCommandAllowed).toHaveBeenCalledWith({
      command: "canvas.present",
      declaredCommands: ["canvas.present"],
      allowlist: new Set(["canvas.present"]),
    });
  });
});
