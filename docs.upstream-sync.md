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

## 2026-04-08 Campaign PR-03

- Campaign item:
  `PR-03: Plugin Runtime Auth`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr03-plugin-runtime-auth`
- Branch:
  `sync/pr03-plugin-runtime-auth`
- Primary upstream sources:
  - `b8f12d99b2`
    `fix: expose runtime-ready provider auth to plugins`
  - `99db33eb39`
    `fix: keep runtime model lookup on configured workspace`

### Landed In This PR

- Added `runtime.modelAuth.getRuntimeAuthForModel` to the native plugin runtime
  surface and kept the existing raw auth helpers unchanged.
- Ported runtime-ready model auth resolution into
  `src/plugins/runtime/runtime-model-auth.runtime.ts`:
  - resolve the raw provider auth with `getApiKeyForModel`
  - skip provider preparation for auth modes without an API key
  - apply provider-owned `prepareRuntimeAuth` when present
  - merge prepared runtime fields back onto the raw auth result
- Threaded `workspaceDir` through the runtime model auth facade so provider
  runtime hooks resolve against the caller's configured workspace instead of
  falling back to the package-global default.
- Added a narrow runtime auth result type for plugins as
  `src/plugins/runtime/model-auth-types.ts` and exposed it via
  `openclaw/plugin-sdk/provider-auth-runtime`.
- Expanded `openclaw/plugin-sdk/provider-auth-runtime` to export:
  - `getRuntimeAuthForModel`
  - `NON_ENV_SECRETREF_MARKER`
  - `ProviderPreparedRuntimeAuth`
  - `ResolvedProviderRuntimeAuth`
- Used upstream-style runtime module resolution in
  `provider-auth-runtime.ts` so the SDK helper can find the runtime auth module
  from either adjacent runtime staging or the canonical plugin runtime path.

### Intentionally Deferred

- Upstream runtime surface additions unrelated to auth in
  `src/plugins/runtime/index.ts`
  (image/video/music/tasks/task-flow expansions) were left out of this PR.
- Upstream runtime auth transport-override typing was not ported because the
  current `myclaw` provider runtime auth contract only exposes `apiKey`,
  `baseUrl`, and `expiresAt`.
- No broader model discovery or plugin host boundary rewrite was mixed into
  this pass; only the workspace-scoped runtime auth path was absorbed.

### Validation On This Branch

- Passed:
  - `node node_modules/vitest/vitest.mjs run src/plugins/runtime/runtime-model-auth.runtime.test.ts src/plugins/runtime/index.test.ts src/plugin-sdk/provider-auth-runtime.test.ts --reporter=dot`
  - `node node_modules/vitest/vitest.mjs run src/plugins/provider-runtime.test.ts --reporter=dot`
- Environment note:
  full repo `tsc -p tsconfig.json --noEmit` could not be completed in this
  container because the TypeScript process exhausted the local Node heap, so
  this branch is currently validated by targeted runtime/auth regressions rather
  than a successful whole-repo typecheck.

## 2026-04-08 Campaign PR-04

- Campaign item:
  `PR-04: Agent Tooling Follow-ups`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr04-agent-tooling`
- Branch:
  `sync/pr04-agent-tooling`
- Upstream sources absorbed in this branch:
  - `8359e5f584`
    `fix: pass threadId through sessions_send announce delivery`
  - `6211e3dcd6`
    `fix: raise acpx runtime timeout`

### Landed In This PR

- `sessions_send` announce delivery now forwards `threadId` to gateway `send`
  calls so forum/topic sessions can announce back into the correct thread
  instead of dropping into the channel root.
- Added a focused A2A regression test for the `threadId` pass-through and kept
  the existing session-key parsing coverage in `sessions-send-helpers.test.ts`.
- Raised bundled `acpx` runtime turns to a default 120-second timeout by:
  - defaulting the plugin config schema value
  - making the resolved runtime config always carry `timeoutSeconds`
  - updating the plugin manifest JSON schema and UI help
  - documenting the operator override path in `docs/tools/acp-agents.md`
- Added ACPX config/service tests to lock the new default into the runtime
  factory wiring and manifest/schema contract.

### Intentionally Deferred

- Upstream `9d31c5ad53`
  `fix: compact update_plan tool result`
  was not ported in this PR because `myclaw` does not currently ship the
  built-in `update_plan` tool or the corresponding `tools.experimental.planTool`
  config gate. Pulling that commit in directly would become a feature train, not
  a narrow follow-up fix.

### Validation On This Branch

- Passed:
  - `node node_modules/vitest/vitest.mjs run src/agents/tools/sessions-send-tool.a2a.test.ts src/agents/tools/sessions-send-helpers.test.ts extensions/acpx/src/config.test.ts extensions/acpx/src/service.test.ts --reporter=dot`

## 2026-04-09 Campaign PR-05

