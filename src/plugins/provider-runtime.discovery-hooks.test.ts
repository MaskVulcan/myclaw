import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderPlugin, ProviderRuntimeModel } from "./types.js";

type ResolvePluginProviders = typeof import("./providers.runtime.js").resolvePluginProviders;
type ResolveCatalogHookProviderPluginIds =
  typeof import("./providers.js").resolveCatalogHookProviderPluginIds;
type ResolveOwningPluginIdsForProvider =
  typeof import("./providers.js").resolveOwningPluginIdsForProvider;

const resolvePluginProvidersMock = vi.fn<ResolvePluginProviders>((_) => [] as ProviderPlugin[]);
const resolveCatalogHookProviderPluginIdsMock = vi.fn<ResolveCatalogHookProviderPluginIds>(
  (_) => [] as string[],
);
const resolveOwningPluginIdsForProviderMock = vi.fn<ResolveOwningPluginIdsForProvider>(
  (_) => undefined as string[] | undefined,
);

let applyProviderResolvedModelCompatWithPlugins: typeof import("./provider-runtime.js").applyProviderResolvedModelCompatWithPlugins;
let applyProviderResolvedTransportWithPlugin: typeof import("./provider-runtime.js").applyProviderResolvedTransportWithPlugin;
let resetProviderRuntimeHookCacheForTest: typeof import("./provider-runtime.js").resetProviderRuntimeHookCacheForTest;

const MODEL: ProviderRuntimeModel = {
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

beforeEach(async () => {
  vi.resetModules();
  vi.doMock("./providers.js", () => ({
    resolveCatalogHookProviderPluginIds: (params: unknown) =>
      resolveCatalogHookProviderPluginIdsMock(params as never),
    resolveOwningPluginIdsForProvider: (params: unknown) =>
      resolveOwningPluginIdsForProviderMock(params as never),
  }));
  vi.doMock("./providers.runtime.js", () => ({
    resolvePluginProviders: (params: unknown) => resolvePluginProvidersMock(params as never),
  }));
  ({
    applyProviderResolvedModelCompatWithPlugins,
    applyProviderResolvedTransportWithPlugin,
    resetProviderRuntimeHookCacheForTest,
  } = await import("./provider-runtime.js"));

  resetProviderRuntimeHookCacheForTest();
  resolvePluginProvidersMock.mockReset();
  resolvePluginProvidersMock.mockReturnValue([]);
  resolveCatalogHookProviderPluginIdsMock.mockReset();
  resolveCatalogHookProviderPluginIdsMock.mockReturnValue([]);
  resolveOwningPluginIdsForProviderMock.mockReset();
  resolveOwningPluginIdsForProviderMock.mockReturnValue(undefined);
});

describe("provider-runtime discovery hooks", () => {
  it("merges compat contributions from owner and foreign provider plugins", () => {
    resolveOwningPluginIdsForProviderMock.mockImplementation((params) =>
      params.provider === "openrouter" ? ["openrouter"] : undefined,
    );
    resolvePluginProvidersMock.mockImplementation((params) => {
      const onlyPluginIds = params.onlyPluginIds ?? [];
      const plugins: ProviderPlugin[] = [
        {
          id: "openrouter",
          label: "OpenRouter",
          auth: [],
          contributeResolvedModelCompat: () => ({ supportsStrictMode: true }),
        },
        {
          id: "mistral",
          label: "Mistral",
          auth: [],
          contributeResolvedModelCompat: ({ modelId }) =>
            modelId.startsWith("mistralai/") ? { supportsStore: false } : undefined,
        },
      ];
      return onlyPluginIds.length > 0
        ? plugins.filter((plugin) => onlyPluginIds.includes(plugin.id))
        : plugins;
    });

    expect(
      applyProviderResolvedModelCompatWithPlugins({
        provider: "openrouter",
        context: {
          provider: "openrouter",
          modelId: "mistralai/mistral-small-3.2-24b-instruct",
          model: {
            ...MODEL,
            provider: "openrouter",
            id: "mistralai/mistral-small-3.2-24b-instruct",
            compat: { supportsDeveloperRole: false },
          },
        },
      }),
    ).toMatchObject({
      compat: {
        supportsDeveloperRole: false,
        supportsStrictMode: true,
        supportsStore: false,
      },
    });
  });

  it("applies foreign transport normalization for custom provider hosts", () => {
    resolvePluginProvidersMock.mockImplementation((params) => {
      const onlyPluginIds = params.onlyPluginIds ?? [];
      const plugins: ProviderPlugin[] = [
        {
          id: "openai",
          label: "OpenAI",
          auth: [],
          normalizeTransport: ({ provider, api, baseUrl }) =>
            provider === "custom-openai" &&
            api === "openai-completions" &&
            baseUrl === "https://api.openai.com/v1"
              ? { api: "openai-responses", baseUrl }
              : undefined,
        },
      ];
      return onlyPluginIds.length > 0
        ? plugins.filter((plugin) => onlyPluginIds.includes(plugin.id))
        : plugins;
    });

    expect(
      applyProviderResolvedTransportWithPlugin({
        provider: "custom-openai",
        context: {
          provider: "custom-openai",
          modelId: "gpt-5.4",
          model: {
            ...MODEL,
            provider: "custom-openai",
            id: "gpt-5.4",
            api: "openai-completions",
            baseUrl: "https://api.openai.com/v1",
          },
        },
      }),
    ).toMatchObject({
      provider: "custom-openai",
      id: "gpt-5.4",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
    });
  });
});
