import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "./system-prompt.js";

describe("system prompt update_plan guidance", () => {
  it("lists update_plan and its guidance when the tool is available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["exec", "update_plan", "sessions_list"],
    });

    expect(prompt).toContain("- update_plan: Track a short structured work plan");
    expect(prompt).toContain(
      "For non-trivial multi-step work, keep a short plan updated with `update_plan`.",
    );
    expect(prompt).toContain(
      "When you use `update_plan`, keep exactly one step `in_progress` until the work is done.",
    );
  });

  it("omits update_plan guidance when the tool is unavailable", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["exec", "sessions_list"],
    });

    expect(prompt).not.toContain("keep a short plan updated with `update_plan`");
    expect(prompt).not.toContain("- update_plan:");
  });
});
