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

| Upstream commit                            | Local commit | Summary                                                                                     |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------- |
| `17479ceb439aebe8c73de66698f07904d6720d89` | `65d39a072e` | `fix(auto-reply): suppress JSON-wrapped NO_REPLY payloads before channel delivery (#56612)` |
| `468185d1b507aa58fda7f6a871d58ce593faaa0e` | `729b2a1a82` | `fix(agents): handle unhandled stop reasons gracefully instead of crashing (#56639)`        |
| `c14b169a1b9be959c02702db15ea865d8f4caa85` | `a31ae200a7` | `fix(acp): repair stale bindings after runtime exits (#56476)`                              |
| `4e74e7e26cfdff5474533da5bba73252754ac7c2` | `84a45e3242` | `fix(memory): resolve slugified qmd search paths (#50313)`                                  |
| `19e52a1ba23eeeb619366384ff016720436364ca` | `24739e0e15` | `fix(memory/qmd): honor embedInterval independent of update interval`                       |
| `971ecabe80b632180edddb81f5652436de13ffed` | `9ff467a406` | `fix(memory): account for CJK characters in QMD memory chunking`                            |
| `a5147d4d88f1e2db82568efe9414a41e02cd429d` | `66b59370e4` | `fix: address bot review — surrogate-pair counting and CJK line splitting`                  |
| `3b95aa8804fb6dd99b0a2302a914ddf50271be0d` | `d6c079001b` | `fix: address second-round review — Latin backward compat and emoji consistency`            |
| `f8547fcae4c05147a6648ed4765dcd1a2026bc72` | `bc74cc95f8` | `fix: guard fine-split against breaking UTF-16 surrogate pairs`                             |
| `3ce48aff660a0dca487fb195132d53e6e0e404ed` | `53e3689d1b` | `Memory: add configurable FTS5 tokenizer for CJK text support (openclaw#56707)`             |

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

## 2026-04-08 Campaign Note

- A worktree-scoped multi-PR sync campaign plan now lives at
  `docs/experiments/plans/upstream-sync-campaign-2026-04-08.md`.
- It records:
  - the ordered PR queue for safety, approvals, plugin runtime auth, packaging,
    and mobile UX
  - the intentionally deferred but still valuable platform items
  - the Phase 2 backlog for tool registry alignment, model discovery alignment,
    plugin platform boundary work, QA platform work, and docs/locale automation
- Use that document as the execution plan for incremental future sync work
  instead of trying to infer the sequence from chat history.

## 2026-04-08 Scratch Integration Branch

- Scope: scratch worktree only, based on `myclaw/main`
- Worktree: `/root/gitsource/.worktrees/myclaw-mainline-effective-20260408`
- Branch: `integrate/openclaw-effective-20260408`
- Reviewed upstream range:
  `a5cd9210536879cf94cde8dc2ea95aa446d019c2..de6bac331cde02ea19389e46c7e4385f0b31cc49`
- Reviewed upstream head:
  `de6bac331cde02ea19389e46c7e4385f0b31cc49`
- Reviewed head subject:
  `fix(exec): detect cmd wrapper carriers (#62439)`
- Important note:
  this section records what has been ported onto the scratch integration branch.
  It does not mean `myclaw/main` is fully refreshed to the upstream head.

### Upstream Status Train Effectively Integrated On This Branch

- `72dcf94221`
  `refactor: consolidate status reporting helpers`
- `e8731589c0`
  `refactor: share status scan and report helpers`
- `88aa814226`
  `refactor: consolidate status runtime and overview helpers`
- `143f501fe5`
  `refactor: share status overview and json helpers`
- Follow-up fixes folded into the port where needed for `myclaw` compatibility:
  - `279f56e658`
    `fix: restore status command typing after refactor`
  - `5fa166ed11`
    `fix(check): repair status report typing drift`

### Local Integration Commits On This Branch

