# Design-debt sweep report

Branch: `build/crew-suite`

## 1. Thread context-menu grouping

What changed: Split primary, edit, copy, and destructive actions with separators. Moved Copy path, Copy branch, and Copy thread ID into one Copy submenu. Kept every prior leaf action and capability gate.

Files:

- `packages/contracts/src/ipc.ts`
- `apps/desktop/src/electron/ElectronMenu.ts`
- `apps/web/src/contextMenuFallback.ts`
- `apps/web/src/contextMenuFallback.test.ts`
- `apps/web/src/components/threadActionMenu.logic.ts`
- `apps/web/src/components/threadActionMenu.logic.test.ts`

Visual QA screenshot: Open a branched thread menu in the desktop app and web fallback. Capture the three group separators, open Copy submenu, and show Delete isolated at the bottom.

## 2. One Tabs style

What changed: Replaced the bespoke Usage range selector and both thread-view PR tab variants with the shared `ToggleGroup` and `Toggle` components. All three now share the same active height and state treatment.

Files:

- `apps/web/src/components/usage/UsagePage.tsx`
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx`

Visual QA screenshot: Capture the Usage time-range tabs beside the date range. Capture Summary, Timeline, and Code in the thread view with expanded and condensed chrome and an active tab.

## 3. Disabled means disabled

What changed: Derived the PR detail-pane toggle from an actual selected PR. An unavailable toggle is no longer pressed, has native and ARIA disabled state, and uses a visible disabled treatment. The hidden terminal sibling uses the same truthful semantics through the shared control.

Files:

- `apps/web/src/routes/_chat.pull-requests.tsx`
- `apps/web/src/components/chat/PanelLayoutControls.tsx`
- `apps/web/src/components/pullRequest/pullRequestList.logic.ts`
- `apps/web/src/components/pullRequest/pullRequestList.logic.test.ts`

Visual QA screenshot: Capture the PR page before selecting a row with the detail-pane toggle disabled. Then select a PR and capture the enabled closed and open states.

## 4. Base-branch prominence

What changed: PR rows and banners now show `base ← head`. The base uses foreground semibold text. The head and arrow stay muted. The same direction and weight apply to list rows, compact detail chrome, expanded detail chrome, and the PR-thread dialog.

Files:

- `apps/web/src/components/pullRequest/PullRequestRow.tsx`
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx`
- `apps/web/src/components/PullRequestThreadDialog.tsx`

Visual QA screenshot: Capture adjacent normal-to-main and stacked PR rows. Capture the same pair in compact detail chrome, expanded detail chrome, and the resolved PR-thread dialog.

## 5. Subagents banner polish

What changed: Restyled the subagent summary with the changed-files banner shell, spacing, type scale, and trailing outline action. Kept token cost and changed the label from sigma notation to values such as `176.6M tokens`. The Agents panel code was not changed, so its fixed row heights and static dots remain intact.

Files:

- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/chat/MessagesTimeline.test.tsx`

Visual QA screenshot: Capture a completed subagents banner beside a changed-files banner. Capture a running banner with its Open agents action. Also capture the Agents panel above and below the fold to confirm fixed rows and static dots.

## 6. One refresh convention

What changed: Added one page-level refresh icon button. PR, Usage, and Mobile Clients use it at the far right of their header rows. Removed the inline Usage refresh beside the range tabs. Section-level refresh controls remain local to their sections.

Files:

- `apps/web/src/components/PageRefreshButton.tsx`
- `apps/web/src/routes/_chat.pull-requests.tsx`
- `apps/web/src/components/usage/UsagePage.tsx`
- `apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx`

Visual QA screenshot: Capture the far-right refresh control in PR, Usage web, Usage desktop, and Mobile Clients headers. Include the disabled spinning state on one page.

## Verification

- Focused tests: 8 files passed, 206 tests passed.
- Required regressions passed: `apps/web/src/crewSelection.test.ts` and `apps/server/src/server.test.ts`.
- Targeted lint passed for every touched TypeScript and TSX file.
- `tsgo --noEmit` passed in `apps/web`.
- `tsgo --noEmit` passed in `packages/contracts`.
- `tsgo --noEmit` passed in `apps/desktop` with two non-blocking Effect suggestions in unchanged files.
- A separate session added `a36c2eafe` after the six sweep commits. It is outside this sweep and was preserved.
- No browser, dev server, push, or PR was used.
