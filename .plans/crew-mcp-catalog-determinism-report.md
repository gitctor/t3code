# Crew MCP catalog determinism fix

Date: 2026-08-15
Branch: `build/crew-suite`
Functional commit: `3668322a1` (`fix(server): make crew MCP catalog deterministic`)

## Result

Codex crew turns now use one MCP startup path. T3 no longer tells Codex to reload the same
`t3-code` server immediately before each turn.

The production layer regression starts ten fresh Codex crew turns. Every authenticated
`tools/list` response contains `dispatch`, `await_dispatch`, and `list_dispatches`. There were zero
misses.

At the first assistant token of each Codex crew turn, T3 now reads Codex's own catalog through
`mcpServerStatus/list`. If any required orchestration tool is absent, T3 emits a canonical
`runtime.warning`. The warning names the failure and includes the missing and observed tool names.

## Proven cause

Codex already receives the `t3-code` MCP URL and bearer-token setting in its app-server process
arguments. Codex loads that server during process startup.

`CodexSessionRuntime.sendTurn` then sent `config/mcpServer/reload` before every turn. On the first
turn, this overlapped the startup load. It explains the exact field lifecycle:

1. The process configuration starts the first connection.
2. The pre-turn reload starts a second connection.
3. Codex cancels the older load while both catalog generations settle.
4. The internal catalog can retain either generation, producing the alternating visible and empty
   results.

A protocol regression captured every request sent by T3 to the Codex app-server. Before the fix,
the new zero-reload assertion failed because it captured one `config/mcpServer/reload` request.
After the fix, the same crew turn captures zero reload requests.

The reload was the only T3 command that could create the second connection after process startup.
Production code now contains no `config/mcpServer/reload` request. The single startup connection
remains configured through the process arguments.

## Hypothesis verdicts

### 1. Two MCP connections raced

Confirmed. T3 configured the server at process startup and then explicitly reloaded it before the
turn. The field `starting, starting, cancelled, ready, ready` sequence matches those two paths.

The fix removes the second path. It does not add retries or timing delays.

### 2. The session registry lost orchestration scope

Rejected for this failure.

Fresh crew credentials are issued with orchestration in the same synchronized state mutation.
Both old connection attempts used the same process-bound bearer token. The ten-turn real-layer
test authenticated each request against the live registry and saw the complete catalog every time.
The registry test suite also kept its expiry, replacement, and capability tests green.

### 3. The change notification reached only one connection

Not the fresh-turn cause. A fresh crew credential already has orchestration before Codex starts, so
it does not need a capability-change notification.

Long-lived sessions still use `notifications/tools/list_changed` for real capability changes. The
removed reload no longer creates a second connection that can compete with that live connection.

## Failure is now loud

The runtime marks each new Codex crew turn for one catalog audit. When the first
`item/agentMessage/delta` arrives, it requests `mcpServerStatus/list` with
`detail: "toolsAndAuthOnly"` and checks the `t3-code` tool names.

If a tool is missing, the adapter emits:

`Crew turn reached its first assistant token without all orchestration tools in the Codex catalog.`

The warning becomes a normal `runtime.warning` event. It appears before the first assistant delta
is delivered downstream. The audit runs once per crew turn and never runs for crewless turns.

## Regression coverage

- The child-process protocol test proves a configured crew turn sends zero
  `config/mcpServer/reload` requests.
- The same test simulates a missing catalog and proves one `mcpServerStatus/list` audit occurs at
  first output.
- The warning test proves the warning precedes the first assistant delta and names all three
  missing tools.
- The adapter test proves the provider event becomes a canonical `runtime.warning` with its detail
  intact.
- The production layer graph starts ten fresh Codex crew turns. Each performs real authenticated
  MCP `initialize` and `tools/list` requests and sees all three orchestration tools.
- The existing fresh Claude and crewless negative checks remain in the same real-layer test.

## Verification

- Required and touched suites: 7 files, 211 tests passed.
- `apps/server/src/server.test.ts`: passed, including ten consecutive Codex crew catalogs.
- `apps/server/src/mcp/McpHttpServer.test.ts`: passed.
- `apps/server/src/mcp/McpSessionRegistry.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexSessionRuntime.test.ts`: passed.
- `apps/server/src/mcp/DispatchBroker.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexAdapter.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexMcpApprovalRuntime.integration.test.ts`: passed.
- `pnpm exec tsgo --noEmit -p apps/server/tsconfig.json`: exited 0. It reported only existing
  Effect suggestions in untouched files.
- Targeted lint, focused formatting, and `git diff --check`: passed.

No browser, installed-app, or post-fix live provider flight was run. The double-connect proof is at
the T3-to-Codex protocol boundary: the pre-fix request was captured, and the post-fix request count
is zero. No push or pull request was made.
