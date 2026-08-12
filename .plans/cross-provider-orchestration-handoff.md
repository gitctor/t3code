# Handoff: cross-provider orchestration

**To:** Codex (GPT-5.6-Sol) · **From:** Claude Opus 5, which did the recon, the
architecture, and the contracts.
**Branch:** `feat/cross-provider-orchestration` on `gitctor/t3code`, forked from
`pingdotgg/t3code`. Base commit `8689f7c78`.
**Repo:** `~/Documents/Code/t3code`

Read `.plans/cross-provider-orchestration.md` first — it is the design. This
file is the build order.

---

## What you are building

One agent plans and hands work to agents on *other* providers. A Fable-planned
turn dispatches to Codex, Claude and Kimi, each child's transcript is visible
and interactive, and results report back to the planner.

Upstream issues this closes: **#3138** (cross-provider dispatch), **#5479**
(delegated children missing from the Agents panel).

## Already done — do not redo

- `packages/contracts/src/orchestrationCrew.ts` — crews, dispatch lifecycle,
  toolkit I/O, `OrchestrationError`. Exported from `index.ts`.
- `packages/contracts/src/orchestrationCrew.test.ts` — 23 tests, passing.
- `tsgo --noEmit` clean in `packages/contracts`.
- Deps installed (`pnpm install` at repo root).

## Decisions already made — do not relitigate

1. **A dispatched subagent is an ordinary thread on the target instance**,
   linked to the parent turn by `parentThreadId` + `parentTurnId`. No second
   runtime. Children inherit worktrees, checkpointing, transcripts, resume and
   mobile because they are just threads.
2. **No new event vocabulary.** Child lifecycle projects into the existing
   `task.started` / `task.progress` / `task.updated` / `task.completed`
   (`packages/contracts/src/providerRuntime.ts:177`), attributed to the
   **parent** turn. This is the entire reason the Agents panel renders
   cross-provider children without a schema change.
3. **Dispatch is a new MCP toolkit, not new process machinery.** T3 already
   serves its own `t3-code` MCP server into agent sessions.
4. **`dispatch` returns on acceptance, not completion.** A planner fanning out
   three agents must not block on the first.
5. **No automatic model routing.** The planner chooses the seat. T3 never
   guesses.
6. **UX: crews in the model-picker rail.** `Orchestrate` becomes a rail entry
   beside the provider instances; where a provider entry lists models, this one
   lists saved crews. Selecting a crew sets planner + effort + roster in one
   click. This was chosen over a planner-model list and over a composer toggle.

## Integration points — verified, exact

| Thing | Location |
|---|---|
| T3's own MCP server injected into Claude sessions | `apps/server/src/provider/Layers/ClaudeAdapter.ts:4128` (`mcpServers: { "t3-code": { type: "http", url: mcpSession.endpoint, … } }`) |
| Per-thread MCP session registry | `apps/server/src/mcp/McpProviderSession.ts` (28 lines, plain Map) |
| Toolkit pattern to copy | `apps/server/src/mcp/toolkits/preview/{tools,handlers}.ts` |
| Capability gate | `apps/server/src/mcp/McpInvocationContext.ts:10` — `export type McpCapability = "preview";` |
| Toolkit registration | `apps/server/src/mcp/McpHttpServer.ts:206-226` (`McpServer.toolkit(X).pipe(Layer.provide(XHandlersLive))`, merged into the exported `layer`) |
| Agents panel | `apps/web/src/components/AgentsPanel.tsx` (581 lines) |
| Panel view model | `packages/client-runtime/state/subagentRuntime` |
| Model picker | `apps/web/src/components/chat/{ProviderModelPicker,ModelPickerSidebar,ModelPickerContent}.tsx` |
| Rail entry shape | `ProviderInstanceEntry` in `apps/web/src/providerInstances.ts:46` |
| Claude subagent attribution (reference for the projection) | `apps/server/src/provider/Layers/ClaudeAdapter.ts:2592` |
| Codex collab children (second reference) | `apps/server/src/provider/Layers/CodexSessionRuntime.ts:977` |

---

## Build order

### 1. Capability + toolkit skeleton

Add `"orchestration"` to `McpCapability`. Create
`apps/server/src/mcp/toolkits/orchestration/{tools,handlers}.ts` mirroring the
preview toolkit. Three tools, parameters and success/failure schemas already
exist in `@t3tools/contracts`:

