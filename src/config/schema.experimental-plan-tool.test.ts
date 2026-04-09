import { describe, expect, it } from "vitest";
import { buildConfigSchema } from "./schema.js";
import { ToolsSchema } from "./zod-schema.agent-runtime.js";

describe("config schema experimental plan tool", () => {
  it("parses tools.experimental.planTool", () => {
    const parsed = ToolsSchema.parse({
      experimental: {
        planTool: true,
      },
    });

    expect(parsed?.experimental?.planTool).toBe(true);
  });

  it("exposes ui hints for tools.experimental.planTool", () => {
    const schema = buildConfigSchema();

    expect(schema.uiHints["tools.experimental"]?.label).toBe("Experimental Tools");
    expect(schema.uiHints["tools.experimental.planTool"]?.label).toBe(
      "Enable Structured Plan Tool",
    );
    expect(schema.uiHints["tools.experimental.planTool"]?.help).toContain("update_plan");
  });
});
