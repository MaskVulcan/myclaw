# Upstream Sync Record

This file tracks which `openclaw/openclaw` upstream commits have already been
reviewed or integrated into `myclaw`, so future sync passes can start from a
known baseline instead of re-checking the same history.

## 2026-03-31

- Upstream remote: `upstream`
- Baseline checked on `upstream/main`: `f263d0c4f37417715dae10e9337375d538708886`
- Baseline subject: `fix(docs): remove broken Xfinity SSL troubleshooting links from FAQ (#56500)`
- At record time: `git rev-list --left-right --count main...upstream/main` = `11 0`
- Meaning: `myclaw/main` already contains all `upstream/main` commits through the
  baseline above; next sync only needs to review commits after that baseline, plus
  any new side-branch fixes not yet merged upstream.

### Extra Upstream Commits Already Integrated

These were pulled in from upstream side branches / not-yet-main commits and do
not need to be re-reviewed unless upstream reworks them materially.

| Upstream commit                            | Local commit | Summary                                                                 |
| ------------------------------------------ | ------------ | ----------------------------------------------------------------------- |
| `aff9a4986d368d6211f8d8e25b632b384a28cdb1` | `957637d4cf` | `fix(agents): fail over and sanitize Codex server_error payloads`       |
| `4aa8316c5c3e3c54330b84b24c9c787381b8d508` | `91e0045615` | `fix(agents): narrow Codex payload sanitization fallback`               |
| `f41d0ea6e70cd091c78f3c71d08f93f719d6c2c4` | `caf6dbb276` | `fix(acp): deliver final result text as fallback when no blocks routed` |
| `b26b46b6a148b00e381ced9f3d49d9114d09f3b7` | `33c8880097` | `fix: tighten ACP final fallback semantics (#53692)`                    |
| `6357282ae11c64b05185fd5d73bacc82ef48dc60` | `767fc3fc1a` | `fix(channels): pin outbound adapter registry`                          |

### Reviewed But Already Equivalent

These were checked during this sync pass, but the required behavior was already
present locally after conflict resolution, so they were not added as new commits.

- `a912fd8356bdbe6c5a1b58feb763183ab5b65a60`
  `fix(errors): omit request IDs from UI error copy`
- `5e7c26d3490950894bcfcb8f27389b1521d6a0bd`
  `fix(agents): preserve Codex overflow guidance`

### Deferred For Later Review

These were intentionally left out in this pass because they looked higher-risk
or less aligned with the current `myclaw` direction.

- `c3838ba15a49e64cf3f8bcfb90d7cdb9d8a6b9e9` trusted-proxy / local-direct auth hardening
- `e1c6604a25bd18484671b93a11f5ebc2066fecf9` trusted-proxy follow-up hardening

### Next Sync Starting Rule

1. Start from upstream main commits after
   `f263d0c4f37417715dae10e9337375d538708886`.
2. Skip the side-branch commits listed in `Extra Upstream Commits Already Integrated`.
3. Re-check the deferred items only if we decide to take the behavior change.

## 2026-04-02

- Review source: local sibling repo fetched as `openclaw-local/main`
- History note: upstream rewrote history after the 2026-03-31 record; the old
  baseline commit
  `f263d0c4f37417715dae10e9337375d538708886` now maps to rewritten commit
  `840b806c2f7b04f5b76410d75b81459a807809ec`
  with the same subject
  `fix(docs): remove broken Xfinity SSL troubleshooting links from FAQ (#56500)`.
- Reviewed head on `openclaw-local/main`:
  `a5cd9210536879cf94cde8dc2ea95aa446d019c2`
- Reviewed head subject: `revert: remove TinyFish bundled plugin`
- Review scope: subject-level scan of the full range
  `840b806c2f7b04f5b76410d75b81459a807809ec..a5cd9210536879cf94cde8dc2ea95aa446d019c2`,
  then selective integration of low-risk ACP / auto-reply / memory fixes that
  fit `myclaw`.

### Integrated In `sync/openclaw-20260402`

| Upstream commit                            | Local commit | Summary                                                                  |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------ |
| `17479ceb439aebe8c73de66698f07904d6720d89` | `65d39a072e` | `fix(auto-reply): suppress JSON-wrapped NO_REPLY payloads before channel delivery (#56612)` |
| `468185d1b507aa58fda7f6a871d58ce593faaa0e` | `729b2a1a82` | `fix(agents): handle unhandled stop reasons gracefully instead of crashing (#56639)` |
| `c14b169a1b9be959c02702db15ea865d8f4caa85` | `a31ae200a7` | `fix(acp): repair stale bindings after runtime exits (#56476)` |
| `4e74e7e26cfdff5474533da5bba73252754ac7c2` | `84a45e3242` | `fix(memory): resolve slugified qmd search paths (#50313)` |
| `19e52a1ba23eeeb619366384ff016720436364ca` | `24739e0e15` | `fix(memory/qmd): honor embedInterval independent of update interval` |
| `971ecabe80b632180edddb81f5652436de13ffed` | `9ff467a406` | `fix(memory): account for CJK characters in QMD memory chunking` |
| `a5147d4d88f1e2db82568efe9414a41e02cd429d` | `66b59370e4` | `fix: address bot review — surrogate-pair counting and CJK line splitting` |
| `3b95aa8804fb6dd99b0a2302a914ddf50271be0d` | `d6c079001b` | `fix: address second-round review — Latin backward compat and emoji consistency` |
| `f8547fcae4c05147a6648ed4765dcd1a2026bc72` | `bc74cc95f8` | `fix: guard fine-split against breaking UTF-16 surrogate pairs` |
| `3ce48aff660a0dca487fb195132d53e6e0e404ed` | `53e3689d1b` | `Memory: add configurable FTS5 tokenizer for CJK text support (openclaw#56707)` |

### Deferred This Round

- Broad feature trains not merged in this pass:
  xAI / `x_search` / `code_execution`, task-flow registry work, bundled-plugin
  architecture refactors, and large channel-specific trains (Matrix, LINE,
  Discord, Slack, QQ, gateway/security surface changes).
- These were reviewed at the subject level but left out because the change sets
  were broader, touched areas already customized in `myclaw`, or needed a
  dedicated pass rather than a stability sync.

### Next Sync Starting Rule

1. For new upstream review, start from commits after
   `a5cd9210536879cf94cde8dc2ea95aa446d019c2`.
2. Treat the ten upstream commits in `Integrated In sync/openclaw-20260402` as
   already landed locally.
3. Revisit the deferred broad trains only when we intentionally plan a larger
   upstream rebase / feature-sync pass.
