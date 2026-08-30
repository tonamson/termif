# Plan 6 — Local-only: one SQLite file, no vault, no Google

**Status:** not started. Written 2026-08-30.
**Spec:** [`specs/2026-08-30-termif-local-only-storage.md`](../specs/2026-08-30-termif-local-only-storage.md)
— read it first. It carries the reasoning and the accepted trade; this file is
only the order of operations.
**Blocks:** Plan 7 (live acceptance). Run this first or Plan 7's C-layer steps
will not match the app.

## Global constraints

Hold for every task:

1. **Test-first.** Write the failing test, watch it fail for the right reason,
   then make it pass. A test that passes the moment it is written tested nothing.
2. **Green at every commit.** Each task ends with `npm test` green in `packages/core`
   and in `apps/desktop`, and `npm run typecheck` clean in `apps/desktop`.
   **There is no root `package.json`** — this is not an npm workspace. Run every
   command from inside the package directory; `npm test -w <pkg>` fails with
   ENOENT. Deletion order
   below is chosen so this is achievable — do not reorder casually.
3. **Delete, do not stub.** No empty interface left "for later". If something
   has no caller after this plan, it leaves.
4. **Secrets stay out of logs.** Plaintext at rest does not license plaintext in
   a console line, an error message, or a thrown string. Check every `catch` you
   touch.
5. **Tick the checkbox and commit the plan file with the code it covers.**

## Baseline, measured 2026-08-30 by running it

Numbers to check the work against, not decoration.

    packages/core:   139 tests green, 12 files
    apps/desktop:    221 passed, 6 FAILING, 24 files
    core src:      2,573 lines across 15 files
    core tests:    ~1,900 lines across 12 files

Task 0 fixes those six. Expected after this plan: roughly 2,900 lines removed, 5 fewer source files in
core, 8 fewer test files, 2 dependencies dropped, 8 IPC channels gone.

## Reference inventory

Gathered by grep on 2026-08-30 so no reference is discovered late. If a file
here has moved by the time you execute, re-run the grep before trusting the list.

**`Vault` is referenced by:** `core/src/model.ts`, `core/src/index.ts`,
`core/src/i18n/en.ts`, `core/src/sheet/rows.ts`, `core/src/sheet/client.ts`,
`renderer/app/AppRoot.tsx`, `renderer/app/MainLayout.tsx`,
`renderer/state/hostStore.ts` (2), `renderer/state/connectFlow.tsx` (2),
`renderer/state/boot.ts` (3), `renderer/state/signIn.ts`,
`renderer/state/vaultStore.ts`, `renderer/views/UnlockScreen.tsx`,
`renderer/views/SetupScreen.tsx`.

**`SyncEngine` / `SheetClient` / `spreadsheetId`:** `renderer/state/boot.ts`,
`renderer/views/SignInScreen.tsx`, `main/googleAuth.ts`.

**`requestSync` callers:** `renderer/app/MainLayout.tsx`,
`renderer/state/hostStore.ts` (3), `renderer/state/snippetStore.ts` (3),
`renderer/views/SnippetPalette.tsx`.

**`credential.cipher` readers:** `core/src/model.ts`, `core/src/store.ts` (6),
`renderer/state/hostStore.ts` (`vault.encrypt` at line 99),
`renderer/state/connectFlow.tsx` (`vault.decrypt` at line 37).

**`platform.net` callers:** `renderer/state/boot.ts`,
`renderer/views/SignInScreen.tsx`. **Both are being deleted, so `net` becomes
dead** — this is why Task 6 removes it from the `Platform` interface too.

**`secureStore` callers:** `renderer/state/vaultStore.ts` (2),
`renderer/platform.ts`, `main/handlers.ts` (5), `main/index.ts` (4). All are in
the delete set.

## Task order and why