| Local commit | Summary                                                                |
| ------------ | ---------------------------------------------------------------------- |
| `762c40ad6c` | `port(status): consolidate reporting helpers from openclaw`            |
| `6995bc8f39` | `fix(status): recover port after hook test pollution`                  |
| `1d6bf46f5c` | `port(status): consolidate runtime and overview helpers from openclaw` |
| `4ee9bf4ae6` | `port(status): share overview and json helpers from openclaw`          |
| `7f606482ea` | `feat(status): surface session activity counts in overview`            |

### Notes

- Ported `openclaw -> myclaw`, with `myclaw`-specific compatibility shims where
  upstream assumptions did not match local task/runtime structure:
  - `src/cli/command-config-resolution.ts`
  - `src/gateway/probe-target.ts`
  - `src/tasks/task-registry.maintenance.ts`
  - `src/commands/status.node-mode.ts`
- Re-applied one refresh-branch local carry with clear user-visible value:
  session activity counts in the `status` overview (`1h` / `24h`).
- Also carried the remaining reviewed status/session deltas that had direct
  operator value rather than just internal reshuffling:
  - suppress false multi-listener warnings for single-process dual-stack
    loopback gateway listeners (`127.0.0.1` + `::1`)
  - make `status --all` diagnosis report node-only gateway setups as an
    expected remote-query case instead of a misleading local gateway failure
  - align `status summary` aggregation with the reviewed upstream helper shape
    while keeping `myclaw`'s async task-summary compatibility intact
  - update `status` / `sessions` CLI docs to match the shipped session
    overview, transcript preview, cleanup, and usage-reporting behavior
- Kept the port inside the scratch integration branch only; no claim of
  completion is made for `myclaw/main`.
- Remaining reviewed deltas in this upstream range were assessed and left out
  when they were broad trains or pure internal reshuffles with no clear
  `myclaw` user value, such as the standalone report-section refactor /
  formatting-only cleanup commits.

### Validation On The Scratch Branch

- Passed:
  - `pnpm vitest run src/commands/status.command-report.test.ts src/commands/status.command-sections.test.ts src/commands/status-all/report-tables.test.ts src/commands/status-all/text-report.test.ts src/commands/status.scan-execute.test.ts src/commands/status.scan-overview.test.ts src/commands/status.scan-result.test.ts src/commands/status.scan-memory.test.ts src/commands/status.scan-fast-json.test.ts src/commands/health.command.coverage.test.ts src/commands/status-all/format.test.ts src/commands/status-json-runtime.test.ts src/commands/status-runtime-shared.test.ts src/commands/status.command-report-data.test.ts src/commands/status.gateway-connection.test.ts src/commands/status.summary.test.ts src/commands/status.scan.shared.test.ts src/commands/status-json-command.test.ts src/commands/status-json-payload.test.ts src/commands/status-overview-rows.test.ts src/commands/status-overview-surface.test.ts src/commands/status-overview-values.test.ts src/commands/status-all/diagnosis.test.ts src/commands/status.test.ts`

### Next Step From This Scratch Branch

1. Move the validated subset onto `myclaw/main` from a dedicated mainline
   worktree instead of reusing the scratch branch directly.
2. If we do another upstream pass later, start again from
   `de6bac331cde02ea19389e46c7e4385f0b31cc49` and only revisit omitted items
   when they show clear end-user value for `myclaw`.

## 2026-04-08 PR-01 Security Guards

