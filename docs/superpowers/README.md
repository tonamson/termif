# Termif — Design and Implementation Status

Read this first. It is the only file that tracks what exists, what is next, and
what still has to be written.

**Scope, as of 2026-08-28: v1 is macOS and Windows only.** The React Native
mobile shells are deferred to a later phase, recorded in spec §11. Plan 4 is
not "not written yet" — it is out of v1 scope. Three plans, not four.

**Spec:** [`specs/2026-08-28-termif-crossplatform-ssh-design.md`](specs/2026-08-28-termif-crossplatform-ssh-design.md)
— the design every plan argues from. Read it before any plan.

## Plans, in execution order

| # | Plan | Tasks | Status | Blocks |
|---|---|---|---|---|
| 1 | [`plans/2026-08-28-termif-01-ssh-core.md`](plans/2026-08-28-termif-01-ssh-core.md) — Rust `ssh-core` + napi bridge | 12 | not started | 2, 3 |
| 2 | [`plans/2026-08-28-termif-02-core-ts.md`](plans/2026-08-28-termif-02-core-ts.md) — shared TypeScript core | 12 | **complete (2026-08-30)** — all 73 steps done, 138 tests green | 3 |
| 3 | [`plans/2026-08-28-termif-03-desktop.md`](plans/2026-08-28-termif-03-desktop.md) — Electron desktop shell | 12 | **complete (2026-08-30)** — all 92 steps done, 184 tests green, build OK | — |
| 4 | React Native mobile shell | — | **deferred, out of v1 scope** (spec §11) | — |
| 5 | [`plans/2026-08-30-termif-04-desktop-visual.md`](plans/2026-08-30-termif-04-desktop-visual.md) — desktop visual design | 7 | **complete (2026-08-30)** | — |

Plan 1 goes first because it carries the largest risk — the Rust toolchain and
the FFI boundary — and everything else stands on it. Finding out it is wrong in
week one is much cheaper than in week six.

Plan 1 has 12 tasks numbered 1–11 and 13. Task 12 was the uniffi binding; its
heading is kept as a stub so the numbering does not shift under references that
already exist. The gap is deliberate, not a lost task.

## How to track progress without a separate tool

Three signals, in increasing order of trustworthiness:

1. **Checkboxes.** Every step in every plan is a `- [ ]`. Tick it and commit the
   plan file alongside the code.

       grep -c '^- \[ \]' docs/superpowers/plans/*.md   # steps remaining
       grep -c '^- \[x\]' docs/superpowers/plans/*.md   # steps done

   As of 2026-08-28: 228 steps remain across the three plans — 63 in Plan 1,
   73 in Plan 2, 92 in Plan 3. None are ticked. This checkout has no
   implementation yet.

   Run the count with `/usr/bin/grep` if your shell wraps `grep`; some
   wrappers truncate piped output and will undercount badly.

2. **Commit messages.** Each task ends with a commit whose message the plan
   spells out, so `git log --oneline` reads as a task list.

3. **The test suite.** The plans are test-first: a green `cargo test` or
   `npm test` is what actually says a task is finished. A ticked checkbox with a
   red suite means nothing.

## Work still owed

None in v1's spec or plans. Google sign-in, first-run spreadsheet attach,
`onBridgeEvent`, `fakePlatform` async, and the `SftpBrowser` hook split are
inlined in the plans (Plan 2 Tasks 7 and 9; Plan 3 Tasks 5, 10, and 12).

Light theme, theme switching, and a UX redesign are explicit non-goals per the desktop visual design spec (spec `2026-08-30-termif-desktop-visual-design.md` § non-goals) — not owed in v1.

## Deferred: the mobile phase

Out of v1 scope, not cancelled. Spec §11 has the full record. The short
version: it adds `crates/ffi-uniffi`, `apps/mobile`, `xterm.js` in a WebView, a
keyboard accessory bar, biometric key wrapping, and a `packages/ui-shared`
extracted from whichever desktop components turn out to be worth sharing.

What matters while building v1 is the other half of §11 — four things v1 must
not do, or that phase stops being a new shell and becomes a rewrite:

1. No Electron, Node, or `ipcRenderer` import inside `packages/core`.
   Enforced by the purity check in Plan 2 Task 12.
2. No configuration read inside `ssh-core`; all input arrives as parameters.
   Enforced by Plan 1's Global Constraints.
3. No callback, closure, or object across the FFI boundary — handles cross as
   `u64`, events are pulled by long poll.
4. No ANSI parsing in core; the byte path from channel to emulator stays
   opaque.

Each is a v1 requirement on its own merits — testability, and not crashing the
host process on a panic — so none of them is cost carried for mobile's sake.
That is the reason they are safe to keep while mobile is deferred.

## Decisions already settled

Do not relitigate these while implementing; the spec records the reasoning.

- v1 ships macOS and Windows. Mobile is deferred (spec §11).
- Mobile, when built, gets a real SSH terminal, not a host manager.
- The Google Sheet holds ciphertext; the key is derived client-side.
- One Rust protocol core over FFI, one shared TypeScript core, one UI shell in v1.
- Per-row last-write-wins on `updatedAt`, with the row id as tie-break.
- `known_hosts` is per-device and never synced.
- A host key mismatch is a hard block with no override.
- Argon2id at `m = 65536, t = 3, p = 1`, parameters stored in the sheet's `meta`
  tab so they can be raised later.
- `sftp_read_range` is capped at 1 MiB; bulk movement goes through
  upload/download, which never holds a whole file in memory.
- English is the only locale in v1, but every string goes through `t()`.