Bottom-up, so the type checker points at every remaining caller instead of
hiding them behind a still-compiling stub:

    1 model  →  2 store schema  →  3 known_hosts table  →  4 delete sync
    →  5 delete vault  →  6 main process  →  7 renderer boot  →  8 screens
    →  9 credential read path  →  10 known-hosts wiring  →  11 portability
    →  12 the record

Tasks 1–3 change shape while everything still compiles. Tasks 4–8 delete. Tasks
9–11 make the result actually work end to end. Task 12 updates the docs.

---

### Task 0 — get the baseline green first

**The desktop suite is red right now.** Six tests in `test/main/db.test.ts` fail
before a line of this plan is written:

    The module '.../better-sqlite3/build/Release/better_sqlite3.node'
    was compiled against a different Node.js version using
    NODE_MODULE_VERSION 130. This version of Node.js requires
    NODE_MODULE_VERSION 137.

`better-sqlite3` is a native module with one compiled binary. It is currently
built for Electron 33's Node ABI (130); Vitest runs on the system Node
(v24.19.0, ABI 137). One binary cannot satisfy both.

Do not start Task 1 on a red suite. A red baseline makes every later failure
ambiguous — you will not know whether you broke it or it was already broken.

- [ ] Reproduce: `cd apps/desktop && npm test`. Confirm exactly six failures,
      all in `db.test.ts`, all the ABI message above.
- [ ] Decide the fix and record it here. Three options:
      (a) `npm rebuild better-sqlite3` before tests and `npx electron-rebuild`
      before running or packaging the app — correct, but the binary has to be
      rebuilt on every switch, and whoever forgets gets a confusing crash;
      (b) run the desktop tests under Electron's Node instead of the system
      Node, so one binary serves both;
      (c) keep `better-sqlite3` out of the unit tests entirely — `db.test.ts` is
      the only file that touches it, and `sql.js` is already a dev dependency
      used by the fake platform. **Recommended:** (c) for the unit suite, with
      the real driver exercised by the e2e run and by Plan 7's live layers,
      which is where a native-module problem actually matters.
- [ ] Apply the chosen fix.
- [ ] `cd apps/desktop && npm test` → 227 passed, 0 failed.
- [ ] `cd packages/core && npm test` → 139 passed.
- [ ] `git commit -m "fix(desktop): make the test suite green on the system Node"`

### Task 1 — the credential model

- [ ] Failing test in `core/test/model.test.ts`: `storedCredentialSchema` parses
      `{ id, label, kind: 'password', secret: 'hunter2', updatedAt, deleted }`.
- [ ] Failing test: a payload carrying `cipher` and no `secret` is rejected, so
      a stale writer cannot silently produce a credential with no secret in it.
- [ ] Failing test: `secret` accepts a multi-line PEM private key unchanged —
      the old `cipher` field was `base64url` only, and a key pasted verbatim
      must survive the round trip.
- [ ] In `core/src/model.ts`: `cipher: base64Url` becomes `secret: z.string()`.
      Remove `vaultMetaSchema`, `DEFAULT_KDF_PARAMS`, `KdfParams`, `VaultMeta`.
      Leave `SCHEMA_VERSION` alone for now — Task 2 owns it.
- [ ] `npm test` in `packages/core` green.
- [ ] `git commit -m "feat(core): store credential secrets in the clear"`

### Task 2 — store schema and the version-2 migration

- [x] Failing test in `core/test/store.test.ts`: `saveCredential` with
      `secret: 'pw'` round trips through `getCredential` byte-identical.
- [x] Failing test: opening a database whose `meta.schemaVersion` is `1` yields
      version `2`, keeps every `hosts` and `snippets` row, and leaves
      `credentials` empty.
- [x] Failing test: opening a fresh database creates version 2 directly, with no
      migration path taken.
- [x] Failing test: `meta` no longer carries `kdfSalt`, `kdfParams`,
      `vaultCheck`, or `spreadsheetId` after a migration — stale keys are
      deleted, not left as litter.
- [x] In `core/src/store.ts`: rename the column in the `CREATE TABLE`, update
      the six `cipher` references, set `SCHEMA_VERSION = 2`, write the
      drop-recreate migration.