- Campaign item:
  `PR-05: Bundled Packaging Smoke`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr05-packaging-smoke`
- Branch:
  `sync/pr05-packaging-smoke`
- Upstream sources reviewed for this branch:
  - `8069b990a6`
    `add bundled channel prepack smoke`
  - `d03fa0899f`
    `fix: repair bundled channel secret sidecars`
  - `9163e5bed7`
    `fix bundled channel entry fallback resolution`
  - `5982f2e5e4`
    `fix: repair Telegram setup package entry`

### Landed In This PR

- Broadened `scripts/lib/bundled-plugin-build-entries.mjs` so package-backed
  runtime support surfaces are built and packed even when they do not ship an
  `openclaw.plugin.json` manifest:
  - `extensions/image-generation-core`
  - `extensions/media-understanding-core`
  - `extensions/speech-core`
- Tightened artifact collection so package-backed support packages no longer
  falsely require `dist/extensions/<id>/openclaw.plugin.json` during pack /
  release checks.
- Added a stable build entry for
  `src/channels/plugins/bundled.ts` as
  `dist/channels/plugins/bundled.js`
  so packaged bundled-channel smoke checks can target a deterministic artifact
  instead of a hashed chunk.
- Added `scripts/openclaw-prepack.ts` and switched `package.json` `prepack` to
  use it. The wrapper now:
  - runs `pnpm build`
  - runs `pnpm ui:build`
  - runs bundled-channel built-artifact smoke
  - runs bundled plugin singleton smoke
  - supports `OPENCLAW_PREPACK_PREPARED=1` to verify already-built artifacts and
    re-run the smokes without rebuilding
- Added `scripts/test-built-bundled-channel-entry-smoke.mjs` to assert the
  packaged bundled-channel registry can still load Telegram and Slack channel
  entries plus their `setup-entry` surfaces from built artifacts.
- Added focused script coverage for the new packaging behavior in:
  - `test/scripts/bundled-plugin-build-entries.test.ts`
  - `test/scripts/openclaw-prepack.test.ts`
- While validating this branch, fixed an existing mainline `status --all`
  import drift in `src/commands/status-all/report-data.ts` by removing the
  stray dependency on the non-existent local module
  `src/agents/exec-defaults.ts` and re-aligning the call site with
  `myclaw`'s current `getRemoteSkillEligibility()` surface.

### Intentionally Deferred

- Upstream `d03fa0899f`
  bundled secret-sidecar repair was not ported because `myclaw` does not ship
  the reviewed `channelSecrets -> secret-contract-api` surface in its bundled
  channel entries, so there was no local bug-shaped target for that change.
- Upstream `5982f2e5e4`
  Telegram setup-entry fix was already effectively present locally:
  `extensions/telegram/setup-entry.ts` already exports the setup plugin through
  `defineSetupPluginEntry(...)`, so no additional Telegram-specific port was
  needed.
- This branch does not attempt to fix the broader existing
  `pnpm build:plugin-sdk:dts` type-drift train in the status command area; that
  surfaced during validation but predates this packaging-focused PR.

### Validation On This Branch

- Passed:
  - `node node_modules/vitest/vitest.mjs run test/scripts/bundled-plugin-build-entries.test.ts test/scripts/openclaw-prepack.test.ts test/release-check.test.ts --reporter=dot`
  - `node node_modules/vitest/vitest.mjs run src/commands/status-all/diagnosis.test.ts src/commands/status-all/report-lines.test.ts src/commands/status-all/report-tables.test.ts src/commands/status-overview-rows.test.ts --reporter=dot`
  - `node scripts/tsdown-build.mjs`
  - `node scripts/runtime-postbuild.mjs`
  - `pnpm ui:build`
  - `OPENCLAW_PREPACK_PREPARED=1 node --import tsx scripts/openclaw-prepack.ts`
- Validation note:
  - the full `node --import tsx scripts/openclaw-prepack.ts` path still hits the
    pre-existing `pnpm build:plugin-sdk:dts` TypeScript error train in this
    repo, so the packaging smoke itself was validated via the prepared-artifact
    path after a successful `tsdown` build, runtime postbuild, and Control UI
    build.

## 2026-04-09 Campaign PR-06

- Campaign item:
  `PR-06: Doctor Auth Warnings`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr06-doctor-auth`
- Branch:
  `sync/pr06-doctor-auth`
- Primary upstream source:
  `5050017543`
  `fix(doctor): warn when stale Codex overrides shadow OAuth`

### Landed In This PR

- Ported a narrow Codex OAuth doctor warning into
  `src/commands/doctor-auth.ts` that detects the stale override shape:
  - `models.providers.openai-codex.api` still pinned to legacy OpenAI transport
    APIs (`openai-responses` / `openai-completions`)
  - base URL is absent or still points at the default OpenAI endpoint
  - Codex OAuth is configured in either config or stored auth profiles
- The warning is intentionally narrow:
  - custom proxy / gateway base URLs do not trigger it
  - header-only or other non-transport overrides do not trigger it
  - it only warns when the stale override can actually shadow the built-in
    Codex OAuth provider path
