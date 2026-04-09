import { afterEach, describe, expect, it, vi } from "vitest";

describe("pi-model-discovery module compatibility", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@mariozechner/pi-coding-agent");
  });

  it("loads when InMemoryAuthStorageBackend is not exported", async () => {
    vi.resetModules();
    vi.doMock("@mariozechner/pi-coding-agent", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();
      return {
        ...actual,
        InMemoryAuthStorageBackend: undefined,
      };
    });

    await expect(import("./pi-model-discovery.js")).resolves.toMatchObject({
      discoverAuthStorage: expect.any(Function),
      discoverModels: expect.any(Function),
    });
  });
});