- [x] `git commit -m "feat(core): migrate the credentials table to version 2"`

### Task 3 — the `known_hosts` table

Added here, wired up in Task 10. Splitting them keeps this commit pure schema.

- [ ] Failing test: the table round trips `(host, port, algo, key, addedAt)`.
- [ ] Failing test: inserting the same `(host, port, algo)` twice replaces the
      key rather than duplicating the row — a host that rotates its key must not
      end up with two conflicting entries.
- [ ] Failing test: `listKnownHosts()` on an empty table returns `[]`, not
      `null` and not a throw.
- [ ] Implement the table and its two store methods:

          CREATE TABLE IF NOT EXISTS known_hosts (
            host     TEXT    NOT NULL,
            port     INTEGER NOT NULL,
            algo     TEXT    NOT NULL,
            key      TEXT    NOT NULL,
            added_at TEXT    NOT NULL,
            PRIMARY KEY (host, port, algo)
          )

- [ ] `git commit -m "feat(core): add a known_hosts table"`

### Task 4 — delete sync and the sheet client

Before the vault, because `sheet/rows.ts` and `sheet/client.ts` both reference
`Vault`; removing them first shrinks Task 5.

- [ ] Delete `core/src/sync.ts`, `core/src/sheet/` (three files), and the four
      test files: `sync.test.ts`, `sheetClient.test.ts`, `merge.test.ts`,
      `sheetRows.test.ts`.
- [ ] Prune `core/src/index.ts` and every `sync.*` key in `core/src/i18n/en.ts`.
- [ ] Failing-first check in `core/test/i18n.test.ts`: no exported key starts
      with `sync.`. Leftover strings are the classic half-removal.
- [ ] `npm test` in `packages/core` green.
- [ ] `git commit -m "refactor(core): remove Google Sheets sync"`

### Task 5 — delete the vault

- [ ] Delete `core/src/vault.ts` and `core/test/vault.test.ts`.
- [ ] Prune `core/src/index.ts`; remove every `vault.*` key from `i18n/en.ts`
      and the `vault_locked`, `vault_wrong_password`, `vault_bad_ciphertext`
      codes from `core/src/errors.ts` if nothing else raises them — grep first.
- [ ] Drop `@noble/ciphers` and `@noble/hashes` from
      `packages/core/package.json`, then `npm install` so the lockfile follows.
- [ ] Failing-first check in `i18n.test.ts`: no key starts with `vault.`.
- [ ] `npm test` in `packages/core` green. Core is now a local-only library.
- [ ] `git commit -m "refactor(core): remove the vault"`

### Task 6 — main process: Google, secure store, and the net bridge

- [ ] Failing test in `desktop/test/main/handlers.test.ts`: `handlerNames()`
      contains no `auth:*`, no `secure:*`, and no `net:request` channel, and
      still matches `CHANNELS` exactly. That equality assertion is the one that
      catches a channel removed from one list but not the other.
- [ ] Delete `main/googleAuth.ts`, `main/secureStore.ts`, `main/net.ts`, and
      `test/main/googleAuth.test.ts`.
- [ ] In `shared/ipc.ts`: remove the five `auth*` channels, the three `secure*`
      channels, `netRequest`, and the `DeviceFlowStart`, `DeviceFlowPoll`,
      `HttpRequestPayload`, `HttpResponsePayload` types plus the `auth`,
      `secure`, and `net` members of `TermifApi`.
- [ ] In `main/handlers.ts`: remove the nine handlers and the `secureStore` and
      `auth` fields of `HandlerDeps`.
- [ ] In `main/index.ts`: remove the `GoogleAuth` construction, the
      `createSecureStore` call, and both `TERMIF_GOOGLE_*` env reads.
- [ ] In `preload/index.ts`: remove the matching bridge members.
- [ ] In `core/src/platform.ts`: remove `net: HttpClient` and
      `secureStore: SecureStore` from `Platform`, and the `HttpClient` and
      `SecureStore` types if nothing else uses them.
