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
