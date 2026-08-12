# Crew suite UI report

Date: 2026-08-12
Branch: `build/crew-suite`

## What landed

### 1. Model picker and composer

- Added the `Orchestrate` rail entry after provider instances and before Favorites. It is hidden when no provider is ready and uses the selected crew planner's accent.
- Added the empty, ready, and degraded crew picker states with the specified copy, planner line, roster roles, seat tooltip, favorite toggle, last-used ordering, create action, and Settings deep link.
- Added crew entries to Favorites, the picker jump-key flow, and the command palette. The palette includes `Switch to crew: {name}` and `Create crew…`.
- The composer trigger shows `◆ {crew name}` with the planner provider icon. The planner effort remains editable for the current turn.

### 2. Crew editor

- Added create and edit dialogs with name, planner, model, effort, and repeatable member/model/role fields.
- Added the Settings → Providers → Crews section with confirmed deletion.
- Added the specified inline validation copy. All CRUD uses `orchestration.dispatchCommand` with fresh command IDs and observes the settings stream. The editor never writes `ServerSettingsPatch.crews`.

### 3. Thread behavior

- Crew turns send `crewId` on every `ClientThreadTurnStartCommand` path.
- Sidebar rows show the crew diamond and hide every shell whose `parentThreadId` is non-null.
- Project search retains child threads and labels them `via {crewName}`, with neutral `via crew` fallback after deletion.
- Parent deletion uses the specified child-count prompt. The delete-all path dispatches an individual `thread.delete` command for every child before deleting the parent.

### 4. Agents panel

- Linked rows resolve the provider icon from `instanceId`, with a generic Bot fallback.
- Role chips render after the model label.
- Only rows with `childThreadId` get the transcript chevron and click action.
- Preserved fixed-height rows, static status dots, stable ordering, and the existing DOM timer. Waiting children now read `Needs you`.

### 5. Transcript drawer

- Added a presentation-only, right-side drawer for web and desktop at approximately 480 px.
- The header includes provider icon, title, status dot, stop action, and `Open as thread ↗`.
- The body embeds the normal `ChatView`, so transcript virtualization, live updates, approvals, and standard composer queue/new-turn behavior are shared rather than reimplemented.
- Mobile row activation navigates to the child thread instead of opening a drawer.

### 6. Planner briefing

- No duplicate client briefing was added. The UI sends the selected `crewId` and leaves the briefing contract at the existing server adapter boundary.

### 7. Turn lifecycle

- The panel and drawer consume the existing projected child status and stop commands. Existing parent interruption and planner-error behavior remain server-owned.
- Usage remains attributed through the existing child-thread/provider flow; no Usage page fork was added.

### 8. Reverse states and scope guard

- Users can leave crew mode by selecting a normal model, delete crews with confirmation, stop a child from the drawer, unfavorite crews, and open hidden child threads as full threads.
- No automatic routing, nested-crew UI, cost estimate, sharing/export, or mobile drawer was added.

## Unsatisfied spec points

None known. Browser and dev-server visual QA were intentionally not run in this session, per the task instructions.

## Verification

- `apps/web/src/crewSelection.test.ts`: 3 passed.
- `apps/web/src/components/Sidebar.crew.test.ts`: 3 passed.
- `apps/web/src/components/AgentsPanel.logic.test.ts`: 1 passed.
- `packages/client-runtime/src/state/subagentRuntime.test.ts`: 47 passed.
- `apps/web/src/components/settings/settingsSearch.test.ts`: 7 passed.
- `packages/contracts/src/settings.test.ts`: 33 passed.
- `apps/web/src/modelSelection.test.ts`: 11 passed.
- `apps/web/src/modelOrdering.test.ts`: 2 passed.
- `packages/contracts/src/orchestrationCrew.test.ts`: 27 passed.
- `apps/server/src/server.test.ts`: 124 passed.
- `apps/server/src/orchestration/DispatchTaskProjection.test.ts`: 1 passed.
- Targeted lint: passed with no diagnostics after fixes.
- `tsgo --noEmit`: passed in `apps/web`, `packages/client-runtime`, and `packages/contracts`. Client runtime retains one unrelated compiler suggestion in `src/relay/discovery.ts`.
- React Doctor ran offline against changed-from-main files and exited successfully. It reported the branch's broad existing compiler/ref/large-component baseline (54/100, 280 diagnostics across 23 files). The actionable context-value warning introduced by this work was fixed; no crew picker or crew editor diagnostic remained.
- `git diff --check`: passed.

## Visual QA priorities

1. Check rail order, planner accent, empty state, degraded repair clicks, crew Favorites, and jump keys with several providers and more than one crew.
2. Exercise editor overflow, model/effort changes, member row add/remove, exact validation copy, Settings deep link, and confirmed delete.
3. Start crew turns and verify the composer label, per-turn effort override, sidebar diamond, search `via` label, and both parent-delete choices.
4. Watch the Agents panel during rapid status changes. Confirm row height never shifts, icons and roles resolve correctly, and only linked children show chevrons.
5. Open a running and a settled child in the drawer. Verify live transcript virtualization, approvals, queued replies versus new turns, stop, close persistence, and `Open as thread ↗`.
6. On mobile, verify the same row navigates to the full child thread and never opens a drawer.
