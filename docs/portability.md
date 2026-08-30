# Portability — one file, whole configuration

Termif keeps everything in a single SQLite file on your machine. No cloud
account, no master password, no extra file to remember.

## Which file

`termif.sqlite` — hosts, credentials (passwords and private keys), snippets,
and trusted host keys all live in this one file.

## Where it lives

- **macOS:** `~/Library/Application Support/Termif/termif.sqlite`
- **Windows:** `%APPDATA%\Termif\termif.sqlite` (e.g. `C:\Users\you\AppData\Roaming\Termif\termif.sqlite`)

> The directory is Electron's `app.getPath('userData')`. The file is created
> on first launch if it does not exist.

## How to copy it safely

1. **Quit Termif** on the source machine (so the write-ahead log is checkpointed
   and the file is not being written).
2. Copy `termif.sqlite` to the same location on the destination machine. Create
   the `Termif` directory if it does not exist.
3. Launch Termif on the destination. Hosts, credentials, and trusted host keys
   appear immediately — no setup prompt, no password, no sign-in.

If the destination already has a `termif.sqlite`, back it up first; the last
file copied wins (there is no merge).

You can also keep a backup by copying the file anywhere else while Termif is
quit. Restoring is the same: quit, replace, launch.

No other file is needed. In particular you do **not** need to copy
`secure.json` (removed) or a `known_hosts` file — trusted keys are in the
database and the `known_hosts` file is rebuilt from it on every boot.

## ⚠️ Warning — this file holds every SSH password in plaintext

`sqlite3 termif.sqlite 'select * from credentials'` prints them. Anything that
can read the file has those secrets: another process running as the same user,
malware, a Time Machine or File History snapshot, a backup that leaves the
machine, or any folder-sync client whose directory it lands in.

Therefore `termif.sqlite` is itself a secret. **Do not** put it in:

- a git repository
- a shared drive
- a cloud-sync folder (Dropbox, iCloud Drive, OneDrive, etc.)
- a bug report, chat message, or screen recording

Mitigations are the operating system's, not the app's: full-disk encryption
(FileVault on macOS, BitLocker on Windows), the file's `0600` permissions, and
the OS account password.

Losing the file loses everything. There is no server-side copy. Two machines
editing two copies diverge silently; the last file copied wins.

## Changing the schema

All schema changes live in `packages/core/src/store.ts` as `MIGRATIONS: string[][]`
— one inner array per migration, append-only. Never edit or reorder a shipped
entry; a correction ships as a new entry.

- `SCHEMA_VERSION = MIGRATIONS.length` — never bump a version by hand.
- `PRAGMA user_version` is the only version stored in a DB file; the old
  `meta.schemaVersion` row is deleted on adoption.
- The release version in `apps/desktop/package.json` is deliberately unrelated;
  most releases change no schema and must not force empty migrations.
- Simple step: `ALTER TABLE … ADD COLUMN` / `RENAME COLUMN` / `DROP COLUMN`.
- Complex step (type change, new `NOT NULL`, PK change): table rewrite:

  ```ts
  [
    `CREATE TABLE t_new (id TEXT PRIMARY KEY, val TEXT NOT NULL)`,
    `INSERT INTO t_new (id, val) SELECT id, UPPER(val) FROM t`,
    `DROP TABLE t`,
    `ALTER TABLE t_new RENAME TO t`,
    `CREATE INDEX IF NOT EXISTS t_idx ON t (val)`,
  ]
  ```

  Recreate every index/trigger after `DROP TABLE` — they are removed with it.
  When SQL cannot express the transform, the entry is a function run inside
  the same `BEGIN`/`COMMIT` that writes the new `user_version`.

Each migration runs in its own `BEGIN`/`COMMIT` that also writes
`PRAGMA user_version = n+1`; a failure rolls back and the error propagates
out of `Store.open` — no `.catch(() => {})`.

## Diagnostics for bug reports

A bug report should include both:

- the app release version (`apps/desktop/package.json` / `app.getVersion()`,
  e.g. `0.1.0`), and
- the DB schema version (`PRAGMA user_version`, exposed as `SCHEMA_VERSION`
  in code and via `window.termif.app.getVersions()`).

The two move at different rates and are shown together by
`termif:app:getVersions` (main) / `window.termif.app.getVersions()` (renderer).

## Debug logs

Termif writes all logs to a file for debugging:

- **macOS (dev / packaged):** `~/Library/Application Support/@termif/desktop/logs/termif.log`
  (packaged `Termif` build uses the same path; if you see `Termif/logs` it is an old install — use `getLogPath()` to confirm)
- **Windows:** `%APPDATA%\@termif\desktop\logs\termif.log` (`%APPDATA%\Termif\logs\termif.log` on older builds)

The file contains timestamped entries for app start, DB migrations, SSH
connect/disconnect (host, port, fingerprint, errors), DB exec/transaction,
and renderer connect attempts. Uncaught exceptions and unhandled rejections
are also captured. The file is rotated at 5 MB (keeps 5 old files).

From the renderer: `await window.termif.app.getLogPath()` returns the path,
`await window.termif.app.openLog()` opens it in the OS, and
`window.termif.app.log(level, scope, message)` appends a line.
From the main process: `writeLog(level, scope, message)` in
`apps/desktop/src/main/logger.ts`.
