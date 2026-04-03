---
summary: "CLI reference for `openclaw capabilities` (structured capability registry with schema-constrained execution)"
read_when:
  - You want a stable way for skills or agents to inspect runnable capabilities
  - You want JSON schema before executing a CLI-backed automation flow
title: "capabilities"
---

# `openclaw capabilities`

Inspect and run structured CLI capabilities with explicit JSON-schema contracts.

This surface is for agent-safe execution contracts. It is different from the
plugin capability system documented in the contributor cookbook: here the goal
is progressive disclosure, predictable inputs, and stable execution for skills
and steward automation.

Related:

- Skills CLI: [skills](/cli/skills)
- Steward CLI: [steward](/cli/steward)
- Skills system: [Skills](/tools/skills)

## Commands

```bash
openclaw capabilities list
openclaw capabilities describe <id>
openclaw capabilities run <id> --input-json '<json>'
```

## Intended flow

1. Discover a capability id from a skill summary, `openclaw skills info`, or
   `openclaw capabilities list`.
2. Inspect the contract with `openclaw capabilities describe <id>`.
3. Execute with `openclaw capabilities run <id> --input-json '<json>'`.

When a skill already advertises capability ids, prefer this flow over inventing
new shell commands.

## Output shape

`list` returns:

```json
{
  "ok": true,
  "capabilities": [{ "id": "skills.list", "summary": "...", "...": "..." }]
}
```

`describe` returns:

```json
{
  "ok": true,
  "capability": {
    "id": "steward.ingest",
    "inputSchema": { "type": "object", "...": "..." },
    "outputSchema": { "type": "object", "...": "..." },
    "examples": ["openclaw capabilities run steward.ingest ..."]
  }
}
```

`run` returns:

```json
{
  "ok": true,
  "capability": { "id": "steward.ingest", "...": "..." },
  "input": { "workspace": "/root/.openclaw/agents/main", "apply": false },
  "output": { "runId": "...", "mode": "dry-run", "...": "..." },
  "runnerCommand": ["openclaw", "steward", "ingest", "--json"]
}
```

Failures are also structured JSON with these error codes:

- `unknown_capability`
- `invalid_json`
- `invalid_input`
- `capability_failed`

## Current capability groups

- `skills.list`
- `skills.info`
- `skills.check`
- `steward.ingest`
- `steward.curate`
- `steward.maintain`
- `steward.incubate-skills`
- `steward.promote-skills`
- `steward.cycle`

## Examples

List capabilities:

```bash
openclaw capabilities list
```

Inspect one capability before execution:

```bash
openclaw capabilities describe steward.promote-skills
```

Run a dry-run steward cycle through the schema-constrained interface:

```bash
openclaw capabilities run steward.cycle --input-json '{"workspace":"/root/.openclaw/agents/main","recent":5,"apply":false}'
```
