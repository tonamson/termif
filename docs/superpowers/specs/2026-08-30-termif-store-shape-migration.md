# Schema migrations: a numbered runner, adopted once by shape

Status: proposed, 2026-08-30. Supersedes the version-ladder in
`Store.open` (`packages/core/src/store.ts`) and `SCHEMA_VERSION` in
`packages/core/src/model.ts`.

## The bug that forced this

    Error invoking remote method 'termif:db:exec':
    SqliteError: table credentials has no column named secret

Reproduced on a real profile at
`~/Library/Application Support/@termif/desktop/termif.sqlite`:

    sqlite> .schema credentials
    CREATE TABLE credentials (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL,
      cipher TEXT NOT NULL, updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0, passphrase TEXT);
    sqlite> select * from meta;
    vaultMeta|[["schema_version","1"],["kdf_salt",...],["vault_check",...]]
    schemaVersion|3

The table is the pre-local-only vault shape: `cipher`, not `secret`.
`meta.schemaVersion` already reads `3`, so every branch in `Store.open`
is skipped, and `CREATE TABLE IF NOT EXISTS credentials` is a no-op on an
existing table. `#writeCredential` then inserts into `secret` and fails.

Root cause: **the version number is hand-written, so it can disagree with
the file it claims to describe.** The vault-era build stamped
`schemaVersion=3` while leaving the vault-era table in place. A number
nobody derives is a number that will eventually lie.

## The design

Every schema change ships as one numbered step in an append-only list,
and the app runs the unapplied tail on startup — the discipline any
backend gets from a `migrations` table. Three rules make it hold:

1. **`PRAGMA user_version` is the only version stored in a DB file.**
   SQLite maintains this integer per file. It replaces
   `meta.schemaVersion`, which is deleted. No extra table is needed for
   what SQLite already carries.
2. **The current version is derived, never typed.** It is
   `MIGRATIONS.length`. Adding a step advances the version by
   construction, so no commit can add a migration and forget to bump.
   `SCHEMA_VERSION` stops being a hand-maintained literal.
3. **Schema version is independent of the app's release version.**
   `apps/desktop/package.json` versions the build for users; the schema
   version counts migrations. Most releases change no schema. Tying them
   together would force empty migrations on every release bump and would
   silently skip a migration whenever a release forgot to bump.

### The runner

```ts
// Append only. Never edit or reorder an entry that has shipped.
const MIGRATIONS: string[][] = [
  /* 0 */ [ /* baseline: hosts, credentials(secret), snippets, known_hosts, meta, indexes */ ],
  /* 1 */ [`ALTER TABLE credentials ADD COLUMN passphrase TEXT`],
]
export const SCHEMA_VERSION = MIGRATIONS.length
```

On open, read `PRAGMA user_version` and run steps from that index to the
end. Each step is its own transaction that ends by writing the new
`user_version`, so a failure at step 5 leaves a file honestly at 5, not
half-migrated. Failures propagate — the current code's
`.catch(() => {})` is what let a broken file keep running until it
surfaced as an IPC error much later.

`PRAGMA user_version = ?` does not accept a bound parameter; the value is
interpolated. It is a loop index, never user input.

### Adoption: the one and only shape check

An existing profile reports `user_version = 0` while already holding
tables. Running step 0 against it would collide. So exactly once, on
first open under the new runner, the file's real version is *observed*
rather than trusted:

| Observed via `PRAGMA table_info` | Adopted as | Then |
|---|---|---|
| no `credentials` table | 0 | runner creates everything |
| `credentials` has `secret` and `passphrase` | 2 | nothing to run |
| `credentials` has `secret`, no `passphrase` | 1 | runner adds `passphrase` |
| `credentials` missing `secret` (vault-era `cipher`) | repaired, then 2 | see below |

After adoption the shape check is never consulted again. It exists to
buy the right to trust a counter forever after.

### The vault-era file

`cipher` holds AES payload keyed by a master password that the local-only
spec removed. There is no key left, so the value cannot be migrated into
`secret` — and renaming the column would be worse than dropping it, since
the app would then read ciphertext as a plaintext password and send it to
a server. The table is dropped and recreated at the current shape, and
the stale vault metadata goes with it: `vaultMeta` plus the existing
`STALE_META_KEYS`.

`hosts` and `snippets` never changed shape and are untouched. A host's
`auth_ref` will dangle until the user re-adds a credential; a dangling
`auth_ref` already renders as "no credential" today.

## After this lands

Changing the schema means appending one array entry. Nothing else — no
version constant to bump, no branch to add, no build step to remember.
