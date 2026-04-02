---
summary: "CLI reference for `openclaw sessions` (list stored sessions + usage)"
read_when:
  - You want to list stored sessions and see recent activity
title: "sessions"
---

# `openclaw sessions`

List stored conversation sessions.

```bash
openclaw sessions
openclaw sessions --agent work
openclaw sessions --all-agents
openclaw sessions --active 120
openclaw sessions --json
openclaw sessions summary
openclaw sessions summary --all-agents --recent 3
```

Scope selection:

- default: configured default agent store
- `--agent <id>`: one configured agent store
- `--all-agents`: aggregate all configured agent stores
- `--store <path>`: explicit store path (cannot be combined with `--agent` or `--all-agents`)

`openclaw sessions --all-agents` reads configured agent stores. Gateway and ACP
session discovery are broader: they also include disk-only stores found under
the default `agents/` root or a templated `session.store` root. Those
discovered stores must resolve to regular `sessions.json` files inside the
agent root; symlinks and out-of-root paths are skipped.

JSON examples:

`openclaw sessions --all-agents --json`:

```json
{
  "path": null,
  "stores": [
    { "agentId": "main", "path": "/home/user/.openclaw/agents/main/sessions/sessions.json" },
    { "agentId": "work", "path": "/home/user/.openclaw/agents/work/sessions/sessions.json" }
  ],
  "allAgents": true,
  "count": 2,
  "activeMinutes": null,
  "sessions": [
    { "agentId": "main", "key": "agent:main:main", "model": "gpt-5" },
    { "agentId": "work", "key": "agent:work:main", "model": "claude-opus-4-6" }
  ]
}
```

## Summary overview

Use `openclaw sessions summary` for a lightweight aggregated view inspired by
Claude Code style session insights, but kept read-only and local:

```bash
openclaw sessions summary
openclaw sessions summary --agent work
openclaw sessions summary --all-agents
openclaw sessions summary --active 60
openclaw sessions summary --recent 3
openclaw sessions summary --json
```

What it shows:

- total sessions in scope
- recent activity windows (`1h`, `24h`, `7d`)
- top models, top agents, and session-kind distribution
- known token usage and estimated cost totals when session metadata has them
- a few recent session previews

`openclaw status` now includes a short version of this overview. Use
`openclaw sessions summary` when you want the dedicated breakdown.

`openclaw sessions summary --all-agents --json`:

```json
{
  "path": null,
  "stores": [
    { "agentId": "main", "path": "/home/user/.openclaw/agents/main/sessions/sessions.json" },
    { "agentId": "work", "path": "/home/user/.openclaw/agents/work/sessions/sessions.json" }
  ],
  "allAgents": true,
  "scannedCount": 12,
  "count": 12,
  "activeMinutes": null,
  "recentLimit": 3,
  "activity": { "last60m": 4, "last24h": 9, "last7d": 12 },
  "totals": {
    "sessions": 12,
    "knownTokens": 182000,
    "sessionsWithKnownTokens": 8,
    "estimatedCostUsd": 1.42,
    "sessionsWithEstimatedCost": 5
  },
  "models": [
    { "model": "gpt-5.2", "count": 7, "knownTokens": 99000 },
    { "model": "pi:opus", "count": 3, "knownTokens": 61000 }
  ],
  "agents": [
    { "agentId": "main", "count": 9, "knownTokens": 141000 },
    { "agentId": "work", "count": 3, "knownTokens": 41000 }
  ],
  "kinds": [
    { "kind": "direct", "count": 10 },
    { "kind": "group", "count": 2 }
  ],
  "recent": [
    {
      "key": "agent:main:main",
      "agentId": "main",
      "kind": "direct",
      "model": "gpt-5.2",
      "previewItems": [{ "role": "user", "text": "Investigate flaky tests" }]
    }
  ]
}
```

## Cleanup maintenance

Run maintenance now (instead of waiting for the next write cycle):

```bash
openclaw sessions cleanup --dry-run
openclaw sessions cleanup --agent work --dry-run
openclaw sessions cleanup --all-agents --dry-run
openclaw sessions cleanup --enforce
openclaw sessions cleanup --enforce --active-key "agent:main:telegram:direct:123"
openclaw sessions cleanup --json
```

`openclaw sessions cleanup` uses `session.maintenance` settings from config:

- Scope note: `openclaw sessions cleanup` maintains session stores/transcripts only. It does not prune cron run logs (`cron/runs/<jobId>.jsonl`), which are managed by `cron.runLog.maxBytes` and `cron.runLog.keepLines` in [Cron configuration](/automation/cron-jobs#configuration) and explained in [Cron maintenance](/automation/cron-jobs#maintenance).

- `--dry-run`: preview how many entries would be pruned/capped without writing.
  - In text mode, dry-run prints a per-session action table (`Action`, `Key`, `Age`, `Model`, `Flags`) so you can see what would be kept vs removed.
- `--enforce`: apply maintenance even when `session.maintenance.mode` is `warn`.
- `--active-key <key>`: protect a specific active key from disk-budget eviction.
- `--agent <id>`: run cleanup for one configured agent store.
- `--all-agents`: run cleanup for all configured agent stores.
- `--store <path>`: run against a specific `sessions.json` file.
- `--json`: print a JSON summary. With `--all-agents`, output includes one summary per store.

`openclaw sessions cleanup --all-agents --dry-run --json`:

```json
{
  "allAgents": true,
  "mode": "warn",
  "dryRun": true,
  "stores": [
    {
      "agentId": "main",
      "storePath": "/home/user/.openclaw/agents/main/sessions/sessions.json",
      "beforeCount": 120,
      "afterCount": 80,
      "pruned": 40,
      "capped": 0
    },
    {
      "agentId": "work",
      "storePath": "/home/user/.openclaw/agents/work/sessions/sessions.json",
      "beforeCount": 18,
      "afterCount": 18,
      "pruned": 0,
      "capped": 0
    }
  ]
}
```

Related:

- Session config: [Configuration reference](/gateway/configuration-reference#session)
- Status overview: [CLI status](/cli/status)
