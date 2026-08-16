# T3 Code fork — handoff prompt

Paste everything below into a fresh session in another launcher. It is
self-contained. Verified against live state 2026-08-16 02:15 ET.

---

You are picking up a project mid-flight. Read this fully before acting.

## Who / where

Operator: Victor. macOS (Apple Silicon). Talk to him in plain, short
sentences — answer first, detail after, no walls of text. Push back honestly
when something is wrong; never fake agreement.

Repo: `~/Documents/Code/t3code` — a fork of `pingdotgg/t3code` (T3 Code, an
open-source MIT GUI that wraps coding-agent CLIs). Fork remote is
`origin` = `gitctor/t3code`; upstream is `pingdotgg/t3code`.
Working branch: **`build/crew-suite`** (pushed).

## What was built (all merged on build/crew-suite, ~100 commits)

1. **Cross-provider crew orchestration** — one "planner" agent dispatches
   work to agents on OTHER providers. A dispatched subagent is an ordinary
   child thread on the target provider, linked to the parent turn; children
   appear in the existing Agents panel and each child's live transcript
   opens in a drawer. MCP tools: `dispatch`, `await_dispatch`,
   `list_dispatches`, served by T3's own `t3-code` MCP server, granted only
   on crew turns.
2. **Crews UI** — "Orchestrate" entry in the model-picker rail (Orbit icon),
   crew list, crew editor (planner + members + per-seat model/effort/role),
   starter "Orchestrator" template (Fable xhigh plans; Codex/Claude/Kimi
   execute).
3. **Crew Test Flight** — 🧪 button per crew: spins a throwaway thread,
   overrides every seat to its CHEAPEST model, has each member reply
   `TEST COMPLETE — {role}`, reports a per-seat table. This is the cheap
   end-to-end proof harness. USE IT to verify orchestration after changes.