- Wired the warning into the existing doctor auth flow in
  `src/flows/doctor-health-contributions.ts`
  immediately after auth profile health checks so operators see it in the same
  auth remediation pass.

### Intentionally Deferred

- Upstream changes to doctor E2E harness / fast-path mocks around memory health
  were not ported because the current `myclaw` test harness already covers this
  auth warning path without those compatibility shims.
- No broader doctor flow refactor or auth profile storage rewrite was mixed into
  this PR; only the stale Codex override detection and warning path was landed.

### Validation On This Branch

- Passed:
  - `node node_modules/vitest/vitest.mjs run src/commands/doctor-auth.deprecated-cli-profiles.test.ts src/commands/doctor-auth.hints.test.ts src/commands/doctor.warns-state-directory-is-missing.e2e.test.ts --reporter=dot`

## 2026-04-09 Campaign PR-07

- Campaign item:
  `PR-07: Systemd Fallback Hardening`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr07-systemd-fallback`
- Branch:
  `sync/pr07-systemd-fallback`
- Primary upstream source:
  `700efe6d16`
  `fix(daemon): skip machine-scope fallback on permission-denied bus errors`

### Landed In This PR

- Tightened `src/daemon/systemd.ts`
  machine-scope fallback gating so `systemctl --user` failures with
  `Failed to connect to bus: Permission denied` no longer retry through
  `--machine <user>@ --user`.
- Added a regression test proving the permission-denied case stops after the
  direct `--user` attempt instead of making a second machine-scope call.
- Added a second regression test for the existing `myclaw` sudo behavior:
  when `SUDO_USER` is set, we already scope directly to the invoking user's
  machine manager and do not fall back to bare `systemctl --user` if that
  machine-scope call fails. This behavior matched the reviewed upstream state,
  so the PR only locked it in with coverage.

### Intentionally Deferred

- No broader systemd flow refactor was taken here. The reviewed upstream commit
  was already narrow, and `myclaw`'s local daemon/service management surface did
  not need additional restructuring beyond the fallback guard and regression
  coverage.

### Validation On This Branch

- Passed:
  - `node node_modules/vitest/vitest.mjs run src/daemon/systemd.test.ts --reporter=dot`

## 2026-04-09 Campaign PR-08

- Campaign item:
  `PR-08: iOS Gateway Problem UX`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr08-ios-gateway-problem-ux`
- Branch:
  `sync/pr08-ios-gateway-problem-ux`
- Primary upstream source:
  `6380c872bc`
  `feat(ios): improve gateway connection error ux`

### Landed In This PR

- Ported the upstream structured gateway-problem model into
  `apps/shared/OpenClawKit`:
  - `GatewayConnectAuthError` now preserves connect-auth metadata such as
    `requestId`, `reason`, `owner`, title/message overrides, action command,
    docs URL, and retry/pause hints.
  - `GatewayChannel` now forwards those fields out of gateway connect failures.
  - new `GatewayConnectionProblem` and `GatewayConnectionProblemMapper` map auth,
    response, and transport failures into typed iOS-facing connection problems.
- Updated `apps/ios/Sources/Model/NodeAppModel.swift` to keep the last
  structured gateway problem, pause reconnect churn when the problem explicitly
  requires operator action, preserve pairing/request-id context across cancel
  disconnects, and expose `gatewayDisplayStatusText` for UI surfaces.
- Updated the iOS app's problem consumers to use the structured model instead of
  string parsing only:
  - `GatewayConnectionIssue.detect(problem:)`
  - `GatewayStatusBuilder`
  - `StatusActivityBuilder`
  - onboarding / quick-setup / settings / root canvas / root tabs problem
    presentation
  - added reusable `GatewayProblemBanner` and `GatewayProblemDetailsSheet`
    surfaces for actionable problem display
- Added focused regression coverage for the new mapping and status behavior in:
  - `apps/shared/OpenClawKit/Tests/OpenClawKitTests/GatewayErrorsTests.swift`
  - `apps/ios/Tests/GatewayConnectionIssueTests.swift`
  - `apps/ios/Tests/GatewayStatusBuilderTests.swift`

### Intentionally Deferred

- `CHANGELOG.md` was not updated in this campaign PR because `myclaw` does not
  mirror upstream changelog maintenance commit-for-commit; only code and local
  sync docs were updated here.
- This branch did not try to pull in any later iOS approval / watch-bridge
  trains from upstream `NodeAppModel.swift`; only the gateway-problem UX and
  reconnect behavior from the reviewed commit were ported.

### Validation On This Branch

- Passed:
  - `git diff --check`
- Validation gap:
  - `swift test --package-path apps/shared/OpenClawKit --filter GatewayErrorsTests`
    could not run in this environment because the `swift` toolchain is missing
    (`/bin/bash: swift: command not found`).
  - iOS app / test target compilation also remains unverified locally in this
    Linux worktree because the required Apple toolchain (`swift`, `xcodegen`,
    `xcodebuild`) is unavailable here.

