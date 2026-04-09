# Upstream Sync Campaign Plan (2026-04-08)

This plan breaks the next `openclaw` -> `myclaw` sync into reviewable,
worktree-scoped PRs. The goal is to absorb high-value upstream platform
improvements without overwriting `myclaw`'s intentional local direction
(`weixin`, fast-pass routing, CJK memory tuning, capability-first skills,
localized docs).

## Principles

- Prefer behavior-level ports over file-level replacement.
- Keep each PR focused enough to revert independently.
- Land security and approval fixes before UX and packaging work.
- For large divergent files, cherry-pick behavior and tests, not upstream
  structure.
- Every PR gets its own worktree and branch.

## Non-goals

- Do not attempt a full upstream rebase.
- Do not overwrite `myclaw`'s `weixin`, calendar/doc fast-pass, or capability
  routing customizations.
- Do not absorb broad upstream refactors in `openclaw-tools`,
  `pi-model-discovery`, or plugin host boundaries unless a later PR needs a
  narrow subset.

## Worktree Convention

- Bare repo: `/root/gitsource/myclaw`
- Main worktree: `/root/gitsource/.worktrees/myclaw-main`
- PR worktrees: `/root/gitsource/.worktrees/myclaw-prXX-<topic>`
- Branches: `sync/prXX-<topic>`

Per PR routine:

1. Create branch + worktree from `main`.
2. Port only the targeted upstream behavior.
3. Run targeted tests first, then a narrow regression pass.
4. Open PR against `main`.
5. Merge only after green tests and manual review notes are recorded.

## PR Queue

### Wave 1: Safety / Core Runtime

#### PR-01: Security Guards

- Branch: `sync/pr01-security-guards`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr01-security-guards`
- Why first:
  closes silent risk in host env inheritance, guarded fetch redirects, browser
  SSRF redirect handling, and gateway config patch protection.
- Upstream sources:
  - `fa82193c72` `fix(env): align inherited host exec env filtering`
  - `423a14e2be` `fix(git): expand host env denylist coverage`
  - `14ec1ac50f` `fix(browser): harden SSRF redirect guard`
  - `4108901932` `fix(fetch-guard): drop request body on cross-origin unsafe-method redirects`
  - `b9e972e174` `Protect gateway exec approval config paths`
- Scope:
  - `src/infra/host-env-security*`
  - `src/infra/net/fetch-guard*`
  - `extensions/browser/src/browser/pw-session.ts`
  - `src/agents/tools/gateway-tool.ts`
- Risk: medium-high
- Must preserve:
  current `myclaw` browser and gateway patch behavior
- Acceptance:
  - targeted security/unit tests pass
  - no regression in gateway config patch flow

#### PR-02: Approval Replay + Channel Runtime

- Branch: `sync/pr02-approval-runtime`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr02-approval-runtime`
- Why now:
  approval delivery/recovery is core infra and a dependency for later mobile
  approval UX ports.
- Upstream sources:
  - `6484b41eb9` `Approvals: replay pending requests on startup`
  - relevant surrounding tests in `src/gateway` and `src/infra`
- Scope:
  - `src/gateway/server-methods/exec-approval.ts`
  - `src/infra/exec-approval-channel-runtime.ts`
  - related `method-scopes` / `server-methods-list`
  - only the minimum changes needed for replay, request listing, and runtime
    adapters
- Risk: high
- Must preserve:
  `myclaw` exec approval forwarding and any local session/channel expectations
- Acceptance:
  - gateway approval tests pass
  - pending approval survives restart and can be replayed

#### PR-03: Plugin Runtime Auth

- Branch: `sync/pr03-plugin-runtime-auth`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr03-plugin-runtime-auth`
- Why now:
  plugin providers should receive runtime-ready auth, not only static api keys.
- Upstream sources:
  - `b8f12d99b2` `fix: expose runtime-ready provider auth to plugins`
  - `99db33eb39` `fix: keep runtime model lookup on configured workspace`
- Scope:
  - `src/plugin-sdk/provider-auth-runtime.ts`
  - `src/plugins/runtime/runtime-model-auth.runtime.ts`
  - narrow parts of `src/plugins/runtime/index.ts`
  - narrow workspace lookup fix in embedded model resolution
- Risk: medium
- Must preserve:
  `myclaw` capability routing and local provider customizations
- Acceptance:
  - provider runtime auth tests pass
  - plugin-owned `prepareRuntimeAuth` path works in workspace-scoped runs

#### PR-04: Agent Tooling Follow-ups

- Branch: `sync/pr04-agent-tooling`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr04-agent-tooling`
- Why now:
  small but meaningful correctness fixes after runtime/auth groundwork.
