# Final QA and daily-driver install report

Date: 2026-08-15
Branch: `build/crew-suite`
QA HEAD: `18ca244198c0c8f4804f09fef1da366817485b61`

## Final verdict

The branch passed the install gate. T3 Code `0.0.34-crew.3` is installed at
`/Applications/T3 Code (Alpha).app`, is running, and serves HTTP/WebSocket traffic on port `3773`.

The real database passed integrity checks after startup. It contains 23 threads and 476 turns.
The same 476 turns were present immediately before the graceful quit, so the install created no
turns and lost no live data.

One provider warning remains. Kimi is registered and its CLI version `1.49.0` is installed, but its
live ACP startup check timed out after 15 seconds. I did not try to repair or reconfigure it.

## Phase 1: QA findings

### Git hygiene

- Working tree: clean before QA.
- Branch: `build/crew-suite`.
- HEAD on fork: `origin/build/crew-suite` resolves to the exact local HEAD above.
- Merge, rebase, and cherry-pick state: none.
- Linked review worktree: clean and detached at the same HEAD.
- Pending `.plans` changes before this report: none.

### Focused tests

`git diff --diff-filter=A origin/main...HEAD` found 41 test files added by this branch. Every added
test file was included with the requested focused list.

- Requested plus branch-added suite: 52 files passed, 571 tests passed.
- Live native Ollama integration: 1 file passed, 1 test passed.
- Total executed proof: 53 files and 572 tests passed.

The live Ollama integration used the existing operator-owned `ollama serve` process. It was not
stopped or restarted.

### Type checks

`pnpm exec tsgo --noEmit -p <package>/tsconfig.json` results:

- `apps/server`: passed. Existing Effect suggestions only.
- `apps/web`: passed.
- `apps/desktop`: passed. Existing Effect suggestions only.
- `packages/contracts`: passed.
- `packages/shared`: passed.
- `packages/client-runtime`: passed. One existing Effect suggestion only.
- `apps/mobile`: the known 64 React Navigation route-inference errors remain.

The mobile error count matches the prior branch report. No error is in a branch-added file or a
changed hunk. Errors in changed files point only to unchanged lines, so this branch adds no mobile
type error.

### Migration safety on the backup copy

Source backup:
`/Users/victorfreyre/Documents/t3code-backup-20260815-224902/state.sqlite`

The source passed `PRAGMA integrity_check` and contained 23 threads and 473 turns. I copied it to
`/tmp/t3mig.sqlite` and ran the server's `runMigrations` path with foreign keys enabled and WAL mode.

These migrations applied in order:

1. `41_CrossProviderDispatches`
2. `42_ProjectionThreadParents`
3. `43_TaskSuggestions`
4. `44_CrossThreadMessages`
5. `45_CrewTestFlights`

After migration, integrity remained `ok`. Counts remained 23 threads and 473 turns. The copied
database contained:

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
- `DEFAULT_SERVER_SETTINGS.crews` is `[]`.
- The starter crew only prefills the editor. Source comments and behavior state that it is never
  saved silently.
- Crew selection starts as `null` unless a thread already has a crew or the operator selects one.
- Messaging MCP tools are omitted when cross-thread messaging is `off`.

## Phase 2: install steps performed

### Backup and artifact

- The backup still existed immediately before install.
- Backup integrity: `ok`.
- Backup counts: 23 threads and 473 turns.
- DMG SHA-256:
  `32943751a796438038fd8edab5bf6bb5fa5154ec1a3d0cc707e0b0b8e6578304`.
- Artifact bundle: `0.0.34-crew.3`, arm64.

### Process safety and graceful quit

- T3 Code root PID before quit: `28097`.
- One sleeping Claude child was present. I waited and checked again.
- Both database checks showed zero active turns. The child was an idle retained provider session.
- `ollama serve` PID `2095` remained running throughout.
- T3 Code quit through AppleScript. All T3 processes exited in under one second.
- No signal and no force kill was used.

### Installation

