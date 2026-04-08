import { describe, expect, it } from "vitest";
import {
  listBundledPluginBuildEntries,
  listBundledPluginPackArtifacts,
} from "../../scripts/lib/bundled-plugin-build-entries.mjs";

describe("bundled plugin build entries", () => {
  it("includes package-backed runtime support packages without plugin manifests", () => {
    const entries = listBundledPluginBuildEntries();

    expect(entries).toMatchObject({
      "extensions/image-generation-core/api": "extensions/image-generation-core/api.ts",
      "extensions/image-generation-core/runtime-api":
        "extensions/image-generation-core/runtime-api.ts",
      "extensions/media-understanding-core/runtime-api":
        "extensions/media-understanding-core/runtime-api.ts",
      "extensions/speech-core/api": "extensions/speech-core/api.ts",
      "extensions/speech-core/runtime-api": "extensions/speech-core/runtime-api.ts",
    });
  });

  it("keeps package-less helper directories out of bundled build entries", () => {
    const entries = listBundledPluginBuildEntries();

    expect(entries).not.toHaveProperty("extensions/anthropic-vertex/api");
    expect(entries).not.toHaveProperty("extensions/shared/runtime");
  });

  it("packs runtime support packages without requiring plugin manifests", () => {
    const artifacts = listBundledPluginPackArtifacts();

    expect(artifacts).toContain("dist/extensions/image-generation-core/package.json");
    expect(artifacts).toContain("dist/extensions/image-generation-core/runtime-api.js");
    expect(artifacts).not.toContain("dist/extensions/image-generation-core/openclaw.plugin.json");
    expect(artifacts).toContain("dist/extensions/media-understanding-core/package.json");
    expect(artifacts).toContain("dist/extensions/media-understanding-core/runtime-api.js");
    expect(artifacts).not.toContain(
      "dist/extensions/media-understanding-core/openclaw.plugin.json",
    );
    expect(artifacts).toContain("dist/extensions/speech-core/package.json");
    expect(artifacts).toContain("dist/extensions/speech-core/runtime-api.js");
    expect(artifacts).not.toContain("dist/extensions/speech-core/openclaw.plugin.json");
  });

  it("keeps bundled Slack and Telegram setup entries on the packed surface", () => {
    const artifacts = listBundledPluginPackArtifacts();

    expect(artifacts).toContain("dist/extensions/slack/setup-entry.js");
    expect(artifacts).toContain("dist/extensions/telegram/setup-entry.js");
  });
});