- Upstream sources:
  - `8359e5f584` `fix: pass threadId through sessions_send announce delivery`
  - `9d31c5ad53` `fix: compact update_plan tool result`
  - `6211e3dcd6` `fix: raise acpx runtime timeout`
- Scope:
  - `src/agents/tools/sessions-send-tool.a2a.ts`
  - add `src/agents/tools/update-plan-tool.ts` and registration only if it fits
    current `myclaw` tool policy
  - ACPX timeout config
- Risk: low-medium
- Acceptance:
  - sessions A2A topic/thread tests pass
  - update_plan tool tests pass if enabled
  - ACP/ACPX tests pass

### Wave 2: Packaging / Operations / Doctor

#### PR-05: Bundled Packaging Smoke

- Branch: `sync/pr05-packaging-smoke`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr05-packaging-smoke`
- Upstream sources:
  - `8069b990a6` `add bundled channel prepack smoke`
  - `d03fa0899f` `fix: repair bundled channel secret sidecars`
  - `9163e5bed7` `fix bundled channel entry fallback resolution`
  - `5982f2e5e4` `fix: repair Telegram setup package entry`
  - related `package.json` export/file surface updates
- Scope:
  - `scripts/openclaw-prepack.ts`
  - `scripts/test-built-bundled-channel-entry-smoke.mjs`
  - minimal `package.json` `files`/`exports` fixes required for runtime/plugin SDK
- Risk: medium
- Acceptance:
  - prepack smoke passes
  - packed install can load bundled Telegram/Slack setup/channel entries

#### PR-06: Doctor Auth Warnings

- Branch: `sync/pr06-doctor-auth`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr06-doctor-auth`
- Upstream sources:
  - `5050017543` `fix(doctor): warn when stale Codex overrides shadow OAuth`
- Scope:
  - `src/commands/doctor-auth.ts`
  - only the warning/cleanup logic that remains compatible with `myclaw`
- Risk: low-medium
- Acceptance:
  - doctor tests pass
  - stale auth override case produces actionable warning

#### PR-07: Systemd Fallback Hardening

- Branch: `sync/pr07-systemd-fallback`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr07-systemd-fallback`
- Upstream sources:
  - `700efe6d16` `fix(daemon): skip machine-scope fallback on permission-denied bus errors`
- Scope:
  - `src/daemon/systemd.ts`
  - related tests
- Risk: low
- Acceptance:
  - systemd tests pass
  - no fallback to machine scope on permission-denied bus errors

### Wave 3: Mobile UX

#### PR-08: iOS Gateway Problem UX

- Branch: `sync/pr08-ios-gateway-problem-ux`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr08-ios-gateway-problem-ux`
- Upstream sources:
  - `6380c872bc` `feat(ios): improve gateway connection error ux`
- Scope:
  - `apps/shared/OpenClawKit/Sources/OpenClawKit/GatewayConnectionProblem.swift`
  - `apps/ios/Sources/Gateway/GatewayProblemView.swift`
  - `apps/ios/Sources/Status/GatewayStatusBuilder.swift`
  - minimum `NodeAppModel` / onboarding glue needed
- Risk: high
- Must preserve:
  current `myclaw` iOS app flow and local branding/custom behavior
- Acceptance:
  - iOS shared/unit tests pass
  - connection issues become structured and actionable

#### PR-09: iOS Exec Approval Prompt + Bridge

- Branch: `sync/pr09-ios-exec-approval`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr09-ios-exec-approval`
- Upstream sources:
  - `ExecApprovalPromptDialog.swift`
  - `ExecApprovalNotificationBridge.swift`
  - watch transport/payload pieces where compatible
- Scope:
  - prompt dialog and local approval recovery first
  - push/watch bridge only if it can be landed cleanly without broad app churn
- Risk: high
- Acceptance:
  - prompt can surface and resolve pending approvals
  - existing iOS invoke behavior remains stable

#### PR-10: Android Host Security

- Branch: `sync/pr10-android-gateway-security`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr10-android-gateway-security`
- Upstream sources:
  - `GatewayHostSecurity.kt`
