# Cross-provider orchestration backend Phase 1

## Outcome

Phase 1 is complete on `feat/cross-provider-orchestration`. It adds the orchestration MCP surface, an intentionally unavailable broker, runnable-crew capability isolation, an empty in-memory crew registry seam, provider warnings for unavailable crews, and one shared planner briefing delivered by both Codex and Claude adapters. It does not add crew persistence, dispatch execution, child threads, worktrees, or `task.*` projection.

## Commits and files

### `9c5c03a1b` — `feat(server): add orchestration MCP toolkit`

- `apps/server/src/mcp/DispatchBroker.ts`
- `apps/server/src/mcp/McpHttpServer.ts`
- `apps/server/src/mcp/McpInvocationContext.ts`
- `apps/server/src/mcp/toolkits/orchestration/tools.ts`
- `apps/server/src/mcp/toolkits/orchestration/handlers.ts`
- `apps/server/src/server.ts`
- Focused tests in `apps/server/src/mcp/McpInvocationContext.test.ts` and `apps/server/src/mcp/toolkits/orchestration/handlers.test.ts`

The toolkit registers `dispatch`, `await_dispatch`, and `list_dispatches` with the existing contract schemas. Every handler requires the `orchestration` capability before calling `DispatchBroker`. The Phase 1 live broker fails every operation with `OrchestrationError` code `not-orchestrating` and message `No crew is active for this thread.`

### `902650e2b` — `feat(server): wire runnable crews into provider turns`

- Registry and briefing: `apps/server/src/orchestration/{CrewBriefing.ts,Services/CrewRegistry.ts,Layers/CrewRegistry.ts}` and focused tests
- Turn propagation and resolution: `packages/contracts/src/{orchestration.ts,provider.ts}`, `apps/server/src/orchestration/{decider.ts,Layers/ProviderCommandReactor.ts}`, and focused tests
- Capability isolation: `apps/server/src/mcp/{McpSessionRegistry.ts,McpHttpServer.ts}`, `apps/server/src/provider/Layers/ProviderService.ts`, and focused tests
- Provider delivery: `apps/server/src/provider/{CodexDeveloperInstructions.ts,Layers/CodexAdapter.ts,Layers/CodexSessionRuntime.ts,Layers/ClaudeAdapter.ts}` and focused tests
- Runtime integration: `apps/server/src/provider/Services/ProviderService.ts`, `apps/server/src/server.ts`, plus affected reactor/service test doubles

`CrewRegistryLive` is seeded empty. A known runnable crew grants `orchestration` and supplies the same server-owned briefing string to session start and turn send. An unknown or unrunnable crew continues as a normal turn without orchestration tools and emits a canonical `runtime.warning` provider event.

## Capability isolation proof

`apps/server/src/mcp/McpHttpServer.test.ts` proves both boundaries:

1. The crewless `tools/list` response is filtered back to the exact pre-orchestration JSON bytes.
2. An authenticated preview-only MCP session still exposes `preview_status` and does not expose `dispatch`, `await_dispatch`, or `list_dispatches`.

`apps/server/src/mcp/McpSessionRegistry.test.ts` proves that capability replacement changes the existing thread credential without rotating it. `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts` proves that only a resolved runnable crew propagates `crewId` and the briefing; an unknown crew propagates neither and publishes a warning.

## Issue #4149 verdict

[Upstream issue #4149](https://github.com/pingdotgg/t3code/issues/4149) does not block Phase 1, so this branch contains no issue-specific fix.

The issue has two concerns:

- Explicit Claude model slugs can bypass `ANTHROPIC_DEFAULT_*` aliases. That remains relevant to future persisted crews that select OpenRouter/Fable-backed Claude models.
- The reported worktree-mode loss is not present in the current Phase 1 path: `ProviderCommandReactor` resolves the effective thread/worktree directory, carries it through `ProviderSessionStartInput`, and the Claude adapter passes it as the query `cwd`.

Phase 1 cannot launch a real crew-led Claude planner because `CrewRegistryLive` is empty and `DispatchBroker` is intentionally unavailable. Before Phase 2 enables such a planner with an explicit third-party Claude slug, revisit the alias/model-selection behavior from #4149 and add a focused driver test if that configuration is supported.

## Contract friction

The existing command contract already carried optional `crewId`, but `ThreadTurnStartRequestedPayload` dropped it. The event needed optional `crewId` because crew resolution happens asynchronously in `ProviderCommandReactor`; no existing event field identified the selected crew.

`ProviderSessionStartInput` and `ProviderSendTurnInput` needed optional `crewId` and `additionalInstructions`. `crewId` lets the provider service establish the MCP capability before an adapter initializes or refreshes its MCP catalog. `additionalInstructions` carries the single server-owned briefing through the common adapter boundary. Neither model selection nor interaction mode can carry this information without conflating unrelated semantics.

No orchestration crew schemas or dispatch result shapes changed. `packages/contracts/src/orchestrationCrew.test.ts` remains green with all 27 tests.

## Phase 2 requirements

Phase 2 can replace the stub `DispatchBroker` without changing the toolkit, capability name, registry interface, or briefing builder. The real broker must:

- Resolve the active parent thread, turn, runnable crew, member allowlist, role, model override, and concurrency limit from the invocation scope and registry entry.
- Create an ordinary child thread per dispatch, assign the selected member instance/model, and persist the parent/child/dispatch relationship needed by projection.
- Create or reuse the correct worktree from the parent checkpoint. For chained work, `fromDispatchId` must use the completed dependency's resulting checkpoint.
- Emit queue-backed receipts for acceptance, progress, completion, decline, failure, and cancellation so `await_dispatch` can wait on effects rather than sleeps or polling.
- Enforce the crew concurrency cap of four, parent cancellation, member availability, and dispatch ownership.
- Project `task.*` events with stable dispatch ID, parent thread ID, child thread ID, provider instance ID, status, timestamps, summary/error, and checkpoint/worktree metadata required by the frontend read model.
- Return the completed member summary unchanged through `DispatchOutcome`; the planner briefing already tells the planner how to chain, list, and await work.
- Add persisted crew storage behind `CrewRegistry` when that later phase lands. The current empty live layer is the intentional seam, not a persistence implementation.

## Verification

- Every added or touched test file was run directly with `./node_modules/.bin/vp test run <file>`.
- Required contract suite: 27 of 27 passing in `packages/contracts/src/orchestrationCrew.test.ts`.
- Additional focused coverage includes MCP invocation and handlers, authenticated MCP tool isolation, session capability replacement, registry/briefing, decider propagation, provider reactor resolution, canonical runtime warnings, and Codex/Claude instruction delivery.
- `../../node_modules/.bin/tsgo --noEmit` passes from `apps/server` and `packages/contracts`. The server emits only existing suggestion-level Effect diagnostics.
- `git diff --check` passes.
- No repo-wide check, live server, browser, push, or pull request was used.
