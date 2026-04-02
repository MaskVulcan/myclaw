import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliRuntimeCapture } from "../test-runtime-capture.js";

const stewardIngestCommand = vi.fn();
const stewardCurateCommand = vi.fn();
const stewardMaintainCommand = vi.fn();
const stewardIncubateSkillsCommand = vi.fn();
const stewardPromoteSkillsCommand = vi.fn();
const stewardCycleCommand = vi.fn();

const { defaultRuntime: runtime, resetRuntimeCapture } = createCliRuntimeCapture();

vi.mock("../../commands/steward.js", () => ({
  stewardIngestCommand,
  stewardCurateCommand,
  stewardMaintainCommand,
  stewardIncubateSkillsCommand,
  stewardPromoteSkillsCommand,
  stewardCycleCommand,
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: runtime,
}));

let registerStewardCommand: typeof import("./register.steward.js").registerStewardCommand;

beforeAll(async () => {
  ({ registerStewardCommand } = await import("./register.steward.js"));
});

describe("registerStewardCommand", () => {
  async function runCli(args: string[]) {
    const program = new Command();
    registerStewardCommand(program);
    await program.parseAsync(args, { from: "user" });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeCapture();
    runtime.exit.mockImplementation(() => {});
    stewardIngestCommand.mockResolvedValue(undefined);
    stewardCurateCommand.mockResolvedValue(undefined);
    stewardMaintainCommand.mockResolvedValue(undefined);
    stewardIncubateSkillsCommand.mockResolvedValue(undefined);
    stewardPromoteSkillsCommand.mockResolvedValue(undefined);
    stewardCycleCommand.mockResolvedValue(undefined);
  });

  it("forwards steward ingest options", async () => {
    await runCli([
      "steward",
      "ingest",
      "--store",
      "/tmp/sessions.json",
      "--workspace",
      "/tmp/workspace",
      "--agent",
      "ops",
      "--active",
      "60",
      "--recent",
      "3",
      "--apply",
      "--json",
    ]);

    expect(stewardIngestCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        store: "/tmp/sessions.json",
        workspace: "/tmp/workspace",
        agent: "ops",
        allAgents: false,
        active: "60",
        recent: "3",
        apply: true,
        json: true,
      }),
      runtime,
    );
  });

  it("forwards --all-agents to steward ingest", async () => {
    await runCli(["steward", "ingest", "--all-agents"]);

    expect(stewardIngestCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        allAgents: true,
      }),
      runtime,
    );
  });

  it("forwards steward curate options", async () => {
    await runCli([
      "steward",
      "curate",
      "--workspace",
      "/tmp/workspace",
      "--agent",
      "ops",
      "--limit",
      "7",
      "--apply",
      "--json",
    ]);

    expect(stewardCurateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "/tmp/workspace",
        agent: "ops",
        limit: "7",
        apply: true,
        json: true,
      }),
      runtime,
    );
  });

  it("forwards steward maintain options", async () => {
    await runCli([
      "steward",
      "maintain",
      "--workspace",
      "/tmp/workspace",
      "--agent",
      "ops",
      "--apply",
      "--json",
    ]);

    expect(stewardMaintainCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "/tmp/workspace",
        agent: "ops",
        apply: true,
        json: true,
      }),
      runtime,
    );
  });

  it("forwards steward incubate-skills options", async () => {
    await runCli([
      "steward",
      "incubate-skills",
      "--workspace",
      "/tmp/workspace",
      "--agent",
      "ops",
      "--limit",
      "9",
      "--apply",
      "--json",
    ]);

    expect(stewardIncubateSkillsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "/tmp/workspace",
        agent: "ops",
        limit: "9",
        apply: true,
        json: true,
      }),
      runtime,
    );
  });

  it("forwards steward promote-skills options", async () => {
    await runCli([
      "steward",
      "promote-skills",
      "--workspace",
      "/tmp/workspace",
      "--agent",
      "ops",
      "--limit",
      "4",
      "--min-candidates",
      "3",
      "--apply",
      "--json",
    ]);

    expect(stewardPromoteSkillsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "/tmp/workspace",
        agent: "ops",
        limit: "4",
        minCandidates: "3",
        apply: true,
        json: true,
      }),
      runtime,
    );
  });

  it("forwards steward cycle options", async () => {
    await runCli([
      "steward",
      "cycle",
      "--store",
      "/tmp/sessions.json",
      "--workspace",
      "/tmp/workspace",
      "--agent",
      "ops",
      "--all-agents",
      "--active",
      "60",
      "--recent",
      "3",
      "--curate-limit",
      "8",
      "--incubate-limit",
      "9",
      "--promote-limit",
      "4",
      "--min-candidates",
      "3",
      "--apply",
      "--json",
    ]);

    expect(stewardCycleCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        store: "/tmp/sessions.json",
        workspace: "/tmp/workspace",
        agent: "ops",
        allAgents: true,
        active: "60",
        recent: "3",
        curateLimit: "8",
        incubateLimit: "9",
        promoteLimit: "4",
        minCandidates: "3",
        apply: true,
        json: true,
      }),
      runtime,
    );
  });
});