- Scope:
  - strict loopback/private-lan gateway host validation
  - related tests
- Risk: medium
- Acceptance:
  - emulator/local/LAN valid cases still work
  - invalid zone-scoped / unsafe host cases are rejected

#### PR-11: Android Assistant Entry + Notification Forwarding

- Branch: `sync/pr11-android-assistant-notify`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr11-android-assistant-notify`
- Upstream sources:
  - `AssistantLaunch.kt`
  - `NotificationForwardingPolicy.kt`
  - related tests
- Scope:
  - assistant launch intent parsing
  - notification forwarding allow/block policy, quiet hours, burst limiter
- Risk: medium
- Acceptance:
  - Android tests pass
  - notification forwarding remains opt-in and rate limited

## Explicitly Deferred

- Full upstream `src/agents/openclaw-tools.ts` tool registry refactor
- Full upstream `src/agents/pi-model-discovery.ts` rewrite
- Broad plugin host boundary / plugin SDK facade trains
- QA Lab / frontier harness / locale automation / docs publishing workflows
- Large mobile feature trains unrelated to gateway safety or approval closure

## Execution Status (Updated 2026-04-09)

- Completed and merged into `main`:
  - `PR-01: Security Guards`
  - `PR-02: Approval Replay + Channel Runtime`
  - `PR-03: Plugin Runtime Auth`
  - `PR-04: Agent Tooling Follow-ups`
  - `PR-05: Bundled Packaging Smoke`
  - `PR-06: Doctor Auth Warnings`
  - `PR-07: Systemd Fallback Hardening`
  - `PR-08: iOS Gateway Problem UX`
  - `PR-09: iOS Exec Approval Prompt + Bridge`
  - `PR-10: Android Host Security`
  - `PR-11: Android Assistant Entry + Notification Forwarding`
- Campaign status:
  all planned PRs are complete on `main`; any further upstream follow-up work
  should come from the deferred/non-goal sections above, not from the original
  execution queue.

## Deferred But Valuable

These are not rejected. They are deferred because their current value is more
about long-term platform leverage than immediate `myclaw` stability.

### Tool Registry Alignment

- Main upstream area:
  `src/agents/openclaw-tools.ts` and adjacent tool-registration helpers
- Why it matters:
  aligns future tool surface with upstream, reduces drift around `update_plan`,
  plugin tool delivery defaults, and media-generation tool rollout
- Why deferred:
  `myclaw` has intentional local behavior in capability-first routing, direct
  fast-pass handling, and localized tool policy; a broad registry sync would be
  high-churn and easy to regress
- When to do it:
  after Wave 1 and Wave 2 are stable

### Model Discovery Alignment

- Main upstream area:
  `src/agents/pi-model-discovery.ts` and related registry/auth discovery seams
- Why it matters:
  improves consistency between provider auth, model discovery, and runtime
  behavior; lowers surprise for workspace-scoped or plugin-owned providers
- Why deferred:
  `myclaw` already diverges in provider/runtime customization; a full rewrite is
  too risky until runtime auth and packaging work have landed cleanly
- When to do it:
  after `PR-03 Plugin Runtime Auth`

### Plugin Host Boundary / SDK Expansion

- Main upstream area:
  `src/plugin-sdk`, `src/plugins`, approval adapter/runtime subpaths, and plugin
  facade boundaries
- Why it matters:
  this is the main long-term investment if `myclaw` wants stronger external
  plugin extensibility, cleaner runtime contracts, and lower future sync cost
- Why deferred:
  broad API-surface churn with high merge risk and limited immediate user-facing
  payoff
- When to do it:
  as a dedicated platform phase, not mixed into bug-fix sync PRs

### QA Platform / Harness

- Main upstream area:
  `extensions/qa-lab`, QA skills, frontier bakeoff loops, finer-grained Vitest
  sharding and helper layers
- Why it matters:
  very useful for repeated upstream syncing, regression catching, and provider
  bakeoffs
- Why deferred:
  the primary benefit is engineering throughput, not current runtime safety
- When to do it:
  after core safety, approval, packaging, and mobile gateway UX work

### Docs / Locale Automation

- Main upstream area:
  docs sync publishing, translation triggers, control UI locale refresh
- Why it matters:
  helpful if `myclaw` later wants upstream-like release/docs operations
- Why deferred:
  lowest direct impact on current product/runtime correctness
- When to do it:
  last

## Phase 2 Backlog

These are candidate follow-up PRs after the first 11 PRs are landed or mostly
stable.

### PR-12: Tool Registry Alignment

- Branch: `sync/pr12-tool-registry-alignment`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr12-tool-registry-alignment`
- Goal:
  selectively absorb upstream tool registration and delivery-default behavior
  without overwriting `myclaw` fast-pass routing
