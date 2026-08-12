# Active-turn message delivery report

## Result

Active-turn message delivery from upstream PR #5396 is integrated on `build/crew-suite`.
The default is **Steer**. **Queue** stores a per-thread FIFO and sends one message after each turn settles.
During a running turn, the composer keeps **Stop** visible beside the mode-specific send action.

No dev server was started or stopped. No browser or device visual QA was run.

## Upstream work and fork adaptations

The integration started from fork commit `8de4c7ad6`. The branch also contained the later crew UI fix `07d088c54` before the active-turn commits.

| Upstream PR #5396 commit | Fork integration | Treatment |
| --- | --- | --- |
| `98fcf1051` | `aa6dcd234` | Adapted across web and mobile settings. Preserved the crew trigger, Crews settings, and usage surfaces. |
| `cbd462f76` | `bd40aed88` | Adapted review fixes to the fork's current composer and preference code. |
| `508098f4e` | `329a3f9d3` | Adapted queue hardening. Preserved crew-aware Codex turn input, including additional planner instructions. |
| `784345965` | `5667ee838` | Applied tagged Effect recovery for rejected Codex steers. |
| `2137c622a` | `e6a4b6dfd` | Applied the upstream web queue edge-case fix without source changes. |
| `a404f29a9` | `c9ca5527b` | Applied the upstream late-steer and reconnect race fix without source changes. |
| `ee263e222` | `1e7592bdc` | Adapted the final Codex reconciliation patch onto the fork's provider runtime. |

Fork-only follow-ups:

- `ed66d8381` removes a duplicate send-button declaration created by the composer conflict. It preserves the fork's stage artwork and the Stop plus Steer/Queue layout.
- `b4d169ca2` rejects incomplete `localStorage` implementations and falls back to in-memory outbox storage.
- `249a4d3d9` verifies that Stop remains beside both active-turn send actions.
- `7ca914428` initially tested overlapping Kimi prompts against the generic mock ACP agent. That mock did not model Kimi's single mutable turn state.
- `4ef42cdee` replaces that unsafe assumption with an explicit Kimi and unknown-provider Queue fallback. It also adds direct Grok steering coverage.
- `9f54fa842` persists `crewId` in the web FIFO and restores it on delivery. This keeps queued planner turns authorized for crew orchestration, including Kimi's mandatory Queue fallback.
- `d8f0e96fb` adds the same `crewId` persistence and delivery restore to the mobile FIFO. A queued mobile follow-up now keeps the active crew planner authorized after settlement.

Original PR author ClapFy is preserved as author and credited with `Co-authored-by` on adapted commits.

## Provider steer capability

| Provider | Active-turn delivery | Implementation | Fallback |
| --- | --- | --- | --- |
| Claude | Steer | Adds the message to the live SDK prompt queue and keeps the current turn ID. | None required. |
| Codex | Steer | Uses native `turn/steer`. A successful request reaffirms the active turn to orchestration. Late acknowledgements restore the already-settled ready or error state. | A rejected native steer follows the typed recovery path and starts a normal turn only when safe. |
| Kimi | Queue only | Kimi CLI 1.49.0 keeps one mutable `_turn_state` per ACP session. Another `session/prompt` would replace that state and make cancellation and settlement unsafe. The adapter rejects a concurrent prompt. Web and mobile resolve Steer to the per-thread FIFO before sending. | The settings surfaces state that Kimi always uses Queue. Unknown drivers also use Queue until they declare steering support. |
| Cursor | Steer | Sends another ACP prompt into the active session and reuses the current turn ID. | None required. |
| Grok | Steer | Sends another ACP prompt into the active session and reuses the current turn ID. | None required. |
| OpenCode | Steer | Sends a prompt into the active OpenCode session and preserves its current turn ID. | None required. |

The preference remains global. Each composer resolves it against the selected provider. Claude, Codex, Cursor, Grok, and OpenCode honor Steer. Kimi and unknown drivers show and use the safe Queue action while a turn runs.