| Tool | Input | Success | Notes |
|---|---|---|---|
| `dispatch` | `DispatchInput` | `DispatchAccepted` | Non-blocking. Annotate `Tool.Readonly false`, `Tool.Idempotent false`. |
| `await_dispatch` | `AwaitDispatchInput` | `DispatchOutcome` | Honour `timeoutSeconds`; on timeout return `status: "running"`, do not error. |
| `list_dispatches` | none | `DispatchListing` | Readonly + idempotent. |

Every handler opens with `requireMcpCapability("orchestration")`. Failure
channel is `OrchestrationError` — use the existing codes, do not add new ones
without updating the contract.

**Done when:** the toolkit registers, and a session without the capability gets
`not-orchestrating` rather than a crash.

### 2. Capability wiring

Trace where `McpInvocationContext.capabilities` is populated and grant
`orchestration` only when the thread's turn is running under a crew. A normal
Claude thread must not see these tools at all — an always-on `dispatch` tool
would change behaviour for all 100,000 users.

**Done when:** a crewless thread's tool list is byte-identical to today's.

### 3. Dispatch reactor

The real work. Per `AGENTS.md`, side effects belong in queue-backed reactors
that emit receipts. Follow the existing reactors in
`apps/server/src/orchestration/Layers/`.

- `dispatch` → create child thread on target instance → start its turn →
  return `DispatchAccepted` immediately.
- Reject with `instance-not-in-crew` when the target is not on the crew's
  roster. The crew is an allowlist, not a hint.
- Reject with `instance-unavailable` → dispatch settles `declined` with no
  `childThreadId`. The contract already models this; do not invent a synthetic
  thread id.
- Enforce a concurrency cap; over it, return `dispatch-limit-reached`.
- Cancelling the parent turn cancels every non-settled child.

**Done when:** focused tests cover accept, decline, roster rejection, limit, and
parent-cancel cascade.

### 4. `task.*` projection

Project child lifecycle onto the parent turn using the existing event types.
`ClaudeAdapter.ts:2592` and `CodexSessionRuntime.ts:977` are your two reference
implementations — match their attribution shape.

**Done when:** the Agents panel shows a cross-provider child with **zero**
changes to `AgentsPanel.tsx`. If the panel needs edits to display a row, the
projection is wrong. Provider icons in step 6 are additive polish, not a fix.

### 5. Crew persistence

Crews live in server settings beside provider instances. Decode failures for
one crew must not discard the others — the contract already uses
`ForwardCompatibleArray`; keep that property at the settings layer.

### 6. Web — picker and panel

- Rail gains an `orchestrate` entry. Its content lists crews, each showing
  planner + roster, plus `+ New crew…` and an editor.
- A crew failing `isRunnableCrew` renders visibly degraded with its
  `unavailableReason` — never hidden. A crew that vanishes because Kimi is
  logged out is worse than one that says so.
- Agents panel rows gain a provider icon (rows currently carry a model label
  only), so a Codex child is distinguishable from a Kimi one at a glance.
- Row click opens the child's transcript in a drawer with a reply box, so the
  user can interject into one child mid-flight without leaving the planner
  thread.

**Panel constraints are load-bearing** — read the file header comment before
touching it. Fixed three-line row height, static status dots, DOM-write elapsed
timers, stable spawn order. `AGENTS.md`: no continuously repainting animations,
they peg the GPU on high-refresh displays.

### 7. Surfaces

Per `AGENTS.md` "Hit every surface": web, desktop, mobile; every adapter gets an
explicit dispatch decision including "not supported here"; reverse states exist
(a dispatch you can start, you can stop); docs land in `docs/user/` for
behaviour and `docs/internals/` for architecture; new vocabulary goes in
`docs/internals/glossary.md`.

---

## House rules that bind you

From the repo's own `AGENTS.md` — these override any default habit:

- **Never open a PR unless Victor explicitly asks.** This stays on the fork.
- **Do not run repo-wide checks.** No `vp check`, no `vp run -r test`. CI owns
  the full suite. Run `vp test run <files>` for what you touched.
- **Never `pkill -f` or kill a PID you found by pattern.** Victor may be running
  T3 Code itself while you work; its argv contains this worktree path.
