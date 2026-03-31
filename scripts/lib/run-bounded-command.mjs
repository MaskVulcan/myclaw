import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

export async function runBoundedCommand({ command, args, timeoutMs, label, env = process.env }) {
  return await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let escalationTimer = null;

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

    child.on("error", (error) => {
      finish({
        code: null,
        error,
        signal: null,
        timedOut,
      });
    });

    child.on("close", (code, signal) => {
      finish({
        code,
        error: null,
        signal,
        timedOut,
      });
    });
  });
}
