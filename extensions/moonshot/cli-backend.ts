import type { CliBackendPlugin } from "openclaw/plugin-sdk/cli-backend";
import {
  CLI_FRESH_WATCHDOG_DEFAULTS,
  CLI_RESUME_WATCHDOG_DEFAULTS,
} from "openclaw/plugin-sdk/cli-backend";

const KIMI_DEFAULT_MODEL = "kimi-k2.5";
const KIMI_CODING_MODEL = "kimi-code/kimi-for-coding";

const KIMI_MODEL_ALIASES: Record<string, string> = {
  default: KIMI_DEFAULT_MODEL,
  k2p5: KIMI_DEFAULT_MODEL,
  generic: KIMI_DEFAULT_MODEL,
  "kimi-k2.5": KIMI_DEFAULT_MODEL,
  thinking: "kimi-k2-thinking",
  "thinking-turbo": "kimi-k2-thinking-turbo",
  turbo: "kimi-k2-turbo",
  coding: KIMI_CODING_MODEL,
  "kimi-code": KIMI_CODING_MODEL,
  "kimi-for-coding": KIMI_CODING_MODEL,
};

export function buildKimiCliBackend(): CliBackendPlugin {
  return {
    id: "kimi-cli",
    config: {
      command: "kimi",
      args: ["--quiet", "--no-thinking", "--max-steps-per-turn", "1", "--prompt", "{{Prompt}}"],
      output: "text",
      input: "arg",
      modelArg: "--model",
      modelAliases: KIMI_MODEL_ALIASES,
      sessionArg: "--session",
      sessionMode: "always",
      reliability: {
        watchdog: {
          fresh: { ...CLI_FRESH_WATCHDOG_DEFAULTS },
          resume: { ...CLI_RESUME_WATCHDOG_DEFAULTS },
        },
      },
      serialize: true,
    },
  };
}
