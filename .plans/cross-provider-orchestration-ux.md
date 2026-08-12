# Cross-provider orchestration — UX spec

Every user-facing decision, made. The backend builder reads this to know what
the server must support; the UI builder implements it verbatim. Pairs with
`.plans/cross-provider-orchestration.md` (design) and
`-handoff.md` (build order).

Voice note: all user-facing copy below is final. Short sentences, no jargon,
no "orchestration" in user copy — the user word is **crew**.

---

## 1. Model picker

### Rail

- New rail entry `Orchestrate`, icon `Network` (lucide), rendered after the
  provider instances and before Favorites. Same 1-icon layout as providers.
- Entry hidden when zero providers are ready (a crew needs seats). Never
  hidden because crews are degraded — see states below.
- Selected-crew accent: the rail entry uses the planner instance's accent
  color, so the mode still reads as "led by Claude/Codex" at a glance.

### Content pane (when `Orchestrate` selected)

Replaces the model list. Three states:

**Empty (no crews saved):**
> **Crews**
> A crew is one model that plans and hands work to your other agents.
> `[ + Create your first crew ]`

**List:** one row per crew, ordered by last used, then name.

```
◆ Deep Build                          ★
  Fable 5 xhigh plans
  → Codex · Claude · Kimi

◆ Design Pass
  Opus 5 high plans
  → Kimi
```

- Line 1: crew name + favorite star (crews participate in Favorites like
  models do).
- Line 2: planner model + effort, in the planner's accent color.
- Line 3: `→` + member display names in roster order. Role suffix when set:
  `Codex (build)`.
- Hover: tooltip with full seat detail (instance, model, role each).
- Trailing `+ New crew…` row, then `Manage crews…` (opens Settings section).

**Degraded crew:** stays in the list, muted, with the reason on line 3:

| `unavailableReason` | Copy |
|---|---|
| `planner-instance-missing` | "Planner not installed" |
| `planner-instance-unavailable` | "Planner is signed out or unavailable" |
| `no-available-members` | "No crew members are available" |

Clicking a degraded crew opens the crew editor scrolled to the broken seat —
never a dead click.

### Composer trigger (crew selected)

- Trigger shows `◆ {crew name}` with the planner's provider icon. Chevron
  opens the picker as usual.
- The effort selector reflects the crew's planner effort and stays editable;
  editing it changes this thread's turn, not the saved crew.
- Keybinding: crews appear in the existing model-switch cycle after models.
  Command palette: `Switch to crew: {name}` entries + `Create crew…`.

## 2. Crew editor

Dialog from `+ New crew…` / clicking a crew; full section under
Settings → Providers → Crews (`Manage crews…` deep-links here).

Fields, top to bottom:

1. **Name** — text, required, max 60 chars. Slug auto-derived, never shown.
2. **Planner** — instance picker (ready instances only) + model picker
   (that instance's models) + effort (that model's option descriptors).
   Required. Default: the session's current instance/model.
3. **Crew members** — repeatable rows: instance picker + optional model
   ("Default model" when unset) + optional role text (placeholder:
   "build, review, design…"). Min 1 row. The planner's instance MAY also be
   a member (Claude planning + Claude building is legitimate).
4. Footer: `Cancel` / `Save crew`. Destructive `Delete crew` only in the
   Settings section, with confirm.

Validation is inline and blocking: no members → "Add at least one crew
member." Planner unset → "Pick who plans."

## 3. Thread behavior

- A thread whose latest turn carried a `crewId` shows a small `◆` beside its
  title in the sidebar (same treatment as existing thread badges).
- **Child threads are hidden from the sidebar thread list.** They are real
  threads, but their surface is the Agents panel and the transcript drawer.
  Filter: any thread with a `parentThreadId` set. They still count in project
  search results (they contain real work), labeled `via {crew name}`.
- Deleting the parent thread prompts: "This thread dispatched work to
  {N} agents. Delete their threads too?" Default: delete all. Keeping
  orphans re-surfaces them in the sidebar (they lost their parent).

## 4. Agents panel

Existing panel, three additive changes. The panel's load-bearing rules hold:
fixed three-line rows, static status dots, DOM-write timers, stable spawn
order, no continuous repaints.

1. **Provider icon** — rows whose task linkage carries `instanceId` render
   that instance's provider icon at the start of line 1 (before the title).
   Rows without it (provider-native subagents) render exactly as today.
2. **Role chip** — when linkage `role` is set, show it after the model label
   on line 3 (`gpt-5.6-sol · build`). Already-existing field, now populated.
3. **Row click** — rows whose linkage carries `childThreadId` open the
   transcript drawer. Rows without it keep today's behavior (expand/none).
   Affordance: chevron at row end, only on rows with a child thread.

## 5. Transcript drawer

New surface, web + desktop. Right-side drawer over the chat, ~480px, same
shell as existing right panels. Mobile v1: tapping a child row navigates to
the child thread's normal thread view instead (read/reply works for free);
no drawer.

- **Header:** provider icon + child title + status dot + `Open as thread ↗`
  (navigates to the child thread's full view).
- **Body:** the child thread's normal transcript, virtualized, live.
- **Approval requests surface here exactly as they do in a normal thread.**
  When a child is blocked on approval, its panel row shows status label
  `Needs you` (maps from the existing `waiting` status) — this is the one
  status-label change to the panel, and it is presentation-only.
- **Footer:** standard composer reply box. Sending while the child runs
  queues as a user message into its current turn (same semantics as typing
  into a running thread). Sending after it settled starts a new turn on the
  child thread — dispatch reports the ORIGINAL outcome to the planner;
  user follow-ups on a child do not mutate the planner's view.
- Drawer state is presentation-only. Closing it changes nothing.

## 6. Planner-side UX (what the model sees — briefing contract)

Injected by the server on every crew turn, after resolving the crew:

- The roster: per member — instanceId, display name, model (or "instance
  default"), role, availability right now.
- Tool guidance: dispatch work with `dispatch`; parallelize independent work;
  chain dependent work with `fromDispatchId`; check in with `list_dispatches`;
  collect with `await_dispatch` using `timeoutSeconds` ≤ 300 in a loop.
- One behavioral rule: "You are the planner. Hand implementation to the crew;
  do not do a member's work yourself unless every relevant member declined."

Briefing is server-owned text, versioned in one file, same for every planner
provider (adapter-specific delivery, identical content).

## 7. Turn lifecycle UX

- Interrupting the parent turn interrupts every non-settled child. The panel
  rows settle to `Stopped`. No orphan work.
- Parent turn completion with children still running is a **planner error**:
  the server appends a system line to the parent transcript — "Turn ended
  with {N} agents still working. Their results were not collected." —
  and cancels them. (The briefing tells the planner to await before ending.)
- Usage: children accrue usage to their own provider accounts as normal
  threads; the Usage page needs no change for v1.

## 8. Reverse states (AGENTS.md rule)

| Way in | Way out | Where visible |
|---|---|---|
| Select crew | Select any model (rail) | Picker |
| Create crew | Delete crew (Settings, confirmed) | Settings |
| Dispatch child | Stop child (drawer header ⏹ / parent interrupt) | Panel + drawer |
| Favorite crew | Unfavorite | Picker |
| Hide child threads (automatic) | `Open as thread ↗` from drawer | Drawer |

## 9. Out of scope for v1 — named so nobody half-builds them

- Automatic model routing / task classification. The planner decides.
- Cross-crew nesting (a child that is itself a crew turn). Dispatch inside a
  child fails `not-orchestrating`.
- Crew sharing/export, per-member permission-mode overrides, mobile drawer.
- Cost estimates per crew in the picker.
