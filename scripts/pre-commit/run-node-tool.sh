#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: run-node-tool.sh <tool> [args...]" >&2
  exit 2
fi

tool="$1"
shift

case "$tool" in
  oxlint)
    SAFE_OXLINT_SCRIPT="$ROOT_DIR/scripts/run-oxlint-safe.mjs"
    if [[ -f "$SAFE_OXLINT_SCRIPT" ]] && command -v node >/dev/null 2>&1; then
      exec node "$SAFE_OXLINT_SCRIPT" "$@"
    fi
    ;;
  tsgo)
    SAFE_TSGO_SCRIPT="$ROOT_DIR/scripts/run-tsgo-safe.mjs"
    if [[ -f "$SAFE_TSGO_SCRIPT" ]] && command -v node >/dev/null 2>&1; then
      exec node "$SAFE_TSGO_SCRIPT" "$@"
    fi
    ;;
esac

if [[ -f "$ROOT_DIR/pnpm-lock.yaml" ]] && command -v pnpm >/dev/null 2>&1; then
  exec pnpm exec "$tool" "$@"
fi

if { [[ -f "$ROOT_DIR/bun.lockb" ]] || [[ -f "$ROOT_DIR/bun.lock" ]]; } && command -v bun >/dev/null 2>&1; then
  exec bunx --bun "$tool" "$@"
fi

if command -v npm >/dev/null 2>&1; then
  exec npm exec -- "$tool" "$@"
fi

if command -v npx >/dev/null 2>&1; then
  exec npx "$tool" "$@"
fi

echo "Missing package manager: pnpm, bun, or npm required." >&2
exit 1
