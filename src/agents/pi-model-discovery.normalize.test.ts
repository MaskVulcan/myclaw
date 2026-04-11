import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRuntimeModel } from "../plugins/types.js";

const normalizeProviderResolvedModelWithPlugin = vi.hoisted(() =>
  vi.fn((params: { context: { model: ProviderRuntimeModel } }) => ({
    ...params.context.model,
    baseUrl: "https://plugin.example.com/v1",
  })),
);
const applyProviderResolvedModelCompatWithPlugins = vi.hoisted(() =>
  vi.fn((params: { context: { model: ProviderRuntimeModel } }) => {
    expect(params.context.model.baseUrl).toBe("https://plugin.example.com/v1");
    const compat = params.context.model.compat;
    return {
      ...params.context.model,
      compat: compat ? { ...compat, supportsStrictMode: true } : { supportsStrictMode: true },
    };
  }),
);
const applyProviderResolvedTransportWithPlugin = vi.hoisted(() =>
  vi.fn((params: { context: { model: ProviderRuntimeModel } }) => {
    expect(params.context.model.compat).toMatchObject({ supportsStrictMode: true });
    return {
      ...params.context.model,
      api: "openai-completions" as ProviderRuntimeModel["api"],
      baseUrl: "https://transport.example.com/v1",
    };
  }),
);

vi.mock(import("../plugins/provider-runtime.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    applyProviderResolvedModelCompatWithPlugins,
    applyProviderResolvedTransportWithPlugin,
    normalizeProviderResolvedModelWithPlugin,
    resolveProviderSyntheticAuthWithPlugin: () => undefined,
  };
});

vi.mock("../plugins/synthetic-auth.runtime.js", () => ({
  resolveRuntimeSyntheticAuthProviderRefs: () => [],
}));

let normalizeDiscoveredPiModel: typeof import("./pi-model-discovery.js").normalizeDiscoveredPiModel;

const BASE_MODEL: ProviderRuntimeModel = {
  id: "demo-model",
  name: "Demo Model",
  api: "openai-responses",
  provider: "demo",
  baseUrl: "https://api.example.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
};

describe("normalizeDiscoveredPiModel", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ normalizeDiscoveredPiModel } = await import("./pi-model-discovery.js"));
    normalizeProviderResolvedModelWithPlugin.mockClear();
    applyProviderResolvedModelCompatWithPlugins.mockClear();
    applyProviderResolvedTransportWithPlugin.mockClear();
  });

  it("chains provider normalization, compat contributions, and transport rewrites", () => {
    const normalized = normalizeDiscoveredPiModel(BASE_MODEL, "/tmp/openclaw-agent");

    expect(normalizeProviderResolvedModelWithPlugin).toHaveBeenCalledWith({
      provider: "demo",
      context: {
        provider: "demo",
        modelId: "demo-model",
        model: BASE_MODEL,
        agentDir: "/tmp/openclaw-agent",
      },
    });
    expect(applyProviderResolvedModelCompatWithPlugins).toHaveBeenCalled();
    expect(applyProviderResolvedTransportWithPlugin).toHaveBeenCalled();
    expect(normalized).toMatchObject({
      id: "demo-model",
      provider: "demo",
      api: "openai-completions",
      baseUrl: "https://transport.example.com/v1",
      compat: {
        supportsStrictMode: true,
      },
    });
  });
});
