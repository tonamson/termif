# Termif — Design and Implementation Status

Read this first. It is the only file that tracks what exists, what is next, and
what still has to be written.

**Scope, as of 2026-08-28: v1 is macOS and Windows only.** The React Native
mobile shells are deferred to a later phase, recorded in spec §11. Plan 4 is
not "not written yet" — it is out of v1 scope.

**Specs**, in the order they were decided:

- [`specs/2026-08-28-termif-crossplatform-ssh-design.md`](specs/2026-08-28-termif-crossplatform-ssh-design.md)
  — the design every plan argues from. Read it before any plan.
- [`specs/2026-08-30-termif-desktop-layout-design.md`](specs/2026-08-30-termif-desktop-layout-design.md)
  — layout and interaction: the three-column skeleton, the drawer, the
  inspector, SFTP drag-and-drop and context menus, two token sets, and the
  real-layout test tier. Extends the visual design spec.
- [`specs/2026-08-30-termif-local-only-storage.md`](specs/2026-08-30-termif-local-only-storage.md)
  — **supersedes §4 and §7 of the above.** No master password, no encryption, no
  Google Sheets sync; one portable SQLite file holds everything. Read it before
  Plans 6 and 7.
- [`specs/2026-08-30-termif-ui-redesign-spec.md`](specs/2026-08-30-termif-ui-redesign-spec.md)
  — Hybrid Studio Console UI/UX specification adhering to Taste-Skill anti-slop guidelines.

## Plans, in execution order

| # | Plan | Tasks | Status | Blocks |
|---|---|---|---|---|
| 1 | [`plans/2026-08-28-termif-01-ssh-core.md`](plans/2026-08-28-termif-01-ssh-core.md) — Rust `ssh-core` + napi bridge | 12 | not started | 2, 3 |
| 2 | [`plans/2026-08-28-termif-02-core-ts.md`](plans/2026-08-28-termif-02-core-ts.md) — shared TypeScript core | 12 | **complete (2026-08-30)** — all 73 steps done, 138 tests green | 3 |
| 3 | [`plans/2026-08-28-termif-03-desktop.md`](plans/2026-08-28-termif-03-desktop.md) — Electron desktop shell | 12 | **complete (2026-08-30)** — all 92 steps done, 184 tests green, build OK | — |
| 4 | React Native mobile shell | — | **deferred, out of v1 scope** (spec §11) | — |
| 5 | [`plans/2026-08-30-termif-04-desktop-visual.md`](plans/2026-08-30-termif-04-desktop-visual.md) — desktop visual design | 7 | **complete (2026-08-30)** | — |
| 6 | [`plans/2026-08-30-termif-06-local-only.md`](plans/2026-08-30-termif-06-local-only.md) — everything in one SQLite file, no vault, no Google | 12 | **complete (2026-08-30)** — 290 tests green (83 core + 207 desktop), 30 IPC channels, 0 Google channels | 7 |
| 7 | [`plans/2026-08-30-termif-07-live-acceptance.md`](plans/2026-08-30-termif-07-live-acceptance.md) — live acceptance: real server, packaged `.dmg` | 3 layers | not started, blocked by 6 | — |
| 8 | [`plans/2026-08-30-termif-08-desktop-layout.md`](plans/2026-08-30-termif-08-desktop-layout.md) — layout: drawer, inspector, SFTP menus, layout tests | 15 | **complete (2026-08-30)** — 255 desktop tests green (83 core), drawer + resizable sidebar + grouping + tab overflow + passphrase + inspector/sheet + hostile fixture | — |
| 9 | [`plans/2026-08-30-termif-09-store-shape-migration.md`](plans/2026-08-30-termif-09-store-shape-migration.md) — repair credentials table by shape, not version | 6 | **complete (2026-08-30)** — 21 core tests green, vault-era DB repaired, passphrase column ensured | — |
| 10 | [`plans/2026-08-30-termif-10-schema-versioning.md`](plans/2026-08-30-termif-10-schema-versioning.md) — numbered migration runner on `PRAGMA user_version` | 6 | **complete (2026-08-30)** — MIGRATIONS is string[][], SCHEMA_VERSION derived, adopt+runMigrations, vault repair preserved, 89 core tests green, rewrite pattern proven, docs + diagnostics | — |
| 12 | [`plans/2026-08-30-termif-12-host-connection-status.md`](plans/2026-08-30-termif-12-host-connection-status.md) — sidebar dot follows session state, release 0.1.6 | 4 | **complete (2026-08-30)** — hostStates() strongest wins, MainLayout subscribes, 95 core + 270 desktop tests green, Termif-0.1.6-arm64.dmg 104M / Termif-0.1.6.dmg 108M | — |
| 13 | [`plans/2026-08-30-termif-13-main-panels.md`](plans/2026-08-30-termif-13-main-panels.md) — terminal-first exclusive main panels, SFTP via titlebar, oscillation fix, real geometry tier | 6 | **complete (2026-08-30)** — panels + oscillation killed (28.5 RO/s → 0) + geometry tier, 274 desktop + 95 core + 9 e2e green, 0.1.7 | — |
| 14 | [`plans/2026-08-30-termif-ui-redesign-plan.md`](plans/2026-08-30-termif-ui-redesign-plan.md) — Hybrid Studio Console UI/UX redesign | 4 | **complete (2026-08-30)** | — |

Plans 6 and 7 were added on 2026-08-30 and run last. Plan 6 removes the
encryption and sync layers; Plan 7 then verifies what remains against a real
SSH server and a packaged build. Plan 7 is the first thing in this project that
touches a real network, so it goes after everything else is settled.

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
2. **The table above.** When a plan finishes, update its row.
3. **The test count.** Every commit that lands a plan step should hold or
   grow the green count.