## 2026-04-09 Campaign PR-09

- Campaign item:
  `PR-09: iOS Exec Approval Prompt + Bridge`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr09-ios-exec-approval`
- Branch:
  `sync/pr09-ios-exec-approval`
- Primary upstream source:
  `28955a36e7`
  `feat(ios): add exec approval notification flow`
- Additional upstream source reviewed but intentionally not fully ported here:
  `6f566585d8`
  `fix(ios): harden watch exec approval review`

### Landed In This PR

- Added app-side exec-approval notification bridge primitives:
  - new `apps/ios/Sources/Push/ExecApprovalNotificationBridge.swift`
    for requested/resolved push parsing and local notification cleanup
  - expanded `apps/ios/Sources/Services/NotificationService.swift`
    so iOS notification code can inspect delivered notifications and remove
    pending/delivered approval prompts by identifier
- Added a local exec-approval review surface in
  `apps/ios/Sources/Gateway/ExecApprovalPromptDialog.swift`
  and mounted it from `RootCanvas` so approval requests opened from
  notifications can be reviewed in-app without dropping the operator into a
  generic error state.
- Updated `apps/ios/Sources/Model/NodeAppModel.swift` to:
  - keep pending exec-approval prompt state plus resolve/error UX state
  - fetch approval details through `exec.approval.get`
  - resolve user decisions through `exec.approval.resolve`
  - classify stale and allow-always-unavailable gateway errors using
    structured gateway error metadata
  - recover an operator connection on demand before approval fetch/resolve
  - clear matching local UI state when resolved cleanup pushes arrive
- Updated `apps/ios/Sources/OpenClawApp.swift` so APNs handling and
  notification taps now:
  - surface exec-approval notifications as banners
  - route default notification taps into the new approval prompt flow
  - process resolved cleanup pushes even before the `NodeAppModel` is attached
  - queue prompt routing until the app model becomes available during startup
- Added focused regression coverage for the bridge and prompt-state plumbing in:
  - `apps/ios/Tests/ExecApprovalNotificationBridgeTests.swift`
  - `apps/ios/Tests/NodeAppModelInvokeTests.swift`

### Intentionally Deferred

- The broader gateway-side APNs delivery train around exec-approval push
  generation was not ported in this PR. This branch only lands the iOS
  app-side prompt / fetch / resolve / cleanup path that can work with existing
  notification payloads once they are delivered.
- The watch-specific exec-approval recovery / review train from
  `6f566585d8` was also deferred. `myclaw` already ships custom watch prompt
  handling, and folding in the full upstream watch path here would turn this
  into a wider mobile feature merge rather than a narrow prompt-flow PR.

### Validation On This Branch

- Passed:
  - `git diff --check`
- Validation gap:
  - iOS / Swift target compilation and tests remain unverified in this Linux
    worktree because the required Apple toolchain is unavailable:
    `swift`, `xcodebuild`, and related tooling are not installed.

## 2026-04-09 Campaign PR-10

- Campaign item:
  `PR-10: Android Host Security`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr10-android-gateway-security`
- Branch:
  `sync/pr10-android-gateway-security`
- Primary upstream sources combined for the final behavior:
  - `a941a4fef9`
    `fix(android): require TLS for remote gateway endpoints`
  - `945b198c76`
    `fix(android): allow cleartext LAN gateways`

### Landed In This PR

- Added `apps/android/app/src/main/java/ai/openclaw/app/gateway/GatewayHostSecurity.kt`
  to centralize Android gateway host classification:
  - loopback detection covers `localhost`, `127.0.0.0/8`, `::1`,
    IPv4-mapped loopback IPv6 literals, and the emulator bridge alias
    `10.0.2.2`
  - private-LAN detection covers RFC1918 IPv4, link-local IPv4/IPv6,
    `.local` mDNS names, bare LAN hostnames, and local IPv6 ULA ranges
  - Tailnet / public hosts remain outside the cleartext allow-list
- Tightened `ConnectionManager.resolveTlsParamsForEndpoint(...)` so Android now
  requires TLS for remote/tailnet/public gateway endpoints even when discovery
  metadata does not advertise TLS, while still allowing cleartext for loopback
  and private-LAN manual/discovered endpoints.
- Updated `GatewayConfigResolver` to validate gateway URLs through the same host
  security policy:
  - insecure remote `ws://` / `http://` endpoints are rejected
  - private-LAN cleartext endpoints remain valid
  - scanned/setup-code parsing now carries structured validation errors
  - manual-connect config preserves bootstrap auth only when the manual endpoint
    is unchanged and no replacement token/password is present
  - IPv6 hosts render with brackets in `displayUrl`
- Updated Android connect/onboarding UI flows to surface the new validation
  messages instead of collapsing all failures into a generic “invalid host”
  error:
  - `ConnectTabScreen.kt`
  - `OnboardingFlow.kt`
