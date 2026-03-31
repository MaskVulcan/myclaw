import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

function writeExecutable(dir: string, name: string, contents: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, contents, {
    encoding: "utf8",
    mode: 0o755,
  });
  return filePath;
}

function runScript(scriptName: string, envOverrides: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [path.join(process.cwd(), "scripts", scriptName)], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...envOverrides,
    },
  });
}

describe("safe tooling wrappers", () => {
  it("soft-skips timed out tsgo in local mode", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openclaw-tsgo-safe-"));
    try {
      const fakeTsgo = writeExecutable(dir, "fake-tsgo", "#!/usr/bin/env bash\nsleep 2\n");
      const result = runScript("run-tsgo-safe.mjs", {
        OPENCLAW_TSGO_ALLOW_FALLBACK: "0",
        OPENCLAW_TSGO_BIN: fakeTsgo,
        OPENCLAW_TSGO_STRICT: "0",
        OPENCLAW_TSGO_TIMEOUT_MS: "100",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("tsgo timed out");
      expect(result.stderr).toContain("skipping hard failure");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("falls back to tsc in strict mode when enabled", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openclaw-tsgo-fallback-"));
    try {
      const fakeTsgo = writeExecutable(dir, "fake-tsgo", "#!/usr/bin/env bash\nsleep 2\n");
      const fakeTsc = writeExecutable(
        dir,
        "fake-tsc",
        "#!/usr/bin/env bash\necho 'tsc-fallback-ok' >&2\nexit 0\n",
      );
      const result = runScript("run-tsgo-safe.mjs", {
        OPENCLAW_TSC_BIN: fakeTsc,
        OPENCLAW_TSC_TIMEOUT_MS: "1000",
        OPENCLAW_TSGO_ALLOW_FALLBACK: "1",
        OPENCLAW_TSGO_BIN: fakeTsgo,
        OPENCLAW_TSGO_STRICT: "1",
        OPENCLAW_TSGO_TIMEOUT_MS: "100",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("Falling back to tsc");
      expect(result.stderr).toContain("tsc-fallback-ok");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("falls back to non-type-aware oxlint when type-aware linting times out", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openclaw-oxlint-safe-"));
    try {
      const fakeOxlint = writeExecutable(
        dir,
        "fake-oxlint",
        [
          "#!/usr/bin/env bash",
          'for arg in "$@"; do',
          '  if [ "$arg" = "--type-aware" ]; then',
          "    sleep 2",
          "    exit 0",
          "  fi",
          "done",
          "echo 'oxlint-fallback-ok' >&2",
          "exit 0",
        ].join("\n") + "\n",
      );
      const result = runScript("run-oxlint-safe.mjs", {
        OPENCLAW_OXLINT_BIN: fakeOxlint,
        OPENCLAW_OXLINT_FALLBACK_TIMEOUT_MS: "1000",
        OPENCLAW_OXLINT_TIMEOUT_MS: "100",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("retrying without --type-aware");
      expect(result.stderr).toContain("oxlint-fallback-ok");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("fails when type-aware oxlint times out and fallback is disabled", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openclaw-oxlint-strict-"));
    try {
      const fakeOxlint = writeExecutable(dir, "fake-oxlint", "#!/usr/bin/env bash\nsleep 2\n");
      const result = runScript("run-oxlint-safe.mjs", {
        OPENCLAW_OXLINT_ALLOW_FALLBACK: "0",
        OPENCLAW_OXLINT_BIN: fakeOxlint,
        OPENCLAW_OXLINT_TIMEOUT_MS: "100",
      });

      expect(result.status).toBe(124);
      expect(result.stderr).toContain("timed out");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
