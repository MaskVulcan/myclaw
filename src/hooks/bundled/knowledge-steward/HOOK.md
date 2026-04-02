---
name: knowledge-steward
description: "Automatically run steward ingest/curate/maintain/skill incubation on /new and /reset"
homepage: https://docs.openclaw.ai/automation/hooks#knowledge-steward
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "events": ["command:new", "command:reset"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with OpenClaw" }],
      },
  }
---

# Knowledge Steward Hook

Automatically runs the steward pipeline when you close out a session with `/new`
or `/reset`.

## What It Does

When a reset/new command starts a fresh session, the hook uses the pre-reset
session transcript to:

1. Stage deterministic memory and skill candidates
2. Curate memory candidates into `memory/topics/` and `MEMORY.md`
3. Maintain topic note size/link hygiene
4. Incubate repeated skill candidates
5. Promote ready incubators into `skills/<slug>/SKILL.md`

This keeps long-term memory and reusable workflow capture moving forward without
manual CLI runs.

## Requirements

- `workspace.dir` must be configured

## Configuration

Optional hook config:

| Option          | Type   | Default | Description                                        |
| --------------- | ------ | ------- | -------------------------------------------------- |
| `curateLimit`   | number | `20`    | Max staged memory candidates inspected per run     |
| `incubateLimit` | number | `50`    | Max staged skill candidates inspected per run      |
| `promoteLimit`  | number | `50`    | Max incubator notes inspected per run              |
| `minCandidates` | number | `2`     | Minimum repeated candidates required for promotion |

Example:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "knowledge-steward": {
          "enabled": true,
          "curateLimit": 12,
          "incubateLimit": 30,
          "promoteLimit": 20,
          "minCandidates": 2
        }
      }
    }
  }
}
```

## Enable

```bash
openclaw hooks enable knowledge-steward
```

## Notes

- The hook uses deterministic steward extraction, not free-form rewriting.
- Promotion still requires repeated evidence across sessions.
- It works well alongside `session-memory`; `session-memory` keeps a raw reset
  snapshot, while `knowledge-steward` maintains curated long-term notes.