- Added focused regression coverage in:
  - `apps/android/app/src/test/java/ai/openclaw/app/node/ConnectionManagerTest.kt`
  - `apps/android/app/src/test/java/ai/openclaw/app/ui/GatewayConfigResolverTest.kt`

### Intentionally Deferred

- The broader upstream Android trust-prompt/auth-preservation train in
  `NodeRuntime.kt` was not ported here because `myclaw`'s manual-connect flow
  already persists auth into preferences before connect, so the user-facing
  security value in this PR comes from host validation and TLS enforcement,
  not from reshaping the runtime connect API.
- No attempt was made to pull in unrelated Android gateway/session refactors;
  this branch keeps the scope on host classification, endpoint parsing, and TLS
  gating only.

### Validation On This Branch

- Passed:
  - `git diff --check`
- Validation gap:
  - Gradle unit tests could not be completed in this environment because the
    Android SDK is not configured. The targeted tasks
    `:app:testPlayDebugUnitTest` and `:app:testThirdPartyDebugUnitTest` fail at
    configuration time with:
    `SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path in local.properties`.
  - During verification, Gradle's daemon-JVM auto-download path also attempted
    to fetch a toolchain through Foojay/GitHub and timed out. A temporary local
    bypass confirmed the real remaining blocker is the missing Android SDK, not
    the new source changes.

## 2026-04-09 Campaign PR-11

- Campaign item:
  `PR-11: Android Assistant Entry + Notification Forwarding`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr11-android-assistant-notify`
- Branch:
  `sync/pr11-android-assistant-notify`
- Merged to `main` as:
  `1fef94cca6`
- Primary upstream sources:
  - `e45b29b247`
    `feat: add Android assistant role entrypoint`
  - `fcf708665c`
    `feat: route Android assistant launches into chat`
  - `186647cb74`
    `feat: auto-send Android assistant prompts`
  - `aee61dcee0`
    `fix: finalize android notification forwarding controls`

### Landed In This PR

- Added Android assistant launch parsing in
  `apps/android/app/src/main/java/ai/openclaw/app/AssistantLaunch.kt` and wired
  `MainActivity` to consume both `ACTION_ASSIST` and the app-action shortcut
  intent on cold start and `onNewIntent(...)`.
- Extended `MainViewModel`, `PostOnboardingTabs`, `ChatSheetContent`, and
  `ChatComposer` so assistant launches can:
  - route directly into the Chat tab
  - prefill a chat draft for non-auto-send launches
  - auto-send assistant prompts once chat health is ready and there is no
    pending run
- Extended `ChatController` and `NodeRuntime` with
  `sendMessageAwaitAcceptance(...)` / `sendChatAwaitAcceptance(...)` so the
  auto-send path can wait for the gateway request to be accepted before clearing
  pending assistant state.
- Added Android notification forwarding policy primitives in
  `apps/android/app/src/main/java/ai/openclaw/app/NotificationForwardingPolicy.kt`
  covering:
  - allowlist / blocklist package filtering
  - strict `HH:mm` quiet-hours parsing
  - wall-clock quiet-hours evaluation
  - per-minute burst limiting
- Expanded `SecurePrefs` so notification forwarding is persisted and exposed as
  observable state:
  - enabled flag
  - filter mode
  - configured package set
  - quiet-hours enable/start/end
  - max events per minute
  - optional session-key route override
- Hardened `DeviceNotificationListenerService` so forwarded
  `notifications.changed` events are now:
  - opt-in instead of unconditional
  - filtered by allow/block package policy
  - suppressed during local quiet hours
  - rate limited through a burst limiter
  - optionally routed with a pinned `sessionKey`
  - tracked with recent-package history for settings UX
- Updated Android settings / manifest / resources to expose the new behavior:
  - `SettingsSheet.kt` now includes assistant-role setup, notification
    forwarding controls, app picker, quiet-hours editing, rate controls, and
    optional session routing
  - `AndroidManifest.xml` now advertises `ACTION_ASSIST` and app shortcuts
  - new `res/xml/shortcuts.xml` and `res/values/assistant.xml` wire the
    `ASK_OPENCLAW` app action capability
- Added focused regression coverage in:
  - `apps/android/app/src/test/java/ai/openclaw/app/AssistantLaunchTest.kt`
  - `apps/android/app/src/test/java/ai/openclaw/app/NotificationForwardingPolicyTest.kt`
  - `apps/android/app/src/test/java/ai/openclaw/app/SecurePrefsNotificationForwardingTest.kt`
  - `apps/android/app/src/test/java/ai/openclaw/app/node/DeviceNotificationListenerServiceTest.kt`
  - `apps/android/app/src/test/java/ai/openclaw/app/ui/SettingsSheetNotificationAppsTest.kt`

### Intentionally Deferred

- The assistant auto-send queue preservation / stale-queue cleanup follow-ups
  from `5d524617e1` and `34a5c47351` were not ported as-is. `myclaw` now tracks
  a single in-memory pending assistant prompt, which covers the intended
  assistant-entry UX here without pulling in the broader upstream queue model.
- No attempt was made to pull in unrelated Android chat / settings refactors
  outside the assistant-launch and notification-forwarding surfaces above.

### Validation On This Branch

- Passed:
  - `git diff --check`
- Validation gap:
  - Attempted targeted Gradle unit-test execution with the daemon-JVM download
    workaround:
    `./gradlew :app:testPlayDebugUnitTest --tests 'ai.openclaw.app.AssistantLaunchTest' --tests 'ai.openclaw.app.NotificationForwardingPolicyTest' --tests 'ai.openclaw.app.SecurePrefsNotificationForwardingTest' --tests 'ai.openclaw.app.node.DeviceNotificationListenerServiceTest' --tests 'ai.openclaw.app.ui.SettingsSheetNotificationAppsTest'`
  - The build still stops during configuration because the Android SDK is not
    configured in this environment:
    `SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path in local.properties`.
  - The temporary `apps/android/gradle/gradle-daemon-jvm.properties` bypass used
    for local validation was restored after the test attempt; no Gradle
    scaffolding changes were kept in the branch.

## 2026-04-09 Campaign PR-12

- Campaign item:
  `PR-12: Tool Registry Alignment`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr12-tool-registry-alignment`
