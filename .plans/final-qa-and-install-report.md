# Final QA and daily-driver install report

Date: 2026-08-15
Branch: `build/crew-suite`
Shipped implementation HEAD: `18ca244198c0c8f4804f09fef1da366817485b61`

## Final verdict

The shipped implementation passed the install gate. T3 Code `0.0.34-crew.3` is installed at
`/Applications/T3 Code (Alpha).app`, is running, and serves HTTP/WebSocket traffic on port `3773`.

The real database passed integrity and foreign-key checks after startup. It contains 23 threads
and 476 turns. All five new migrations are recorded, and every required table and column exists.

One provider warning remains. Kimi is registered and its CLI version `1.49.0` is installed, but its
live ACP startup check timed out after 15 seconds. I did not repair or reconfigure it.

## Phase 1: QA findings

### Git hygiene

- Working tree: clean before QA.
- Branch: `build/crew-suite`.
- Shipped implementation HEAD: exactly matches `origin/build/crew-suite` after a fresh fetch.
- Starting local HEAD: one report-only commit ahead of the remote implementation. It was the
  previous required local-only `.plans/final-qa-and-install-report.md` commit. No implementation
  code was unpushed.
- Merge, rebase, cherry-pick, and revert state: none.
- Linked review worktree: clean and detached at the shipped implementation HEAD.
- Pending `.plans` edits before this report: none.

### Focused tests

`git diff --diff-filter=A origin/main...origin/build/crew-suite` found 41 test files added by this
branch. Every added test was included with the requested focused list.

- Requested plus branch-added run: 52 files passed and 1 gated integration file skipped; 571 tests
  passed and 1 integration test skipped.
- Live native Ollama integration: 1 file and 1 test passed against the existing operator-owned
  Ollama listener.
- Distinct proof after the gated integration run: 53 files and 572 tests passed.

The install did not start, stop, or restart Ollama.

### Type checks

`pnpm exec tsgo --noEmit -p <package>/tsconfig.json` results:

- `apps/server`: passed. Existing Effect suggestions only.
- `apps/web`: passed.
- `apps/desktop`: passed. Existing Effect suggestions only.
- `packages/contracts`: passed.
- `packages/shared`: passed.
- `packages/client-runtime`: passed. One existing Effect suggestion only.
- `apps/mobile`: the known 64 React Navigation route-inference errors remain.

The mobile error count matches the prior branch reports. No error is in a branch-added file or a
changed hunk, so this branch adds no mobile type error.

### Migration safety on the backup copy

Source backup:
`/Users/victorfreyre/Documents/t3code-backup-20260815-224902/state.sqlite`

The source passed `PRAGMA integrity_check` and contained 23 threads and 473 turns. Its latest
migration was 40. I copied it to `/tmp/t3mig.sqlite` and ran the server's real `runMigrations`
function with foreign keys enabled and WAL journal mode.

These migrations applied in order:

1. `41_CrossProviderDispatches`
2. `42_ProjectionThreadParents`
3. `43_TaskSuggestions`
4. `44_CrossThreadMessages`
5. `45_CrewTestFlights`

After migration, integrity remained `ok`, foreign-key violations remained zero, and counts
remained 23 threads and 473 turns. The copy contained:

- `projection_dispatches`
- `projection_threads.parent_thread_id`
- `projection_task_suggestions`
- `projection_cross_thread_messages`
- `projection_thread_messages.cross_thread_source_json`
- `projection_turns.crew_id`
- `projection_turns.crew_test_flight_json`

No separate Ollama or settings migration exists. Those additions use the decoded settings schema.

### Safe defaults

- `DEFAULT_SERVER_SETTINGS.crossThreadMessaging` is `off`.
- New MCP credentials omit messaging tools while that setting is `off`.
- `DEFAULT_SERVER_SETTINGS.crews` is `[]`.
- The starter crew only prefills an editor and is never saved silently.
- Crew selection starts as `null` unless the current thread already used a crew.
- Suggested-task cards render only from persisted suggestion records. The agent tool cannot accept
  or auto-run a suggestion.

## Phase 2: install steps performed

### Backup and artifact

- The backup still existed immediately before install and was not changed.
- Backup integrity: `ok`.
- Backup counts: 23 threads and 473 turns.
- DMG SHA-256:
  `32943751a796438038fd8edab5bf6bb5fa5154ec1a3d0cc707e0b0b8e6578304`.
- Mounted bundle: `0.0.34-crew.3`, arm64.

### Process safety and app shutdown

- T3 Code root PID before quit: `48716`.
- T3-owned Claude, Codex, Kimi, or Ollama CLI children: zero.
- Live database turn states before quit: 475 completed, 1 interrupted, 0 active.
- Independent `ollama serve` PID `2095` remained running throughout.
- AppleScript graceful quit did not complete within 60 seconds.
- After the authorized timeout, I used `kill -9` on the captured and revalidated T3 root PID
  `48716` only.
