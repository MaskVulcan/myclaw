import { afterEach, describe, expect, it } from "vitest";
import { createEmptyPluginRegistry } from "./registry-empty.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "./runtime.js";
import { resolveRuntimeSyntheticAuthProviderRefs } from "./synthetic-auth.runtime.js";

afterEach(() => {
  resetPluginRuntimeStateForTest();
});

describe("synthetic-auth runtime", () => {
  it("falls back to bundled synthetic auth refs without an active registry", () => {
    expect(resolveRuntimeSyntheticAuthProviderRefs()).toEqual(["claude-cli", "ollama", "xai"]);
  });

  it("collects unique provider refs from active providers and cli backends", () => {
    const registry = createEmptyPluginRegistry();
    registry.providers.push(
      {
        pluginId: "ollama",
        provider: {
          id: "ollama",
          label: "Ollama",
          auth: [],
          resolveSyntheticAuth: () => ({
            apiKey: "ollama-local",
            source: "models.providers.ollama (synthetic local key)",
            mode: "api-key",
          }),
        },
        source: "test",
      },
      {
        pluginId: "ignored",
        provider: {
          id: "openrouter",
          label: "OpenRouter",
          auth: [],
        },
        source: "test",
      },
    );
    registry.cliBackends?.push(
      {
        pluginId: "claude-cli",
        backend: {
          id: "claude-cli",
          config: {},
          resolveSyntheticAuth: () => ({
            apiKey: "claude-cli-access-token",
            source: "Claude CLI native auth",
            mode: "oauth",
          }),
        },
        source: "test",
      } as never,
      {
        pluginId: "claude-cli-duplicate",
        backend: {
          id: "claude-cli",
          config: {},
          resolveSyntheticAuth: () => ({
            apiKey: "duplicate",
            source: "duplicate",
            mode: "oauth",
          }),
        },
        source: "test",
      } as never,
    );

    setActivePluginRegistry(registry);

    expect(resolveRuntimeSyntheticAuthProviderRefs()).toEqual(["ollama", "claude-cli"]);
  });
});