- Branch:
  `sync/pr12-tool-registry-alignment`
- Primary upstream sources:
  - `a705845e18`
    `feat(agents): add experimental structured plan updates`
  - `9d31c5ad53`
    `fix: compact update_plan tool result`
  - `43cc92dc07`
    `perf(agents): isolate plugin tool resolution for tests`

### Landed In This PR

- Added the experimental `update_plan` tool in
  `src/agents/tools/update-plan-tool.ts` with compact success payloads and
  validation that keeps the structured plan shape tight.
- Registered `update_plan` in `src/agents/openclaw-tools.ts` with narrow
  gating:
  - explicit `tools.experimental.planTool`
  - OpenAI / OpenAI Codex auto-enable when the flag is unset
  - no change to `myclaw`'s fast-pass or capability-first routing logic
- Forwarded `modelProvider` from `src/agents/pi-tools.ts` so provider-aware
  gating can activate without broad tool-registry churn.
- Isolated plugin-tool resolution into:
  - `src/agents/openclaw-tools.plugin-context.ts`
  - `src/agents/openclaw-plugin-tools.ts`
  This keeps future registry-sync work localized without replacing
  `myclaw`'s existing plugin/tool policy pipeline.
- Added `update_plan` to the shipped tool surface metadata:
  - tool catalog / coding profile policy
  - system prompt availability + usage guidance
  - shared tool display metadata
- Added the minimum config/schema surface needed to make the tool explicitly
  configurable:
  - `tools.experimental.planTool` in runtime schema + types
  - labels/help entries
  - minimal generated schema/doc baseline entries for that path only

### Intentionally Deferred

- Did not pull in the broader upstream `openclaw-tools.ts` rewrite, music/video
  registry additions, or wider plugin/runtime refactors. This PR keeps the
  change set centered on `update_plan` plus helper extraction only.
- Did not trust a full `config:schema:gen` / `config:docs:gen` rewrite while
  using the sibling `openclaw/node_modules` dependency tree for local
  validation. That path surfaced unrelated baseline drift outside `PR-12`.
  The branch keeps only the minimal generated deltas for
  `tools.experimental.planTool` and leaves the broader baseline refresh for a
  separate maintenance pass.

### Validation On This Branch

- Passed:
  - `git diff --check`
  - `NODE_OPTIONS='--max-old-space-size=768' pnpm vitest run --maxWorkers=1 src/agents/tools/update-plan-tool.test.ts src/agents/openclaw-plugin-tools.test.ts src/agents/system-prompt.update-plan.test.ts src/agents/tool-catalog.test.ts src/config/schema.experimental-plan-tool.test.ts src/config/schema.base.generated.test.ts`
  - `NODE_OPTIONS='--max-old-space-size=768' pnpm vitest run --maxWorkers=1 src/agents/openclaw-tools.update-plan.test.ts`
- Validation gap:
  - The broader legacy suites
    `src/agents/system-prompt.test.ts` and
    `src/agents/openclaw-tools.plugin-context.test.ts`
    exceeded the local heap budget during single-worker runs in this
    environment. Focused replacement coverage was added for the new `PR-12`
    behavior instead of forcing higher-memory runs.

## 2026-04-09 Campaign PR-13

