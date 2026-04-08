import { describe, expect, it } from "vitest";
import { collectPreparedPrepackErrors, shouldSkipPrepack } from "../../scripts/openclaw-prepack.ts";

describe("openclaw prepack", () => {
  it("skips rebuild only when the prepared-artifacts flag is truthy", () => {
    expect(shouldSkipPrepack({})).toBe(false);
    expect(shouldSkipPrepack({ OPENCLAW_PREPACK_PREPARED: "0" })).toBe(false);
    expect(shouldSkipPrepack({ OPENCLAW_PREPACK_PREPARED: "false" })).toBe(false);
    expect(shouldSkipPrepack({ OPENCLAW_PREPACK_PREPARED: "1" })).toBe(true);
    expect(shouldSkipPrepack({ OPENCLAW_PREPACK_PREPARED: "yes" })).toBe(true);
  });

  it("accepts prepared artifacts only when the build smokes can run", () => {
    expect(
      collectPreparedPrepackErrors(
        [
          "dist/index.js",
          "dist/control-ui/index.html",
          "dist/channels/plugins/bundled.js",
          "dist/plugins/build-smoke-entry.js",
        ],
        ["dist/control-ui/assets/index.js"],
      ),
    ).toEqual([]);
  });

  it("flags missing build-smoke and Control UI artifacts in prepared mode", () => {
    expect(
      collectPreparedPrepackErrors(["dist/index.js", "dist/control-ui/index.html"], []),
    ).toEqual([
      "missing required prepared artifact: dist/channels/plugins/bundled.js",
      "missing required prepared artifact: dist/plugins/build-smoke-entry.js",
      "missing prepared Control UI asset payload under dist/control-ui/assets/",
    ]);
  });
});
