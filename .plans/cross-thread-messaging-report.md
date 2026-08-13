# Cross-thread messaging report

## Result

Cross-thread messaging is implemented on `build/crew-suite`. Agents receive a dedicated `messaging` MCP capability when the operator permits it. The server resolves scope, owns attribution, records the message lifecycle, and either steers a compatible running target or drains a durable per-target FIFO when the target is ready.

No dev server, browser, desktop app, or mobile simulator was opened. No push or pull request was made.

## What landed

### Contracts and settings

- Added the `ThreadMessage` record and forward-compatible arrays.
- Added typed `message.sent`, `message.delivered`, and `message.rejected` commands, events, and aggregate identity.
- Added typed MCP inputs, results, and rejection codes.
- Added `crossThreadMessaging: "off" | "crew" | "project"` to server settings with `off` as the decoding and runtime default.
- Added server-owned transcript attribution for source-thread chips.

### Durable delivery

- Added migration 44 with `projection_cross_thread_messages`, target FIFO and source-turn indexes, and transcript attribution storage.
- Added decider and projection handling for the complete message lifecycle.
- Added a shared per-target delivery lock and FIFO-head check. A pending ordinary turn is never replaced.
- Added a reactor that drains one queued message when a target settles and resumes durable queues at server startup.
- Preserved the target thread's `crewId` when a queued or steered message starts through the normal turn path.
- Enforced a maximum of 20 send attempts per source turn.

### MCP and permission enforcement

- Added readonly `list_threads` and mutating `send_to_thread` tools.
- New sessions receive the `messaging` capability only when the setting is `crew` or `project`.
- MCP tool-list filtering removes both messaging tools when the credential lacks the capability.
- The broker rechecks the current setting and source turn on every call.
- Crew scope resolves dispatch parents, direct children, and siblings under the same parent turn from `projection_dispatches`.
- Project scope resolves active threads from the same projected project.
- Environment identity is checked before scope resolution. Messages cannot address another environment.
- The server wraps agent text in `[Message from thread {title} ({sourceThreadId})]:\n{body}`. Agent text cannot replace this envelope.

### Audit and surfaces

- A delivered message appends a system audit line to the target transcript and a `task.progress` activity anchored to the source turn.
- A rejected message appends its reason to the source turn.
- Web and desktop render the target audit as a compact source-thread chip. Selecting it opens the source thread.
- Settings → Providers exposes all three permission levels with the requested plain-language copy.
- The shared live thread reducer preserves attribution, so web, desktop, remote clients, and mobile receive the same message data without a reload.
- Added user documentation and glossary entries.

## Permission matrix as tested

| Setting or boundary | Agent tools | Allowed targets | Tested result |
| --- | --- | --- | --- |
| `off` | `list_threads` and `send_to_thread` absent | None | New credential omitted `messaging`; authenticated tool listing hid both tools. |
| `crew` | Present | Dispatch parent, direct dispatch children, siblings from the same parent turn | Family members listed; an unrelated same-project thread was rejected with a typed scope error and source audit. |
| `project` | Present | Other non-deleted threads in the same project | A same-project peer accepted immediate delivery. |
| Different environment | Irrelevant | None | Request was rejected with `cross-environment` and a source audit. |
| More than 20 sends from one source turn | Present | None after the limit | Attempt was rejected with `rate-limit-reached` and a source audit. |

## Proof notes

Focused tests passed:

- Contracts: 4 files, 77 tests. This includes `orchestrationCrew.test.ts`, `taskSuggestion.test.ts`, settings defaults, record round-trip, forward-compatible arrays, and the 20,000-character body limit.
- Server: 12 files, 167 tests. This includes `server.test.ts`, `DispatchBroker.test.ts`, decider/projection persistence, capability grants, scope resolution, cross-environment rejection, steer and queue paths, FIFO startup drain, pending-turn protection, trusted-envelope spoof resistance, rate limiting, and audit commands.
- Web: 2 files, 22 tests. This includes the source chip and permission selector.
- Client runtime: 1 file, 28 tests. This includes live-event attribution retention.
- Mobile: 1 file, 14 tests. `ThreadFeed` already routes non-user system messages through its shared feed path; no new screen or mobile-specific message transport was added.

Total: 20 focused test files and 308 tests passed.

Type checks passed with `tsgo --noEmit` in:

- `packages/contracts`
- `packages/client-runtime`
- `apps/server`
- `apps/web`
- `apps/desktop`

Targeted lint passed for every touched TypeScript and TSX file. The type checks reported only existing non-blocking Effect suggestions in unchanged code.

## Commits

- `6cf2553d9` — `feat(contracts): define cross-thread messaging`
- `bf2fa59cb` — `feat(server): deliver cross-thread messages`
- `6d44221ba` — `feat(web): surface cross-thread messaging`
- `37ec5cfee` — `chore(contracts): satisfy messaging lint`

Each commit is local only and carries the required model footer.

## Deferred items

- The mobile permission selector is deferred. The mobile settings surface does not currently expose this class of environment-level provider setting, so adding it was not a trivial reuse. Operators can change the level from web or desktop.
- Visual QA of the chip and selector is deferred because repository rules require explicit approval before browser or computer-use testing. Unit rendering and type checks passed.

There are no deferred server, contract, delivery, audit, web-rendering, or documentation requirements from this phase.
