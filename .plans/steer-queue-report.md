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
| `2137c622a` | `573f23c12` | Applied the upstream web queue edge-case fix without source changes. |
| `a404f29a9` | `4d5187868` | Applied the upstream late-steer and reconnect race fix without source changes. |
| `ee263e222` | `618973741` | Adapted the final Codex reconciliation patch onto the fork's provider runtime. |

Fork-only follow-ups:

- `a03ca4cbe` removes a duplicate send-button declaration created by the composer conflict. It preserves the fork's stage artwork and the Stop plus Steer/Queue layout.
- `b3ee9c2af` rejects incomplete `localStorage` implementations and falls back to in-memory outbox storage.
- `e016517e2` verifies that Stop remains beside both active-turn send actions.
- `15a701806` verifies that two overlapping Kimi ACP prompts remain one active turn.

Original PR author ClapFy is preserved as author and credited with `Co-authored-by` on adapted commits.

## Provider steer capability

| Provider | Active-turn delivery | Implementation | Fallback |
| --- | --- | --- | --- |
| Claude | Steer | Adds the message to the live SDK prompt queue and keeps the current turn ID. | None required. |
| Codex | Steer | Uses native `turn/steer`. A successful request reaffirms the active turn to orchestration. Late acknowledgements restore the already-settled ready or error state. | A rejected native steer follows the typed recovery path and starts a normal turn only when safe. |
| Kimi | Steer | The ACP session accepts another `session/prompt` while work is active. The adapter counts prompts in flight and reuses the current turn ID until all prompts settle. | None required. The ACP capability is implemented and tested in this fork, so the UI does not claim a queue-only Kimi fallback. |
| Cursor | Steer | Sends another ACP prompt into the active session and reuses the current turn ID. | None required. |
| Grok | Steer | Sends another ACP prompt into the active session and reuses the current turn ID. | None required. |
| OpenCode | Steer | Sends a prompt into the active OpenCode session and preserves its current turn ID. | None required. |

The setting is global because all six installed adapters support steering. Queue remains available as an explicit preference.

## Crew child and planner routing

The crew transcript drawer renders an embedded `ChatView` with the child's `environmentId` and `childThreadId`.
The drawer composer therefore reads the same delivery preference but sends and queues against the child thread.
Web outbox keys include both environment and thread IDs, so parent and child FIFOs cannot merge.

The planner composer remains the outer `ChatView` and resolves its target from `activeThread.id`.
Opening a transcript drawer does not navigate or replace that parent thread.
A steer from the planner composer therefore reaches the planner session, never a child session.

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

The reported mobile background-loss shape still exists.
The mobile queue is persisted by the client and drained by `use-thread-outbox-drain` while the mobile JavaScript runtime is active.
If the app is suspended after enqueue, the server does not own a durable command that can send the next message when the active turn settles.

This was not fixed here. Moving queue ownership to the server needs a wire contract, server persistence, projection or reactor behavior, reconnect rules, and migration of existing client entries. That is not a small isolated fix.

## Verification

Focused tests:

- 21 test files passed.
- 550 tests passed.
- This includes direct steer coverage for Claude, Codex, Kimi, Cursor, Grok, and OpenCode.

Type checks:

- `apps/server`: passed `tsgo --noEmit`.
- `packages/contracts`: passed `tsgo --noEmit`.
- `apps/web`: the committed tree passed `tsgo --noEmit` from a clean temporary archive. The live working tree is separately blocked by uncommitted crew-editor work.
- `apps/mobile`: the committed tree still fails on existing React Navigation route inference across unrelated screens. The active-turn files and focused mobile tests pass.

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
9. Repeat on mobile at the smallest supported phone width. Confirm the queue count and Stop action do not cover the send action.
10. Background mobile with a queued message and record the known #5436 behavior for the follow-up server-owned queue work.
