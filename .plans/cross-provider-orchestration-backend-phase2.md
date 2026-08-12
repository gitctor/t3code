# Cross-provider orchestration backend — Phase 2

Date: 2026-08-11
Branch: `feat/cross-provider-orchestration`
Phase 1 base: `4eacdd4cc`
Status: complete

## Outcome

Phase 2 replaces the Phase 1 `DispatchBroker` stub with a real cross-provider
dispatch path. Dispatch relationships are domain events projected into SQLite,
children run as ordinary threads in isolated worktrees, lifecycle coordination
uses queue-backed receipts, and the parent turn receives the existing `task.*`
activity shape consumed by the Agents panel.

The Phase 1 toolkit, orchestration capability name, `CrewRegistry` interface,
and briefing builder did not change.

## Commits

### `445cd83e1` — `feat(server): persist cross-provider dispatch state`

- `packages/contracts/src/orchestration.ts`
  - Adds internal dispatch-upsert and system-message commands.
  - Adds the persisted `thread.dispatch-upserted` domain event.
- `apps/server/src/orchestration/decider.ts`
  - Decides the new internal commands without adding a second runtime model.
- `apps/server/src/persistence/Migrations/041_CrossProviderDispatches.ts`
  - Adds `projection_turns.crew_id`.
  - Adds `projection_dispatches` plus parent-turn, child-thread, and unsettled
    indexes.
- `apps/server/src/persistence/Services/ProjectionDispatches.ts`
- `apps/server/src/persistence/Layers/ProjectionDispatches.ts`
  - Adds the durable dispatch repository used by the broker and reactor.
- `apps/server/src/persistence/Services/ProjectionTurns.ts`
- `apps/server/src/persistence/Layers/ProjectionTurns.ts`
  - Carries the selected `crewId` from pending turn start into the concrete
    active turn.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
  - Projects dispatch events and crew turn provenance.
- `apps/server/src/persistence/Migrations.ts`
  - Registers migration 41.
- Focused persistence tests:
  - `apps/server/src/persistence/Migrations/041_CrossProviderDispatches.test.ts`
  - `apps/server/src/persistence/Layers/ProjectionDispatches.test.ts`

### `39035bcbe` — `feat(server): run cross-provider dispatch lifecycle`

- `apps/server/src/mcp/DispatchBroker.ts`
  - Resolves the parent thread, active turn, frozen crew, and target member.
  - Enforces roster membership and a four-child concurrency cap.
  - Persists unavailable targets as declined dispatches without a synthetic
    `childThreadId`.
  - Creates one worktree and ordinary child thread per accepted dispatch.
  - Branches chained work from a completed dispatch's child-thread branch.
  - Reads `list_dispatches` from the SQL projection.
  - Implements subscribe-before-snapshot `await_dispatch`; timeout returns
    `running` and settlement arrives through a lifecycle receipt.
- `apps/server/src/orchestration/Layers/DispatchReactor.ts`
- `apps/server/src/orchestration/Services/DispatchReactor.ts`
  - Maps child activity to parent progress.
  - Settles children after the existing turn-processing quiescence receipt.
  - Reconciles persisted live dispatches on startup.
  - Interrupts live children before recording cancellation.
  - Cancels all live children on parent interruption or completion.
  - Appends the exact Section 7 warning when a parent completes early.
- `apps/server/src/orchestration/DispatchTaskProjection.ts`
  - Produces contract-valid `task.started`, `task.progress`, `task.updated`,
    and `task.completed` events with stable dispatch identity and full linkage.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
  - Retains `instanceId` and `childThreadId` when task events become persisted
    parent activities.
- `apps/server/src/orchestration/Services/RuntimeReceiptBus.ts`
- `apps/server/src/orchestration/Layers/RuntimeReceiptBus.ts`
  - Makes production receipts non-retaining PubSub events so the dispatch
    reactor and MCP await path coordinate without polling.
- `apps/server/src/orchestration/Layers/OrchestrationReactor.ts`
- `apps/server/src/server.ts`
  - Starts and provides the dispatch reactor and real broker once per server.
- Test and harness updates:
  - `apps/server/src/mcp/DispatchBroker.test.ts`
  - `apps/server/src/orchestration/Layers/DispatchReactor.test.ts`
  - `apps/server/src/orchestration/DispatchTaskProjection.test.ts`
  - `apps/server/src/orchestration/Layers/OrchestrationReactor.test.ts`
  - `apps/server/src/mcp/McpHttpServer.test.ts`
  - `apps/server/src/mcp/toolkits/orchestration/handlers.test.ts`
  - `apps/server/src/server.test.ts`
  - `apps/server/integration/OrchestrationEngineHarness.integration.ts`

## Behavioral proof

Focused broker tests prove:

- accepted work creates a child thread and isolated worktree from the parent
  branch;
- unavailable work settles declined and creates no child thread;
- a non-roster target is rejected;
- four live dispatches block a fifth;
- `fromDispatchId` uses the completed child's branch;
- timeout returns `running` without polling;
- a lifecycle receipt settles an await without polling;
- a freshly constructed broker reads the same projected dispatch state.

The dispatch reactor test proves both parent end paths. Interruption first
persists a child interrupt request and then settles its Agents row to
`stopped`. Completion appends:

> Turn ended with 1 agents still working. Their results were not collected.

It then interrupts and settles the child.

