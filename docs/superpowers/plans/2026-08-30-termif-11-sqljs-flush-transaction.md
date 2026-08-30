# Plan 11 — CI red: `no such table: main.hosts` in the desktop portability test

No spec. This is a defect report and its fix, recorded because the cause
is a non-obvious property of `sql.js` that will bite the next person who
writes a file-backed fake `LocalDb`.

## Symptom

`desktop` workflow, both `macos-latest` and `windows-latest`, exit code 1:

```
test/renderer/portability.test.ts > portability — the database is the whole configuration
Error: no such table: main.hosts
  at Object.exec test/renderer/portability.test.ts:50:24
  at runMigrations packages/core/dist/index.js:275:41
  at _Store.open packages/core/dist/index.js:346:5
  at Module.bootApp src/renderer/state/boot.ts:22:17
```

Reproduces locally — not a CI-only or platform-only failure. The two
`Node.js 20 is deprecated` annotations on the same run are warnings and
did not turn the job red.

## Cause

`sql.js`'s `Database.export()` closes the SQLite handle and reopens it
from the serialized bytes. Reopening discards any transaction that was
still open, so every statement since the last `BEGIN` is rolled back.

The test's file-backed platform flushes to disk after every DDL/DML
statement, and `flush()` calls `export()`. Plan 10's `runMigrations`
wraps each migration entry in `BEGIN` / `COMMIT`. Composed:

1. `runMigrations` issues `BEGIN`.
2. `CREATE TABLE hosts` runs; the harness flushes; `export()` reopens the
   database and rolls the transaction back — `hosts` is gone.
3. `CREATE INDEX hosts_updated_at ON hosts` fails: no such table.

The migration runner is correct. The test harness is what breaks the
transaction, so `packages/core` needs no change.

## Fix

`apps/desktop/test/renderer/portability.test.ts` only:

- [x] Track transaction depth with an `inTx` flag in `makeFilePlatform`.
- [x] `flush()` returns early while `inTx` — never `export()` mid-transaction.
- [x] `db.exec` sets `inTx` on `BEGIN`, clears it on `COMMIT` / `ROLLBACK`,
      and flushes on `COMMIT` so the file still tracks committed state.
- [x] `db.transaction` sets and clears the same flag around its own
      `BEGIN` / `COMMIT` / `ROLLBACK`.

## Verification

- [x] `npx vitest run test/renderer/portability.test.ts` — 1 passed.
- [x] `npm test` in `apps/desktop` — 30 files, 256 tests passed.

## Follow-up, not done here

- `node-version: 20` in all three workflows draws a deprecation warning
  from `actions/checkout@v4` and `actions/setup-node@v4`. Cosmetic; bump
  to 22 when someone is already touching CI.
