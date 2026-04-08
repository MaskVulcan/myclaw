import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledEntriesPath = path.join(repoRoot, "dist", "channels", "plugins", "bundled.js");
assert.ok(fs.existsSync(bundledEntriesPath), `missing build output: ${bundledEntriesPath}`);

const {
  bundledChannelPlugins,
  bundledChannelSetupPlugins,
  getBundledChannelPlugin,
  requireBundledChannelPlugin,
} = await import(pathToFileURL(bundledEntriesPath).href);

assert.ok(Array.isArray(bundledChannelPlugins), "bundledChannelPlugins missing");
assert.ok(Array.isArray(bundledChannelSetupPlugins), "bundledChannelSetupPlugins missing");
assert.equal(typeof getBundledChannelPlugin, "function", "getBundledChannelPlugin missing");
assert.equal(typeof requireBundledChannelPlugin, "function", "requireBundledChannelPlugin missing");

const bundledIds = new Set(bundledChannelPlugins.map((plugin) => plugin?.id));
const setupIds = new Set(bundledChannelSetupPlugins.map((plugin) => plugin?.id));

for (const channelId of ["telegram", "slack"]) {
  assert.ok(bundledIds.has(channelId), `missing bundled channel entry: ${channelId}`);
  assert.ok(setupIds.has(channelId), `missing bundled setup entry: ${channelId}`);
  assert.equal(
    getBundledChannelPlugin(channelId)?.id,
    channelId,
    `bundled channel lookup failed: ${channelId}`,
  );
  assert.equal(
    requireBundledChannelPlugin(channelId).id,
    channelId,
    `bundled channel require failed: ${channelId}`,
  );
}

process.stdout.write("[build-smoke] bundled channel entry smoke passed\n");
