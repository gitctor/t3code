# Crew Codex tool approval fix

Date: 2026-08-15
Branch: `build/crew-suite`
Functional commit: `cfc0bb96c` (`fix(server): allow crew orchestration MCP tools`)

## Result

Codex crew sessions now auto-allow exactly three tools from the `t3-code` MCP server:

- `dispatch`
- `await_dispatch`
- `list_dispatches`

Each tool receives its own process-start config override:

```text
mcp_servers.t3-code.tools.dispatch.approval_mode="approve"
mcp_servers.t3-code.tools.await_dispatch.approval_mode="approve"
mcp_servers.t3-code.tools.list_dispatches.approval_mode="approve"
```

The adapter adds these overrides only when `ProviderSessionStartInput.crewId` is present.
It does not add a server-wide default. It does not change any other tool or server.

Non-crew sessions still send the same config override list as before this fix:

```text
-c mcp_servers.t3-code.url=<session endpoint>
-c mcp_servers.t3-code.bearer_token_env_var="T3_MCP_BEARER_TOKEN"
```

## Exact Codex 0.147.x config contract

The per-MCP-tool path is:

```text
mcp_servers.<server>.tools.<tool>.approval_mode
```

`approval_mode` is the only supported field in `McpServerToolConfig` for Codex 0.147.0.
Its allowed values are:

- `auto`: use tool annotations to decide whether approval is required.
- `prompt`: always require approval.
- `writes`: require approval unless the tool declares `readOnlyHint = true`.
- `approve`: do not require approval.

The never-prompt value is **`approve`**. It is not `auto` and there is no `allow` value.

The operator config is consistent with this result. It contains:

```toml
[mcp_servers.context-mode.tools.ctx_execute]
approval_mode = "approve"
```

The earlier description of `approve` as a prompting mode was not correct for Codex 0.147.0.
The tagged runtime source returns `false` from `requires_mcp_tool_approval_for_mode` for
`AppToolApproval::Approve`.

## Confirmation sources

The sources were checked in the requested order.

1. The vendored generated schema lists `auto`, `prompt`, `writes`, and `approve` in
   `packages/effect-codex-app-server/src/_generated/schema.gen.ts:3504-3510`. It defines the
   per-tool `approval_mode` field at `schema.gen.ts:36947-36956`.
2. The installed CLI reports `codex-cli 0.147.0`. Its parser accepted all four values for
   `mcp_servers.t3-proof.tools.dispatch.approval_mode`. It rejected `allow` with:
   `unknown variant 'allow', expected one of 'auto', 'prompt', 'writes', 'approve'`.
3. Read-only binary inspection found `McpServerToolConfig`, `approval_mode`, and the four enum
   values in the installed 0.147.0 binary.
4. The operator config at `~/.codex/config.toml:42-43` proves the exact nested path and
   `approval_mode = "approve"` work on this machine.
5. The matching OpenAI source tag defines the enum and MCP tool field in
   [`mcp_types.rs`](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/config/src/mcp_types.rs#L23-L31)
   and
   [`mcp_types.rs`](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/config/src/mcp_types.rs#L58-L65).
   It defines the runtime behavior in
   [`mcp_tool_call.rs`](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/core/src/mcp_tool_call.rs#L2179-L2190).

## Trust-key check

Codex 0.147.0 has no `mcp_servers.<server>.trust_level` key and no
`mcp_servers.<server>.tools.<tool>.trust_level` key.

The installed CLI rejected both paths under `--strict-config` as unknown configuration fields.
The tagged `McpServerToolConfig` also denies unknown fields and contains only `approval_mode`.

`projects.<path>.trust_level = "trusted"` is a separate project-trust setting. It does not control
MCP tool approval. Codex also supports the broader server key `default_tools_approval_mode`, but
this fix does not use it because it would loosen every tool on the server.

## Layer 4 decision

Layer 4's crew-only `approvalPolicy: "on-request"` elevation was reverted.

Supervised crew turns now keep:

```text
approvalPolicy: "untrusted"
sandboxPolicy: { type: "readOnly" }
```

The elevation is redundant because `approval_mode = "approve"` makes Codex skip the MCP approval
request for the three named tools. The per-tool config is now the execution mechanism. Other MCP
tools keep their normal approval behavior.

The existing narrow provider-side approval handler remains unchanged. Codex should not call it for
these three configured tools because no approval request is created.

## Regression coverage

- The Codex adapter test proves a crew session sends the original URL and token settings plus the
  three exact per-tool `approve` overrides.
- The same test proves a non-crew session sends the original override list with no added bytes.
- The assertions name all entries, so an extra tool, server, or server-wide default fails the test.
- The child-process protocol test proves a supervised crew turn sends `untrusted` with `readOnly`.
- Existing catalog, lifecycle, and narrow provider-side approval coverage remains green.

## Verification

- Required and touched suites: 6 files, 224 tests passed.
- `apps/server/src/server.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexSessionRuntime.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexAdapter.test.ts`: passed.
- `apps/server/src/provider/Layers/CodexMcpApprovalRuntime.integration.test.ts`: passed.
- `apps/server/src/mcp/DispatchBroker.test.ts`: passed.
- `packages/contracts/src/orchestrationCrew.test.ts`: passed.
- `pnpm exec tsgo --noEmit -p apps/server/tsconfig.json`: exited 0. It reported only existing
  Effect suggestions in untouched files.
- `pnpm exec tsgo --noEmit -p packages/contracts/tsconfig.json`: exited 0.
- Targeted format, targeted lint, and `git diff --check`: passed.

No post-fix live provider flight was run. The new proof is at the T3-to-Codex process config and
app-server protocol boundaries. Nothing was pushed, and no pull request was opened.