- [ ] In `renderer/platform.ts`: remove the `net` and `secureStore` adapters;
      update `test/renderer/platform.test.ts` and the `fakePlatform` helper.
- [ ] `npm run typecheck` in `apps/desktop` clean.
- [ ] `git commit -m "refactor(desktop): remove Google auth, the secure store, and the net bridge"`

### Task 7 — renderer boot

- [ ] Failing test: `bootApp` returns an `App` with no `vaultStore` and no
      `sync`, and never reads the `spreadsheetId` meta key.
- [ ] Failing test: `bootApp` resolves with an empty database and no thrown
      error — first run must not depend on any meta row existing.
- [ ] Rewrite `renderer/state/boot.ts`: drop `SheetClient`, `SyncEngine`,
      `setSpreadsheet`, `SPREADSHEET_KEY`, `vaultStore`, and the `sync` field
      of `App`.
- [ ] Delete `renderer/state/vaultStore.ts`, `renderer/state/signIn.ts`,
      `test/renderer/vaultStore.test.ts`, `test/renderer/signIn.test.ts`.
- [ ] Remove every `requestSync` call in `state/hostStore.ts` (3),
      `state/snippetStore.ts` (3), `views/SnippetPalette.tsx`, and
      `app/MainLayout.tsx`.
- [ ] `git commit -m "refactor(desktop): boot straight into the host list"`

### Task 8 — screens

- [ ] Failing test: rendering `AppRoot` against an empty database shows the host
      list. Assert on the absence of any password field, not only on the
      presence of the list — the old flow's failure mode is a stuck screen.
- [ ] Delete `views/SetupScreen.tsx`, `views/UnlockScreen.tsx`,
      `views/SignInScreen.tsx`, `views/SyncBadge.tsx` and any test rendering
      them.
- [ ] `app/AppRoot.tsx`: one branch — loading, then `MainLayout`. No setup, no
      unlock, no lock action.
- [ ] `app/MainLayout.tsx`: remove the sign-in slot, the sync badge, and the
      `vaultStore` references.
- [ ] Remove the now-unused `.sign-in`, `.setup`, `.unlock`, and sync-badge
      rules from `renderer/styles/app.css`. Dead CSS reads as intentional to
      whoever comes next.
- [ ] `npm test` in `apps/desktop` green.
- [ ] `git commit -m "refactor(desktop): drop the setup, unlock, and sign-in screens"`

### Task 9 — the credential read and write path

- [ ] Failing test in `test/renderer/hostStore.test.ts`: saving a credential
      writes `secret` verbatim, with no encrypt step and no `vault()` dep.
- [ ] Failing test in the connect-flow test: connecting with a saved credential
      passes `credential.secret` to `ssh.connect` unchanged.
- [ ] Failing test: a host whose `authRef` points at a deleted credential fails
      with a clear error rather than connecting with an empty password. The old
      code raised `vault_locked` here; that code is gone, so this path needs its
      own error and its own test.
- [ ] Update `state/hostStore.ts` (drop the `vault` dep, write `secret`) and
      `state/connectFlow.tsx` (`resolveCredential` loses its `vault` parameter
      and its decrypt call).
- [ ] `views/HostForm.tsx` writes `secret` directly.
- [ ] Check every `catch` on this path: no error message may include the secret.
- [ ] `git commit -m "feat(desktop): read and write credentials in the clear"`

### Task 10 — known-hosts wiring

Spec §6. The database is the source of truth; the file is a derived cache.

- [ ] Failing test: rendering N rows produces N lines of OpenSSH-format
      `known_hosts`, and an empty table produces an empty file rather than
      throwing.
- [ ] Failing test: a non-22 port is rendered in the bracketed
      `[host]:port` form. Getting this wrong makes every non-default-port host
      re-prompt, and it looks like the copy failed rather than like a formatting
      bug.
