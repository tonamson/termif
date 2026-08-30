# Task 1 Report — the credential model

status: DONE

commit: 254a881 feat(core): store credential secrets in the clear

changes:
- `packages/core/src/model.ts:3-31` — `cipher: base64Url` → `secret: z.string()`; removed `DEFAULT_KDF_PARAMS`, `base64Url`, `vaultMetaSchema`, `VaultMeta`, `KdfParams`; `SCHEMA_VERSION` left at 1
- `packages/core/test/model.test.ts:1-65` — added 3 failing-first tests: parses `{id,label,kind:'password',secret:'hunter2',updatedAt,deleted}` via `secret`, rejects `cipher`-only payload, accepts multi-line PEM private key unchanged; migrated existing `cipher` tests to `secret`; removed `vaultMetaSchema` suite
- shims to keep `npm test` green until owner tasks delete the files (Task 4: sheet, Task 5: vault, Task 2: store column):
  - `packages/core/src/store.ts:175-194` — `#writeCredential` writes `c.secret`, `toCredential` maps `row.cipher→secret` (DB column stays `cipher` until Task 2 migration)
  - `packages/core/test/store.test.ts:122` — `cipher` → `secret`
  - `packages/core/src/vault.ts:4-16` — local `DEFAULT_KDF_PARAMS`/`KdfParams`/`VaultMeta` (ponytail shim, deleted in Task 5)
  - `packages/core/test/vault.test.ts:131` — `vaultMetaSchema` test skipped
  - `packages/core/src/sheet/rows.ts:1-123` — local `vaultMetaSchema` shim, `credentialToRow`/`rowToCredential` use `secret`/`cipher` mapping (deleted in Task 4)
  - `packages/core/test/sheetRows.test.ts:1-91` — `DEFAULT_KDF_PARAMS` import from vault shim, credential `secret`, two suites skipped

test-first:
- `npm test -- test/model.test.ts` before fix: 3 failed (secret Required, cipher-only did not throw, PEM Required), 11 passed
- after fix: 12 passed

verify:
- `cd packages/core && npm test` → Test Files 12 passed (12), Tests 137 passed | 3 skipped (140), duration ~2.9s
- `cd packages/core && npm run typecheck` → clean
- `cd packages/core && npm test -- test/model.test.ts` → 12 passed

secrets: no secret in logs; secret field holds PEM verbatim via `z.string()` (no base64url restriction); error messages do not include secret values

concerns:
- Three skipped tests are intentional half-removal markers — they cover features deleted in Tasks 4–5; they will disappear with those files. Stub vaultMetaSchema in rows.ts/vault.ts is local and not exported from model.
- DB column remains `cipher` until Task 2's `CREATE TABLE` + migration to `secret`; Store currently translates `secret↔cipher` at the row boundary.
