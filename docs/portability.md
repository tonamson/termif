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
