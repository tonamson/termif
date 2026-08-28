# Termif — Design and Implementation Status

Read this first. It is the only file that tracks what exists, what is next, and
what still has to be written.

**Spec:** [`specs/2026-08-28-termif-crossplatform-ssh-design.md`](specs/2026-08-28-termif-crossplatform-ssh-design.md)
— the design every plan argues from. Read it before any plan.

## Plans, in execution order

| # | Plan | Tasks | Status | Blocks |
|---|---|---|---|---|
| 1 | [`plans/2026-08-28-termif-01-ssh-core.md`](plans/2026-08-28-termif-01-ssh-core.md) — Rust `ssh-core` + napi/uniffi bridges | 13 | not started | 2, 3, 4 |
| 2 | [`plans/2026-08-28-termif-02-core-ts.md`](plans/2026-08-28-termif-02-core-ts.md) — shared TypeScript core | 12 | not started | 3, 4 |
| 3 | [`plans/2026-08-28-termif-03-desktop.md`](plans/2026-08-28-termif-03-desktop.md) — Electron desktop shell | 11 | not started | — |
| 4 | **not written yet** — React Native mobile shell | — | **plan missing** | — |

Plan 1 goes first because it carries the largest risk — a four-target Rust
toolchain — and everything else stands on it. Finding out it is wrong in week
one is much cheaper than in week six.

## How to track progress without a separate tool

Three signals, in increasing order of trustworthiness:

1. **Checkboxes.** Every step in every plan is a `- [ ]`. Tick it and commit the
   plan file alongside the code.

       grep -c '^- \[ \]' docs/superpowers/plans/*.md   # steps remaining
       grep -c '^- \[x\]' docs/superpowers/plans/*.md   # steps done

2. **Commit messages.** Each task ends with a commit whose message the plan
   spells out, so `git log --oneline` reads as a task list.

3. **The test suite.** The plans are test-first: a green `cargo test` or
   `npm test` is what actually says a task is finished. A ticked checkbox with a
   red suite means nothing.

## Work still owed

### Plan 4 — React Native mobile shell (not written)

The spec covers it (§3, §5, §6), and Plan 2 was built to serve it — `Platform`
injection and the `ForwardManager` platform notes exist for this shell. Writing
it should wait until Plans 1 and 2 are actually built, because it depends on
their real signatures rather than their planned ones.

Scope, from the spec:

- React Native shell with a `Platform` built over the uniffi native module
  (Plan 1 Task 12), mirroring `apps/desktop/src/renderer/platform.ts`.
- `xterm.js` inside `react-native-webview`, bytes bridged via `postMessage` —
  the same emulator as desktop (spec §6).
- A keyboard accessory bar: `Tab`, `Ctrl`, `Esc`, arrows, `|`, `~`, `/`, and a
  snippet button. Without it, SSH on a phone is unusable, which is why snippets
  matter more here than on desktop.
- Vault key wrapped behind biometrics via Keychain/Keystore.
- iOS foreground-only forwarding, surfaced through the note `ForwardManager`
  already attaches; Android foreground service for background forwards.
- Two build integrations: the XCFramework and the `jniLibs`/Kotlin output from
  `scripts/build-ios.sh` and `scripts/build-android.sh`.

### Desktop: Google sign-in screen (deferred, called out in Plan 3)

`GoogleAuth` and its IPC channels are built in Plan 3 Task 3, but no UI drives
them. Until that screen exists the app runs fully offline against the local
database — `bootApp` creates a `SyncEngine` only when a spreadsheet id is
already stored. The screen needs: device-flow code display, a poll loop, and
first-run spreadsheet creation via `SheetClient.createSpreadsheet`.

### Three fixes Plan 3 flags against itself

Each is described at its own site in the plan and again in Plan 3's
Self-Review. Apply them while implementing:

1. Task 5 — `fakePlatform` uses a top-level `await` inside a non-async
   function. Make it `async`; `await` it at both call sites.
2. Task 5 — `bootApp` calls `sessions.onBridgeEvent`, which Plan 2 does not
   define. Add `onBridgeEvent(listener: (event: SshEvent) => void): () => void`
   to `SessionManager` in **Plan 2 Task 9**, emitting each drained event before
   its own handling, then drop the optional-call `?.`. Do not open a second
   `nextEvents` loop — two loops would race for the same events.
3. Task 10 — `SftpBrowser` calls `useStore` conditionally, which React forbids.
   Split it into an outer component that checks for a session and an inner one,
   keyed on `sessionId`, that always calls the hook.

## Decisions already settled

Do not relitigate these while implementing; the spec records the reasoning.

- Mobile gets a real SSH terminal, not a host manager.
- The Google Sheet holds ciphertext; the key is derived client-side.
- One Rust protocol core over FFI, one shared TypeScript core, two UI shells.
- Per-row last-write-wins on `updatedAt`, with the row id as tie-break.
- `known_hosts` is per-device and never synced.
- A host key mismatch is a hard block with no override.
- Argon2id at `m = 65536, t = 3, p = 1`, parameters stored in the sheet's `meta`
  tab so they can be raised later.
- `sftp_read_range` is capped at 1 MiB; bulk movement goes through
  upload/download, which never holds a whole file in memory.
- English is the only locale in v1, but every string goes through `t()`.
