# Subscription Usage Limits Report

Date: 2026-08-12

## Result

T3 Code now caches and displays subscription limits for Claude Code and Codex.

The usage page has a Limits strip. The sidebar Usage control has a detailed hover card and compact remaining-capacity gauges. The gauges are static SVG draws. They do not animate or update from a timer.

Kimi Code is also visible in the Limits strip and hover card. It shows `Limits not reported by provider.` and never shows an empty gauge.

## Upstream PR Adaptation

Fetched these upstream PR heads:

- `pull/5739/head` as `pr-5739-limits`
- `pull/6264/head` as `pr-6264-gauges`

PR #5739 was cherry-picked in order and adapted to this fork:

| Upstream | Local | Result |
| --- | --- | --- |
| `d95c7667e` | `8b9f6a2e6` | AccountLimitsService, normalization, transcript seed, RPC, usage strip, and hover card |
| `66b6fb4cf` | `3b88c6b9b` | Node namespace import fix |
| `ba79f14d2` | `238199861` | Atomic cache writes and deeper transcript scan |
| `48bb96251` | `1c3630588` | Serialized cache persistence |
| `6031e5e53` | `b32cb9fe2` | Atomic ordering guard and store |
| `a3e58c648` | `3092917e2` | Clear used-percent and stale-data copy |
| `a3823306b` | `856775d09` | Non-wrapping reset text |
| `54d006d52` | `3de60099a` | Claude SDK binding, clock, transcript ordering, loading, and refresh fixes |

The server and contract parts applied with small current-HEAD adjustments. The web conflicts were adapted to the fork's newer compact sidebar footer and workspace-style Usage page. `limitsFormat` moved to `packages/shared` because this fork already moved shared usage helpers there.

PR #6264 was then cherry-picked and adapted:

| Upstream | Local | Result |
| --- | --- | --- |
| `54a6622fe` | `117a1e2c8` | Circular remaining-capacity gauges beside the compact Usage label |
| `f16e599f5` | `051d28145` | Zero-capacity, wording, and reset-time edge cases |

The adapted commits retain upstream authorship and include co-author credit. Each local commit ends with the required model line.

## Fork-Specific Work

- `7357f79df` removes the recurring 30-second React clock.
- `2b947c723` adds Kimi's honest unavailable state and Kimi mark.
- `92ff866bd` fixes the shared formatter test import for NodeNext.
- `e6e325e6d` derives freshness and reset labels from the server `readAt` value. This removes render-time clock reads and keeps redraws data-driven.

## Kimi Verdict

Kimi Code CLI 1.49.0 does not report subscription quota through ACP.

The shared ACP schema has `usage_update`, but that event contains context-window token counts and optional turn cost. It does not contain account quota, remaining subscription capacity, or a reset window.

Kimi CLI has an interactive `/usage` command. Its local implementation calls a Kimi platform `/usages` endpoint with the active account token. However, Kimi does not expose that data through ACP or a stable non-interactive CLI command. Using it here would require a separate authenticated query and refresh policy. That would violate this feature's provider-event and no-polling rules.

Therefore, no `account.rate-limits.updated` event was added to the Kimi adapter. The UI shows `Limits not reported by provider.` and omits the Kimi gauge.

## Verification

Focused tests passed:

- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
- `apps/server/src/usage/accountLimitsNormalize.test.ts`
- `apps/server/src/server.test.ts`
- `packages/shared/src/limitsFormat.test.ts`
- `packages/contracts/src/orchestrationCrew.test.ts`
- Result: 5 test files and 211 tests passed.

Package type checks passed with `tsgo --noEmit`:

- `apps/server`
- `apps/web`
- `packages/client-runtime`
- `packages/contracts`
- `packages/shared`

The server and client-runtime checks print existing Effect suggestions. They exit successfully and report no type errors.

React Doctor improved from 82 to 91 after removing render-time clock reads. It reports no performance errors. Its remaining nine warnings are manual-memoization and multi-component-file suggestions inherited from the adapted component structure.

No browser or computer-use pass was run. The project instructions require explicit approval for that step.

## UI Phase Polish

The next UI pass should verify these items in a real web or desktop client:

- Expanded, collapsed, and narrow sidebar footer layouts with zero, one, and two gauges.
- Gauge contrast in all themes and at 100% used.
- Hover-card placement above the compact footer.
- The three-column Limits strip at desktop widths and its wrap at small widths.
- Multi-environment loading and stale-snapshot copy with real provider events.
- The Kimi unavailable row after the Kimi provider branch is merged.

The implementation is committed locally only. No branch was pushed and no pull request was opened.
