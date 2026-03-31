import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function parsePositiveIntEnv(name, fallbackValue) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return fallbackValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function parseNonNegativeIntEnv(name, fallbackValue) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return fallbackValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function parseBooleanEnv(name, fallbackValue) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return fallbackValue;
  }

  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`${name} must be a boolean-like value`);
  }
}

export function resolveToolCommand(toolName, overrideEnvName) {
  const override = process.env[overrideEnvName];
  if (override != null && override.trim() !== "") {
    return override;
  }

  const binaryName = process.platform === "win32" ? `${toolName}.cmd` : toolName;
  const localBinary = path.join(process.cwd(), "node_modules", ".bin", binaryName);
  return existsSync(localBinary) ? localBinary : toolName;
}

export function defaultOxlintThreads() {
  const cpuCount =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, Math.ceil(cpuCount / 2)));
}

export function hasFlag(args, flagName) {
  return args.some((arg) => arg === flagName || arg.startsWith(`${flagName}=`));
}

export function insertArgsBeforeDoubleDash(args, insertedArgs) {
  if (insertedArgs.length === 0) {
    return [...args];
  }

  const separatorIndex = args.indexOf("--");
  if (separatorIndex === -1) {
    return [...args, ...insertedArgs];
  }

  return [
    ...args.slice(0, separatorIndex),
    ...insertedArgs,
    "--",
    ...args.slice(separatorIndex + 1),
  ];
}

function signalProcessGroup(pid, signal) {
  if (pid == null) {
    return;
  }

  try {
    if (process.platform === "win32") {
      process.kill(pid, signal);
      return;
    }

    process.kill(-pid, signal);
  } catch {
    // Best-effort cleanup only.
  }
}

function readAvailableMemoryKb() {
  if (process.platform === "linux") {
    try {
      const meminfo = readFileSync("/proc/meminfo", "utf8");
      const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
    } catch {
      // Fall through to os.freemem().
    }
  }

  return Math.floor(os.freemem() / 1024);
}

function readProcessTreeRssKb(rootPid) {
  if (rootPid == null || process.platform === "win32") {
    return null;
  }

  const ps = spawnSync("ps", ["-axo", "pid=,ppid=,rss="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (ps.status !== 0 || typeof ps.stdout !== "string") {
    return null;
  }

  const childrenByParent = new Map();
  const rssByPid = new Map();
  for (const line of ps.stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }

    const [pidRaw, ppidRaw, rssRaw] = trimmed.split(/\s+/, 3);
    const pid = Number.parseInt(pidRaw, 10);
    const parentPid = Number.parseInt(ppidRaw, 10);
    const rssKb = Number.parseInt(rssRaw, 10);
    if (!Number.isFinite(pid) || !Number.isFinite(parentPid) || !Number.isFinite(rssKb)) {
      continue;
    }

    rssByPid.set(pid, rssKb);
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }

  let totalRssKb = 0;
  const visited = new Set();
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.pop();
    if (pid == null || visited.has(pid)) {
      continue;
    }
    visited.add(pid);
    totalRssKb += rssByPid.get(pid) ?? 0;
    for (const childPid of childrenByParent.get(pid) ?? []) {
      queue.push(childPid);
    }
  }

  return totalRssKb;
}

function formatMb(kb) {
  return Math.max(0, Math.round(kb / 1024));
}

