# Claude limits fallback investigation

## Verdict

Claude Code does not persist recoverable account limit-window state under `~/.claude` on this machine. No Claude HOME fallback was added.

The UI now says: `No limit data yet — appears after your first Claude turn.` This copy appears in both the sidebar limits card and the Usage page.

## On-disk evidence

The investigation was read-only. It covered the real `~/.claude/projects` transcripts and Claude's other top-level state files while excluding credentials and settings content.

- The machine had 2,171 Claude project transcript files. Their structured assistant usage records used `message.usage` for input, output, cache, service-tier, and tool token accounting.
- No transcript had a structured `rate_limit_event`, `rate_limits`, `five_hour`, `seven_day`, `resets_at`, or `utilization` payload.
- There were 484 structured `system.error.rateLimits` fields. Every value was `null`, so these records cannot seed a limit window.
- Exact `rateLimits`, `rate_limits`, and `utilization` text matches outside that null field were inside prompts, tool inputs, tool output, or debug text. They were not Claude-owned quota records.
- `~/.claude/stats-cache.json` held daily and per-model token and cost totals. It had no quota percentage, reset timestamp, or subscription window.
- Claude's top-level state, history, and telemetry files did not contain a recoverable limit snapshot. The local token dashboard database also had no quota-window table.

This differs from Codex. Codex writes a full `rate_limits` snapshot beside transcript token-count records. Claude's full window set exists only in the live SDK usage control response. That response supplies the subscription type plus 5-hour, weekly, and model-scoped utilization/reset fields.

## Implementation

- Kept the existing bounded Codex HOME scan unchanged.
- Did not infer Claude limits from token totals because subscription limits are not a stable token budget.
- Added the Claude first-turn expectation to both empty-state surfaces.
- Kept history seeding best-effort. Any typed error or defect is swallowed and written as a debug log, so it cannot block server startup or an account-limits read.

## Verification

All requested checks passed:

```text
apps/web/src/components/usage/usageProviders.test.ts: 2 tests passed
apps/server/src/usage/accountLimitsTranscripts.test.ts and AccountLimitsService.test.ts: 4 tests passed
apps/server/src/server.test.ts: 126 tests passed
apps/server: tsgo --noEmit passed
apps/web: tsgo --noEmit passed
Targeted formatting check: passed
```

The server typecheck printed existing Effect suggestions in orchestration and pull-request files. It exited successfully. No browser or installed-app test was run.
