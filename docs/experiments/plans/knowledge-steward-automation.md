---
title: "Knowledge Steward Automation Plan"
summary: "Detailed phased plan for automated memory/skill stewardship without UI dependencies"
read_when:
  - You want the implementation roadmap for knowledge-steward
  - You are wiring automated memory or skill incubation flows
---

# Knowledge Steward Automation Plan

## Why this exists

OpenClaw already has durable Markdown memory, session summaries, hooks, and
cron/heartbeat scheduling. What it does **not** have yet is a constrained
automation loop that continuously:

- extracts durable user/project facts from recent sessions
- stages them into long-term-memory candidates
- detects reusable command/tool workflows
- incubates skill candidates before promotion
- keeps long-term notes bounded, linked, and maintainable

The goal is to add that loop **without** adding a UI dependency and without
turning memory maintenance into an unconstrained free-for-all.

## Design principles

This plan borrows the useful part of `autoresearch`: a **tight autonomous
loop with fixed scope, fixed inputs, fixed outputs, validation, and
keep/discard semantics**.

### Operating constraints

- Only write inside fixed roots:
  - `memory/inbox/`
  - `memory/steward/`
  - `skills/_candidates/`
  - later phases may promote into `MEMORY.md`, `memory/people/`,
    `memory/projects/`, `memory/topics/`, and `skills/<slug>/`
- Prefer deterministic first-pass extraction over broad model-driven rewrites.
- Every run produces a machine-readable result object.
- Every applied run appends a steward ledger entry.
- Candidate generation must be idempotent enough to re-run safely on the same
  session.
- Promotion to long-term memory or a real skill must be a separate step from
  ingestion.

## Storage model

### Memory candidate staging

- `memory/inbox/YYYY-MM-DD/<slug>-<sessionId8>.md`
  - session-derived candidate durable facts
  - evidence snippets
  - Obsidian-friendly frontmatter
  - links back to canonical memory entry points such as `[[MEMORY]]`

### Skill candidate staging

- `skills/_candidates/YYYY-MM-DD/<slug>-<sessionId8>.md`
  - candidate reusable workflow
  - observed commands/tools
  - promotion notes and guardrails

### Steward ledger

- `memory/steward/runs/YYYY-MM-DD.jsonl`
  - append-only run records
  - run id, mode, workspace, candidate counts, kept/discarded sessions

## Phases

## Phase 1: Deterministic ingest foundation

### Goal

Create the first autonomous loop entry point with no UI and no mandatory LLM
dependence.

### Deliverables

- New CLI surface: `openclaw steward ingest`
- Fixed input selection:
  - recent sessions from the resolved session store
  - optional `--agent`, `--all-agents`, `--store`, `--active`, `--recent`
- Fixed output selection:
  - memory inbox candidate notes
  - skill candidate notes
  - steward run ledger on `--apply`
- Keep/discard decision per session:
  - keep when durable-memory or automation/skill signals are present
  - discard when the session looks conversational but not durable/reusable
- Validation:
  - reject writes outside allowed prefixes
  - keep generated notes under byte budgets
  - dry-run by default; only write on `--apply`

### Non-goals

- no automatic mutation of `MEMORY.md`
- no automatic promotion into `skills/<slug>/`
- no hook/cron integration yet
- no heavy LLM summarization yet

## Phase 2: Curation and maintenance passes

### Goal

Turn staged candidates into maintained long-term notes.

### Deliverables

- `openclaw steward curate`
  - merge inbox candidates into entity/topic/project notes
  - add wikilinks, aliases, and tags
  - dedupe overlapping facts
  - initial slice may promote only into `memory/topics/` plus `MEMORY.md`
    index links before adding richer people/project routing
- `openclaw steward maintain`
  - enforce note size budgets
  - split oversized notes into child notes + rollup notes
  - repair orphan links / stale aliases / empty candidates

### Write scope expansion

- `MEMORY.md`
- `memory/people/`
- `memory/projects/`
- `memory/topics/`
- `memory/mocs/`

## Phase 3: Skill incubation and promotion

### Goal

Promote repeated workflow evidence into reusable workspace skills.

### Deliverables

- `openclaw steward incubate-skills`
  - cluster repeated automation evidence
  - score candidate workflows by repetition and stability
- `openclaw steward promote-skills`
  - create `skills/<slug>/SKILL.md`
  - optionally create helper scripts alongside the skill
  - preserve provenance back to candidate notes and sessions
  - default to capability-first disclosure when observed commands already map to
    registered structured capabilities

### Execution contract rule

Promoted skills should not become another place where the model freely invents
shell.

- If a reusable workflow already has a registered CLI capability, the promoted
  skill should expose the capability id first.
- The agent should inspect the contract with `openclaw capabilities describe`
  before execution.
- The actual run should prefer `openclaw capabilities run` with schema-checked
  JSON input.
- Skill prose stays light; stable execution belongs in the capability layer.

### Promotion policy

- one conversation is not enough
- repeated command or tool patterns across sessions are required
- destructive flows require explicit guardrails
- promotion must remain reversible

## Phase 4: Background automation

### Goal

Run the steward loop without manual CLI invocation.

### Trigger points

- near-compaction memory flush follow-up
- `/new` or `/reset` post-session ingest
- nightly isolated cron maintenance
- lower-frequency skill incubation cron

### Integration points

- existing session memory hook
- cron isolated sessions
- heartbeat only for light reminders, not heavy curation

## Candidate schemas

## Memory candidate note

Minimum structure:

- frontmatter:
  - `type: steward-memory-candidate`
  - `source: openclaw-steward-ingest`
  - `agent_id`
  - `session_key`
  - `session_id`
  - `updated_at`
  - `tags`
- body:
  - candidate durable facts
  - evidence
  - suggested links

## Skill candidate note

Minimum structure:

- frontmatter:
  - `type: steward-skill-candidate`
  - `source: openclaw-steward-ingest`
  - `agent_id`
  - `session_key`
  - `session_id`
  - `updated_at`
  - `tags`
- body:
  - why this looks reusable
  - observed commands
  - observed tools
  - proposed skill sketch
  - promotion cautions

## Validation and rollback model

Each run follows this shape:

1. Select candidate sessions
2. Build deterministic candidate payloads in memory
3. Validate output paths and note budgets
4. Decide keep/discard per session
5. If dry-run, return the plan only
6. If apply, write staged notes and append ledger

This keeps the steward loop bounded and observable instead of allowing an
opaque background model to mutate long-term memory freely.

## Immediate implementation order

1. Land this plan document
2. Implement `openclaw steward ingest`
3. Add run ledger + allowed-write-path validation
4. Stage memory inbox and skill candidate notes
5. Add tests for dry-run/apply/idempotent candidate paths
6. Only then connect the command to hook/cron triggers