- Campaign item:
  `PR-13: Model Discovery Alignment`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr13-model-discovery-alignment`
- Branch:
  `sync/pr13-model-discovery-alignment`
- Primary upstream references reviewed for this port:
  - `openclaw/src/agents/pi-model-discovery.ts`
  - `openclaw/src/plugins/provider-runtime.ts`
  - `openclaw/src/plugins/synthetic-auth.runtime.ts`
  - `openclaw/src/agents/model-auth-env-vars.ts`

### Landed In This PR

- Added discovery-time provider-runtime helpers in
  `src/plugins/provider-runtime.ts`:
  - `applyProviderResolvedModelCompatWithPlugins`
  - `applyProviderResolvedTransportWithPlugin`
  - compat-hook ordering that lets an owning plugin plus foreign
    transport-family plugins contribute resolved-model compat patches
- Extended `ProviderPlugin` in `src/plugins/types.ts` with the narrow
  `contributeResolvedModelCompat` hook so future provider plugins can describe
  vendor compat behind proxy/custom transports without taking over provider
  ownership.
- Added `src/plugins/synthetic-auth.runtime.ts` so model discovery can inspect
  active plugin providers / CLI backends for synthetic auth support, with a
  conservative bundled fallback list for startup-time discovery.
- Updated `src/agents/pi-model-discovery.ts` to:
  - export focused discovery helpers
    (`normalizeDiscoveredPiModel`,
    `scrubLegacyStaticAuthJsonEntriesForDiscovery`,
    `addEnvBackedPiCredentials`,
    `resolvePiCredentialsForDiscovery`)
  - run discovered models through plugin normalization, compat contribution,
    and transport normalization before final generic compat cleanup
  - mirror plugin/CLI synthetic auth into Pi auth storage so discovery sees the
    same providers runtime auth can use
  - instantiate the Pi model registry through a class-or-factory compatibility
    shim instead of depending on subclassing only
- Added `resolveProviderEnvApiKeyCandidates()` to
  `src/agents/model-auth-env-vars.ts` so discovery helpers can query the
  provider env-candidate table through an exported function, matching the
  upstream seam without rewriting the broader secrets layer.
- Added focused low-memory tests:
  - `src/plugins/provider-runtime.discovery-hooks.test.ts`
  - `src/plugins/synthetic-auth.runtime.test.ts`
  - `src/agents/pi-model-discovery.normalize.test.ts`
  - `src/agents/pi-model-discovery.synthetic-auth.test.ts`

### Intentionally Deferred

- Did not pull in the full upstream `pi-model-discovery.ts` rewrite or the
  wider plugin/runtime boundary expansion. This PR stays on the discovery-time
  seams that directly improve parity with runtime auth.
- Did not broaden validation into large legacy suites or unrelated model/runtime
  trains. The goal here is to make discovery honor provider hooks and synthetic
  auth, not to rebase the entire provider platform.

### Validation On This Branch

- Passed:
  - `git diff --check`
  - `NODE_OPTIONS='--max-old-space-size=768' pnpm vitest run --maxWorkers=1 src/plugins/provider-runtime.discovery-hooks.test.ts src/plugins/synthetic-auth.runtime.test.ts src/agents/pi-model-discovery.auth.test.ts src/agents/pi-model-discovery.normalize.test.ts src/agents/pi-model-discovery.synthetic-auth.test.ts`
- Validation note:
  - `src/agents/pi-model-discovery.compat.e2e.test.ts` exists as a compatibility
    smoke, but the repo Vitest config excludes `*.e2e.test.ts`, so it is not
    part of routine targeted validation in this environment.

## 2026-04-09 Campaign PR-14

- Campaign item:
  `PR-14: Plugin Platform Boundary`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr14-plugin-platform-boundary`
- Branch:
  `sync/pr14-plugin-platform-boundary`
- Primary upstream sources:
  - `df993291b6`
    `refactor: share bundled loader Jiti config helpers`
  - `3a4b96bfbf`
    `fix: normalize plugin SDK aliases on Windows`
  - `03be4c2489`
    `fix(plugin-sdk): export missing context-engine types (#61251)`
  - targeted remainder from
    `b8f12d99b2`
    `fix: expose runtime-ready provider auth to plugins (#62753)`

### Landed In This PR

- Aligned `src/plugins/sdk-alias.ts` with the narrower upstream boundary-loader
  improvements:
  - plugin-sdk alias maps now resolve both `openclaw/plugin-sdk/*` and
    `@openclaw/plugin-sdk/*`
  - alias targets are normalized before handing them to Jiti on Windows
  - `shouldPreferNativeJiti()` now avoids native Jiti loading on Windows while
    preserving the existing Bun guard
- Updated `src/plugins/runtime/runtime-plugin-boundary.ts` so runtime boundary
  Jiti loaders mirror the dual root alias behavior instead of only wiring the
  unscoped package name.
- Expanded the root `src/plugin-sdk/index.ts` type surface with the already
  shipped local runtime-auth and context-engine contracts:
  - `ProviderPreparedRuntimeAuth`
  - `ResolvedProviderRuntimeAuth`
  - `AssembleResult`, `BootstrapResult`, `CompactResult`
  - `IngestResult`, `IngestBatchResult`
  - `SubagentSpawnPreparation`, `SubagentEndReason`
