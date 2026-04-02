# Weixin extension backup

This snapshot preserves local fixes applied to the installed
`@tencent-weixin/openclaw-weixin` extension on `2026-04-03`.

Target extension root:

- Default: `~/.openclaw/extensions/openclaw-weixin`

Base package:

- npm package: `@tencent-weixin/openclaw-weixin`
- observed installed version: `2.1.1`

Why this backup exists:

- proactive Weixin sends can return `HTTP 200` with `{"ret":-2}`
- scheduled reminder sends should not be treated as success
- failed scheduled reminders should be queued and retried after the next inbound token refresh
- pending reminders should be isolated per user and only keep the newest failed reminder for the same user

Related `myclaw` commits:

- `e996ecdda0` `fix: queue failed weixin reminders until token refresh`
- `fdedc1110f` `fix: replace stale pending weixin reminders per user`

Backed up files:

- `src/api/api.ts`
- `src/api/types.ts`
- `src/messaging/send.ts`
- `src/messaging/process-message.ts`
- `src/messaging/send-payload.ts`
- `src/messaging/pending-reminders.ts`
- `src/messaging/pending-reminders.test.ts`

Restore on another machine:

```bash
cd /root/gitsource/myclaw/patches/openclaw-weixin-backup/2026-04-03
./apply.sh
```

Restore to a custom extension directory:

```bash
OPENCLAW_WEIXIN_EXT_DIR=/path/to/openclaw-weixin ./apply.sh
```

After restore, restart the user gateway service:

```bash
systemctl --user restart openclaw-gateway.service
```
