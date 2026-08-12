# Cross-provider orchestration backend — Phase 3 handoff

Phase 3 is complete on `feat/cross-provider-orchestration`. This file is the
backend-to-frontend contract for the crew picker, editor, and sidebar work.

## What landed

### 1. Authored crew persistence

- `ServerSettings.crews` stores authored `Crew` values beside provider
  instances. It uses the existing `Crews` forward-compatible array, so one
  malformed outer crew is dropped without discarding valid crews.
- `crew.create`, `crew.update`, and `crew.delete` are client-dispatchable
  orchestration commands. They emit `crew.created`, `crew.updated`, and
  `crew.deleted` domain events before the idempotent settings projection is
  written.
- `CrewRegistry.resolve(CrewId)` is unchanged. The live implementation reads
  saved crews and current provider snapshots on every resolution. It rebuilds
  planner availability, `availableMemberIds`, and member display names.
- A saved crew never vanishes because a provider signs out. Resolution returns
  the crew with `planner-instance-missing`, `planner-instance-unavailable`, or
  `no-available-members` as appropriate.
- Server settings start before orchestration reactors. A resumed planner cannot
  reach its MCP tools before saved crew data is available.
- Deleting a crew removes only its authored setting. It does not delete or
  rewrite dispatches, turns, or threads.

### 2. Durable child-thread ancestry

- New child `thread.create` commands carry `parentThreadId` and
  `DispatchBroker` stamps the invoking planner thread id.
- The value flows through `thread.created`, the in-memory read model,
  `projection_threads`, detail snapshots, active and archived shell snapshots,
  and single-thread queries.
- New servers emit `null` for root threads. The wire fields remain optional on
  decode so pre-Phase-3 cached snapshots and historical events still load.
- Migration 42 adds `projection_threads.parent_thread_id`, indexes it, and
  backfills Phase 2 children by mapping dispatch `child_thread_id` values to
  their `parent_thread_id` values.
- `projection_dispatches` remains the lifecycle and parent-turn source of
  truth. The thread column is navigation and filter data only.

### 3. Crew-aware sidebar and search metadata

- `OrchestrationThreadShell.parentThreadId` lets the sidebar hide children
  without loading thread details.
- `OrchestrationLatestTurn.crewId` exposes the latest turn's saved crew
  provenance for the sidebar diamond.
- `orchestration.getCrewThreadMetadata` returns sparse rows for dispatched
  children and parents that have children. It joins dispatches to the parent
  turn's `crew_id`, then resolves the current saved crew name through server
  settings.
- Parent rows carry `childThreadCount`. Child rows carry `parentThreadId`,
  `crewId`, and `crewName`. Ordinary root threads are omitted and therefore
  default to a count of zero.
- The client runtime exposes this RPC through the
  `crewThreadMetadata` environment query atom.

### 4. Claude model alias mapping — issue #4149

Verdict: the issue was real. A saved built-in slug such as
`claude-sonnet-4-6` was sent verbatim, so Claude Code never applied
`ANTHROPIC_DEFAULT_SONNET_MODEL`.

The fix is in both Claude execution paths. When a provider instance defines
the matching `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`,
or `ANTHROPIC_DEFAULT_HAIKU_MODEL`, its built-in family slug is sent as
`opus`, `sonnet`, or `haiku`. Claude Code then applies the instance mapping.
The 1M context suffix is preserved. Custom slugs such as
`moonshotai/kimi-k3` remain pass-through.

A focused driver test proves that a persisted `claude-sonnet-4-6` selection
with `ANTHROPIC_DEFAULT_SONNET_MODEL=moonshotai/kimi-k3` starts the SDK with
`model: "sonnet"` and does not reset it to the explicit slug on the next turn.

## Local commits

- `5a9e5e224` — `feat(server): persist authored orchestration crews`
- `61606e834` — `feat(server): persist dispatched thread ancestry`
- `ac7b83b24` — `feat(server): expose crew thread metadata`
- `ef73da5fb` — `fix(claude): honor configured model aliases`
- `59518e495` — `fix(server): require crew metadata projection`
- `cdde863cb` — `fix(claude): preserve custom family slugs`

## Proof notes

- Final Phase 3 and required Phase 2 regression run: 13 test files, 340 tests,
  all passed.
- The required regression files passed:
  `orchestrationCrew.test.ts`, `DispatchBroker.test.ts`,
  `DispatchReactor.test.ts`, `DispatchTaskProjection.test.ts`, and
  `server.test.ts`.
