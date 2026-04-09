import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolvePluginToolsMock } = vi.hoisted(() => ({
  resolvePluginToolsMock: vi.fn((params?: unknown) => {
    void params;
    return [];
  }),
}));

vi.mock("../plugins/tools.js", () => ({
  resolvePluginTools: resolvePluginToolsMock,
}));

describe("openclaw plugin tool helpers", () => {
  beforeEach(() => {
    resolvePluginToolsMock.mockClear();
  });

  it("skips plugin resolution when disablePluginTools is set", async () => {
    const { resolveOpenClawPluginToolsForOptions } = await import("./openclaw-plugin-tools.js");

    const tools = resolveOpenClawPluginToolsForOptions({
      options: {
        disablePluginTools: true,
      },
    });

    expect(tools).toEqual([]);
    expect(resolvePluginToolsMock).not.toHaveBeenCalled();
  });

  it("forwards trusted requester identity into plugin tool resolution", async () => {
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
});