The projection-level test decodes all four emitted `task.*` events with
`ProviderRuntimeEvent`, converts them into the persisted parent activities,
and runs the unchanged `foldSubagentActivities` implementation. It asserts:

- stable `taskId` from the dispatch id;
- title, model, role, and effort;
- running, waiting, and completed transitions;
- `instanceId` and `childThreadId` on every persisted lifecycle row;
- one completed Agents-model row with the child result.

No changes were made to:

- `apps/web/src/components/AgentsPanel.tsx`
- `packages/client-runtime/src/state/subagentRuntime.ts`

This proves the existing Agents panel can render the cross-provider child row.
Provider-icon and transcript-navigation presentation remain later UI work from
the UX plan.

## Verification

All commands used the repository-local `vp` binary and targeted files only.

- `apps/server/src/mcp/DispatchBroker.test.ts` — 8 passed
- `apps/server/src/orchestration/Layers/DispatchReactor.test.ts` — 1 passed
- `apps/server/src/orchestration/DispatchTaskProjection.test.ts` — 1 passed
- `apps/server/src/persistence/Migrations/041_CrossProviderDispatches.test.ts`
  — 1 passed
- `apps/server/src/persistence/Layers/ProjectionDispatches.test.ts` — 2 passed
- `apps/server/src/orchestration/Layers/OrchestrationReactor.test.ts` — 1 passed
- `apps/server/src/server.test.ts` — 124 passed
- `packages/contracts/src/orchestrationCrew.test.ts` — 27 passed
- `apps/server/src/mcp/McpHttpServer.test.ts` — 6 passed
- `apps/server/src/mcp/McpInvocationContext.test.ts` — 2 passed
- `apps/server/src/mcp/toolkits/orchestration/handlers.test.ts` — 3 passed
- `apps/server/src/orchestration/CrewBriefing.test.ts` — 1 passed
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts` — 47
  passed
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts` — 47
  passed
- `apps/server/src/mcp/McpSessionRegistry.test.ts` — 6 passed
- `tsgo --noEmit` from `apps/server` — no errors; only the documented existing
  suggestion diagnostics
- `tsgo --noEmit` from `packages/contracts` — clean
- `git diff --check` — clean

`apps/server/integration/OrchestrationEngineHarness.integration.ts` is a shared
harness rather than a test entry point, so `vp test run` does not collect it.
The server `tsgo` pass compiles the harness with the new reactor dependency.

## Phase 1 seam friction

The Phase 1 seam held. The toolkit, capability, registry interface, and briefing
did not need reshaping.

One implementation gap existed beside that seam: Phase 1 added `instanceId`
and `childThreadId` to `taskAgentLinkageFields`, but the existing runtime-event
to activity copier did not include those keys. The Phase 2 projection decoded
correctly but would have dropped both fields before persistence. Phase 2 adds
the two keys to that copier and proves them on every lifecycle row.

`CrewRegistry` remains intentionally in-memory until Phase 3. Phase 2 persists
the active turn's `crewId` and all dispatch rows, so dispatch state and reactor
reconciliation survive restart. Rehydrating saved crew definitions and frozen
registry entries is still Phase 3's responsibility.

There was no contract-field gap for task projection. The current client fold
renders the row from the existing task identity/status/title/model/role data;
the persisted instance and child-thread linkage is ready for the later provider
icon and transcript interaction work.

## Exact Phase 3 inputs

Phase 3 should build on these boundaries instead of replacing them.

### 1. Crew persistence behind `CrewRegistry`

- Persist authored crew definitions in server settings beside provider
  instances using the existing forward-compatible crew contracts.
- Hydrate and resolve them behind the unchanged `CrewRegistry.resolve(CrewId)`
  interface. The broker must continue to consume only that interface.
- Rebuild `memberDisplayNames`, planner availability, and
  `availableMemberIds` from the current provider registry when crews hydrate.
- Make crew hydration available before a resumed planner invokes MCP tools.
  The dispatch reactor does not require crew data and can reconcile persisted
  child state independently.
- Keep using `projection_turns.crew_id` as the active-turn provenance. Do not
  add broker-local crew state.

### 2. `parentThreadId` on the thread read model

- Add nullable `parentThreadId` through thread creation, the domain event,
  `projection_threads`, detail and shell contracts, and snapshot queries.
- Have `DispatchBroker` stamp `scope.threadId` when it creates a child. Phase 2
  could not do this because the thread contract does not yet expose the field.
- Backfill existing Phase 2 child threads by joining
  `projection_dispatches.child_thread_id` to
  `projection_dispatches.parent_thread_id`.
- Keep `projection_dispatches` as the lifecycle and parent-turn source of
  truth. `parentThreadId` on a thread is navigation/filter data, not a second
  dispatch record.

### 3. Sidebar filter data

- Include nullable `parentThreadId` in the lightweight thread shell so sidebar
  classification does not hydrate thread detail.
- Hide child threads from the normal sidebar when `parentThreadId` is set, but
  leave them in project search.
- Derive the `via {crew name}` label from the dispatch's `parentTurnId` joined
  to `projection_turns.crew_id`, then resolve the saved crew name through the
  persisted crew registry data.
- Use `projection_dispatches` for parent child counts and future deletion
  prompts. It already provides parent thread, parent turn, child thread,
  provider instance, status, and settlement timestamps.

No Phase 3 work should add dispatch state to broker memory, alter the Phase 1
toolkit, or introduce a provider-specific child runtime.
