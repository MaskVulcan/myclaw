#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${OPENCLAW_WEIXIN_EXT_DIR:-$HOME/.openclaw/extensions/openclaw-weixin}"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "target extension dir not found: $TARGET_DIR" >&2
  echo "install @tencent-weixin/openclaw-weixin first, then rerun this script." >&2
  exit 1
fi

mkdir -p \
  "$TARGET_DIR/src/api" \
  "$TARGET_DIR/src/messaging"

cp "$ROOT_DIR/src/api/api.ts" "$TARGET_DIR/src/api/api.ts"
cp "$ROOT_DIR/src/api/types.ts" "$TARGET_DIR/src/api/types.ts"
cp "$ROOT_DIR/src/messaging/send.ts" "$TARGET_DIR/src/messaging/send.ts"
cp "$ROOT_DIR/src/messaging/process-message.ts" "$TARGET_DIR/src/messaging/process-message.ts"
cp "$ROOT_DIR/src/messaging/send-payload.ts" "$TARGET_DIR/src/messaging/send-payload.ts"
cp "$ROOT_DIR/src/messaging/pending-reminders.ts" "$TARGET_DIR/src/messaging/pending-reminders.ts"
cp "$ROOT_DIR/src/messaging/pending-reminders.test.ts" "$TARGET_DIR/src/messaging/pending-reminders.test.ts"

echo "restored openclaw-weixin backup into: $TARGET_DIR"
echo "next step: systemctl --user restart openclaw-gateway.service"
