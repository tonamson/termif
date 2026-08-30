# Schema versioning: a numbered migration runner

Status: proposed, 2026-08-30. Follows
[`2026-08-30-termif-store-shape-migration.md`](2026-08-30-termif-store-shape-migration.md),
which repairs one broken profile. This spec answers the general question
that bug exposed: how does *every* future schema change ship?

## The problem

Termif stores hosts, credentials and snippets in one SQLite file that
lives on the user's machine across upgrades. A release that changes the
schema must find a file written by an older release and bring it forward,
unattended, on first launch. That is the discipline a NestJS/TypeORM app
gets from a `migrations` table; this codebase has nothing equivalent.

What it has instead is a hand-written constant (`SCHEMA_VERSION = 3` in
`packages/core/src/model.ts`), a hand-written mirror of it in the DB
(`meta.schemaVersion`), and a ladder of `if (version === '1')` branches in
`Store.open`. That arrangement already produced one corrupt profile: a
build stamped `schemaVersion=3` onto a database that was not at 3, and
every migration branch was skipped from then on.

The lesson is not "that branch was wrong". It is that **a version nobody
derives is a version that will eventually lie.**

## The design

### 1. One list, append-only

Every schema change is one entry in an ordered array of SQL statements.

```ts
// Append only. Never edit or reorder an entry that has shipped.
const MIGRATIONS: string[][] = [
  /* 0 */ [ /* baseline: hosts, credentials, snippets, known_hosts, meta, indexes */ ],
  /* 1 */ [`ALTER TABLE credentials ADD COLUMN passphrase TEXT`],
]
```

Editing a shipped entry is the one unrecoverable mistake: machines that
already ran it will never run it again, so the fleet splits into two
schemas that both believe they are current. A correction ships as a new
entry.

### 2. The version is derived, never typed

`SCHEMA_VERSION = MIGRATIONS.length`. Adding a migration advances the
version by construction, so no commit can add a step and forget to bump —
the failure mode that produced the corrupt profile. The literal in
`model.ts` is deleted.

### 3. `PRAGMA user_version` is the only version inside a DB file

SQLite maintains this integer per file, for exactly this purpose. It
replaces `meta.schemaVersion`, which is deleted. No `migrations` table is
needed to store what SQLite already carries; a table would be worth its
cost only if we needed per-step timestamps or checksums, and we do not.

### 4. Schema version is independent of the release version

`apps/desktop/package.json` (`0.1.0` today) versions the build for users.
The schema version counts migrations. They move at different rates and
must not be coupled:

- most releases change no schema, so coupling forces empty migrations on
  every release bump;
- a release that forgets to bump would silently skip a migration — the
  same class of failure as the hand-written constant.

The two meet in exactly one place: a released build reports both, so a
bug report says which code is running against which schema.

### 5. One transaction per step, and failures propagate

Each entry runs inside `BEGIN` / `COMMIT` that also writes the new
`user_version`. A failure at step 5 rolls back and leaves a file honestly
at 5 rather than half-migrated at 6. The error propagates out of
`Store.open` and is shown; the current code's `.catch(() => {})` is
precisely what let a broken file keep running until the damage surfaced
much later as an IPC error the user could not act on.

`PRAGMA user_version = ?` does not accept a bound parameter, so the value
is interpolated. It is a loop index, never user input.

### 6. Data migrations, not just shape

`ALTER TABLE ADD COLUMN` / `RENAME COLUMN` / `DROP COLUMN` cover most
steps. When a change cannot be expressed that way — a type change, a new
`NOT NULL`, a changed primary key — the entry is SQLite's table rewrite:
create the new table, `INSERT ... SELECT` with the transform in the
`SELECT`, drop the old, rename, and **recreate every index and trigger**,
which `DROP TABLE` removes. When the transform cannot be written in SQL
at all, the entry is a function rather than a string, run inside the same
transaction. Both stay one numbered step.

## Adoption

Every profile in the wild reports `user_version = 0` while already
holding tables, so the runner cannot simply start at 0. Exactly once, on
first open under this design, the file's true version is *observed* from
its shape — the `PRAGMA table_info` check that Plan 9 already
introduces — and `user_version` is set to match. After that the shape
check is never consulted again. It exists to buy the right to trust a
counter forever after.

## After this lands

Changing the schema is: append one entry to `MIGRATIONS`, write a test
that opens a DB at the previous version and asserts the data survives.
Nothing else — no constant to bump, no branch to add, no release step to
remember.