## Crew child and planner routing

The crew transcript drawer renders an embedded `ChatView` with the child's `environmentId` and `childThreadId`.
The drawer composer therefore reads the same delivery preference, resolves the child's provider capability, and sends or queues against the child thread.
Web outbox keys include both environment and thread IDs, so parent and child FIFOs cannot merge.

The planner composer remains the outer `ChatView` and resolves its target from `activeThread.id`.
Opening a transcript drawer does not navigate or replace that parent thread.
A steer from the planner composer therefore reaches the planner session, never a child session.
Web and mobile queued planner messages persist the selected `crewId` with the environment and planner thread IDs.
Each outbox restores that `crewId` on the next turn command, so Queue does not strip crew orchestration access after settlement.

Provider turn-start work is forked by `ProviderCommandReactor`, so a second child turn-start request can reach an active adapter.
Steer-capable adapters keep the existing provider turn ID and do not emit a false new turn boundary.
`DispatchReactor` continues to identify the dispatch by `childThreadId` and settles the parent's `task.*` projection only when the child turn settles.

Verification passed for:

- `apps/server/src/orchestration/Layers/DispatchReactor.test.ts`
- `apps/server/src/orchestration/DispatchTaskProjection.test.ts`
- `apps/server/src/mcp/DispatchBroker.test.ts`
- `packages/contracts/src/orchestrationCrew.test.ts`
- `apps/server/src/server.test.ts`

## Issue #5436 verdict

The upstream issue was still open with the reported mobile background-loss shape on 2026-08-12.
The mobile queue is persisted by the client and drained by `use-thread-outbox-drain` while the mobile JavaScript runtime is active.
If the app is suspended after enqueue, the server does not own a durable command that can send the next message when the active turn settles.

This was not fixed here. Moving queue ownership to the server needs a wire contract, server persistence, projection or reactor behavior, reconnect rules, and migration of existing client entries. That is not a small isolated fix.

## Verification

Focused tests:

- 21 test files passed.
- 561 tests passed.
- This includes direct steer coverage for Claude, Codex, Cursor, Grok, and OpenCode, plus direct rejection coverage for a second active Kimi prompt.

Type checks:

- `apps/server`: passed `tsgo --noEmit`.
- `packages/contracts`: passed `tsgo --noEmit`.
- `apps/web`: passed `tsgo --noEmit` in the live working tree, including the concurrent crew-editor edits.
- `apps/mobile`: `tsgo --noEmit` still reports 64 existing React Navigation route inference errors. Two errors are in `SettingsRouteScreen.tsx`, but both predate this feature and are outside the active-turn hunks. No error points to added active-turn code. The focused mobile tests pass.

## Visual QA checklist

Test web, desktop, and mobile after the concurrent crew-editor work is complete.

1. Use narrow web widths, including 320 px and 375 px.
2. Start a crew planner turn. Confirm the toolbar can carry the crew trigger, effort, runtime mode, delivery control, and Stop without overlap.
3. In Steer mode, confirm Stop and the Steer send action remain visible together.
4. In Queue mode, confirm Stop and the Queue send action remain visible together.
5. Confirm the fork's stage artwork still renders inside the send action.
6. Open a running crew child transcript. Confirm its drawer composer has the same controls and sends only to that child.
7. Keep the drawer open and steer from the parent composer. Confirm the message appears in the planner transcript, not the child transcript.
8. Queue two messages on one thread and one on another. Confirm FIFO order is per thread.
9. Use Kimi as a crew planner on web and mobile. Queue a follow-up and confirm the next turn keeps the crew tools and can dispatch children.
10. Repeat on mobile at the smallest supported phone width. Confirm the queue count and Stop action do not cover the send action.
11. Background mobile with a queued message and record the known #5436 behavior for the follow-up server-owned queue work.