1. Mounted the DMG read-only at `/dev/disk4`.
2. Confirmed the mounted app was `0.0.34-crew.3` and arm64.
3. Staged the complete bundle in `/Applications`.
4. Replaced `/Applications/T3 Code (Alpha).app` with the staged bundle.
5. Detached `/dev/disk4` successfully.
6. Cleared `com.apple.quarantine` recursively.
7. Confirmed the quarantine attribute is absent.
8. Relaunched with `open -a 'T3 Code (Alpha)'`.

The prior `0.0.33` app is recoverable from
`/Users/victorfreyre/.Trash/T3 Code (Alpha) 0.0.33 pre-crew.app` until Trash is emptied.

## Phase 3: post-install verification

### App and server

- Installed version: `0.0.34-crew.3`.
- App root PID at verification: `48716`.
- Server PID at verification: `48768`.
- Runtime origin: `http://127.0.0.1:3773`.
- Listener proof: server PID `48768` owns TCP `*:3773` in `LISTEN` state.
- HTTP proof: the origin returned the installed T3 web shell.

### Real userdata migration and counts

Read-only checks against `/Users/victorfreyre/.t3/userdata/state.sqlite` showed:

- Integrity: `ok`.
- Threads: 23.
- Turns: 476.
- Active turns after startup: 0.
- Applied migrations: 41 through 45, with the expected names.
- New tables and columns: all items listed in the copied-database check exist.

### Live provider registry

The current provider status cache was written by this installed server boot. It contains the four
required provider instances:

| Instance | Driver | Installed state |
| --- | --- | --- |
| `codex` | `codex` | Ready and authenticated; CLI `0.147.0`. |
| `claudeAgent` | `claudeAgent` | Registered; startup cache says status has not been checked in this session. |
| `kimi` | `kimi` | Registered and installed; CLI `1.49.0`; ACP startup timed out after 15 seconds. |
| `ollama` | `ollama` | Ready and authenticated as `Local — free`; both `qwen3.6:27b-mlx` and `qwen3.6:35b-mlx` discovered. |

## Operator action

The app and database need no manual action.

Before using Kimi, open Settings -> Providers -> Kimi and refresh it. If it still reports the ACP
timeout, run `kimi` in Terminal and complete `/login` if requested. Claude can also be refreshed
from its provider card if its initial unchecked warning remains.

No provider credentials, settings file, or authentication state was changed during this install.

## Emergency database restore command

This restore is not required for the Kimi timeout. Use it only to return the database to the
verified backup point. It restores 23 threads and 473 turns, so it discards the three newer turns
present before installation.

```sh
osascript -e 'tell application "T3 Code (Alpha)" to quit'
while osascript -e 'application "T3 Code (Alpha)" is running' | grep -q true; do sleep 1; done
mv '/Users/victorfreyre/.t3/userdata/state.sqlite' '/Users/victorfreyre/.t3/userdata/state.sqlite.before-crew3-restore'
if [ -e '/Users/victorfreyre/.t3/userdata/state.sqlite-wal' ]; then mv '/Users/victorfreyre/.t3/userdata/state.sqlite-wal' '/Users/victorfreyre/.t3/userdata/state.sqlite-wal.before-crew3-restore'; fi
if [ -e '/Users/victorfreyre/.t3/userdata/state.sqlite-shm' ]; then mv '/Users/victorfreyre/.t3/userdata/state.sqlite-shm' '/Users/victorfreyre/.t3/userdata/state.sqlite-shm.before-crew3-restore'; fi
cp '/Users/victorfreyre/Documents/t3code-backup-20260815-224902/state.sqlite' '/Users/victorfreyre/.t3/userdata/state.sqlite'
sqlite3 -readonly '/Users/victorfreyre/.t3/userdata/state.sqlite' 'PRAGMA integrity_check;'
open -a 'T3 Code (Alpha)'
```

## Proof limits

This pass proves source tests, package type checks, a live Ollama adapter call, copied-data
migration safety, installed process startup, listener ownership, real-data migration survival, and
live provider-registry contents. It did not perform a browser-driven visual or interaction pass.