- The server and resource monitor remained reparented, so I used `kill -9` on the captured and
  revalidated T3 PIDs `48768` and `48787`.
- All T3 app-bundle processes then exited. No other process was signaled.

### Installation

1. Mounted the DMG read-only at `/dev/disk4`.
2. Confirmed the mounted app was `0.0.34-crew.3` and arm64.
3. Staged a complete copy in `/Applications`.
4. Moved the prior installed app to
   `/Users/victorfreyre/.Trash/T3 Code (Alpha) 0.0.34-crew.3 pre-reinstall-20260815-2348.app`.
5. Moved the staged bundle into `/Applications/T3 Code (Alpha).app`.
6. Detached `/dev/disk4` successfully.
7. Cleared `com.apple.quarantine` recursively and confirmed the attribute is absent.
8. Relaunched with `open -a 'T3 Code (Alpha)'`.

## Phase 3: post-install verification

### App and server

- Installed version: `0.0.34-crew.3`.
- App root PID at verification: `61206`.
- Server PID at verification: `61274`.
- Runtime origin: `http://127.0.0.1:3773`.
- Listener proof: server PID `61274` owns TCP `*:3773` in `LISTEN` state.
- HTTP proof: the origin returned the installed T3 web shell.

### Real userdata migration and counts

Read-only checks against `/Users/victorfreyre/.t3/userdata/state.sqlite` showed:

- Integrity: `ok`.
- Foreign-key violations: zero.
- Threads: 23.
- Turns: 476.
- Turn states: 475 completed and 1 interrupted; no active turn.
- Applied migrations: 41 through 45, with the expected names.
- New tables and columns: all items listed in the copied-database check exist.

### Live provider registry

The installed server wrote fresh provider status caches during this boot. The required instances
are present:

| Instance | Driver | Current state |
| --- | --- | --- |
| `codex` | `codex` | Ready and authenticated; CLI `0.147.0`. |
| `claudeAgent` | `claudeAgent` | Registered; startup cache says status has not been checked in this session. |
| `kimi` | `kimi` | Registered and installed; CLI `1.49.0`; ACP startup timed out after 15 seconds. |
| `ollama` | `ollama` | Ready and authenticated; `qwen3.6:27b-mlx` and default `qwen3.6:35b-mlx` discovered. |

## Operator action

The app and database need no manual action.

Before using Kimi, open Settings -> Providers -> Kimi and refresh it. If the timeout remains, run
`kimi` in Terminal and complete `/login` if requested. Claude can also be refreshed from its
provider card if its initial unchecked warning remains.

No provider credential, settings file, or authentication state was changed during this pass.

## Emergency database restore command

This restore is not required for the Kimi timeout. It restores 23 threads and 473 turns, so it
discards the three turns created after the verified backup.

```sh
set -euo pipefail
osascript -e 'tell application "T3 Code (Alpha)" to quit'
for attempt in {1..60}; do
  if ! osascript -e 'application "T3 Code (Alpha)" is running' | grep -q true; then break; fi
  sleep 1
done
if osascript -e 'application "T3 Code (Alpha)" is running' | grep -q true; then
  echo 'T3 Code is still running. Stop it before restoring the database.' >&2
  exit 1
fi
mv '/Users/victorfreyre/.t3/userdata/state.sqlite' '/Users/victorfreyre/.t3/userdata/state.sqlite.before-crew3-restore-20260815-finalqa'
if [ -e '/Users/victorfreyre/.t3/userdata/state.sqlite-wal' ]; then
  mv '/Users/victorfreyre/.t3/userdata/state.sqlite-wal' '/Users/victorfreyre/.t3/userdata/state.sqlite-wal.before-crew3-restore-20260815-finalqa'
fi
if [ -e '/Users/victorfreyre/.t3/userdata/state.sqlite-shm' ]; then
  mv '/Users/victorfreyre/.t3/userdata/state.sqlite-shm' '/Users/victorfreyre/.t3/userdata/state.sqlite-shm.before-crew3-restore-20260815-finalqa'
fi
cp '/Users/victorfreyre/Documents/t3code-backup-20260815-224902/state.sqlite' '/Users/victorfreyre/.t3/userdata/state.sqlite'
sqlite3 -readonly '/Users/victorfreyre/.t3/userdata/state.sqlite' 'PRAGMA integrity_check;'
open -a 'T3 Code (Alpha)'
```

## Proof limits

This pass proves focused source tests, package type checks, a live Ollama adapter call, copied-data
migration safety, installed process startup, listener ownership, real-data migration survival, and
fresh provider-registry cache contents. It did not perform a browser-driven visual or interaction
pass.
