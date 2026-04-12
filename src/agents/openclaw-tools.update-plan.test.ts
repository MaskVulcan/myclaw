import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

vi.mock("../plugins/tools.js", () => ({
  resolvePluginTools: () => [],
}));

function createStubTool(name: string) {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({ output: name })),
  };
}

function mockToolFactory(name: string) {
  return () => createStubTool(name);
}

vi.mock("./tools/agents-list-tool.js", () => ({
  createAgentsListTool: mockToolFactory("agents_list_stub"),
}));
vi.mock("./tools/canvas-tool.js", () => ({
  createCanvasTool: mockToolFactory("canvas_stub"),
}));
vi.mock("./tools/cron-tool.js", () => ({
  createCronTool: mockToolFactory("cron_stub"),
}));
vi.mock("./tools/gateway-tool.js", () => ({
  createGatewayTool: mockToolFactory("gateway_stub"),
}));
vi.mock("./tools/image-generate-tool.js", () => ({
  createImageGenerateTool: mockToolFactory("image_generate_stub"),
}));
vi.mock("./tools/image-tool.js", () => ({
  createImageTool: mockToolFactory("image_stub"),
}));
vi.mock("./tools/message-tool.js", () => ({
  createMessageTool: mockToolFactory("message_stub"),
}));
vi.mock("./tools/nodes-tool.js", () => ({
  createNodesTool: mockToolFactory("nodes_stub"),
}));
vi.mock("./tools/pdf-tool.js", () => ({
  createPdfTool: mockToolFactory("pdf_stub"),
}));
vi.mock("./tools/session-status-tool.js", () => ({
  createSessionStatusTool: mockToolFactory("session_status_stub"),
}));
vi.mock("./tools/sessions-history-tool.js", () => ({
  createSessionsHistoryTool: mockToolFactory("sessions_history_stub"),
}));
vi.mock("./tools/sessions-list-tool.js", () => ({
  createSessionsListTool: mockToolFactory("sessions_list_stub"),
}));
vi.mock("./tools/sessions-search-tool.js", () => ({
  createSessionsSearchTool: mockToolFactory("sessions_search_stub"),
}));
vi.mock("./tools/sessions-send-tool.js", () => ({
  createSessionsSendTool: mockToolFactory("sessions_send_stub"),
}));
vi.mock("./tools/sessions-spawn-tool.js", () => ({
  createSessionsSpawnTool: mockToolFactory("sessions_spawn_stub"),
}));
vi.mock("./tools/sessions-yield-tool.js", () => ({
  createSessionsYieldTool: mockToolFactory("sessions_yield_stub"),
}));
vi.mock("./tools/subagents-tool.js", () => ({
  createSubagentsTool: mockToolFactory("subagents_stub"),
}));
vi.mock("./tools/tts-tool.js", () => ({
  createTtsTool: mockToolFactory("tts_stub"),
}));
vi.mock("./tools/web-tools.js", () => ({
  createWebFetchTool: mockToolFactory("web_fetch_stub"),
  createWebSearchTool: mockToolFactory("web_search_stub"),
}));

let createOpenClawTools: typeof import("./openclaw-tools.js").createOpenClawTools;

describe("openclaw-tools update_plan gating", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ createOpenClawTools } = await import("./openclaw-tools.js"));
  });

  it("keeps update_plan disabled by default", () => {
    const tools = createOpenClawTools({
      config: {} as OpenClawConfig,
      disablePluginTools: true,
    });

    expect(tools.map((tool) => tool.name)).not.toContain("update_plan");
  });

  it("registers update_plan when explicitly enabled", () => {
    const tools = createOpenClawTools({
      config: {
        tools: {
          experimental: {
            planTool: true,
          },
        },
      } as OpenClawConfig,
      disablePluginTools: true,
    });

    const updatePlan = tools.find((tool) => tool.name === "update_plan");
    expect(updatePlan?.displaySummary).toBe("Track a short structured work plan.");
  });

  it("auto-enables update_plan for OpenAI-family providers", () => {
    const openaiTools = createOpenClawTools({
      config: {} as OpenClawConfig,
      modelProvider: "openai",
      disablePluginTools: true,
    });
    const codexTools = createOpenClawTools({
      config: {} as OpenClawConfig,
      modelProvider: "openai-codex",
      disablePluginTools: true,
    });
    const anthropicTools = createOpenClawTools({
      config: {} as OpenClawConfig,
      modelProvider: "anthropic",
      disablePluginTools: true,
    });

    expect(openaiTools.map((tool) => tool.name)).toContain("update_plan");
    expect(codexTools.map((tool) => tool.name)).toContain("update_plan");
    expect(anthropicTools.map((tool) => tool.name)).not.toContain("update_plan");
  });

  it("lets config disable update_plan auto-enable", () => {
    const tools = createOpenClawTools({
      config: {
        tools: {
          experimental: {
            planTool: false,
          },
        },
      } as OpenClawConfig,
      modelProvider: "openai",
      disablePluginTools: true,
    });

    expect(tools.map((tool) => tool.name)).not.toContain("update_plan");
  });
});
