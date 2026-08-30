# Task 6 Report — main process: Google, secure store, and the net bridge

status: DONE

commit: refactor(desktop): remove Google auth, the secure store, and the net bridge

changes:
- `apps/desktop/src/main/googleAuth.ts` — deleted (192 lines, GoogleAuth/DeviceFlow, TOKEN_KEY, SCOPES)
- `apps/desktop/src/main/secureStore.ts` — deleted (69 lines, MainSecureStore, createSecureStore)
- `apps/desktop/src/main/net.ts` — deleted (18 lines, Electron net.fetch bridge)
- `apps/desktop/test/main/googleAuth.test.ts` — deleted (252 lines)
- `apps/desktop/src/shared/ipc.ts:36-46` — remove 5 auth* channels, 3 secure* channels, netRequest; delete DeviceFlowStart, DeviceFlowPoll, HttpRequestPayload, HttpResponsePayload; remove auth/secure/net from TermifApi (CHANNELS 38→29, -9)
- `apps/desktop/src/main/handlers.ts` — remove secureStore/auth from HandlerDeps, delete 9 handlers (secureGet/Set/Delete, netRequest, 5 auth), handlerNames() now 38→29 matching CHANNELS
- `apps/desktop/src/main/index.ts` — remove GoogleAuth, createSecureStore, TERMIF_GOOGLE_* env reads; registerHandlers({db}) only
- `apps/desktop/src/preload/index.ts:45-60` — remove secure/net/auth bridge members
- `packages/core/src/platform.ts:6-50` — remove secureStore: SecureStore, net: HttpClient, and SecureStore/HttpClient/HttpResponse types (27 lines, 0 remaining consumers in src)
- `packages/core/test/fakes/http.ts` + `secureStore.ts` — deleted (dead after type removal, no consumers)
- `apps/desktop/src/renderer/platform.ts:124-173` — remove secureStore/net adapters
- `apps/desktop/test/renderer/platform.test.ts:55-69` — remove secure/net stubs from stubApi
- `apps/desktop/test/renderer/fakes/platform.ts:51-55,82-84` — remove secureStore/net from fakePlatform
- `docs/superpowers/plans/2026-08-30-termif-06-local-only.md:206-227` — tick Task 6 checkboxes

test-first:
- before fix: `handlerNames()` 38 entries including auth:*/secure:*/net:request; CHANNELS 38 entries; equality passes but task requires no auth:*/secure:*/net
- after fix: `handlerNames()` 29 entries, CHANNELS 29 entries, equality still passes, no auth:*/secure:*/net channel present

verify:
- `cd apps/desktop && npm test -- test/main/handlers.test.ts test/renderer/platform.test.ts` → 2 files, 13 passed
- `cd apps/desktop && npx tsc --noEmit -p tsconfig.node.json` → clean (main/preload/shared)
- `cd apps/desktop && npm run typecheck` → renderer failures are pre-existing Task 7-8 vault/cipher leftovers (connectFlow.test.tsx, hostStore.test.ts, vaultStore.test.ts, UnlockScreen.test.tsx, signIn.test.ts, TerminalPane.test.tsx, better-sqlite3 mock) — none from Task 6 scope; main scope clean
- `cd packages/core && npm run build` → ESM 37.14KB, DTS 21.49KB clean
- `cd packages/core && npm test` → 7 files, 83 passed (unchanged)
- `grep -rn TERMIF_GOOGLE apps/desktop/src` → 0
- `grep -rn "secureStore\|\.net\.request\|googleAuth\|createSecureStore" apps/desktop/src` → 0 (only vaultStore.ts which is Task 7 scope, not Task 6)

secrets: no secret in logs; OAuth client secret env reads removed

concerns:
- renderer `vaultStore.ts`/`signIn.ts` and their tests still reference `platform.secureStore`/`net`/`Vault` — intentionally left for Task 7-8 per plan order; Task 6 only removes Platform interface and adapters
- `apps/desktop` full typecheck shows ~20 errors from Tasks 7-8 scope; will be cleared by Tasks 7-9
