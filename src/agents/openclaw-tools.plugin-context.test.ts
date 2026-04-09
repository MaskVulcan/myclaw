import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "./tools/common.js";

const { resolvePluginToolsMock } = vi.hoisted(() => ({
  resolvePluginToolsMock: vi.fn((params?: unknown) => {
    void params;
    return [];
  }),
}));

vi.mock("../plugins/tools.js", () => ({
  resolvePluginTools: resolvePluginToolsMock,
}));

describe("openclaw plugin tool context helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    resolvePluginToolsMock.mockReset();
    resolvePluginToolsMock.mockImplementation((params?: unknown) => {
      void params;
      return [];
    });
  });

  it("forwards trusted requester sender identity", async () => {
    const { resolveOpenClawPluginToolInputs } = await import("./openclaw-tools.plugin-context.js");

    const result = resolveOpenClawPluginToolInputs({
      options: {
        requesterSenderId: "trusted-sender",
        senderIsOwner: true,
      },
    });

    expect(result.context).toMatchObject({
      requesterSenderId: "trusted-sender",
      senderIsOwner: true,
    });
  });

  it("forwards ephemeral session ids", async () => {
    const { resolveOpenClawPluginToolInputs } = await import("./openclaw-tools.plugin-context.js");

    const result = resolveOpenClawPluginToolInputs({
      options: {
        agentSessionKey: "agent:main:telegram:direct:12345",
        sessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      },
    });

    expect(result.context).toMatchObject({
      sessionKey: "agent:main:telegram:direct:12345",
      sessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
  });

  it("infers the default agent workspace when workspaceDir is omitted", async () => {
    const { resolveOpenClawPluginToolInputs } = await import("./openclaw-tools.plugin-context.js");
    const workspaceDir = path.join(process.cwd(), "tmp-main-workspace");

    const result = resolveOpenClawPluginToolInputs({
      options: {
        agentSessionKey: "main",
      },
      resolvedConfig: {
        agents: {
          defaults: { workspace: workspaceDir },
          list: [{ id: "main", default: true }],
        },
      } as never,
    });

    expect(result.context).toMatchObject({
      agentId: "main",
      workspaceDir,
    });
  });

  it("infers the session agent workspace when workspaceDir is omitted", async () => {
    const { resolveOpenClawPluginToolInputs } = await import("./openclaw-tools.plugin-context.js");
    const supportWorkspace = path.join(process.cwd(), "tmp-support-workspace");

    const result = resolveOpenClawPluginToolInputs({
      options: {
        agentSessionKey: "agent:support:main",
      },
      resolvedConfig: {
        agents: {
          defaults: { workspace: path.join(process.cwd(), "tmp-default-workspace") },
          list: [
            { id: "main", default: true },
            { id: "support", workspace: supportWorkspace },
          ],
        },
      } as never,
    });

    expect(result.context).toMatchObject({
      agentId: "support",
      workspaceDir: supportWorkspace,
    });
  });

  it("forwards browser session wiring", async () => {
    const { resolveOpenClawPluginToolInputs } = await import("./openclaw-tools.plugin-context.js");

    const result = resolveOpenClawPluginToolInputs({
      options: {
        sandboxBrowserBridgeUrl: "http://127.0.0.1:9999",
        allowHostBrowserControl: true,
      },
    });

    expect(result.context).toMatchObject({
      browser: {
        sandboxBridgeUrl: "http://127.0.0.1:9999",
        allowHostControl: true,
      },
    });
  });

  it("forwards ambient deliveryContext", async () => {
    const { resolveOpenClawPluginToolInputs } = await import("./openclaw-tools.plugin-context.js");

    const result = resolveOpenClawPluginToolInputs({
      options: {
        agentChannel: "slack",
        agentTo: "channel:C123",
        agentAccountId: "work",
        agentThreadId: "1710000000.000100",
      },
    });

    expect(result.context).toMatchObject({
      deliveryContext: {
        channel: "slack",
        to: "channel:C123",
        accountId: "work",
        threadId: "1710000000.000100",
      },
    });
  });

  it("forwards gateway subagent binding into plugin resolution", async () => {
    const { resolveOpenClawPluginToolsForOptions } = await import("./openclaw-plugin-tools.js");

    resolveOpenClawPluginToolsForOptions({
      options: {
        allowGatewaySubagentBinding: true,
      },
    });

    expect(resolvePluginToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowGatewaySubagentBinding: true,
      }),
    );
  });

  it("does not inject ambient thread defaults into plugin tools", async () => {
    const { resolveOpenClawPluginToolsForOptions } = await import("./openclaw-plugin-tools.js");
    const executeMock = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      details: {},
    }));
    const sharedTool: AnyAgentTool = {
      name: "plugin-thread-default",
      label: "plugin-thread-default",
      description: "test",
      parameters: {
        type: "object",
        properties: {
          threadId: { type: "string" },
        },
      },
      execute: executeMock,
    };
    resolvePluginToolsMock.mockReturnValue([sharedTool] as never);

    const first = resolveOpenClawPluginToolsForOptions({
      options: {
        agentThreadId: "111.222",
      },
    }).find((tool) => tool.name === sharedTool.name);
    const second = resolveOpenClawPluginToolsForOptions({
      options: {
        agentThreadId: "333.444",
      },
    }).find((tool) => tool.name === sharedTool.name);

    expect(first).toBe(sharedTool);
    expect(second).toBe(sharedTool);

    await first?.execute("call-1", {});
    await second?.execute("call-2", {});

    expect(executeMock).toHaveBeenNthCalledWith(1, "call-1", {});
    expect(executeMock).toHaveBeenNthCalledWith(2, "call-2", {});
  });

  it("does not inject messageThreadId defaults for missing params objects", async () => {
    const { resolveOpenClawPluginToolsForOptions } = await import("./openclaw-plugin-tools.js");
    const executeMock = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      details: {},
    }));
    const tool: AnyAgentTool = {
      name: "plugin-message-thread-default",
      label: "plugin-message-thread-default",
      description: "test",
      parameters: {
        type: "object",
        properties: {
          messageThreadId: { type: "number" },
        },
      },
      execute: executeMock,
    };
    resolvePluginToolsMock.mockReturnValue([tool] as never);

    const wrapped = resolveOpenClawPluginToolsForOptions({
      options: {
        agentThreadId: "77",
      },
    }).find((candidate) => candidate.name === tool.name);

    await wrapped?.execute("call-1", undefined);

    expect(executeMock).toHaveBeenCalledWith("call-1", undefined);
  });

  it("does not infer string thread ids for tools that declare thread parameters", async () => {
    const { resolveOpenClawPluginToolsForOptions } = await import("./openclaw-plugin-tools.js");
    const executeMock = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      details: {},
    }));
    const tool: AnyAgentTool = {
      name: "plugin-string-thread-default",
      label: "plugin-string-thread-default",
      description: "test",
      parameters: {
        type: "object",
        properties: {
          threadId: { type: "string" },
        },
      },
      execute: executeMock,
    };
    resolvePluginToolsMock.mockReturnValue([tool] as never);

    const wrapped = resolveOpenClawPluginToolsForOptions({
      options: {
        agentThreadId: "77",
      },
    }).find((candidate) => candidate.name === tool.name);

    await wrapped?.execute("call-1", {});

    expect(executeMock).toHaveBeenCalledWith("call-1", {});
  });

  it("preserves explicit thread params when ambient defaults exist", async () => {
    const { resolveOpenClawPluginToolsForOptions } = await import("./openclaw-plugin-tools.js");
    const executeMock = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      details: {},
    }));
    const tool: AnyAgentTool = {
      name: "plugin-thread-override",
      label: "plugin-thread-override",
      description: "test",
      parameters: {
        type: "object",
        properties: {
          threadId: { type: "string" },
        },
      },
      execute: executeMock,
    };
    resolvePluginToolsMock.mockReturnValue([tool] as never);

    const wrapped = resolveOpenClawPluginToolsForOptions({
      options: {
        agentThreadId: "111.222",
      },
    }).find((candidate) => candidate.name === tool.name);

    await wrapped?.execute("call-1", { threadId: "explicit" });

    expect(executeMock).toHaveBeenCalledWith("call-1", { threadId: "explicit" });
  });
});
