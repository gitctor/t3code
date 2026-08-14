# Limits and Steer UX Report

Date: 2026-08-13
Branch: `build/crew-suite`
Starting commit: `ed0ea486c`

## Outcome

The built-app operator issues are addressed across the shared web surface used by local web, app.t3.codes, and desktop.

- Account limits seed eagerly from historical canonical provider events, refresh on interaction, and keep cached content visible while a newer response is in flight.
- The composer context-window popover now includes the existing shared account-limits hover card without removing context usage details.
- A running turn now has per-message Steer or Queue controls, and queued messages can be promoted with `Steer now` only when their target provider supports steering.
- Kimi remains honest and queue-only: it shows `Limits not reported by provider.`, has no limit gauge, and never offers a Steer action.

No polling loop, continuously repainting UI, push, or pull request was added.

## Claude seed root cause

The old seed path could not find Claude data for three independent reasons:

1. Seeding scope was Codex-only. `AccountLimitsService` only called `readLatestCodexRateLimits` and had no historical Claude reader.
2. The path assumption was provider-owned Codex storage (`~/.codex/sessions`). Claude's useful historical rate-limit records are in T3's canonical provider event logs. Those logs are per-thread and rotated as `events.<threadId>.log` and `events.<threadId>.log.N`; they are not the configured base name `events.log` and are not Claude project transcripts.
3. Seeding did not run at server construction. It waited for the first `server.getAccountLimits` request, so startup could expose an empty cache until a client happened to request the limits surface.

The replacement scans bounded tails of recent canonical provider logs, selects the newest `account.rate-limits.updated` record per provider, ingests them under the existing timestamp guard, and runs during `AccountLimitsService` construction. Codex's own transcript scan remains as an additional fallback for sessions run outside T3.

## Interaction-driven refresh

- Mounting the Usage limits strip or opening a limits hover card requests an atom refresh once for that mount.
- `AccountLimitsService.readSummary` re-scans historical sources subject to the existing one-minute coalescing window and invokes a runtime-registered live refresh hook.
- `ProviderService` asks each live adapter that implements `refreshAccountLimits`; one provider failure cannot fail the aggregate read.
- Claude uses its live SDK usage control request, coalesced to at most once every five seconds for interactive requests.
- Codex uses app-server `account/rateLimits/read` on a live session.
- The client retains the previous atom value during refresh, so cached gauges and rows remain rendered and update in place when the RPC returns.

## Composer limits

`ContextWindowMeter` still renders percentage, token counts, total processed tokens, and compaction copy. Below that content it renders `AccountLimitsHoverCard`, the same component used by the sidebar Usage hover. There is no second limits renderer.

## Per-send Steer and Queue

While a turn is running:

- Plain click keeps the saved `activeTurnMessageBehavior`.
- Right-click, long-hover, the Context Menu key, or Shift+F10 opens the one-shot delivery menu.
- Capable providers show `Steer — send into the running turn` and `Queue — send after this turn`; the saved behavior is marked `Default`.
- Queue-only providers show only Queue.
- Choosing an action affects that message only and does not mutate settings.
- A one-shot Steer intentionally bypasses older locally queued messages and enters the running turn.

The awaiting-delivery area now renders each queued message. `Steer now` is present only while a turn is running and the queued message's target provider supports steering. Promotion acquires the same outbox dispatch lock used by the drain, sends the exact persisted message/model/mode/crew identity, removes it only after success, and leaves it queued on failure.

## Surfaces

- Local web and app.t3.codes: all three changes apply through shared web components and RPC contracts.
- Desktop: all three changes apply because desktop wraps the web client; desktop typecheck passed.
- Native mobile: no desktop hover/context-menu UI was added. Its existing queue behavior is unchanged. The authoritative provider capability helper remains shared, so Kimi continues to resolve to Queue where the mobile client uses that setting.
- Providers: Claude and Codex implement live limit refresh; all canonical reporting providers participate in historical log recovery; Kimi remains explicitly unsupported for subscription limits and active-turn steering.

## Verification

Focused and required regression run:

```text
12 test files passed
342 tests passed
```

The run included:

- `apps/server/src/usage/accountLimitsTranscripts.test.ts`
- `apps/server/src/usage/AccountLimitsService.test.ts`
- Claude adapter, Codex adapter, Codex session runtime, and ProviderService tests
- `apps/web/src/components/chat/ComposerPrimaryActions.test.ts`
- `apps/web/src/components/WebThreadOutboxDrain.logic.test.ts`
- `apps/web/src/webThreadOutbox.test.ts`
- `apps/server/src/server.test.ts`
- `packages/contracts/src/orchestrationCrew.test.ts`
- `apps/web/src/crewSelection.test.ts`

`tsgo --noEmit` passed in:

- `packages/contracts`
- `apps/server`
- `apps/web`
- `apps/desktop`

The typechecks emitted existing Effect suggestions and a Node engine warning because the shell used Node 25.9.0 while the repo requests Node 24.13.1; all four commands exited successfully.

## Visual QA checklist

Browser/installed-app QA was not run because repository instructions require explicit permission before launching browser or computer-use testing. The integrated visual pass should check:

1. Start against a safe copied data snapshot, never live `~/.t3/userdata`. Confirm Claude and Codex historical limits appear on first connection without opening Usage first.
2. Open the sidebar Usage hover with cached data. Confirm content appears immediately, does not switch to a blocking spinner, and percentages/reset copy update in place after the live response.
3. Confirm Kimi says `Limits not reported by provider.` and renders neither a gauge nor a Steer action.
4. Hover the composer context indicator. Confirm its original context percentage/token details remain and the same Claude/Codex/Kimi limits card appears below them.
5. During a Claude and Codex running turn, open the send menu by right-click, long-hover, Context Menu key, and Shift+F10. Confirm focus enters the menu, Escape closes it, and the saved mode carries the `Default` label.
6. Choose Steer and Queue in turn. Confirm each affects only its message and Settings remains unchanged; confirm plain click still follows Settings.
7. Queue multiple messages. Confirm every message is visible, capable targets show `Steer now`, Kimi targets do not, and promotion removes only the successfully steered message.
8. Revisit the route and repeat in the installed desktop artifact to catch portal positioning, nested popover sizing, and persisted-outbox regressions.

## Local commits

- `e49ae1903` — `fix(usage): eagerly refresh account limits`
- `ca1590094` — `feat(web): show limits with context usage`
- `65512b5e3` — `feat(web): add per-send steer and queue controls`

The pre-existing staged `.plans/design-debt-sweep-report.md` change was preserved and excluded from every implementation commit.