- Execution note (2026-04-09):
  scoped down to the highest-value, lowest-risk subset:
  `update_plan` registration/gating, minimal plugin-tool helper extraction, and
  the smallest config/generated-surface additions needed for
  `tools.experimental.planTool`.
- Recorded issue (2026-04-09):
  full schema/doc regeneration under the borrowed sibling-repo dependency tree
  surfaced unrelated baseline drift outside `PR-12`; keep only the minimal
  `planTool` generated deltas in this PR and revisit the wider baseline refresh
  in a separate maintenance pass.

### PR-13: Model Discovery Alignment

- Branch: `sync/pr13-model-discovery-alignment`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr13-model-discovery-alignment`
- Goal:
  reconcile model discovery with workspace/runtime auth behavior after plugin
  runtime auth is stable
- Execution note (2026-04-09):
  scoped to the highest-value discovery seams:
  provider-owned resolved-model compat/transport hooks, synthetic-auth-backed
  discovery credentials, `pi-coding-agent` model-registry instantiation
  compatibility, and focused helper exports/tests rather than a full
  `pi-model-discovery.ts` rewrite.
- Recorded issue (2026-04-09):
  `src/agents/pi-model-discovery.compat.e2e.test.ts` remains outside routine
  targeted validation because the repo Vitest config excludes `*.e2e.test.ts`.
  Keep using focused `*.test.ts` coverage for this PR unless we intentionally
  revisit the test-inclusion policy.

### PR-14: Plugin Platform Boundary

- Branch: `sync/pr14-plugin-platform-boundary`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr14-plugin-platform-boundary`
- Goal:
  take the plugin SDK and plugin runtime boundary improvements that reduce
  future drift and improve plugin-host contracts
- Execution note (2026-04-09):
  scoped to loader/boundary alias correctness and root plugin-sdk surface
  parity:
  dual `openclaw` / `@openclaw` plugin-sdk alias handling, Windows-safe Jiti
  alias targets, and the missing runtime-auth / context-engine type exports on
  the root SDK surface.
- Intentionally deferred inside this PR (2026-04-09):
  the wider public-surface loader/runtime train, facade runtime expansion, and
  task-domain runtime surfaces remain out of scope for this branch and should
  stay separate from boundary-loader cleanup.

### PR-15: QA Platform

- Branch: `sync/pr15-qa-platform`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr15-qa-platform`
- Goal:
  bring in the most useful QA harness and test-layer improvements for future
  sync work
- Execution note (2026-04-09):
  scoped down to the highest-value low-memory runner seams instead of the full
  upstream QA lab train:
  shared `pnpm` / Vitest launch helpers, detached-process cleanup for scripted
  Vitest runs, `test:live` heartbeat logging, and package-script adoption for
  the direct Vitest entrypoints that still bypassed the local wrappers.
- Recorded issue (2026-04-09):
  the broader upstream QA platform remains intentionally deferred:
  `extensions/qa-lab`, frontier bakeoff loops, and multi-project runner
  adoption (`scripts/test-projects.mjs`) were left out because `myclaw` already
  has a customized planner-backed `scripts/test-parallel.mjs` flow and this
  campaign is keeping memory use constrained.

### PR-16: Docs / Locale Automation

- Branch: `sync/pr16-docs-locale-automation`
- Worktree: `/root/gitsource/.worktrees/myclaw-pr16-docs-locale-automation`
- Goal:
  optional docs/release automation parity after runtime/platform work is done

## Execution Order

1. PR-01
2. PR-02
3. PR-03
4. PR-04
5. PR-05
6. PR-06
7. PR-07
8. PR-08
9. PR-09
10. PR-10
11. PR-11
12. PR-12
13. PR-13
14. PR-14
15. PR-15
16. PR-16

## Merge Gate

Each PR needs:

- a short port note listing upstream commits/behaviors absorbed
- targeted tests green
- no overwrite of `myclaw`-specific behavior without an explicit callout
- a rollback note if the PR touches approvals, browser security, or mobile
  connection flows
