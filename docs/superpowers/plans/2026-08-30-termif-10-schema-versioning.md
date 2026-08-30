# Plan 10 — numbered migration runner on `PRAGMA user_version`

Spec: [`specs/2026-08-30-termif-schema-versioning.md`](../specs/2026-08-30-termif-schema-versioning.md)

Replaces the hand-written version constant and the `if (version === ...)`
ladder with an append-only migration list, so every later schema change
is one array entry and one test.

**Runs after Plan 9.** Plan 9 fixes the broken profile and lands the
`PRAGMA table_info` shape check; this plan reuses that check as its
one-time adoption step. Do not start until Plan 9 is green.

Work is in `packages/core/src/store.ts`, `packages/core/src/model.ts`,
and the core store tests. Test-first; each task is one commit.

## Task 1 — the runner, behind its own tests

- [x] Restructure `MIGRATIONS` from `string[]` to `string[][]`: entry 0
      is the current baseline (hosts, credentials with `secret`,
      snippets, known_hosts, meta, the three indexes); entry 1 is
      `ALTER TABLE credentials ADD COLUMN passphrase TEXT`.
- [x] Write `runMigrations(db)`: read `PRAGMA user_version`, run each
      unapplied entry inside `BEGIN` / `COMMIT`, writing
      `PRAGMA user_version = <n+1>` in the same transaction; `ROLLBACK`
      and rethrow on failure. No `.catch(() => {})`.
- [x] Tests, written first: a fresh DB reaches
      `user_version === MIGRATIONS.length`; a second run applies nothing;
      a deliberately failing entry leaves `user_version` at the last good
      step, leaves that step's tables untouched, and the error propagates
      out of `Store.open`.

## Task 2 — one derived version

- [x] Export `SCHEMA_VERSION = MIGRATIONS.length` from `store.ts`.
- [x] Delete the literal `SCHEMA_VERSION = 3` from `model.ts`; grep for
      importers first — today only `store.ts` reads it.
- [x] Test that appending a throwaway entry to `MIGRATIONS` raises
      `SCHEMA_VERSION` without any other edit.

## Task 3 — adoption, once

- [x] Add `adopt(db)`, which runs only when `user_version === 0` and sets
      it from the shape observed by Plan 9's `columnsOf`: no
      `credentials` table → 0; `secret` + `passphrase` → 2; `secret`
      only → 1.
- [x] `Store.open` becomes `adopt(db)` then `runMigrations(db)`.
- [x] Delete the `meta.schemaVersion` row during adoption. `user_version`
      is the only version a DB file carries.
- [x] Tests: a DB at each of the three shapes adopts the right number,
      then runs exactly the steps it still owes, and its rows survive.

## Task 4 — delete what the runner replaces

- [x] Remove the `version === '1'` / `version === '2'` branches, the
      "New DB at version 3" comment and its `ALTER`, the trailing
      unconditional `ALTER ... .catch(() => {})`, and every write of
      `meta.schemaVersion`.
- [x] `Store.migrate()` becomes a call to `runMigrations`, or is deleted
      if nothing calls it — grep first.
- [x] Confirm Plan 9's vault-era regression test is still green: adoption
      must not undo that repair.
- [x] Full core suite green.

## Task 5 — prove a data migration works, once, on a throwaway step

- [x] Add a temporary entry that does a full table rewrite (create new,
      `INSERT ... SELECT` with a transform, drop, rename, recreate the
      index) against a scratch table the app does not use.
- [x] Test: rows survive with the transform applied, and the index exists
      afterwards — the step that is easiest to forget.
- [x] Delete the temporary entry and its test before committing; it
      exists to prove the pattern, not to ship. Record the working
      pattern in the docs note from Task 6 instead.

## Task 6 — write the rule down where the next change will look

- [x] Add a "Changing the schema" section to the repo docs: append one
      entry, never edit a shipped entry, never bump a version by hand,
      include the table-rewrite snippet from Task 5, and note that the
      release version in `apps/desktop/package.json` is deliberately
      unrelated.
- [x] Surface both numbers together for bug reports: the app's release
      version and the DB's `user_version`, in whatever About/diagnostics
      surface exists — add the smallest one that does not exist yet.
- [x] Tick the boxes, update the Status row in
      `docs/superpowers/README.md`, commit plan with code.