function detectMemoryPressure(rootPid, memoryGuard) {
  if (!memoryGuard?.enabled) {
    return null;
  }

  const availableMemoryKb = readAvailableMemoryKb();
  if (
    Number.isFinite(memoryGuard.minAvailableMemoryKb) &&
    memoryGuard.minAvailableMemoryKb > 0 &&
    availableMemoryKb < memoryGuard.minAvailableMemoryKb
  ) {
    return {
      availableMemoryKb,
      kind: "available-memory",
      maxTreeRssKb: memoryGuard.maxTreeRssKb ?? null,
      minAvailableMemoryKb: memoryGuard.minAvailableMemoryKb,
      treeRssKb: null,
    };
  }

  if (rootPid == null) {
    return null;
  }

  const treeRssKb = readProcessTreeRssKb(rootPid);
  if (
    treeRssKb != null &&
    Number.isFinite(memoryGuard.maxTreeRssKb) &&
    memoryGuard.maxTreeRssKb > 0 &&
    treeRssKb > memoryGuard.maxTreeRssKb
  ) {
    return {
      availableMemoryKb,
      kind: "tree-rss",
      maxTreeRssKb: memoryGuard.maxTreeRssKb,
      minAvailableMemoryKb: memoryGuard.minAvailableMemoryKb ?? null,
      treeRssKb,
    };
  }

  return null;
}

function describeMemoryPressure(label, pressure, preflight) {
  if (pressure.kind === "available-memory") {
    return (
      `[openclaw] ${label} ${preflight ? "aborted before start" : "hit memory guard"}: ` +
      `available memory ${formatMb(pressure.availableMemoryKb)}MB below floor ` +
      `${formatMb(pressure.minAvailableMemoryKb)}MB.`
    );
  }

  return (
    `[openclaw] ${label} ${preflight ? "aborted before start" : "hit memory guard"}: ` +
    `process tree RSS ${formatMb(pressure.treeRssKb)}MB exceeds limit ` +
    `${formatMb(pressure.maxTreeRssKb)}MB.`
  );
}

export async function runBoundedCommand({
  command,
  args,
  timeoutMs,
  label,
  env = process.env,
  memoryGuard = null,
}) {
  return await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let escalationTimer = null;
    let memoryMonitor = null;
    let memoryPressure = null;

    const preflightMemoryPressure = detectMemoryPressure(null, memoryGuard);
    if (preflightMemoryPressure != null) {
      console.error(describeMemoryPressure(label, preflightMemoryPressure, true));
      resolve({
        code: null,
        error: null,
        memoryPressure: preflightMemoryPressure,
        signal: null,
        timedOut,
      });
      return;
    }

    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer != null) {
        clearTimeout(timer);
      }
      if (escalationTimer != null) {
        clearTimeout(escalationTimer);
      }
      if (memoryMonitor != null) {
        clearInterval(memoryMonitor);
      }
      resolve(result);
    };

    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            console.error(
              `[openclaw] ${label} timed out after ${timeoutMs}ms; terminating child process tree.`,
            );
            signalProcessGroup(child.pid, "SIGTERM");
            escalationTimer = setTimeout(() => {
              signalProcessGroup(child.pid, "SIGKILL");
            }, 2_500);
            escalationTimer.unref?.();
          }, timeoutMs)
        : null;

    timer?.unref?.();

    if (memoryGuard?.enabled) {
      const pollIntervalMs = memoryGuard.pollIntervalMs ?? 1_000;
      memoryMonitor = setInterval(() => {
        if (memoryPressure != null) {
          return;
        }

        const detectedMemoryPressure = detectMemoryPressure(child.pid, memoryGuard);
        if (detectedMemoryPressure == null) {
          return;
        }

        memoryPressure = detectedMemoryPressure;
        console.error(describeMemoryPressure(label, detectedMemoryPressure, false));
        signalProcessGroup(child.pid, "SIGTERM");
        escalationTimer = setTimeout(() => {
          signalProcessGroup(child.pid, "SIGKILL");
        }, 2_500);
        escalationTimer.unref?.();
      }, pollIntervalMs);
      memoryMonitor.unref?.();
    }

    child.on("error", (error) => {
      finish({
        code: null,
        error,
        memoryPressure,
        signal: null,
        timedOut,
      });
    });

    child.on("close", (code, signal) => {
      finish({
        code,
        error: null,
        memoryPressure,
        signal,
        timedOut,
      });
    });
  });
}