- **Never start a server against `~/.t3/userdata`.** That is the live install.
  Copy from it with `VACUUM INTO` per the Test data section; data flows in only.
- **Never set `VITE_HTTP_URL` / `VITE_WS_URL`.** Bakes localhost into the bundle.
- **Effect-heavy server.** Read `.repos/effect-smol/LLMS.md` before writing
  Effect code. `.repos/` is read-only, never import from it.
- **No sleeps or polling in tests.** Wait on receipts and worker drains.
- Theo's note: "Do not introduce machinery because it looks architecturally
  impressive. Understand the real constraint, then fight for the smallest model
  that makes the correct behavior unsurprising."

## Verification

```bash
cd ~/Documents/Code/t3code
./node_modules/.bin/vp test run packages/contracts/src/orchestrationCrew.test.ts   # must stay green
./node_modules/.bin/vp test run <the files you add>
cd packages/contracts && ../../node_modules/.bin/tsgo --noEmit
```

Ask before browsers or computer use. One integrated web pass at the end, only
once the panel renders a real cross-provider child.

## Known snag

Issue **#4149**: the Claude driver's explicit model slug bypasses the
`ANTHROPIC_DEFAULT_*` mapping, and worktree mode is not honoured — sessions run
in the live checkout. A Fable-pinned planner hits this directly. Read it before
step 2; it may need fixing first, and if so, that is a separate commit.

## Audit deltas (2026-08-11, after contract v2)

A design audit closed these gaps. They override anything above that conflicts.

1. **Crew selection now has a wire contract.** `ThreadTurnStartCommand` and
   `ClientThreadTurnStartCommand` both carry `crewId: optional(CrewId)`.
   Step 2's capability wiring keys off this field: `crewId` present → resolve
   crew → grant `orchestration` capability → inject briefing. The thread read
   model should persist the last crew so follow-up turns default to it.
2. **"Zero schema change" for the panel was overclaimed — now corrected in
   the contract.** `taskAgentLinkageFields` gained optional `instanceId` and
   `childThreadId`. Step 4's done-criteria still holds for rendering a row
   (all fields optional; legacy rows decode unchanged), and the dispatch
   projection MUST stamp both fields — they power the provider icon and the
   transcript drawer.
3. **Child worktree policy is decided.** Every dispatched child gets its own
   worktree branched from the parent thread's current branch. No flag, no
   sharing the parent checkout. Chained work uses the new
   `DispatchInput.fromDispatchId`: the child branches from that dispatch's
   child-thread branch instead (build → review). Referenced dispatch must be
   settled `completed`, else `dispatch-not-found`.
4. **`await_dispatch` must not long-poll the transport.** MCP clients kill
   long-blocked HTTP tool calls. Handler waits on receipts with no pinned
   resources; the crew briefing instructs planners to loop with
   `timeoutSeconds` ≤ 300. Timeout returns `status: "running"` — never an
   error.
5. **Kimi does not exist in this fork yet.** The Kimi seat needs upstream
   PR #5243 (Kimi Code CLI over ACP) or #6071 (generic ACP registry).
   Isolated phase: `git fetch upstream pull/5243/head` and cherry-pick onto a
   separate branch first; do not entangle it with the dispatch work. Crews
   ship day one with Codex + Claude seats regardless.
6. **Crew briefing is server-owned text**, one versioned file, identical
   content for every planner provider; adapters only deliver it. Content
   spec: `.plans/cross-provider-orchestration-ux.md` §6.
7. **Child threads are hidden from the sidebar.** The thread read model must
   expose `parentThreadId` so clients can filter. UX spec §3 has the rules,
   including delete-cascade prompt behavior.
8. **Concurrency cap default is 4** concurrent non-settled dispatches per
   parent turn. Over cap → `dispatch-limit-reached`.
9. **Parent turn ending with live children is a planner error**: cancel
   children, append the system line from UX spec §7.
10. **The full UX is specified** in `.plans/cross-provider-orchestration-ux.md`.
    Backend work must satisfy it but not build it — the UI phases (6–7 above)
    are being done separately by Claude. Your scope ends at the read model,
    events, and MCP toolkit.

## Commit style

Conventional titles, plain language: `feat(server): dispatch work across
providers`. Body is the problem in a sentence, then the fix. End with the model
and harness that did the work. One concern per commit — if the message says
"also", split it.
