---
name: knowledge-steward
description: "Run the knowledge loop: background review nudges after compaction, review + steward on /new and /reset"
homepage: https://docs.openclaw.ai/automation/hooks#knowledge-steward
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "events": ["command:new", "command:reset", "session:compact:after"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with OpenClaw" }],
      },
  }
---

# Knowledge Steward Hook

Runs the unified knowledge loop around a session:

- after compaction, it writes a lightweight review nudge
- on `/new` or `/reset`, it writes a deterministic session review and then runs
  the steward pipeline

## What It Does

When compaction finishes, the hook records a background nudge so the session can
be reviewed later with full context.

When a reset/new command starts a fresh session, the hook uses the pre-reset
session transcript to:

1. Write a deterministic review record under `workspace/.openclaw/knowledge/`
2. Sync the machine-managed `USER.md` profile block from accumulated reviews
3. Stage deterministic memory and skill candidates
4. Curate memory candidates into `memory/topics/` and `MEMORY.md`
5. Maintain topic note size/link hygiene
6. Incubate repeated skill candidates
7. Promote ready incubators into `skills/<slug>/SKILL.md`

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

- The review and steward passes are deterministic, not free-form rewriting.
- Review records are also the shared fact source for session search and `USER.md`
  profile sync.
- Promotion still requires repeated evidence across sessions.
- It works well alongside `session-memory`; `session-memory` keeps a raw reset
  snapshot, while `knowledge-steward` maintains curated long-term notes.