4. **Kimi provider** (ACP driver, adapted from upstream PR #5243). Kimi is
   Queue-only for active-turn delivery (single mutable ACP turn state).
5. **Local Ollama provider** (native driver) — live model discovery from
   `GET /api/tags`, base URL is a setting (default
   `http://127.0.0.1:11434`), shows "Local — free" instead of quotas.
   Operator has `qwen3.6:35b-mlx` (default) and `qwen3.6:27b-mlx`.
6. **Usage limits** — Limits strip + sidebar hover card + gauges (adapted
   upstream PRs #5739/#6264). Claude persists no limit data on disk, so its
   empty state reads "No limit data yet — appears after your first Claude
   turn" (verified against 2,171 real transcripts; do not "fix" this by
   faking data).
7. **Active-turn Steer/Queue** (upstream PR #5396 adapted) — right-click the
   send button DURING a running turn WITH text in the composer to choose
   per-message delivery; queued messages get "Steer now".
8. **Task suggestions ("chips")** — `suggest_task` MCP tool available to all
   agents; operator-only accept spawns a real prefilled thread. Max 10
   pending per source thread.
9. **Cross-thread messaging** — `send_to_thread` / `list_threads`, gated by
   a server setting `crossThreadMessaging: off | crew | project`,
   **default off**. Server-composed non-spoofable envelope; audit lines in
   both transcripts.
10. **Design-debt sweep** from designer @ggsimm's public feedback thread:
    grouped thread context menu, one Tabs component, honest disabled states,
    base-branch emphasis, subagents banner restyle, one refresh convention.

In-repo docs: `.plans/*.md` — design, UX spec, per-phase reports, and
`final-qa-and-install-report.md`.

## CURRENT STATE (verified live, do not assume otherwise)

- The fork build **is installed as the daily driver**:
  `/Applications/T3 Code (Alpha).app` version **0.0.34-crew.3**, and it is
  RUNNING right now.
- Real data at `~/.t3/userdata` migrated cleanly: **23 threads / 476 turns**,
  `PRAGMA integrity_check` ok, zero FK violations, migrations 41-44 recorded.
- Backup of the pre-install database:
  `~/Documents/t3code-backup-20260815-224902/` (23 threads / 473 turns,
  integrity ok). DO NOT delete it.
- Orchestration was proven END TO END on 2026-08-15: a crew test flight
  dispatched 3 children (Claude haiku ×2, Kimi highspeed), all completed,
  each child's transcript opened from the Agents panel.
- Ollama proven live: model appeared in the picker and replied in-app.

## OPEN ITEMS (in priority order)

1. **Kimi provider warning.** Kimi's ACP startup check timed out (15s) during
   post-install verification. Fix: Settings → Providers → Kimi → refresh; if
   it persists, run `kimi` in Terminal and complete `/login`. Claude's card
   may also need one refresh. Nothing was reconfigured automatically.
2. **The in-app update button has nothing to find yet.** The build's updater
   points at `gitctor/t3code` RELEASES (set at build time via
   `T3CODE_DESKTOP_UPDATE_REPOSITORY`). The fork currently has ZERO releases,
   so the button will honestly report "no updates". TO MAKE IT LIVE: publish
   the current DMG as a GitHub Release on `gitctor/t3code` with assets
   `T3-Code-0.0.34-crew.3-arm64.dmg`, its `.blockmap`, and `latest-mac.yml`
   (all already in `~/Documents/Code/t3code/release/`). Use `gh release
   create` — ASK VICTOR FIRST, it is outward-facing.
3. **Staying current with upstream T3.** The routine is:
   `git fetch upstream && git merge upstream/main` → run the gate (below) →
   rebuild DMG → publish release to the fork → his app self-updates. Our
   features are additive; a 41-commit upstream drift merged with a one-word
   conflict. Auto-updater must NEVER point at upstream or stock builds would
   overwrite the fork's features.
4. **Three features are test-verified but never exercised live**: chips,
   cross-thread messaging, and the Steer/Queue right-click menu. All are
   additive/off-by-default. Verify them opportunistically during real use.
5. Known cosmetic gap: Kimi reasoning chunks don't render in the worklog.

## HOW TO WORK ON THIS REPO

Read `AGENTS.md` in the repo first — it is binding. Highlights:
- **Never open a PR unless Victor explicitly asks.**
- **No repo-wide checks** (`vp check`, `vp run -r test`). Run focused tests.
- **Never `pkill -f`** or kill a PID matched by name — his own processes
  share those strings. Never kill his `ollama serve`.
- **Never run a server against `~/.t3/userdata`** (his live data). To test
  with real data, snapshot with `VACUUM INTO` into a worktree's `.t3`.
- Effect-heavy server: read `.repos/effect-smol/LLMS.md` before Effect code.
- No continuously repainting animations (GPU cost on high-refresh displays).

### The gate to run before pushing anything

```bash
cd ~/Documents/Code/t3code
./node_modules/.bin/vp test run \
  packages/contracts/src/orchestrationCrew.test.ts \
  packages/contracts/src/taskSuggestion.test.ts \
  packages/contracts/src/settings.test.ts \
  packages/shared/src/model.test.ts \
  apps/server/src/server.test.ts \
  apps/server/src/mcp/DispatchBroker.test.ts \
  apps/web/src/crewSelection.test.ts
# then, per touched package:
(cd apps/server && ../../node_modules/.bin/tsgo --noEmit)   # also apps/web,
# apps/desktop, packages/contracts, packages/shared, packages/client-runtime
```
`apps/mobile` has PRE-EXISTING React Navigation route-inference errors —
confirm you added no NEW ones; do not try to fix the old ones.

### Reviewing UI changes safely (never against his live app)

A frozen review worktree exists at `~/Documents/Code/t3code-review`:
```bash
cd ~/Documents/Code/t3code-review && git fetch -q origin \
  && git checkout -q origin/build/crew-suite \
  && ./node_modules/.bin/vp run dev --home-dir "$PWD/.t3"
# then open the printed pairingUrl (token required)
```
Add `T3CODE_LOG_LEVEL=Debug` when diagnosing. Kill the server when done —
each one costs GBs of RAM.

### Delegating heavy work to Codex (the proven lane)

Long runs MUST go through launchd or they get reaped:
```bash
launchctl submit -l com.victor.codex-<slug> -o <log> -e <log> -- /bin/zsh -c \
 'cd ~/Documents/Code/t3code && export CLAUDE_PLUGIN_DATA="$HOME/.claude/plugins/data/gemini-gemini-plugin-cc" && export PATH="/opt/homebrew/bin:$PATH" && exec node "$HOME/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs" task --write --model gpt-5.6-sol --effort xhigh --prompt-file <prompt.md>'
```
**`launchctl remove <label>` THE MOMENT it finishes** — submit jobs restart
on exit and will silently re-run the whole prompt for hours. Do not use
`codex-collect.sh`; poll the job JSON under
`~/.claude/plugins/data/gemini-gemini-plugin-cc/state/<cwd-key>/jobs/` and
the launcher log's freshness instead. Tell Codex to COMMIT LOCALLY ONLY and
write a report; review the diff yourself before pushing.

## HARD-WON GOTCHAS (do not rediscover these)

- **Codex MCP tool approval is per-tool config, NOT `approvalPolicy`.**
  `mcp_servers.<server>.tools.<tool>.approval_mode="approve"` means DO NOT
  prompt (`"prompt"` means always ask). Under `approvalPolicy: untrusted`,
  Codex silently denies non-allowlisted MCP tools with "user rejected MCP
  tool call" and NO approval request is ever emitted. This one cost 6 debug
  flights.
- **Never send `config/mcpServer/reload` before a turn** — it races Codex's
  own startup load, producing two catalog generations and non-deterministic
  tool visibility.
- A `Context.Reference` with a default implementation hides missing DI: the
  crew registry silently resolved to empty in one layer while working in
  another. Prefer required services.
- Base UI `SelectValue` renders the raw VALUE unless given label children.
- Popovers freeze their height on open; content that grows after mount gets
  clipped (`h-auto!` fixes it).
- Localhost HTTP may be blocked by an agent's own sandbox — confirm with
  `lsof -nP -iTCP:<port> -sTCP:LISTEN` before declaring a service down.

## EMERGENCY RESTORE

If the app misbehaves catastrophically, quit it and restore the pre-install
database (see the exact command at the bottom of
`.plans/final-qa-and-install-report.md`). The stock upstream app may not read
migrated data, so restoring the backup is the path back.
