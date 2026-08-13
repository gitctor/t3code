# Task suggestions report

## What landed

Task suggestions are now durable, operator-controlled follow-up work.

- `TaskSuggestion` contracts define the source turn, recommended provider settings, concurrency verdict, lifecycle state, and typed errors. The wire list remains forward-compatible.
- The orchestration decider emits create, accept, dismiss, and restore events. Migration `043_TaskSuggestions` projects them into an indexed SQLite table.
- Every agent MCP session receives the `suggestions` capability. Crew capability changes cannot remove it.
- The `suggest_task` MCP tool tells agents to suggest sparingly and report concurrency honestly. It rejects an eleventh pending suggestion for one source thread with a typed error.
- Environment-scoped client RPCs list, accept, dismiss, and restore suggestions. Only client RPC accept starts work. The MCP tool cannot accept or auto-run a suggestion.
- Accept uses `ThreadTurnStartCommand.bootstrap`. It creates a new thread and worktree, runs the setup script, sends the suggested prompt, and records the accepted thread ID.
- Provider recommendations are checked against live provider state. Unavailable recommendations fall back through the source thread, project default, and available provider defaults.
- The web timeline renders cards after the assistant turn that created them. The project header shows the pending count and opens the pending or dismissed lists.
- Web cards show provider and model guidance, the concurrency verdict, Accept, Dismiss, Restore, and accepted-thread navigation.
- Desktop receives the same behavior through the shared web client.
- Mobile has a minimal Suggested tasks screen in the existing Settings stack. It lists pending suggestions and supports Accept and Dismiss.
- User documentation and the maintainer glossary define the behavior and the `suggestion` term.

## Commits

- `702825b7f` `feat(contracts): define task suggestions`
- `9b83545c3` `feat(server): persist and accept task suggestions`
- `e34154b7c` `fix(mcp): keep task suggestions available to every agent`
- `f5692f43f` `feat(web): show and manage suggested tasks`
- `afaaf6aec` `feat(mobile): add suggested tasks screen`

Each commit is local on `build/crew-suite`. Nothing was pushed. No pull request was created.

## Proof notes

Final focused verification ran before this report.

- Contracts: `tsgo --noEmit` passed.
- Server: `tsgo --noEmit` passed. It reported only existing Effect compiler suggestions.
- Client runtime: `tsgo --noEmit` passed. It reported one existing Effect compiler suggestion in `src/relay/discovery.ts`.
- Web: `tsgo --noEmit` passed.
- Mobile: the required `tsgo --noEmit` attempt still reports the existing React Navigation route-inference errors across untouched screens. This matches the known branch boundary recorded in `.plans/steer-queue-report.md`. The package-supported `tsc --noEmit` check passed, and no error points to the suggested-task screen.
- Contract round-trip and crew compatibility: 31 tests passed in 2 files.
- Decider, projection, MCP capability, session capability persistence, rate limit, and DispatchBroker compatibility: 23 tests passed in 6 files.
- Server integration, including receipt-backed accept bootstrap plus dismiss and restore: 126 tests passed.
- Web card state mapping: 4 tests passed.
- `packages/contracts/src/orchestrationCrew.test.ts`, `apps/server/src/server.test.ts`, and `apps/server/src/mcp/DispatchBroker.test.ts` stayed green.

No browser or simulator pass ran. The task did not authorize computer use, and `AGENTS.md` requires permission for it.

## Reuse for cross-thread messaging

The next phase can reuse these seams:

1. Use the new MCP toolkit folder as the model for an all-agent messaging capability. Keep send authority separate from operator-only actions.
2. Reuse the source identity tuple: `environmentId`, `sourceThreadId`, and `sourceTurnId`. Add the destination thread as a separate typed field.
3. Reuse event-sourced lifecycle commands, the decider, and an indexed projection table. Do not write cross-thread messages directly into snapshots.
4. Reuse environment-scoped RPC atoms from `packages/client-runtime`. They already work across web, desktop, remote, and mobile connections.
5. Reuse the per-thread semaphore and typed error pattern for delivery limits and concurrent mutations.
6. Reuse timeline row anchoring by turn ID. It keeps generated records beside the turn that produced them without changing message contracts.
7. Reuse `ThreadTurnStartCommand.bootstrap` only when messaging intentionally creates a new thread. Messages to an existing thread should use its normal active-turn steer or queue path.
8. Keep operator disposal and agent proposal as separate authority boundaries. Suggested tasks prove that an agent can create durable intent without receiving auto-run authority.
