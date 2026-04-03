import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCapabilitiesCli } from "./capabilities-cli.js";

const runtime = vi.hoisted(() => ({
  writeJson: vi.fn(),
  exit: vi.fn((code: number) => {
    throw new Error(`exit ${code}`);
  }),
}));

vi.mock("../runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
  return {
    ...actual,
    defaultRuntime: runtime,
  };
});

describe("capabilities cli", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    registerCapabilitiesCli(program);
    return program;
  }

  it("lists capabilities as JSON by default", async () => {
    const program = createProgram();
    await program.parseAsync(["capabilities", "list"], { from: "user" });
    expect(runtime.writeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        capabilities: expect.arrayContaining([expect.objectContaining({ id: "skills.list" })]),
      }),
    );
  });

  it("returns structured error JSON for invalid input", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(
        ["capabilities", "run", "skills.list", "--input-json", '{"workspace":""}'],
        { from: "user" },
      ),
    ).rejects.toThrow("exit 1");
    expect(runtime.writeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "invalid_input",
        }),
      }),
    );
  });
});
