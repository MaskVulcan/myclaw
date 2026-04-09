import fs from "node:fs/promises";
import path from "node:path";
import type {
  AssembleResult as RootAssembleResult,
  BootstrapResult as RootBootstrapResult,
  CompactResult as RootCompactResult,
  IngestBatchResult as RootIngestBatchResult,
  IngestResult as RootIngestResult,
  ProviderPreparedRuntimeAuth as RootProviderPreparedRuntimeAuth,
  ResolvedProviderRuntimeAuth as RootResolvedProviderRuntimeAuth,
  SubagentEndReason as RootSubagentEndReason,
  SubagentSpawnPreparation as RootSubagentSpawnPreparation,
} from "./index.js";
import type {
  AssembleResult,
  BootstrapResult,
  CompactResult,
  IngestBatchResult,
  IngestResult,
  SubagentEndReason,
  SubagentSpawnPreparation,
} from "../context-engine/types.js";
import type { ProviderPreparedRuntimeAuth } from "../plugins/types.js";
import type { ResolvedProviderRuntimeAuth } from "../plugins/runtime/model-auth-types.js";
import { describe, expect, expectTypeOf, it } from "vitest";
import { buildPluginSdkPackageExports } from "./entrypoints.js";

async function collectRuntimeExports(filePath: string, seen = new Set<string>()) {
  const normalizedPath = path.resolve(filePath);
  if (seen.has(normalizedPath)) {
    return new Set<string>();
  }
  seen.add(normalizedPath);

  const source = await fs.readFile(normalizedPath, "utf8");
  const exportNames = new Set<string>();

  for (const match of source.matchAll(/export\s+(?!type\b)\{([\s\S]*?)\}\s+from\s+"([^"]+)";/g)) {
    const names = match[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.split(/\s+as\s+/).at(-1) ?? part);
    for (const name of names) {
      exportNames.add(name);
    }
  }

  for (const match of source.matchAll(/export\s+\*\s+from\s+"([^"]+)";/g)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) {
      continue;
    }
    const nestedPath = path.resolve(
      path.dirname(normalizedPath),
      specifier.replace(/\.js$/, ".ts"),
    );
    const nestedExports = await collectRuntimeExports(nestedPath, seen);
    for (const name of nestedExports) {
      exportNames.add(name);
    }
  }

  return exportNames;
}

async function readIndexRuntimeExports() {
  return await collectRuntimeExports(path.join(import.meta.dirname, "index.ts"));
}

describe("plugin-sdk exports", () => {
  it("does not expose runtime modules", async () => {
    const runtimeExports = await readIndexRuntimeExports();
    const forbidden = [
      "chunkMarkdownText",
      "chunkText",
      "hasControlCommand",
      "isControlCommandMessage",
      "shouldComputeCommandAuthorized",
      "shouldHandleTextCommands",
      "buildMentionRegexes",
      "matchesMentionPatterns",
      "resolveStateDir",
      "writeConfigFile",
      "enqueueSystemEvent",
      "fetchRemoteMedia",
      "saveMediaBuffer",
      "formatAgentEnvelope",
      "buildPairingReply",
      "resolveAgentRoute",
      "dispatchReplyFromConfig",
      "createReplyDispatcherWithTyping",
      "dispatchReplyWithBufferedBlockDispatcher",
      "resolveCommandAuthorizedFromAuthorizers",
      "monitorSlackProvider",
      "monitorTelegramProvider",
      "monitorIMessageProvider",
      "monitorSignalProvider",
      "sendMessageSlack",
      "sendMessageTelegram",
      "sendMessageIMessage",
      "sendMessageSignal",
      "sendMessageWhatsApp",
      "probeSlack",
      "probeTelegram",
      "probeIMessage",
      "probeSignal",
    ];

    for (const key of forbidden) {
      expect(runtimeExports.has(key)).toBe(false);
    }
  });

  it("keeps the root runtime surface intentionally small", async () => {
    const runtimeExports = await readIndexRuntimeExports();
    expect([...runtimeExports].toSorted()).toEqual([
      "delegateCompactionToRuntime",
      "emptyPluginConfigSchema",
      "onDiagnosticEvent",
      "registerContextEngine",
    ]);
  });

  it("keeps package.json plugin-sdk exports synced with the manifest", async () => {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
      exports?: Record<string, unknown>;
    };
    const currentPluginSdkExports = Object.fromEntries(
      Object.entries(packageJson.exports ?? {}).filter(([key]) => key.startsWith("./plugin-sdk")),
    );

    expect(currentPluginSdkExports).toEqual(buildPluginSdkPackageExports());
  });

  it("re-exports runtime auth and context-engine types on the root surface", () => {
    expectTypeOf<RootProviderPreparedRuntimeAuth>().toEqualTypeOf<ProviderPreparedRuntimeAuth>();
    expectTypeOf<RootResolvedProviderRuntimeAuth>().toEqualTypeOf<ResolvedProviderRuntimeAuth>();
    expectTypeOf<RootAssembleResult>().toEqualTypeOf<AssembleResult>();
    expectTypeOf<RootBootstrapResult>().toEqualTypeOf<BootstrapResult>();
    expectTypeOf<RootCompactResult>().toEqualTypeOf<CompactResult>();
    expectTypeOf<RootIngestResult>().toEqualTypeOf<IngestResult>();
    expectTypeOf<RootIngestBatchResult>().toEqualTypeOf<IngestBatchResult>();
    expectTypeOf<RootSubagentSpawnPreparation>().toEqualTypeOf<SubagentSpawnPreparation>();
    expectTypeOf<RootSubagentEndReason>().toEqualTypeOf<SubagentEndReason>();
  });
});
