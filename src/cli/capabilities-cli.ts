import type { Command } from "commander";
import {
  getCapabilityDescriptor,
  listCapabilityDescriptors,
  runCapability,
} from "../capabilities/registry.js";
import { defaultRuntime } from "../runtime.js";

function writeCapabilityError(code: string, message: string, details?: unknown): never {
  defaultRuntime.writeJson({
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  });
  defaultRuntime.exit(1);
}

function parseJsonInput(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeCapabilityError("invalid_json", `Failed to parse --input-json: ${message}`);
  }
}

export function registerCapabilitiesCli(program: Command) {
  const capabilities = program
    .command("capabilities")
    .description("Describe and run structured CLI capabilities with schema constraints");

  capabilities
    .command("list")
    .description("List registered capabilities")
    .action(() => {
      defaultRuntime.writeJson({
        ok: true,
        capabilities: listCapabilityDescriptors(),
      });
    });

  capabilities
    .command("describe")
    .description("Describe one capability, including input/output schema")
    .argument("<id>", "Capability id")
    .action((id: string) => {
      const description = getCapabilityDescriptor(id);
      if (!description) {
        writeCapabilityError("unknown_capability", `Unknown capability: ${id}`);
      }
      defaultRuntime.writeJson({
        ok: true,
        capability: description,
      });
    });

  capabilities
    .command("run")
    .description("Run a capability with structured JSON input")
    .argument("<id>", "Capability id")
    .requiredOption("--input-json <json>", "Capability input JSON")
    .action(async (id: string, opts: { inputJson: string }) => {
      try {
        const result = await runCapability({
          id,
          input: parseJsonInput(opts.inputJson),
        });
        defaultRuntime.writeJson({
          ok: true,
          ...result,
        });
      } catch (error) {
        const details =
          error && typeof error === "object" && "issues" in error
            ? { issues: (error as { issues?: unknown }).issues }
            : undefined;
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error && typeof error === "object" && "issues" in error
            ? "invalid_input"
            : message.startsWith("Unknown capability:")
              ? "unknown_capability"
              : "capability_failed";
        writeCapabilityError(code, message, details);
      }
    });

  capabilities.action(() => {
    defaultRuntime.writeJson({
      ok: true,
      capabilities: listCapabilityDescriptors(),
    });
  });
}
