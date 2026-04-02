---
summary: "CLI reference for `openclaw steward` (memory/skill stewardship automation)"
read_when:
  - You want to stage long-term memory or reusable skill candidates from recent sessions
  - You want to run the full stewardship pipeline manually or from automation
title: "steward"
---

# `openclaw steward`

Automate long-term memory and skill stewardship from recent session transcripts.

Related:

- Hooks: [Hooks](/automation/hooks)
- Hooks CLI: [hooks](/cli/hooks)
- Skills: [skills](/cli/skills)

## Commands

```bash
openclaw steward ingest
openclaw steward curate
openclaw steward maintain
openclaw steward incubate-skills
openclaw steward promote-skills
openclaw steward cycle
```

The steward pipeline is intentionally split into deterministic stages:

- `ingest`: scan recent transcripts and stage bounded candidates into `memory/inbox/` and `skills/_candidates/`
- `curate`: promote durable memory candidates into curated topic notes under `memory/topics/` and rebuild `MEMORY.md`
- `maintain`: keep curated topic notes within size bounds and clean malformed staged candidates
- `incubate-skills`: cluster repeated staged skill candidates into `skills/_incubator/`
- `promote-skills`: promote repeated incubators into real `skills/<slug>/SKILL.md`
- `cycle`: run the full pipeline in sequence

All commands support `--json` for machine-readable output. Files are only written when `--apply` is set.

## Examples

```bash
openclaw steward ingest --recent 5
openclaw steward ingest --agent main --active 180 --apply
openclaw steward curate --workspace ~/vaults/main --apply
openclaw steward maintain --workspace ~/vaults/main --apply
openclaw steward incubate-skills --workspace ~/vaults/main --apply
openclaw steward promote-skills --workspace ~/vaults/main --apply
openclaw steward cycle --workspace ~/vaults/main --apply
```

## Ingest

```bash
openclaw steward ingest [--store <path>] [--workspace <dir>] [--agent <id> | --all-agents] [--active <minutes>] [--recent <count>] [--apply] [--json]
```

Use this when you want to extract candidate long-term memory and automation signals from the most recent sessions without yet curating them.

Outputs on `--apply`:

- `memory/inbox/YYYY-MM-DD/<slug>.md`
- `skills/_candidates/YYYY-MM-DD/<slug>.md`
- `memory/steward/runs/YYYY-MM-DD.jsonl`

## Curate

```bash
openclaw steward curate [--workspace <dir>] [--agent <id>] [--limit <count>] [--apply] [--json]
```

Promotes steward inbox candidates into curated topic notes under `memory/topics/` and refreshes `MEMORY.md` links.

## Maintain

```bash
openclaw steward maintain [--workspace <dir>] [--agent <id>] [--apply] [--json]
```

Keeps curated topic notes concise by splitting oversized evidence into sibling notes when needed, rebuilding index links, and cleaning malformed staged candidates.

## Incubate Skills

```bash
openclaw steward incubate-skills [--workspace <dir>] [--agent <id>] [--limit <count>] [--apply] [--json]
```

Clusters repeated staged skill candidates into incubator notes. This is the bounded review layer between one-off command snippets and promoted reusable skills.

## Promote Skills

```bash
openclaw steward promote-skills [--workspace <dir>] [--agent <id>] [--limit <count>] [--min-candidates <count>] [--apply] [--json]
```

Promotes ready incubator notes into real workspace skills once repeated evidence crosses the configured threshold.

## Cycle

```bash
openclaw steward cycle [--store <path>] [--workspace <dir>] [--agent <id> | --all-agents] [--active <minutes>] [--recent <count>] [--curate-limit <count>] [--incubate-limit <count>] [--promote-limit <count>] [--min-candidates <count>] [--apply] [--json]
```

Runs `ingest`, `curate`, `maintain`, `incubate-skills`, and `promote-skills` as one deterministic pipeline.

This is the best manual entrypoint when you want automation-first maintenance without enabling a hook.

## Hook Integration

If you want the same pipeline to run automatically on `/new` and `/reset`, enable the bundled `knowledge-steward` hook:

```bash
openclaw hooks enable knowledge-steward
```

That hook uses the previous session transcript directly, then runs the same deterministic stewardship stages inside the workspace.
