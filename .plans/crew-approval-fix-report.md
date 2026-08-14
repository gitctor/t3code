# Crew orchestration approval fix

Date: 2026-08-14
Branch: `build/crew-suite`
Functional commit: `4c994c204` (`fix(server): auto-approve crew orchestration tools`)

## Result

A crew turn now treats its orchestration capability as operator consent for exactly three
`t3-code` MCP tools: `dispatch`, `await_dispatch`, and `list_dispatches`. Claude and Codex approve
those calls inside their server-side adapter/runtime paths before an approval request can reach the
client, including in supervised (`approval-required`) mode.

The exemption is evaluated against the active thread's current MCP capabilities on every call.
Removing the crew capability from a reused provider session immediately restores normal approval
behavior. Other MCP servers, other `t3-code` tools, ordinary provider tools, and non-crew turns keep
their existing behavior.

## Fix

- Added one shared policy defining the three orchestration tool names and requiring both the
  `t3-code` server identity and the `orchestration` capability.
- Carried the issued MCP capability set into `McpProviderSession` and refresh it before provider
  turn routing, alongside the credential registry update. This prevents a reused session from
  retaining a stale crew approval exemption.
- Claude's `canUseTool` path parses MCP tool identities and returns `allow` before the generic
  approval lifecycle only when the shared policy matches.
- Codex tracks `mcpToolCall` item-start notifications long enough to correlate its generated
  `item/tool/requestUserInput` approval question. A matching crew orchestration call receives the
  generated `Allow` answer directly; no pending approval or client request event is created.
- Capability filtering and approval now consume the same orchestration tool-name definition, so
  visibility and approval policy cannot drift independently.

## Audit trail

Auto-approval bypasses only the approval request. It does not suppress provider tool lifecycle
notifications or orchestration task events. The Codex runtime integration test observes both
`item/started` and `item/completed` for the accepted `dispatch` call while observing no approval
request for that item. `DispatchBroker` continues to project the accepted test-flight dispatch
through its normal running and completed records with no rejection reason.

## Regression coverage

- Claude supervised crew session: `mcp__t3-code__dispatch` returns `allow` immediately.
- Claude supervised crew session: a preview MCP tool still raises `request.opened`.
- Claude reused session after crew capability removal: `dispatch` raises `request.opened` again.
- Codex supervised crew session: test-flight `dispatch` receives `Allow` without emitting a
  user-input request; the following preview MCP call still emits one and is answered `Cancel`.
- Codex adapter wiring: all three exact orchestration names match, another `t3-code` tool and
  another MCP server do not, and removing the live capability disables the exemption.
- Test-flight broker path: dispatch is accepted, completes, and has no decline/failure reason.

## Verification

- Final requested and focused suite: 6 files, 245 tests passed.
- `apps/server/src/server.test.ts`: passed.
- `apps/server/src/mcp/DispatchBroker.test.ts`: passed.
- `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexAdapter.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexMcpApprovalRuntime.integration.test.ts`: passed against a
  real child-process protocol peer.
- `apps/server/src/mcp/McpSessionRegistry.test.ts`: passed.
- `tsgo --noEmit -p apps/server/tsconfig.json`: exited 0; output contained only pre-existing Effect
  suggestion diagnostics in untouched files.
- Targeted lint, formatting, and `git diff --check`: passed.

No browser, installed-app, or post-fix live crew test flight was performed. Verification used
isolated tests and a local mock Codex app-server process. Nothing was pushed, and no pull request
was opened.
