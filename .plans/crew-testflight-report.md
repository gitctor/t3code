# Crew Test Flight report

## Delivered

- Added live-catalog cheapest-model resolution with the requested driver preferences: Claude Agent `haiku`; Codex `mini`, then `spark`; Kimi `highspeed`; otherwise the instance default.
- Added an operator-only `orchestration.startCrewTestFlight` RPC. It creates `Test flight — {crew name}` in the current project with no worktree, starts the saved planner instance on its cheapest model, and freezes per-seat cheapest-model overrides on that turn without mutating the crew.
- Added the server-owned read-only prompt. It dispatches every available seat in parallel, requests the exact `TEST COMPLETE — {role}` reply, uses 30-second awaits, forbids file edits and non-dispatch tools, includes unavailable seats as declined, and finishes with the requested result table.
- Test-flight children use ordinary crew child threads and ordinary `task.*` projections, but skip worktree creation and saved effort/options. Existing Agents rows, provider/model metadata, Needs you state, and live transcript drawers therefore remain the observation surface.
- Added visible Test flight actions beside Edit in the crew picker and in the saved-crew editor footer. Both use the `isRunnableCrew` gate; the editor action is available when the editor has a current project.
- Added `docs/user/crews.md` and linked it from the user docs index.

## Verification

Focused tests passed:

- Server: 6 files, 141 tests, including `server.test.ts`, `DispatchBroker.test.ts`, cheapest seat override plus reactor settlement, normal task-row projection equivalence, turn-input persistence, and migration 45.
- Contracts: `orchestrationCrew.test.ts`, 28 tests.
- Shared: `model.test.ts`, 11 tests.
- Web: `crewSelection.test.ts`, 4 tests.

`tsgo --noEmit` exited 0 in every touched package and required surface:

- `packages/shared`
- `packages/contracts`
- `packages/client-runtime`
- `apps/server`
- `apps/web`
- `apps/desktop`

The compiler emitted only existing advisory suggestions in client-runtime, server, and desktop; there were no type errors. `git diff --check` passed before this report was written. No browser or installed-app pass was requested or performed.

## Local commits

- `3acbc99d9` `feat(shared): resolve cheapest crew models`
- `8977093ea` `feat(orchestration): define crew test flights`
- `7138401d1` `feat(server): run crew test flights`
- `c1daaa3f9` `feat(web): launch crew test flights`
- `c6f989a80` `docs(user): explain crew test flights`

Each commit ends with `Model: GPT-5.6-Sol via Codex CLI (detached)`. Nothing was pushed and no PR was opened. The pre-existing staged `.plans/design-debt-sweep-report.md` was preserved and excluded from every commit.
