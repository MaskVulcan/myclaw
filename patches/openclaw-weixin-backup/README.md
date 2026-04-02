# openclaw-weixin local backup

This directory stores local backup snapshots for the installed
`@tencent-weixin/openclaw-weixin` extension when we need to preserve
production fixes outside the upstream npm package.

The snapshot is the repo-side source of truth for local Weixin extension
hotfixes that are currently running from `~/.openclaw/extensions/openclaw-weixin`.
If the installed extension is patched again, sync the changed files back into
the latest snapshot and update its README before relying on the live machine.

Current snapshot:

- `2026-04-03/`

Use the snapshot README and `apply.sh` inside that folder to restore the
backup onto another machine after installing the official extension.
