# Termif — local-only storage

**Date:** 2026-08-30
**Status:** design of record. Supersedes §4 (vault and secret handling) and §7
(Google Sheets sync) of
[`2026-08-28-termif-crossplatform-ssh-design.md`](2026-08-28-termif-crossplatform-ssh-design.md).
Those sections stay in the older spec as the record of what was replaced.
**Implemented by:** [Plan 6](../plans/2026-08-30-termif-06-local-only.md).
**Verified by:** [Plan 7](../plans/2026-08-30-termif-07-live-acceptance.md).

## 1. The decision

Termif stores everything in one SQLite file on the user's own machine, in the
clear. There is no master password, no encryption layer, and no cloud sync.

    ~/Library/Application Support/Termif/termif.sqlite      # macOS
    %APPDATA%/Termif/termif.sqlite                          # Windows

Copy that file to another machine, put it in the same place, and the app is
fully configured: hosts, credentials, snippets, and trusted host keys.

## 2. Why the earlier design is being reversed

The original design (§4, §7) had a master password feeding Argon2id, an
XChaCha20-Poly1305 vault around every credential, and Google Sheets as the sync
transport. It works — 138 core tests cover it — and it is being removed anyway,
for three reasons the owner weighed on 2026-08-30:

1. **The password buys less than it costs here.** The threat it defends against
   is an attacker who has the database file but not the running machine. On a
   single-user desktop with FileVault or BitLocker on, that attacker already had
   to get past full-disk encryption and the OS account. The password is a daily
   toll on the owner for a case the OS already covers.
2. **Sync was the expensive half of the project.** `SheetClient`, `mergeRows`,
   `SyncEngine`, the row codecs, and the device-flow OAuth stack are ~1,100
   lines of source and ~800 lines of test, plus a Google Cloud project, an OAuth
   consent screen, and a client id that has to be injected into a packaged
   build. Copying a file does the same job for this user.
3. **Portability was the actual goal all along.** Sync was the means. A single
   portable file is a shorter path to it.

## 3. What is given up, explicitly

This is a real reduction in security, stated so nobody has to discover it later:

- `termif.sqlite` contains every stored SSH password and private key as
  readable text. `sqlite3 termif.sqlite 'select * from credentials'` prints them.
- Anything that can read the file has those secrets: another process running as
  the same user, malware, a Time Machine or File History snapshot, a backup that
  leaves the machine, or any folder-sync client whose directory it lands in.
- The file is therefore a secret in its own right. It must not go into a git
  repository, a shared drive, a cloud-sync folder, a bug report, or a chat
  message.
- There is no multi-device sync and no conflict resolution. Two machines editing
  two copies diverge silently; the last file copied wins.
- Losing the file loses everything. There is no server-side copy.

The mitigations are the operating system's, not the app's: full-disk encryption,
the file's `0600` permissions, and the OS account password.

## 4. Data model

One database, five tables. `hosts`, `credentials`, `snippets`, and `meta` exist
today; `known_hosts` is new.

    hosts        (id, label, hostname, port, username, auth_ref, tags,
                  group_id, updated_at, deleted)
    credentials  (id, label, kind, secret, updated_at, deleted)
    snippets     (id, label, body, tags, updated_at, deleted)
    known_hosts  (host, port, algo, key, added_at)   PRIMARY KEY (host, port, algo)
    meta         (key, value)

Changes from the current schema:

- `credentials.cipher` becomes `credentials.secret`, holding the password or the
  private key material verbatim. `kind` still distinguishes `password` from
  `key`.
- `known_hosts` is new — see §6.
- `meta` keeps `schemaVersion` and drops `kdfSalt`, `kdfParams`, `vaultCheck`,
  and `spreadsheetId`.
- `SCHEMA_VERSION` goes from 1 to 2.

The `updated_at` and `deleted` columns stay. They cost nothing, and they are
what a future sync would need; removing them is the one deletion that would be
expensive to undo.

## 5. Migration

Version 1 databases exist only in this repo's development checkouts. Opening one
at version 2:

1. `hosts`, `snippets`, and `meta` are kept as they are.
2. `credentials` is dropped and recreated with the `secret` column. **Saved
   passwords are lost and must be entered again, once.**
3. Any `known_hosts` file already in the user-data directory is imported into
   the new table.
4. `schemaVersion` is set to 2.

No decrypting migration is written. Decrypting requires the master password,
which is the thing being removed. Writing one would mean keeping the entire
Argon2id and XChaCha20 stack alive to serve a one-time path for a handful of
development machines.

## 6. Known hosts

Trusted host keys must travel with the database, or "copy one file" is false and
every host re-prompts trust-on-first-use on the new machine.

`ssh-core` keeps its file-based interface — `init(knownHostsPath)` — unchanged.
No Rust code changes. The database is the source of truth and the file is a
derived cache:

- **At boot:** read the `known_hosts` table, write the OpenSSH-format file into
  the user-data directory, then call `ssh:init` with its path. That order is
  load-bearing: calling `init` first hands `ssh-core` an empty trust set.
- **On trust:** `ssh:trustHostKey` calls the native side as it does today, then
  inserts the row.
- **The file is disposable.** Deleting it is harmless; the next boot rebuilds it
  from the table.

## 7. What leaves the codebase

| Removed | Reason |
|---|---|
| `Vault`, Argon2id, XChaCha20-Poly1305, `@noble/*` | no encryption layer |
| Master-password setup and unlock screens | no password |
| Device-key "remember on this device" | nothing to remember |
| `SecureStore` and the OS keychain path | its only two users were the vault key and the Google token |
| `SheetClient`, `SyncEngine`, `mergeRows`, the row codecs | no sync |
| `GoogleAuth`, the device flow, the sign-in screen | no Google |
| `Platform.net` and the `net:request` IPC channel | its only callers were Google's |

The `Platform` interface loses `net` and `secureStore`. Both were there to serve
the two features being removed; keeping empty seams for a sync that may never
return is exactly the speculative weight this reversal is shedding.

## 8. Constraints that survive unchanged

None of the reasons the architecture is shaped this way have gone away:

1. No Electron, Node, or `ipcRenderer` import inside `packages/core`.
2. No configuration read inside `ssh-core`; input arrives as parameters.
3. No callback, closure, or object across the FFI boundary.
4. No ANSI parsing in core.
5. Secrets still never touch a log line, an error message, or a crash report.
   Plaintext at rest does not license plaintext in the console.

## 9. If sync is ever wanted again

The path back is not blocked. `updated_at` and `deleted` are still on every row,
which is the schema half of a sync. What would be rebuilt is the transport and
a conflict rule — and at that point the encryption question returns with it,
because a row leaving the machine is a different threat model from a row sitting
on it. Nothing in this spec should be read as "encryption was a bad idea"; it
was the right idea for a design that shipped rows to Google, and it stopped
earning its keep when they stopped leaving the machine.