- Added focused regression coverage:
  - `src/plugins/sdk-alias.test.ts`
    now verifies dual-package alias targets, scoped runtime-shim loading, and
    Windows alias normalization behavior
  - `src/plugin-sdk/index.test.ts`
    now locks the root plugin-sdk type re-export contract for runtime-auth and
    context-engine result types

### Intentionally Deferred

- Did not pull in the broader upstream public-surface loader/runtime train,
  task-domain runtime surfaces, or facade-runtime expansion. This PR keeps the
  scope on boundary alias correctness and root SDK contract parity only.
- Did not attempt the full plugin host/runtime refactor wave. The goal here is
  to reduce immediate boundary drift around loader aliases and root SDK types
  without widening the plugin execution surface.

### Validation On This Branch

- Passed:
  - `git diff --check`
  - `NODE_OPTIONS='--max-old-space-size=768' pnpm vitest run --maxWorkers=1 src/plugins/sdk-alias.test.ts src/plugin-sdk/index.test.ts`
  - `NODE_OPTIONS='--max-old-space-size=768' pnpm vitest run --maxWorkers=1 src/plugins/loader.git-path-regression.test.ts src/plugins/runtime-plugin-boundary.whatsapp.test.ts`

## 2026-04-09 Campaign PR-15

- Campaign item:
  `PR-15: QA Platform`
- Worktree:
  `/root/gitsource/.worktrees/myclaw-pr15-qa-platform`
- Branch:
  `sync/pr15-qa-platform`
- Primary upstream sources:
  - `openclaw/scripts/pnpm-runner.mjs`
  - `openclaw/scripts/run-vitest.mjs`
  - `openclaw/scripts/vitest-process-group.mjs`
  - `openclaw/scripts/windows-cmd-helpers.mjs`
  - focused behavior from `openclaw/scripts/test-live.mjs`

### Landed In This PR

- Added shared scripted Vitest launch helpers:
  - `scripts/windows-cmd-helpers.mjs`
  - `scripts/pnpm-runner.mjs`
  - `scripts/vitest-process-group.mjs`
  - `scripts/run-vitest.mjs`
- The new runner layer brings in the narrow upstream behaviors that matter for
  local low-memory test execution:
  - prefer `npm_execpath` when `pnpm` is being brokered through Corepack
  - use Windows-safe `cmd.exe` argument escaping when `pnpm.cmd` fallback is
    required
  - disable Maglev for child Vitest processes by default unless
    `OPENCLAW_VITEST_ENABLE_MAGLEV=1`
  - forward shutdown signals to detached Unix Vitest process groups so wrapper
    scripts do not strand child workers
  - suppress known rolldown plugin timing noise from Vitest stderr
- Updated `scripts/test-live.mjs` to use the shared `pnpm` runner and emit a
  periodic heartbeat when the wrapped live suite stays silent for a while.
- Switched the direct package-script Vitest entrypoints in `package.json`
  (`test:fast`, `test:coverage`, `test:e2e`, `test:gateway`, contracts, auth
  compat, sectriage, targeted tooling/live Android/voice-call runs) to the new
  wrapper while leaving the planner-backed `scripts/test-parallel.mjs` flow
  unchanged.
- Added focused regression coverage:
  - `test/scripts/pnpm-runner.test.ts`
  - `test/scripts/vitest-process-group.test.ts`
  - `test/scripts/run-vitest.test.ts`

### Intentionally Deferred

- Did not pull in the broader upstream QA platform train:
  `extensions/qa-lab`, QA skills, bakeoff loops, or `scripts/test-projects.mjs`
  remain separate work because `myclaw` already has a customized
  planner-backed `scripts/test-parallel.mjs`.
- Did not replace the main `test` / `test:max` / `test:serial` flows. This PR
  only aligns the direct scripted Vitest entrypoints and `test:live` wrapper.

### Validation On This Branch

- Passed:
  - `git diff --check`
  - `NODE_OPTIONS='--max-old-space-size=768' pnpm vitest run --maxWorkers=1 test/scripts/pnpm-runner.test.ts test/scripts/vitest-process-group.test.ts test/scripts/run-vitest.test.ts test/scripts/run-vitest-profile.test.ts`
  - `NODE_OPTIONS='--max-old-space-size=768' node scripts/run-vitest.mjs run --config vitest.unit.config.ts --maxWorkers=1 test/scripts/pnpm-runner.test.ts test/scripts/vitest-process-group.test.ts test/scripts/run-vitest.test.ts`

## 2026-04-09 Campaign Status

- Planned sync campaign PRs `PR-01` through `PR-11` are now landed on `main`.
- Planned sync campaign PRs `PR-12` through `PR-15` are now landed on `main`.
- Remaining upstream ideas that were intentionally not absorbed stay tracked in:
  - `docs/experiments/plans/upstream-sync-campaign-2026-04-08.md`
  - the `Intentionally Deferred` sections recorded per PR in this log
