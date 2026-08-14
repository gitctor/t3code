# Crew MCP tools visibility fix

Date: 2026-08-14
Branch: `build/crew-suite`
Functional commit: `d7889f486` (`fix(server): expose crew tools before provider boot`)

## Result

Crew-scoped MCP credentials now contain orchestration capability at the instant they are issued,
before any provider adapter can initialize its MCP catalog. Recovery boots receive the same
`crewId` and crew instructions as ordinary fresh boots. Capability changes on an existing
credential now emit `notifications/tools/list_changed`, allowing long-lived MCP clients to refresh
their catalog without rotating the process-bound credential.

The real-layer integration probe proves that both a Codex planner and a Claude planner see
`dispatch`, `await_dispatch`, and `list_dispatches` from an authenticated `tools/list` request at
the adapter-start boundary. Crewless Codex and Claude boots still return byte-identical raw
non-orchestration catalogs.

## Trace and hypothesis verdict

Read-only inspection of the field test-flight artifacts confirmed the reported shape:

- the new thread was created at `2026-08-14T05:26:08.820Z`;
- its persisted turn-start event carried `crewId: "orchestrator"`;
- a fresh Codex App Server session began at `2026-08-14T05:26:08.957Z`;
- the `t3-code` MCP connection became ready before the turn ran;
- the canonical log contained no `task.started` events, and the projection contained no
  dispatch rows.

The narrow ordering hypothesis was not confirmed for the normal new-thread path. Before this fix,
the actual source order was:

1. `startCrewTestFlight` created the thread and immediately dispatched `thread.turn.start` with
   `crewId`.
2. The decider persisted that `crewId` on `thread.turn-start-requested`.
3. `ProviderCommandReactor` resolved the live crew and passed `crewId` into
   `ProviderService.startSession`.
4. `ProviderService` issued a baseline MCP credential, published it through
   `McpProviderSession`, mutated that credential to add orchestration, and only then called the
   adapter's `startSession`.
5. The Codex adapter read the thread's MCP endpoint and bearer token during `startSession`; its
   runtime also requested `config/mcpServer/reload` before a turn. Claude constructed its HTTP MCP
   config for the query.

Therefore the field failure cannot be attributed to the normal fresh path attaching capability
after Codex had already fetched `tools/list`. The retained field artifacts do not expose the
historical in-memory registry catalog, so they cannot identify which catalog the failed Codex
process received. No stronger causal claim is warranted from that evidence.

The trace did reveal three concrete contract violations that made visibility freshness-dependent:

1. Fresh credential issuance and capability grant were separate mutations. A baseline-only
   credential existed between them even though Phase 1 required the capability to exist before
   adapter catalog initialization.
2. `sendTurn` resolved or recovered the provider session before refreshing MCP capability.
   `recoverSessionForThread` did not receive `crewId` or `additionalInstructions`, so a stale
   session rebooted its adapter with a baseline credential and without crew context.
3. Updating an existing credential's capability changed server-side filtering silently. The MCP
   server emitted no `notifications/tools/list_changed`, leaving long-lived clients dependent on
   provider-specific reload behavior.

These are the fixed root causes of the violated visibility invariant. The new adapter-boundary
test makes the fresh-session property directly observable instead of inferring it from call order.

## Fix

- `McpSessionRegistry.issue` accepts initial capabilities and writes the complete crew scope in one
  state mutation. `ProviderService` uses that atomic path before every adapter boot.
- `ProviderService.sendTurn` refreshes capability before routing. If routing recovers a stale
  session, recovery receives `crewId` and crew instructions and issues the crew-scoped credential
  before `adapter.startSession`.
- `McpSessionRegistry.setCapabilities` compares the previous and next catalogs. A real change is
  published on `toolListChanges`; a no-op update emits nothing.
- `McpHttpServer` consumes that stream for its scoped lifetime and broadcasts
  `notifications/tools/list_changed` through the MCP server notification channel.
- A safe debug event, `prepared provider MCP scope before adapter session boot`, records thread id,
  provider instance id, credential presence, and whether orchestration was enabled. It never logs
  the bearer token.

## Test gap closed

The orchestration integration harness now supports a callback at the exact start of a test
adapter's `startSession`, before the test adapter creates its session. The callback performs the
same authenticated HTTP MCP exchange an adapter performs: `initialize`, then `tools/list`, using
the endpoint and bearer credential registered for that thread.

Through the production `CrewProviderCommandLayerLive` graph, the new test proves for both Codex and
Claude planner selections:

1. A newly created thread followed immediately by a crew turn reaches adapter boot with its
   `crewId`.
2. The authenticated boot-time catalog contains `dispatch`, `await_dispatch`, and
   `list_dispatches`.
3. A new crewless thread reaches adapter boot without `crewId` and without those tools.
4. The complete raw crewless `tools/list` response is byte-identical across the two planner cases.

Registry tests prove atomic initial scope and publish-on-change behavior. MCP server tests prove the
change stream becomes `notifications/tools/list_changed`. Provider service recovery tests prove
both Codex and Claude recovery boots receive `crewId` and the crew instructions.

## Verification

- Requested suites plus new registry/provider coverage: 6 files, 229 tests passed.
- `apps/server/src/server.test.ts`: passed, including the fresh Codex/Claude adapter-boot catalog
  integration.
- `apps/server/src/mcp/McpHttpServer.test.ts`: passed.
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`: passed.
- `apps/server/src/mcp/DispatchBroker.test.ts`: passed.
- `apps/server/src/mcp/McpSessionRegistry.test.ts`: passed.
- `apps/server/src/provider/Layers/ProviderService.test.ts`: passed.
- `pnpm exec tsgo --noEmit` in `apps/server`: exited 0 with only existing Effect suggestions in
  untouched files.
- Focused formatting and `git diff --check`: passed.

No browser, installed-app, or post-fix live crew test flight was performed. The existing field
database and provider log were inspected read-only; tests used isolated temporary state and local
test HTTP servers. Nothing was pushed, and no pull request was opened.
