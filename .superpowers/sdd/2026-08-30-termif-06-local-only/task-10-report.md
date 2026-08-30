# Task 10 Report — known-hosts wiring

## Status: done

## What was changed
- `apps/desktop/src/main/knownHosts.ts` (new, 108→130 lines): `formatKnownHostsLine` (port 22 → `host algo key`, else `[host]:port algo key`), `parseKnownHostsLine` (bracketed/non-bracketed, skips comments/blanks), `ensureTable` (CREATE IF NOT EXISTS), `renderKnownHostsFile` (SELECT + JS sort → write `join('\n')` or '' for empty, mkdir recursive), `migrateKnownHostsFromFile` (if `SELECT host` empty → readFile, split lines, parse, INSERT ON CONFLICT, ENOENT → no throw), `syncKnownHosts` (migrate then render), `prepareKnownHosts` (join userData/`known_hosts` + legacy `termif_known_hosts` fallback, sync, legacy import if still empty, then `initFn(knownHostsPath)` — order is render before init).
- `apps/desktop/src/main/handlers.ts:65` — `ssh:trustHostKey` now `await native().trustHostKey(...)` then `await deps.db.exec(INSERT INTO known_hosts ... ON CONFLICT DO UPDATE, [host, port, algo, fingerprint, ISO now])`.
- `apps/desktop/src/main/index.ts:5` — import `prepareKnownHosts` + `initNative`; `whenReady` now `await prepareKnownHosts(db, userData, initNative)` before `registerHandlers`. Export path via `prepareKnownHosts` for testability.
- `apps/desktop/src/renderer/main.tsx:20` — removed `await api.ssh.init('termif_known_hosts')`; main process now owns init, renderer boot no longer races.
- `apps/desktop/test/__mocks__/better-sqlite3.ts` — fixed composite PK parsing (extract `PRIMARY KEY (a,b,c)` before splitting columns, skip `PRIMARY` pseudo-column, stash `compositeKeys`, clone preserves it), added DELETE/UPDATE stubs, ON CONFLICT upsert for composite keys.
- `apps/desktop/test/main/knownHosts.test.ts` (new, 13 tests): empty table → empty file not throw; N rows → N OpenSSH lines; non-22 → `[host]:port`; format/parse unit tests; migrate imports when empty, skips when not empty (file untouched), ignores comments/blanks, ENOENT not throw; sync renders after migrate; boot renders before init (prepareKnownHosts writes file before fakeInit sees it).
- `apps/desktop/test/main/handlers.test.ts` — added `vi.mock('electron')` + `vi.mock('../../src/main/native.js')` with `mockTrust`, new `ssh:trustHostKey` test asserts both `mockTrust` called with `(host, port, algo, fingerprint)` and `db.exec` INSERT with correct params.
- `docs/superpowers/plans/2026-08-30-termif-06-local-only.md` — Task 10 checkboxes ticked.

## Verification
- `apps/desktop: npm test` — 21 passed, 206 passed (was 20/192 before Task 10; +1 file, +14 tests, 0 failures).
- `packages/core: npm test` — 7 passed, 83 passed (store known_hosts still 15 tests, unchanged).
- `npm run typecheck` in `apps/desktop` — clean (fixed mock compositeKeys cast and handler param cast, index.ts 3-arg call).
- Manual: `readFile` after `prepareKnownHosts` contains expected lines before init callback returns — proves order.

## Evidence
- `apps/desktop/src/main/knownHosts.ts:12` — `formatKnownHostsLine` brackets non-22.
- `apps/desktop/src/main/knownHosts.ts:56` — `renderKnownHostsFile` empty → `''`, else `join('\n')+'\n'`.
- `apps/desktop/src/main/knownHosts.ts:77` — `migrateKnownHostsFromFile` early return if `existing.length>0`, ENOENT swallow.
- `apps/desktop/src/main/knownHosts.ts:108` — `prepareKnownHosts` calls `syncKnownHosts` then `initFn`, legacy fallback after.
- `apps/desktop/src/main/handlers.ts:65` — `native().trustHostKey` then `deps.db.exec` INSERT.
- `apps/desktop/src/main/index.ts:61` — `await prepareKnownHosts(db, userData, initNative)` before `registerHandlers`.
- `apps/desktop/test/main/knownHosts.test.ts:14` — empty file not throw, 28 non-22 bracketed, 95 migrate when empty, 112 leave file alone, 200 boot renders before init.
- `apps/desktop/test/main/handlers.test.ts:43` — trustHostKey asserts both native and insert.
- `apps/desktop/src/renderer/main.tsx:20` — no `api.ssh.init` call.

## Next steps
Task 11 owns portability (copy-database test, e2e smoke rewrite, docs/portability.md).