- [ ] Failing test in `handlers.test.ts`: `ssh:trustHostKey` calls the native
      side **and** inserts the row. Assert both; asserting only the insert
      passes while the live connection stays untrusted.
- [ ] Failing test: boot renders the file before `initNative` is called. Assert
      the call order explicitly — this is the plan's most likely silent failure.
- [ ] Implement: render-on-boot in `main/index.ts`, insert-on-trust in
      `main/handlers.ts`.
- [ ] Migration: on finding a `known_hosts` file with an empty table, import its
      lines once, then leave the file alone.
- [ ] `git commit -m "feat: keep trusted host keys in the database"`

### Task 11 — portability, end to end

The point of the whole plan, and the only task that proves it.

- [ ] Failing test: given a `termif.sqlite` copied from a different user-data
      directory and nothing else — no `secure.json`, no `known_hosts` file —
      `bootApp` lists that database's hosts, returns their secrets, and its
      trusted host keys are present.
- [ ] Rewrite `e2e/smoke.spec.ts`: no vault steps. Launch, add a host, restart,
      the host is still listed.
- [ ] Add to the e2e run: copy the resulting `termif.sqlite` into a second
      temporary user-data directory, launch there, and assert the host appears
      without any prompt.
- [ ] Write `docs/portability.md`: which file, where it lives on macOS and
      Windows, how to copy it safely, and the warning from spec §3 — it holds
      every SSH password in plaintext, so it does not belong in a git repo, a
      shared drive, a cloud-sync folder, or a bug report.
- [ ] `git commit -m "feat: make the database the whole configuration"`

### Task 12 — the record

- [ ] Add a reversal note to the top of §4 and §7 of the 2026-08-28 spec,
      pointing at the new spec. Keep the bodies.
- [ ] `docs/superpowers/README.md`: mark Plan 6 complete with the real test
      counts, not the estimates in this file.
- [ ] `grep -rin "vault\|spreadsheet\|oauth\|argon2\|noble" packages apps docs
      --exclude-dir=node_modules` returns only deliberate historical mentions.
      Anything else is a leftover.
- [ ] Re-measure: line count, test count, IPC channel count. Record them here
      next to the estimates so the next plan's estimates are better calibrated.
- [ ] `git commit -m "docs: record the local-only decision"`

---

## Risks

1. **The security trade itself.** Plaintext SSH passwords for a root account.
   Accepted by the project owner on 2026-08-30 with the consequences stated in
   spec §3. Not a bug to be fixed later — a decision to be honoured or reversed
   deliberately.
2. **Task 10's boot order.** `initNative` before the file is rendered gives
   `ssh-core` an empty trust set and every host re-prompts. The symptom looks
   like "copying the database did not work" and sends the debugging in the wrong
   direction. This is why Task 10 asserts call order rather than end state.
3. **Half-removal.** Deleting `SyncEngine` but leaving `platform.net`, or
   deleting `SignInScreen` but leaving its i18n keys and CSS. Tasks 4, 5, 8, and
   12 each carry a specific grep for this.
4. **The migration destroys saved passwords.** Correct now, unforgivable once
   anyone real is using the app. Land it before that is true.
5. **Test count going down looks like tests were lost.** It is the point: ~800
   lines of test covered features that no longer exist. Task 12 records the
   before and after so the drop reads as deletion, not regression.

## Definition of done

- [ ] Task 0 done: `apps/desktop` is 227/227 green before any deletion starts.
- [ ] All twelve tasks committed, each with a green suite.
- [ ] `npm test` green in both workspaces; `npm run typecheck` clean.
- [ ] `npm run package` in `apps/desktop` produces a `.dmg` with no
      `TERMIF_GOOGLE_*` variable anywhere in the build.
- [ ] The copy-the-database test in Task 11 passes on a real second directory.
- [ ] `docs/portability.md` exists and carries the plaintext warning.
- [ ] Plan 7 is unblocked.
