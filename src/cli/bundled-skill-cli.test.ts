import { describe, expect, it, vi } from "vitest";
import {
  extractPrimaryCommandPassthroughArgs,
  runBundledSkillScript,
} from "./bundled-skill-cli.js";

describe("bundled skill cli helpers", () => {
  it("extracts passthrough args after the primary command while skipping root options", () => {
    expect(
      extractPrimaryCommandPassthroughArgs(
        [
          "node",
          "openclaw",
          "--profile",
          "work",
          "--log-level",
          "debug",
          "calendar",
          "show",
          "--week",
        ],
        "calendar",
      ),
    ).toEqual(["show", "--week"]);
  });

  it("rejects unknown root flags before the passthrough command", () => {
    expect(
      extractPrimaryCommandPassthroughArgs(
        ["node", "openclaw", "--unknown-root-flag", "calendar", "show"],
        "calendar",
      ),
    ).toBeNull();
  });

  it("runs the bundled CLI script through bash and returns the child exit code", () => {
    const spawn = vi.fn(() => ({ status: 0 }));

    expect(runBundledSkillScript("/tmp/fake-script", ["show", "--week"], { spawn })).toBe(0);
    expect(spawn).toHaveBeenCalledWith("bash", ["/tmp/fake-script", "show", "--week"], {
      stdio: "inherit",
      env: process.env,
      windowsHide: true,
    });
  });

  it("logs a launch error and returns failure when the child cannot start", () => {
    const spawn = vi.fn(() => ({ status: null, error: new Error("boom") }));
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };

    expect(runBundledSkillScript("/tmp/fake-script", [], { spawn, runtime })).toBe(1);
    expect(runtime.error).toHaveBeenCalledWith(
      "openclaw: failed to launch bundled CLI /tmp/fake-script: boom",
    );
  });
});
