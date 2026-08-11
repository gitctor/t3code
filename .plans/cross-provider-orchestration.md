# Cross-provider orchestration

One agent plans and dispatches work to agents on *other* providers. Closes the
gap named in #3138 (cross-provider dispatch), #5479 (delegated children missing
from the Agents panel) and, for the planner's own reading, #3797.

## The constraint

T3 already has every part of this except the wiring:

- **Threads** on any provider instance, with worktrees and checkpointing.
- **A `task.*` event vocabulary** (`packages/contracts/src/providerRuntime.ts`)
  that `ClaudeAdapter` and `CodexSessionRuntime` both synthesise from their
  provider-native subagent traffic.
- **An Agents panel** (`apps/web/src/components/AgentsPanel.tsx`, PR #5219) that
  renders that vocabulary as a stable fleet roster.
- **MCP injection** into every provider session.

What is missing is a way for the *planner* to start a thread on a *different*
provider, and for that child to report through the vocabulary the panel already
speaks.

## The model

**A dispatched subagent is a child thread on another provider.** No new runtime,
no new event types, no second roster. The child is a real thread, so it gets
worktrees, checkpoints, transcripts, resume, and mobile for free.

Three pieces:

### 1. Linkage (`packages/contracts`)

Add `parentThreadId`, `parentTurnId` and `dispatchId` to the thread record.
A thread with a `parentThreadId` is a dispatched child. Nothing else changes —
the `task.*` events stay exactly as they are, so the panel needs no new schema.

### 2. Orchestrator MCP server (`apps/server`)

A T3-owned MCP server injected into a session only when orchestration mode is
on. Complexity lives at this boundary; orchestration stays pure.

| Tool | Behaviour |
|---|---|
| `dispatch` | `{ provider, model, prompt, effort?, worktree? }` → creates a child thread on the target instance, starts its turn, returns `dispatchId` immediately. Non-blocking. |
| `await_dispatch` | `{ dispatchId }` → resolves when the child settles; returns its final message. |
| `list_dispatches` | Status of every child in this turn. |

Child lifecycle projects into `task.started` / `task.progress` / `task.updated` /
`task.completed` attributed to the **parent** turn. That single projection is
what makes the existing Agents panel render cross-provider children with no UI
change — and is the same seam #5479 asks for.

Dispatch is capability-checked per adapter. A provider that cannot host a
headless turn declines with a typed reason rather than silently doing nothing.

### 3. Selection and observation (`apps/web`)

- **Model picker rail** gains an `orchestrator` entry beside the provider
  instances. Where a provider entry lists models, this one lists **crews**: a
  saved planner (instance + model + effort) plus the instances it may dispatch
  to. Selecting a crew is the whole mode switch — one click sets planner, effort
  and roster. Crews are user-authored and persist like custom instances, with a
  `+ New crew…` row and an editor.
- **Agents panel rows** gain a provider icon (rows currently carry a model label
  only) so a Codex child is distinguishable from a Kimi one at a glance.
- **Row click opens the child transcript** in a drawer, with a reply box so the
  user can interject into one child mid-flight without leaving the planner
  thread.

## Non-goals

- No automatic model routing. The planner chooses; T3 does not guess.
- No new animation or continuous repaint. Rows keep fixed height and static
  dots per the panel's existing rules.
- No provider-native subagent changes. Claude Task spawns and Codex collab
  children keep working exactly as they do.

## Surfaces

Per `AGENTS.md`: contracts change → server, web, desktop, mobile follow. Mobile
gets the read-only panel with provider icons; the reply drawer is web/desktop
first. Every adapter gets an explicit dispatch decision, including "not
supported here".

## Verification

- Focused tests on the dispatch reactor and the `task.*` projection.
- One integrated web pass once the panel renders a real cross-provider child.
- No repo-wide checks; CI owns the full suite.