- Campaign branch: `sync/pr01-security-guards`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr01-security-guards`
- Integration style: behavior-level ports from local sibling `openclaw`, not
  wholesale file replacement

### Landed In This Branch

- Gateway config mutation guard:
  - expanded protected exec paths to cover `safeBins`,
    `safeBinProfiles`, `safeBinTrustedDirs`, and `strictInlineEval`
  - restored legacy `tools.bash.*` alias protection without relying on broad
    config migrations
  - switched protected-path comparison to deep equality so array/object
    mutations cannot slip through by reference inequality
- Fetch guard SSRF hardening:
  - validate explicit proxy hosts through the same SSRF policy before fetch
  - block explicit proxies that resolve to private/internal hosts unless
    `allowPrivateNetwork` is enabled
  - tighten redirect handling for unsafe methods:
    `301/302 POST -> GET`, `303 -> GET`, and cross-origin unsafe redirects drop
    bodies plus body-related headers
  - close the two-step redirect-loop gap by seeding the visited set with the
    initial URL
- Host env security policy refresh:
  - expanded shared JSON policy with upstream high-risk keys for compilers,
    VCS, proxy, CA bundle, package manager, container, and credential-path
    variables
  - regenerated
    `apps/macos/Sources/OpenClaw/HostEnvSecurityPolicy.generated.swift`
    from the shared JSON source
- Browser blocked-target quarantine:
  - quarantine tabs/targets after SSRF-denied navigation
  - keep quarantined tabs out of page enumeration and target resolution
  - preserve quarantine across reconnects / CDP transport churn until the
    Playwright session is explicitly closed

### Validation On This Branch

- `node scripts/test-parallel.mjs --files src/agents/openclaw-gateway-tool.test.ts -- --reporter=verbose`
- `node scripts/test-parallel.mjs --files src/infra/net/fetch-guard.ssrf.test.ts -- --reporter=verbose`
- `node scripts/test-parallel.mjs --files src/infra/host-env-security.test.ts --files src/infra/host-env-security.policy-parity.test.ts -- --reporter=verbose`
- `node scripts/test-parallel.mjs --files extensions/browser/src/browser/pw-session.create-page.navigation-guard.test.ts -- --reporter=verbose`
- Combined regression sweep:
  `node scripts/test-parallel.mjs --files src/agents/openclaw-gateway-tool.test.ts --files src/infra/net/fetch-guard.ssrf.test.ts --files src/infra/host-env-security.test.ts --files src/infra/host-env-security.policy-parity.test.ts --files extensions/browser/src/browser/pw-session.create-page.navigation-guard.test.ts -- --reporter=dot`

## 2026-04-08 Campaign PR-02

- Campaign item:
  `PR-02: Approval Replay + Channel Runtime`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr02-approval-runtime`
- Branch:
  `sync/pr02-approval-runtime`
- Primary upstream source:
  `6484b41eb9`
  `Approvals: replay pending requests on startup`
- Additional upstream references used during the port:
  - `src/gateway/server-methods/approval-shared.ts`
  - `src/gateway/server-methods/exec-approval.ts`
  - `src/gateway/server-methods/plugin-approval.ts`
  - `src/infra/exec-approval-channel-runtime.ts`
  - `src/infra/exec-approval-channel-runtime.test.ts`

### Landed In This PR

- Added `exec.approval.get`, `exec.approval.list`, and `plugin.approval.list`
  to the gateway method surface and operator scope map.
- Added shared approval handler logic for:
  - stable unknown/expired responses
  - optional short-prefix lookup for exec approvals
  - exact-id enforcement for plugin approval resolution
  - shared wait/resolve/request delivery flow
- Ported upstream approval replay runtime as
  `src/infra/exec-approval-channel-runtime.ts`.
- Wired `extensions/telegram/src/exec-approvals-handler.ts` onto the shared
  runtime so startup now replays pending exec approvals instead of only handling
  live events after connect.
- Carried two correctness deltas from upstream exec approval handling:
  - reject explicit exec approval ids that collide with the reserved
    `plugin:` namespace
  - reject `allow-always` when the effective approval policy requires
    per-request confirmation

### Intentionally Deferred

- Full upstream `approval-native-runtime` / channel-native approval delivery
  plan port.
- Discord-side migration to the shared approval runtime.
- Broader upstream approval UX reshapes that depend on the native runtime
  abstraction rather than the replay/runtime core landed here.

### Validation On This Branch

- Passed:
  - `pnpm exec vitest run src/gateway/server-methods/server-methods.test.ts src/gateway/server-methods/plugin-approval.test.ts src/gateway/method-scopes.test.ts src/infra/exec-approval-channel-runtime.test.ts extensions/telegram/src/exec-approvals-handler.test.ts --reporter=dot`
  - `pnpm exec vitest run src/gateway/node-invoke-system-run-approval.test.ts src/gateway/server.node-invoke-approval-bypass.test.ts src/infra/exec-approval-command-display.test.ts src/infra/exec-approval-reply.test.ts --reporter=dot`
