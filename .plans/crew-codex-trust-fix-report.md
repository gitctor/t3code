# Crew Codex trust fix

Date: 2026-08-15
Branch: `build/crew-suite`
Functional commit: `483483306` (`fix(server): route crew MCP calls through approval`)

## Result

Codex crew turns now make orchestration MCP calls executable in every runtime mode.
The fix changes only supervised crew turns.

For a crew turn in `approval-required` mode, T3 sends `approvalPolicy: "on-request"` in
`turn/start`. It still sends `sandboxPolicy: { type: "readOnly" }`.
This makes Codex send the MCP approval request to T3.
Layer 3 then approves only `dispatch`, `await_dispatch`, and `list_dispatches` from `t3-code`.

A non-crew turn still sends `approvalPolicy: "untrusted"` and the same read-only sandbox.
Its complete `turn/start` parameter object is unchanged.

The other runtime modes keep their existing values:

- `auto-accept-edits` already uses `on-request` with `workspaceWrite`.
- `auto` already uses `on-request` with `workspaceWrite` and the automatic reviewer.
- `full-access` keeps `never` with `dangerFullAccess`.

## Mechanism used

The fix uses option C: a crew-only `turn/start` approval-policy elevation.

`ProviderSendTurnInput.crewId` now reaches `CodexSessionRuntime` through `CodexAdapter`.
`buildTurnStartParams` changes `untrusted` to `on-request` only when that turn has a `crewId`.
It reads the sandbox from the unchanged runtime-mode mapping.

This is turn-scoped and reversible.
The next non-crew turn sends `untrusted` again.
The existing Layer 3 capability and tool allowlist remains the approval boundary.

## Why option A was rejected

The installed Codex CLI is version `0.147.0`.
It accepts exact per-tool settings such as:

`mcp_servers.t3-code.tools.dispatch.approval_mode="approve"`

It accepts `auto`, `prompt`, `writes`, and `approve`.
This could trust only the three orchestration tools.

However, that setting is process or thread configuration.
The vendored protocol schema allows a `config` map on `thread/start` and `thread/resume`.
It does not allow a `config` map on `turn/start`.
The schema also states that a turn approval-policy override applies to that turn and later turns.

A T3 provider session can be reused while crew capability changes between turns.
A process or thread MCP trust setting cannot follow that change.
It would either miss a later crew turn or remain trusted for a later non-crew turn.
It therefore does not meet both required invariants.

There is no Codex app-server source mirror under `.repos/` in this checkout.
The review used the vendored generated schema and the installed Codex CLI config parser.

## Why option B was rejected

The vendored schema contains `approved_for_session` and `acceptForSession` decisions.
They are responses to command or patch approval requests.
They are not a request that registers an MCP tool decision before a call.

The MCP path used here is `item/tool/requestUserInput`.
Its response carries question answers.
Under `untrusted`, Codex rejects the MCP call before this request exists.
There is no schema method that can pre-seed this MCP decision.

## Claude check

Claude does not have the Codex failure shape.
The Claude SDK calls T3's `canUseTool` callback before the tool runs.
The adapter checks the live orchestration capability and exact tool allowlist first.

The supervised Claude regression test proves:

- crew `mcp__t3-code__dispatch` returns `allow` immediately;
- `mcp__t3-code__preview_open` still creates an approval request;
- removing orchestration capability from the reused session restores the approval request for
  `dispatch`.

No Claude code change was required.

## Regression coverage

- The Codex adapter test proves `crewId` reaches the session runtime.
- The turn-parameter test proves a supervised crew turn sends `on-request` with `readOnly`.
- The negative test proves a supervised non-crew turn remains exactly `untrusted` with `readOnly`.
- The child-process protocol test records the actual `turn/start` request.
  It sees `on-request` and `readOnly`, then sees Layer 3 answer `Allow` for `dispatch`.
- The same protocol test still sends the unrelated preview MCP request to the client and records
  `Cancel`.
- The accepted dispatch still emits both `item/started` and `item/completed`.

## Verification

- Final focused and requested suite: 7 files, 291 tests passed.
- `apps/server/src/server.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexSessionRuntime.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexAdapter.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexMcpApprovalRuntime.integration.test.ts`: passed.
- `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`: passed.
- `apps/server/src/mcp/DispatchBroker.test.ts`: passed.
- `packages/contracts/src/orchestrationCrew.test.ts`: passed.
- `pnpm exec tsgo --noEmit -p apps/server/tsconfig.json`: exited 0.
  It reported only existing Effect suggestions in untouched files.
- `pnpm exec tsgo --noEmit -p packages/contracts/tsconfig.json`: exited 0.
- Targeted format, targeted lint, and `git diff --check`: passed.

No browser, installed-app, or post-fix live crew flight was run.
The new child-process test proves the failed protocol boundary with isolated test data.
Nothing was pushed, and no pull request was opened.