- Focused proofs passed for crew CRUD, malformed-crew isolation, degraded live
  resolution, migration backfill, shell ancestry, latest-turn crew provenance,
  sparse metadata and crew-name RPC mapping, and Claude alias resolution.
- Every other test file changed to keep the projection interface exhaustive was
  run: 6 files, 59 tests, all passed.
- `tsgo --noEmit` passed in `apps/server` and `packages/contracts`. The known
  Effect suggestions in `decider.ts` and other pre-existing files remain; no
  new type errors were introduced.
- `tsgo --noEmit` also passed in `packages/client-runtime`; it reported only the
  pre-existing suggestion in `src/relay/discovery.ts`.
- No live `~/.t3/userdata` state was opened for writing. No UI was built.

## What the UI needs

This section is the frontend builder's requirements list.

### Read authored crews

1. Call the existing `server.getSettings` RPC.
2. Read `ServerSettings.crews: Crew[]`.
3. Keep the returned roster order. `Crew` contains `id`, `name`, `planner`, and
   `members`; planner models are required and member models are optional.
4. Combine authored crews with the existing live `ServerProvider[]` snapshot
   to render display names and degraded states. Use the backend readiness rule:
   the instance exists, is available, enabled, installed, `status === "ready"`,
   and auth is not `unauthenticated`.
5. Map failures to the exact UX copy from
   `.plans/cross-provider-orchestration-ux.md`. Do not hide degraded crews.

There is no public `CrewRegistry.resolve` RPC. That interface remains an
internal runtime boundary for planner execution. The picker already has both
inputs it needs: `ServerSettings.crews` and live provider snapshots.

### Create, update, and delete crews

Send these through `orchestration.dispatchCommand`:

```ts
{ type: "crew.create", commandId, crew, createdAt }
{ type: "crew.update", commandId, crew, createdAt }
{ type: "crew.delete", commandId, crewId, createdAt }
```

- Generate a new `CommandId` per user action.
- Send the full `Crew` on create and update.
- Use `CrewId` for delete.
- Refresh or observe server settings after success. The settings stream carries
  the new full crew list.
- Do not write `ServerSettingsPatch.crews` from the crew editor. That field is
  the server's atomic settings projection surface; the event-backed commands
  are the public CRUD path.

### Filter and badge sidebar threads

1. Read `OrchestrationThreadShell.parentThreadId`.
2. Hide a shell from the normal sidebar when that value is non-null.
3. Keep search behavior unchanged. `orchestration.searchThreads` still returns
   matching child threads.
4. Show the crew diamond when `shell.latestTurn?.crewId` is present.
5. Treat an absent `parentThreadId` from an old cached shell as `null`.

### Load crew labels and child counts

Call:

```ts
client[ORCHESTRATION_WS_METHODS.getCrewThreadMetadata]({})
```

The result is:

```ts
{
  threads: Array<{
    threadId: ThreadId
    parentThreadId: ThreadId | null
    crewId: CrewId | null
    crewName: string | null
    childThreadCount: number
  }>
}
```

- Index rows by `threadId`.
- For a child search result, render `via {crewName}` when `crewName` is not
  null. A deleted crew can leave historical child work with a null current
  name; use a neutral fallback rather than hiding the result.
- For a parent delete prompt, use `childThreadCount`. Missing metadata means
  zero.
- This phase supplies the count only. Cascade deletion and orphan re-surfacing
  commands are not part of Phase 3; do not imply that the backend performs
  either action yet.
- In shared client state, use the new `crewThreadMetadata` environment query
  atom. In lower-level code, call the RPC tag above directly.

### Contracts now available

- `Crew`, `Crews`, `CrewId`, `ResolvedCrew`, `CrewUnavailableReason`
- `CrewCreateCommand`, `CrewUpdateCommand`, `CrewDeleteCommand`
- `OrchestrationThread.parentThreadId`
- `OrchestrationThreadShell.parentThreadId`
- `OrchestrationLatestTurn.crewId`
- `OrchestrationCrewThreadMetadata`
- `OrchestrationGetCrewThreadMetadataResult`
- `ORCHESTRATION_WS_METHODS.getCrewThreadMetadata`

No frontend component, route, picker, editor, sidebar filter, badge, search
label, or delete prompt was changed in this phase.
