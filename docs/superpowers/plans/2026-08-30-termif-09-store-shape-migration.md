# Plan 9 — repair the credentials table by shape

Spec: [`specs/2026-08-30-termif-store-shape-migration.md`](../specs/2026-08-30-termif-store-shape-migration.md)

Fixes `SqliteError: table credentials has no column named secret` on
profiles carried over from the vault-era build. Test-first; each task is
one commit.

All work is in `packages/core/src/store.ts` and
`packages/core/test/store.test.ts` (plus whichever desktop test file
already exercises `Store.open`).

## Task 1 — failing test: vault-era DB

- [x] In the core store tests, add a fixture that seeds a DB *before*
      `Store.open`: create `credentials` with the vault shape
      (`cipher TEXT NOT NULL`, no `secret`), and insert
      `meta('schemaVersion','3')` and a `meta('vaultMeta', ...)` row.
- [x] Assert `Store.open` succeeds and `addCredential({ label, kind,
      secret })` then `listCredentials()` returns the row.
- [x] Run it. It must fail with `no column named secret` — the same error
      the user hit. If it passes, the fixture does not reproduce the bug;
      fix the fixture before writing any code.

## Task 2 — shape check

- [x] Add a private helper `columnsOf(db, table): Promise<Set<string>>`
      backed by `PRAGMA table_info(<table>)`. Table names are literals in
      this file, never user input.
- [x] Unit-test it against a table created in the test, including the
      empty set for a table that does not exist.

## Task 3 — the repair

- [x] Add `repairCredentials(db)`:
      - columns empty or missing `secret` → `DROP TABLE IF EXISTS
        credentials`, run `MIGRATIONS[1]`, run the
        `credentials_updated_at` index statement, then `ALTER TABLE
        credentials ADD COLUMN passphrase TEXT`.
      - has `secret` but no `passphrase` → the `ALTER` alone.
      - otherwise → nothing.
- [x] Call it from `Store.open` after the `MIGRATIONS` loop.
- [x] Task 1's test goes green.

## Task 4 — delete the version ladder

- [x] Remove the `version === '1'` and `version === '2'` branches, the
      "New DB at version 3" comment and its `ALTER`, and the trailing
      unconditional `ALTER ... .catch(() => {})`.
- [x] `Store.open` keeps exactly one write of
      `meta.schemaVersion = SCHEMA_VERSION`, unconditional, after the
      repair.
- [x] Delete stale meta in the repair's drop branch: `STALE_META_KEYS`
      plus `'vaultMeta'`.
- [x] `Store.migrate()` becomes a thin call to the same repair, or is
      deleted if nothing calls it — grep first.
- [x] Full core suite green.

## Task 5 — regression coverage for the other shapes

- [x] Fresh empty DB opens, credential round-trips.
- [x] v2-shape DB (`secret`, no `passphrase`) opens, keeps its existing
      rows, and accepts a passphrase write.
- [x] Opening the same DB twice is a no-op the second time (idempotence).
- [x] Existing `hosts` and `snippets` rows survive a credentials repair.

## Task 6 — verify against the real profile

- [x] Copy the user's DB to a scratch path and open it with the built
      core; confirm the schema now has `secret` and that `vaultMeta` is
      gone.
- [x] Run the desktop app, add a host and a credential, confirm no IPC
      error.
- [x] Tick the boxes, update the Status row in
      `docs/superpowers/README.md`, commit plan with code.
