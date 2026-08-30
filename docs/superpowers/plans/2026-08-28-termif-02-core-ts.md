# Termif Plan 2 — `packages/core` (shared TypeScript)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared TypeScript core — vault crypto, local store, Google Sheet sync, session/transfer/forward management, and i18n — as the one logic layer the desktop shell consumes.

**Scope revision (2026-08-28):** v1 is desktop only; the mobile shells are deferred (spec §11). This plan is unchanged in substance. Core has exactly one consumer in v1, and the `Platform` seam stays because it is what makes core testable without Electron in the process — the CI purity check in Task 12 is a v1 requirement, not a favour to a future shell.

**Architecture:** Plain TypeScript with the platform injected as an interface (`Platform`). No import from Electron, Node, or any UI framework anywhere in this package; a CI build with no platform bound enforces it. The `SshBridge` interface is the seam over Plan 1's FFI, with one drain loop fanning events out to subscribers.

**Tech Stack:** TypeScript 5.6 (strict), Vitest, `@noble/ciphers` (XChaCha20-Poly1305), `@noble/hashes` (Argon2id), `zod` for row parsing, `tsup` for build.

**Spec:** `docs/superpowers/specs/2026-08-28-termif-crossplatform-ssh-design.md`

**Depends on:** Plan 1 (the `SshBridge` shape mirrors the FFI surface built there). Where this plan names an FFI function, it matches Plan 1 Task 11 — the napi binding, which is the only binding in v1. If Plan 1 landed with a changed signature, reconcile against the built binding rather than trusting this document.

## Global Constraints

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Zero imports from `electron`, `react`, `fs`, `path`, or any Node built-in in `packages/core/src`. Everything platform-shaped arrives through `Platform`. Task 12 adds the CI check that enforces this. This holds with one shell: it is what lets every test below run against a fake `Platform` with no Electron process.
- Every user-facing string goes through `t()`. `en` is the only locale in v1 (spec §6).
- Handle ids are `bigint` in TypeScript, matching napi's `BigInt`.
- Crypto parameters are read from the Sheet's `meta` tab, never hardcoded at a call site (spec §4).
- Argon2id defaults for a new vault: `m = 65536` KiB (64 MiB), `t = 3`, `p = 1`, 32-byte output. 64 MiB costs a brute-forcer real RAM per guess while unlocking in well under a second on any desktop. `meta.kdf_params` carries the values so they can be raised later without breaking existing vaults, and the schema floor is 16 MiB (Task 4) — below that Argon2id stops being meaningfully memory-hard.
- The vault key is a `Uint8Array` held only in memory, zeroed on lock.
- All timestamps are ISO-8601 UTC strings (`2026-08-28T10:00:00.000Z`), compared lexicographically — which is also chronological for this format.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/package.json`, `tsconfig.json`, `vitest.config.ts` | Package setup |
| `packages/core/src/platform.ts` | `Platform`, `SecureStore`, `LocalDb`, `HttpClient`, `SshBridge` interfaces |
| `packages/core/src/errors.ts` | `CoreError` hierarchy, FFI error-code parsing |
| `packages/core/src/i18n/index.ts` | `t()`, locale registry |
| `packages/core/src/i18n/en.ts` | English catalogue |
| `packages/core/src/model.ts` | `Host`, `Credential`, `Snippet`, `Meta` types and zod schemas |
| `packages/core/src/vault.ts` | Argon2id, XChaCha20-Poly1305, unlock/lock, key wrapping |
| `packages/core/src/store.ts` | CRUD over `LocalDb`, change events |
| `packages/core/src/sheet/rows.ts` | Row ⇄ model serialisation |
| `packages/core/src/sheet/client.ts` | Sheets REST calls, backoff, bootstrap |
| `packages/core/src/sheet/merge.ts` | Last-write-wins merge, tombstone pruning |
| `packages/core/src/sync.ts` | Pull/merge/push orchestration, debounce |
| `packages/core/src/sessions.ts` | Drain loop, tab ⇄ channel map, fan-out, reconnect |
| `packages/core/src/transfers.ts` | Transfer queue and progress state |
| `packages/core/src/forwards.ts` | Forward state, rebuild after reconnect |
| `packages/core/src/index.ts` | Public surface |
| `packages/core/test/fakes/*.ts` | Fake `Platform` implementations |

Ordering rationale: types and interfaces first (Tasks 1–3), then the two pieces with no dependencies on each other (vault in Task 4, store in Task 5), then sync on top of both (Tasks 6–8), then the runtime-stateful modules (Tasks 9–11), then the guard rail (Task 12).

---

## Task 1: Package setup, platform interfaces, and errors

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/platform.ts`, `packages/core/src/errors.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/errors.test.ts`

**Interfaces:**
- Produces `Platform` with members `ssh: SshBridge`, `secureStore: SecureStore`, `db: LocalDb`, `net: HttpClient`, `now(): string`, `randomBytes(n: number): Uint8Array`.
- Produces `SshBridge` mirroring Plan 1's FFI: `init`, `connect`, `disconnect`, `trustHostKey`, `openShell`, `write`, `resize`, `closeChannel`, `sftpList`, `sftpStat`, `sftpMkdir`, `sftpRename`, `sftpRemove`, `sftpReadRange`, `sftpUpload`, `sftpDownload`, `cancelTransfer`, `forwardLocal`, `forwardRemote`, `forwardSocks`, `forwardBoundPort`, `closeForward`, `nextEvents`.
- Produces `SshEvent` as a discriminated union on `kind`.
- Produces `CoreError` with `code: string`, `parseFfiError(e: unknown): CoreError`.

- [x] **Step 1: Write the package manifests**

`packages/core/package.json`:

```json
{
  "name": "@termif/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@noble/ciphers": "^1.2.0",
    "@noble/hashes": "^1.7.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

Note the `lib` has no `DOM` and no `@types/node`: that is the first line of defence for the no-platform-imports rule.

`packages/core/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
```

- [x] **Step 2: Write the failing test**

`packages/core/test/errors.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { CoreError, parseFfiError } from '../src/errors.js'

describe('parseFfiError', () => {
  it('extracts the code from a napi-style prefixed message', () => {
    const err = parseFfiError(new Error('host_key_unknown: unknown host key for example.com'))
    expect(err.code).toBe('host_key_unknown')
    expect(err.message).toContain('example.com')
  })

  it('extracts the code from a raw { code, message } object', () => {
    // The IPC boundary does not preserve an Error, so the desktop bridge may
    // rethrow a plain object. Accepting that shape means the bridge does not
    // have to re-stringify into "code: message" just to be parsed again.
    const err = parseFfiError({ code: 'auth', message: 'authentication failed' })
    expect(err.code).toBe('auth')
    expect(err.message).toBe('authentication failed')
  })

  it('falls back to "unknown" for an unrecognised error', () => {
    const err = parseFfiError('something went sideways')
    expect(err.code).toBe('unknown')
    expect(err.message).toBe('something went sideways')
  })

  it('does not treat a colon inside a message as a code delimiter', () => {
    const err = parseFfiError(new Error('connect failed: 127.0.0.1:22 refused'))
    // "connect failed" has a space, so it is not a code — codes are snake_case
    // with no spaces.
    expect(err.code).toBe('unknown')
  })

  it('keeps host key details when present', () => {
    const err = new CoreError('host_key_mismatch', 'key changed', {
      host: 'example.com',
      expected: 'SHA256:aaa',
      got: 'SHA256:bbb',
    })
    expect(err.details.host).toBe('example.com')
    expect(err.isSecurityBlock()).toBe(true)
  })

  it('marks only host_key_mismatch as a security block', () => {
    expect(new CoreError('host_key_unknown', 'x').isSecurityBlock()).toBe(false)
    expect(new CoreError('auth', 'x').isSecurityBlock()).toBe(false)
    expect(new CoreError('host_key_mismatch', 'x').isSecurityBlock()).toBe(true)
  })
})
```

`host_key_unknown` is deliberately not a security block: it is the first-connection prompt, which the user answers. `host_key_mismatch` is the one that blocks (spec §7).

- [x] **Step 3: Run to see it fail**

Run: `cd packages/core && npm install && npx vitest run test/errors.test.ts`
Expected: FAIL — `src/errors.ts` does not exist.

- [x] **Step 4: Write the interfaces and errors**

`packages/core/src/platform.ts`:

```typescript
/**
 * Everything platform-shaped arrives through this interface. `packages/core`
 * imports nothing from Electron, Node, or any UI framework, which is what lets
 * it be tested against a fake and driven by a second shell later (spec §6).
 */
export interface Platform {
  readonly ssh: SshBridge
  readonly secureStore: SecureStore
  readonly db: LocalDb
  readonly net: HttpClient
  /** ISO-8601 UTC. Injected so tests can control time. */
  now(): string
  randomBytes(length: number): Uint8Array
}

export interface SecureStore {
  /** Reads a value, or null when absent. */
  get(key: string): Promise<Uint8Array | null>
  /**
   * Writes a value. `requireBiometrics` asks the OS to gate reads behind
   * Face ID / Touch ID / fingerprint where the platform supports it.
   */
  set(key: string, value: Uint8Array, requireBiometrics: boolean): Promise<void>
  delete(key: string): Promise<void>
}

export interface LocalDb {
  /** Runs a statement with no result rows. */
  exec(sql: string, params?: readonly SqlValue[]): Promise<void>
  /** Runs a query and returns rows as plain objects. */
  query<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>
  /** Runs `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: () => Promise<T>): Promise<T>
}

export type SqlValue = string | number | null

export interface HttpResponse {
  readonly status: number
  readonly body: string
}

export interface HttpClient {
  request(init: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    headers?: Readonly<Record<string, string>>
    body?: string
  }): Promise<HttpResponse>
}

export interface SshConnectConfig {
  host: string
  port: number
  username: string
  /** Exactly one of `password` or `privateKeyPem`. */
  password?: string | undefined
  privateKeyPem?: string | undefined
  passphrase?: string | undefined
  connectTimeoutMs: number
  keepaliveSecs: number
}

export interface SshDirEntry {
  name: string
  size: bigint
  isDir: boolean
  isSymlink: boolean
  mode: number
  modifiedUnix: number
}

/**
 * Normalised event shape. The shell's bridge converts the flat napi object
 * into this before it reaches core, so core never sees an FFI-specific shape.
 */
export type SshEvent =
  | { kind: 'channelData'; channelId: bigint; bytes: Uint8Array }
  | { kind: 'channelClosed'; channelId: bigint; exitStatus: number | null }
  | { kind: 'sessionClosed'; sessionId: bigint; reason: string }
  | { kind: 'transferProgress'; transferId: bigint; done: bigint; total: bigint }
  | { kind: 'transferDone'; transferId: bigint; error: string | null }
  | { kind: 'forwardAccepted'; forwardId: bigint; peer: string }
  | { kind: 'log'; level: string; msg: string }

/** Mirrors the FFI surface from Plan 1 Tasks 11 and 12, one-to-one. */
export interface SshBridge {
  init(knownHostsPath: string): Promise<void>
  connect(cfg: SshConnectConfig): Promise<bigint>
  disconnect(sessionId: bigint): Promise<void>
  trustHostKey(host: string, port: number, algo: string, fingerprint: string): Promise<void>

  openShell(sessionId: bigint, cols: number, rows: number): Promise<bigint>
  write(channelId: bigint, data: Uint8Array): Promise<void>
  resize(channelId: bigint, cols: number, rows: number): Promise<void>
  closeChannel(channelId: bigint): Promise<void>

  sftpList(sessionId: bigint, path: string): Promise<SshDirEntry[]>
  sftpStat(sessionId: bigint, path: string): Promise<SshDirEntry>
  sftpMkdir(sessionId: bigint, path: string): Promise<void>
  sftpRename(sessionId: bigint, from: string, to: string): Promise<void>
  sftpRemove(sessionId: bigint, path: string, recursive: boolean): Promise<void>
  sftpReadRange(sessionId: bigint, path: string, offset: bigint, len: number): Promise<Uint8Array>
  sftpUpload(sessionId: bigint, local: string, remote: string): Promise<bigint>
  sftpDownload(sessionId: bigint, remote: string, local: string): Promise<bigint>
  cancelTransfer(transferId: bigint): Promise<void>

  forwardLocal(
    sessionId: bigint,
    localBind: string,
    remoteHost: string,
    remotePort: number,
  ): Promise<bigint>
  forwardRemote(
    sessionId: bigint,
    remoteBindHost: string,
    remoteBindPort: number,
    localHost: string,
    localPort: number,
  ): Promise<bigint>
  forwardSocks(sessionId: bigint, localBind: string): Promise<bigint>
  forwardBoundPort(forwardId: bigint): Promise<number>
  closeForward(forwardId: bigint): Promise<void>

  nextEvents(timeoutMs: number): Promise<SshEvent[]>
}
```

`packages/core/src/errors.ts`:

```typescript
export type CoreErrorDetails = Readonly<Record<string, string>>

export class CoreError extends Error {
  readonly code: string
  readonly details: CoreErrorDetails

  constructor(code: string, message: string, details: CoreErrorDetails = {}) {
    super(message)
    this.name = 'CoreError'
    this.code = code
    this.details = details
  }

  /**
   * True only for failures that must stop the operation with no override.
   * A changed host key is the signature of an MITM in progress, so there is
   * deliberately no "continue once" path (spec §7).
   */
  isSecurityBlock(): boolean {
    return this.code === 'host_key_mismatch'
  }
}

/** Codes are snake_case with no whitespace; that is how we recognise one. */
const CODE_PREFIX = /^([a-z][a-z0-9_]*):\s(.*)$/s

/**
 * Normalises whatever the bridge threw into a `CoreError`. Plan 1's napi
 * binding produces "code: message"; a raw `{ code, message }` object is also
 * accepted, because an Error does not survive the IPC boundary intact and the
 * bridge should not have to re-stringify just to be re-parsed.
 */
export function parseFfiError(e: unknown): CoreError {
  if (e instanceof CoreError) return e

  if (typeof e === 'object' && e !== null && 'code' in e && 'message' in e) {
    const { code, message } = e as { code: unknown; message: unknown }
    if (typeof code === 'string' && typeof message === 'string') {
      return new CoreError(code, message)
    }
  }

  const text = e instanceof Error ? e.message : String(e)
  const match = CODE_PREFIX.exec(text)
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return new CoreError(match[1], match[2])
  }
  return new CoreError('unknown', text)
}
```

`packages/core/src/index.ts`:

```typescript
export * from './errors.js'
export * from './platform.js'
```

- [x] **Step 5: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run test/errors.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 6: Typecheck**

Run: `cd packages/core && npm run typecheck`
Expected: no output, exit 0.

- [x] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): add platform interfaces and CoreError with FFI code parsing"
```

---

## Task 2: i18n

**Files:**
- Create: `packages/core/src/i18n/index.ts`, `packages/core/src/i18n/en.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/i18n.test.ts`

**Interfaces:**
- Produces `t(key: MessageKey, vars?: Record<string, string | number>): string`, `setLocale(locale: string): void`, `availableLocales(): string[]`, `type MessageKey = keyof typeof en`.
- The catalogue is a flat object so `MessageKey` is a literal union and a typo is a compile error.

- [x] **Step 1: Write the failing test**

`packages/core/test/i18n.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import { availableLocales, setLocale, t } from '../src/i18n/index.js'
import { en } from '../src/i18n/en.js'

describe('t', () => {
  beforeEach(() => setLocale('en'))

  it('returns the English message for a known key', () => {
    expect(t('error.auth.failed')).toBe('Authentication failed. Check the username and credential.')
  })

  it('interpolates named variables', () => {
    expect(t('hostkey.unknown.title', { host: 'example.com' })).toBe(
      'First connection to example.com',
    )
  })

  it('leaves an unmatched placeholder visible rather than printing undefined', () => {
    // A missing variable is a bug we want to see in the UI, not silently blank.
    expect(t('hostkey.unknown.title')).toBe('First connection to {host}')
  })

  it('lists en as the only locale in v1', () => {
    expect(availableLocales()).toEqual(['en'])
  })

  it('falls back to English when an unknown locale is selected', () => {
    setLocale('fr')
    expect(t('error.auth.failed')).toBe(en['error.auth.failed'])
  })

  it('has no empty strings in the catalogue', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.length, `empty message for ${key}`).toBeGreaterThan(0)
    }
  })
})
```

- [x] **Step 2: Run to see it fail**

Run: `cd packages/core && npx vitest run test/i18n.test.ts`
Expected: FAIL — no `src/i18n/index.ts`.

- [x] **Step 3: Write the catalogue and lookup**

`packages/core/src/i18n/en.ts`:

```typescript
/**
 * The single source of message keys. Flat by design: the key union is derived
 * from this object, so a typo at a call site fails to compile.
 */
export const en = {
  'error.auth.failed': 'Authentication failed. Check the username and credential.',
  'error.connect.refused': 'Could not reach {host}. The server may be down or the port blocked.',
  'error.connect.timeout': 'Connecting to {host} timed out.',
  'error.network.offline': 'No network. Hosts are shown from this device; syncing will resume later.',
  'error.sftp.failed': 'File operation failed: {reason}',
  'error.forward.bindFailed': 'Could not listen on {bind}. Another program may be using it.',
  'error.internal': 'Something went wrong inside Termif: {reason}',
  'error.unknown': 'Unexpected error: {reason}',

  'hostkey.unknown.title': 'First connection to {host}',
  'hostkey.unknown.body':
    'This server presented a {algo} key with fingerprint {fingerprint}. Verify it out of band before trusting it.',
  'hostkey.unknown.trust': 'Trust and connect',
  'hostkey.unknown.cancel': 'Cancel',
  'hostkey.mismatch.title': 'Host key changed for {host}',
  'hostkey.mismatch.body':
    'The key changed from {expected} to {got}. This can mean the server was rebuilt, or that the connection is being intercepted. Termif will not connect until you remove the old key deliberately.',

  'vault.locked': 'Vault locked',
  'vault.unlock.prompt': 'Enter your master password',
  'vault.unlock.wrong': 'That password did not unlock the vault.',
  'vault.setup.title': 'Choose a master password',
  'vault.setup.warning':
    'If you lose this password, the stored credentials cannot be recovered. Nothing is sent to Google that can decrypt them.',
  'vault.remember': 'Unlock with biometrics on this device',

  'sync.idle': 'Synced {when}',
  'sync.running': 'Syncing…',
  'sync.failed': 'Sync failed: {reason}. Working from this device.',
  'sync.quota': 'Google rate-limited the sync. Retrying shortly.',
  'sync.offline': 'Working on this device only',
  'sync.signIn': 'Sign in to Google to sync',
  'sync.signIn.body':
    'Termif stores encrypted host data in a Google Sheet you own. Google never sees a readable password.',
  'sync.signIn.start': 'Sign in with Google',
  'sync.signIn.code': 'Enter this code: {code}',
  'sync.signIn.open': 'Open Google in your browser',
  'sync.signIn.waiting': 'Waiting for Google…',
  'sync.signIn.denied': 'Google denied access: {reason}',
  'sync.signIn.expired': 'The code expired. Start again.',
  'sync.signIn.cancel': 'Not now',
  'sync.signOut': 'Disconnect Google',

  'session.reconnecting': 'Connection lost. Reconnecting…',
  'session.reconnected':
    'Reconnected. This is a new shell — scrollback is kept, but the previous session ended.',
  'session.closed': 'Session closed: {reason}',

  'transfer.progress': '{done} of {total}',
  'transfer.done': 'Transferred {name}',
  'transfer.failed': 'Transfer failed: {reason}',
  'transfer.cancelled': 'Transfer cancelled',

  'forward.active': 'Forwarding {from} to {to}',
  'forward.iosForegroundOnly':
    'On iOS this forward only runs while Termif is open. iOS does not allow a background app to keep a listening socket.',
  'forward.androidBackground': 'Keeping this forward alive in the background.',
} as const

export type MessageKey = keyof typeof en
```

`packages/core/src/i18n/index.ts`:

```typescript
import { en, type MessageKey } from './en.js'

const catalogues: Record<string, Readonly<Record<string, string>>> = { en }

let current = 'en'

/** v1 ships English only (spec §6); the machinery is here so adding a locale is a data change. */
export function availableLocales(): string[] {
  return Object.keys(catalogues)
}

export function setLocale(locale: string): void {
  current = locale in catalogues ? locale : 'en'
}

export function currentLocale(): string {
  return current
}

export function t(key: MessageKey, vars?: Readonly<Record<string, string | number>>): string {
  const catalogue = catalogues[current] ?? en
  const template = catalogue[key] ?? en[key]

  if (vars === undefined) return template
  // An unmatched placeholder stays visible: a blank in the UI hides the bug.
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name]
    return value === undefined ? whole : String(value)
  })
}

export type { MessageKey }
export { en }
```

Modify `packages/core/src/index.ts` to add:

```typescript
export * from './i18n/index.js'
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run test/i18n.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add i18n with an English catalogue and typed message keys"
```

---

## Task 3: Model types and zod schemas

**Files:**
- Create: `packages/core/src/model.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/model.test.ts`

**Interfaces:**
- Produces types and schemas for `Host`, `StoredCredential`, `Snippet`, `VaultMeta`, plus `newId(): string`.
- `Host { id, label, hostname, port, username, authRef, tags, groupId, updatedAt, deleted }`
- `StoredCredential { id, label, kind: 'password' | 'key', cipher, updatedAt, deleted }`
- `Snippet { id, label, body, tags, updatedAt, deleted }`
- `VaultMeta { schemaVersion, kdfSalt, kdfParams: { m, t, p }, vaultCheck }`
- `SCHEMA_VERSION = 1`
- `DEFAULT_KDF_PARAMS = { m: 65536, t: 3, p: 1 }`

- [x] **Step 1: Write the failing test**

`packages/core/test/model.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KDF_PARAMS,
  SCHEMA_VERSION,
  hostSchema,
  newId,
  snippetSchema,
  storedCredentialSchema,
  vaultMetaSchema,
} from '../src/model.js'

const validHost = {
  id: 'h1',
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 22,
  username: 'deploy',
  authRef: 'c1',
  tags: ['prod'],
  groupId: null,
  updatedAt: '2026-08-28T10:00:00.000Z',
  deleted: false,
}

describe('hostSchema', () => {
  it('accepts a valid host', () => {
    expect(hostSchema.parse(validHost).label).toBe('web-1')
  })

  it('rejects a port outside 1-65535', () => {
    expect(() => hostSchema.parse({ ...validHost, port: 0 })).toThrow()
    expect(() => hostSchema.parse({ ...validHost, port: 70000 })).toThrow()
  })

  it('rejects an empty hostname', () => {
    expect(() => hostSchema.parse({ ...validHost, hostname: '' })).toThrow()
  })

  it('rejects a non-ISO updatedAt', () => {
    expect(() => hostSchema.parse({ ...validHost, updatedAt: 'yesterday' })).toThrow()
  })

  it('allows a null authRef for a host with no stored credential', () => {
    expect(hostSchema.parse({ ...validHost, authRef: null }).authRef).toBeNull()
  })
})

describe('storedCredentialSchema', () => {
  it('accepts password and key kinds', () => {
    for (const kind of ['password', 'key'] as const) {
      const parsed = storedCredentialSchema.parse({
        id: 'c1',
        label: 'root pw',
        kind,
        cipher: 'AAAA',
        updatedAt: '2026-08-28T10:00:00.000Z',
        deleted: false,
      })
      expect(parsed.kind).toBe(kind)
    }
  })

  it('rejects an unknown kind', () => {
    expect(() =>
      storedCredentialSchema.parse({
        id: 'c1',
        label: 'x',
        kind: 'certificate',
        cipher: 'AAAA',
        updatedAt: '2026-08-28T10:00:00.000Z',
        deleted: false,
      }),
    ).toThrow()
  })
})

describe('snippetSchema', () => {
  it('requires a non-empty body', () => {
    expect(() =>
      snippetSchema.parse({
        id: 's1',
        label: 'tail log',
        body: '',
        tags: [],
        updatedAt: '2026-08-28T10:00:00.000Z',
        deleted: false,
      }),
    ).toThrow()
  })
})

describe('vaultMetaSchema', () => {
  it('accepts the default parameters', () => {
    const meta = vaultMetaSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      kdfSalt: 'c2FsdA',
      kdfParams: DEFAULT_KDF_PARAMS,
      vaultCheck: 'Y2hlY2s',
    })
    expect(meta.kdfParams.m).toBe(65536)
  })

  it('rejects an implausibly weak memory cost', () => {
    // A tiny m would make brute force cheap; reject it rather than trust the sheet.
    expect(() =>
      vaultMetaSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        kdfSalt: 'c2FsdA',
        kdfParams: { m: 8, t: 1, p: 1 },
        vaultCheck: 'Y2hlY2s',
      }),
    ).toThrow()
  })
})

describe('newId', () => {
  it('produces distinct, URL-safe ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16,}$/)
  })
})
```

- [x] **Step 2: Run to see it fail**

Run: `cd packages/core && npx vitest run test/model.test.ts`
Expected: FAIL — no `src/model.ts`.

- [x] **Step 3: Write the model**

`packages/core/src/model.ts`:

```typescript
import { z } from 'zod'

export const SCHEMA_VERSION = 1

/**
 * Argon2id cost. Sized to stay inside a mid-range phone's per-app memory
 * budget while still costing an offline attacker real RAM. Stored in the
 * sheet's `meta` tab so it can be raised later without breaking old vaults
 * (spec §4).
 */
export const DEFAULT_KDF_PARAMS = { m: 65536, t: 3, p: 1 } as const

/** Rejects anything that is not an ISO-8601 UTC instant with milliseconds. */
const isoUtc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, {
  message: 'must be an ISO-8601 UTC timestamp',
})

const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/, { message: 'must be base64url' })

export const hostSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  hostname: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  /** Id of a `StoredCredential`, or null to prompt at connect time. */
  authRef: z.string().min(1).nullable(),
  tags: z.array(z.string()),
  groupId: z.string().min(1).nullable(),
  updatedAt: isoUtc,
  deleted: z.boolean(),
})

export const storedCredentialSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['password', 'key']),
  /** base64url of nonce ‖ ciphertext ‖ tag. Never plaintext. */
  cipher: base64Url,
  updatedAt: isoUtc,
  deleted: z.boolean(),
})

export const snippetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string()),
  updatedAt: isoUtc,
  deleted: z.boolean(),
})

export const vaultMetaSchema = z.object({
  schemaVersion: z.number().int().min(1),
  kdfSalt: base64Url,
  kdfParams: z.object({
    // 16 MiB floor: below this, Argon2id stops being meaningfully memory-hard
    // for an attacker with a GPU.
    m: z.number().int().min(16384).max(1048576),
    t: z.number().int().min(1).max(16),
    p: z.number().int().min(1).max(8),
  }),
  vaultCheck: base64Url,
})

export type Host = z.infer<typeof hostSchema>
export type StoredCredential = z.infer<typeof storedCredentialSchema>
export type Snippet = z.infer<typeof snippetSchema>
export type VaultMeta = z.infer<typeof vaultMetaSchema>
export type KdfParams = VaultMeta['kdfParams']

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

/**
 * 22 characters of base64url from 128 random bits. Ids are generated on four
 * devices with no coordinator, so collision resistance matters more than
 * brevity; `crypto.getRandomValues` is a Web Crypto global, present in every
 * JS runtime this will ever run in.
 */
export function newId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) {
    out += ID_ALPHABET[byte % 64]
  }
  return out
}
```

Modify `packages/core/src/index.ts` to add:

```typescript
export * from './model.js'
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run test/model.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add model types with zod schemas and id generation"
```

---

## Task 4: Vault — Argon2id and XChaCha20-Poly1305

**Files:**
- Create: `packages/core/src/vault.ts`
- Create: `packages/core/test/fakes/secureStore.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/vault.test.ts`

**Interfaces:**
- Consumes: `SecureStore`, `Platform['randomBytes']`, `VaultMeta`, `KdfParams`, `CoreError`.
- Produces `Vault` class:
  - `static async create(platform, password, params?): Promise<{ vault: Vault; meta: VaultMeta }>`
  - `static async unlock(platform, meta, password): Promise<Vault>` — throws `CoreError('vault_wrong_password')`
  - `encrypt(plaintext: string, aad: string): string` (base64url)
  - `decrypt(cipher: string, aad: string): string`
  - `lock(): void` — zeroes the key
  - `isLocked(): boolean`
  - `async rememberOnDevice(store: SecureStore): Promise<void>`
  - `static async unlockFromDevice(platform, meta): Promise<Vault | null>`
- Produces `VAULT_CHECK_PLAINTEXT = 'termif-vault-v1'` and `DEVICE_KEY_NAME = 'termif.vaultKey'`.

- [x] **Step 1: Write the fake secure store**

`packages/core/test/fakes/secureStore.ts`:

```typescript
import type { SecureStore } from '../../src/platform.js'

export class FakeSecureStore implements SecureStore {
  private readonly items = new Map<string, Uint8Array>()
  readonly biometricKeys = new Set<string>()

  async get(key: string): Promise<Uint8Array | null> {
    const value = this.items.get(key)
    return value === undefined ? null : new Uint8Array(value)
  }

  async set(key: string, value: Uint8Array, requireBiometrics: boolean): Promise<void> {
    this.items.set(key, new Uint8Array(value))
    if (requireBiometrics) this.biometricKeys.add(key)
    else this.biometricKeys.delete(key)
  }

  async delete(key: string): Promise<void> {
    this.items.delete(key)
    this.biometricKeys.delete(key)
  }
}
```

- [x] **Step 2: Write the failing test**

`packages/core/test/vault.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { DEVICE_KEY_NAME, Vault } from '../src/vault.js'
import { CoreError } from '../src/errors.js'
import { FakeSecureStore } from './fakes/secureStore.js'
import type { Platform } from '../src/platform.js'

/**
 * Argon2id at production cost makes each unlock take ~100ms+; these tests do
 * several, so they use the schema's minimum memory cost. Correctness of the
 * KDF wiring is what is under test, not its cost.
 */
const TEST_PARAMS = { m: 16384, t: 1, p: 1 } as const

function testPlatform(): Pick<Platform, 'randomBytes' | 'secureStore'> & {
  secureStore: FakeSecureStore
} {
  const secureStore = new FakeSecureStore()
  return {
    secureStore,
    randomBytes: (n: number) => {
      const b = new Uint8Array(n)
      crypto.getRandomValues(b)
      return b
    },
  }
}

describe('Vault', () => {
  it('round-trips a secret', async () => {
    const p = testPlatform()
    const { vault } = await Vault.create(p, 'correct horse battery staple', TEST_PARAMS)
    const cipher = vault.encrypt('super-secret-password', 'cred-1')
    expect(cipher).not.toContain('super-secret')
    expect(vault.decrypt(cipher, 'cred-1')).toBe('super-secret-password')
  })

  it('produces a different ciphertext each time for the same plaintext', async () => {
    const p = testPlatform()
    const { vault } = await Vault.create(p, 'pw', TEST_PARAMS)
    const a = vault.encrypt('same', 'cred-1')
    const b = vault.encrypt('same', 'cred-1')
    expect(a).not.toBe(b)
    expect(vault.decrypt(a, 'cred-1')).toBe('same')
    expect(vault.decrypt(b, 'cred-1')).toBe('same')
  })

  it('refuses to decrypt with the wrong AAD, so a row cannot be swapped', async () => {
    const p = testPlatform()
    const { vault } = await Vault.create(p, 'pw', TEST_PARAMS)
    const cipher = vault.encrypt('secret', 'cred-1')
    expect(() => vault.decrypt(cipher, 'cred-2')).toThrow()
  })

  it('refuses to decrypt a tampered ciphertext', async () => {
    const p = testPlatform()
    const { vault } = await Vault.create(p, 'pw', TEST_PARAMS)
    const cipher = vault.encrypt('secret', 'cred-1')
    // Flip a character in the middle of the payload.
    const chars = cipher.split('')
    const mid = Math.floor(chars.length / 2)
    chars[mid] = chars[mid] === 'A' ? 'B' : 'A'
    expect(() => vault.decrypt(chars.join(''), 'cred-1')).toThrow()
  })

  it('unlocks with the right password using the stored meta', async () => {
    const p = testPlatform()
    const { vault, meta } = await Vault.create(p, 'right-password', TEST_PARAMS)
    const cipher = vault.encrypt('value', 'cred-1')

    const reopened = await Vault.unlock(p, meta, 'right-password')
    expect(reopened.decrypt(cipher, 'cred-1')).toBe('value')
  })

  it('rejects the wrong password with a specific code', async () => {
    const p = testPlatform()
    const { meta } = await Vault.create(p, 'right-password', TEST_PARAMS)
    await expect(Vault.unlock(p, meta, 'wrong-password')).rejects.toMatchObject({
      code: 'vault_wrong_password',
    })
    await expect(Vault.unlock(p, meta, 'wrong-password')).rejects.toBeInstanceOf(CoreError)
  })

  it('derives the same key from the same password and salt', async () => {
    const p = testPlatform()
    const { vault: a, meta } = await Vault.create(p, 'pw', TEST_PARAMS)
    const b = await Vault.unlock(p, meta, 'pw')
    // Cross-decrypt proves both hold the same key.
    expect(b.decrypt(a.encrypt('x', 'aad'), 'aad')).toBe('x')
  })

  it('is unusable after lock', async () => {
    const p = testPlatform()
    const { vault } = await Vault.create(p, 'pw', TEST_PARAMS)
    const cipher = vault.encrypt('value', 'cred-1')
    vault.lock()
    expect(vault.isLocked()).toBe(true)
    expect(() => vault.decrypt(cipher, 'cred-1')).toThrow(/locked/i)
    expect(() => vault.encrypt('x', 'cred-1')).toThrow(/locked/i)
  })

  it('remembers the key on the device behind biometrics and unlocks from it', async () => {
    const p = testPlatform()
    const { vault, meta } = await Vault.create(p, 'pw', TEST_PARAMS)
    const cipher = vault.encrypt('value', 'cred-1')

    await vault.rememberOnDevice(p.secureStore)
    expect(p.secureStore.biometricKeys.has(DEVICE_KEY_NAME)).toBe(true)

    const fromDevice = await Vault.unlockFromDevice(p, meta)
    expect(fromDevice).not.toBeNull()
    expect(fromDevice!.decrypt(cipher, 'cred-1')).toBe('value')
  })

  it('returns null from unlockFromDevice when nothing was remembered', async () => {
    const p = testPlatform()
    const { meta } = await Vault.create(p, 'pw', TEST_PARAMS)
    expect(await Vault.unlockFromDevice(p, meta)).toBeNull()
  })

  it('returns null from unlockFromDevice when the stored key does not match the vault', async () => {
    // A stale device key after the master password changed must not silently
    // "work" against a vault it cannot actually open.
    const p = testPlatform()
    const first = await Vault.create(p, 'old-password', TEST_PARAMS)
    await first.vault.rememberOnDevice(p.secureStore)

    const second = await Vault.create(p, 'new-password', TEST_PARAMS)
    expect(await Vault.unlockFromDevice(p, second.meta)).toBeNull()
  })

  it('writes meta that parses against the schema', async () => {
    const { vaultMetaSchema } = await import('../src/model.js')
    const p = testPlatform()
    const { meta } = await Vault.create(p, 'pw', TEST_PARAMS)
    expect(() => vaultMetaSchema.parse(meta)).not.toThrow()
  })
})
```

- [x] **Step 3: Run to see it fail**

Run: `cd packages/core && npx vitest run test/vault.test.ts`
Expected: FAIL — no `src/vault.ts`.

- [x] **Step 4: Write the vault**

`packages/core/src/vault.ts`:

```typescript
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { argon2id } from '@noble/hashes/argon2.js'

import { CoreError } from './errors.js'
import { DEFAULT_KDF_PARAMS, type KdfParams, type VaultMeta, SCHEMA_VERSION } from './model.js'
import type { Platform, SecureStore } from './platform.js'

/** Encrypting this constant gives us something to test a password against. */
export const VAULT_CHECK_PLAINTEXT = 'termif-vault-v1'
export const DEVICE_KEY_NAME = 'termif.vaultKey'
/** AAD for the check value; a real credential's AAD is its row id. */
const VAULT_CHECK_AAD = 'vault-check'

const KEY_BYTES = 32
const NONCE_BYTES = 24
const SALT_BYTES = 16

type VaultPlatform = Pick<Platform, 'randomBytes'>

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Holds the derived vault key in memory and nothing else. Google only ever
 * sees the output of `encrypt` (spec §4).
 */
export class Vault {
  #key: Uint8Array | null

  private constructor(key: Uint8Array) {
    this.#key = key
  }

  static async create(
    platform: VaultPlatform,
    password: string,
    params: KdfParams = DEFAULT_KDF_PARAMS,
  ): Promise<{ vault: Vault; meta: VaultMeta }> {
    const salt = platform.randomBytes(SALT_BYTES)
    const key = deriveKey(password, salt, params)
    const vault = new Vault(key)

    const meta: VaultMeta = {
      schemaVersion: SCHEMA_VERSION,
      kdfSalt: toBase64Url(salt),
      kdfParams: params,
      vaultCheck: vault.#seal(VAULT_CHECK_PLAINTEXT, VAULT_CHECK_AAD, platform),
    }
    return { vault, meta }
  }

  static async unlock(
    platform: VaultPlatform,
    meta: VaultMeta,
    password: string,
  ): Promise<Vault> {
    const key = deriveKey(password, fromBase64Url(meta.kdfSalt), meta.kdfParams)
    const candidate = new Vault(key)
    if (!candidate.#checkPasses(meta)) {
      candidate.lock()
      throw new CoreError('vault_wrong_password', 'the master password did not open the vault')
    }
    return candidate
  }

  /**
   * Wraps the key with the platform keystore behind biometrics. Without this,
   * daily use on a phone pushes people toward short passwords, which loses
   * more than it gains (spec §4).
   */
  async rememberOnDevice(store: SecureStore): Promise<void> {
    await store.set(DEVICE_KEY_NAME, this.#requireKey(), true)
  }

  static async unlockFromDevice(
    platform: VaultPlatform & { secureStore: SecureStore },
    meta: VaultMeta,
  ): Promise<Vault | null> {
    const stored = await platform.secureStore.get(DEVICE_KEY_NAME)
    if (stored === null || stored.length !== KEY_BYTES) return null

    const candidate = new Vault(stored)
    // A key left over from a previous master password must not be treated as
    // valid for this vault.
    if (!candidate.#checkPasses(meta)) {
      candidate.lock()
      return null
    }
    return candidate
  }

  static async forgetOnDevice(store: SecureStore): Promise<void> {
    await store.delete(DEVICE_KEY_NAME)
  }

  isLocked(): boolean {
    return this.#key === null
  }

  /** Zeroes the key material rather than only dropping the reference. */
  lock(): void {
    if (this.#key !== null) {
      this.#key.fill(0)
      this.#key = null
    }
  }

  encrypt(plaintext: string, aad: string): string {
    return this.#seal(plaintext, aad, {
      randomBytes: (n) => {
        const b = new Uint8Array(n)
        crypto.getRandomValues(b)
        return b
      },
    })
  }

  decrypt(cipher: string, aad: string): string {
    const key = this.#requireKey()
    const raw = fromBase64Url(cipher)
    if (raw.length <= NONCE_BYTES) {
      throw new CoreError('vault_bad_ciphertext', 'ciphertext is too short to contain a nonce')
    }
    const nonce = raw.subarray(0, NONCE_BYTES)
    const payload = raw.subarray(NONCE_BYTES)

    try {
      const plain = xchacha20poly1305(key, nonce, encoder.encode(aad)).decrypt(payload)
      return decoder.decode(plain)
    } catch {
      // Wrong key, wrong AAD, or tampering — indistinguishable by design.
      throw new CoreError('vault_bad_ciphertext', 'could not decrypt: wrong key or altered data')
    }
  }

  #seal(plaintext: string, aad: string, platform: VaultPlatform): string {
    const key = this.#requireKey()
    const nonce = platform.randomBytes(NONCE_BYTES)
    const sealed = xchacha20poly1305(key, nonce, encoder.encode(aad)).encrypt(
      encoder.encode(plaintext),
    )
    const out = new Uint8Array(nonce.length + sealed.length)
    out.set(nonce, 0)
    out.set(sealed, nonce.length)
    return toBase64Url(out)
  }

  #checkPasses(meta: VaultMeta): boolean {
    try {
      return this.decrypt(meta.vaultCheck, VAULT_CHECK_AAD) === VAULT_CHECK_PLAINTEXT
    } catch {
      return false
    }
  }

  #requireKey(): Uint8Array {
    if (this.#key === null) {
      throw new CoreError('vault_locked', 'the vault is locked')
    }
    return this.#key
  }
}

/**
 * Argon2id, not PBKDF2: a human-chosen master password is weak, and only a
 * memory-hard KDF makes offline guessing expensive (spec §4).
 */
function deriveKey(password: string, salt: Uint8Array, params: KdfParams): Uint8Array {
  return argon2id(encoder.encode(password), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: KEY_BYTES,
  })
}
```

Modify `packages/core/src/index.ts` to add:

```typescript
export * from './vault.js'
```

- [x] **Step 5: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run test/vault.test.ts`
Expected: PASS, 12 tests.

- [x] **Step 6: Verify the whole suite and typecheck**

Run: `cd packages/core && npx vitest run && npm run typecheck`
Expected: PASS, and no type errors.

- [x] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): add vault with Argon2id and XChaCha20-Poly1305"
```

---

## Task 5: Local store over `LocalDb`

**Files:**
- Create: `packages/core/src/store.ts`
- Create: `packages/core/test/fakes/db.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/store.test.ts`

**Interfaces:**
- Consumes: `LocalDb`, `Platform['now']`, `Host`, `StoredCredential`, `Snippet`, `newId`.
- Produces `Store` class:
  - `static async open(platform): Promise<Store>` — runs migrations
  - `listHosts(): Promise<Host[]>` / `getHost(id): Promise<Host | null>`
  - `upsertHost(host): Promise<Host>` — stamps `updatedAt`
  - `deleteHost(id): Promise<void>` — tombstones, never removes
  - same trio for credentials and snippets
  - `rowsChangedSince(iso): Promise<{ hosts, credentials, snippets }>` — for the sync push
  - `applyRemote(kind, rows): Promise<void>` — writes merged rows without re-stamping `updatedAt`
  - `getMetaValue(key): Promise<string | null>` / `setMetaValue(key, value): Promise<void>`
  - `onChange(listener): () => void`
  - `pruneTombstones(olderThanIso): Promise<number>`

The `applyRemote` / `upsertHost` split matters: a local edit gets a fresh `updatedAt`, but a row arriving from the sheet must keep the timestamp it was written with, or last-write-wins would drift forward on every pull.

- [x] **Step 1: Write the fake database**

`packages/core/test/fakes/db.ts`:

```typescript
import initSqlJs from 'sql.js'
import type { LocalDb, SqlValue } from '../../src/platform.js'

/**
 * A real SQL engine rather than a hand-rolled map: the store's queries are
 * part of what is under test, and a fake that cannot parse SQL would not
 * exercise them.
 */
export async function createFakeDb(): Promise<LocalDb> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  return {
    async exec(sql: string, params: readonly SqlValue[] = []): Promise<void> {
      const stmt = db.prepare(sql)
      stmt.run(params as SqlValue[])
      stmt.free()
    },

    async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      const stmt = db.prepare(sql)
      stmt.bind(params as SqlValue[])
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      stmt.free()
      return rows
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      db.run('BEGIN')
      try {
        const result = await fn()
        db.run('COMMIT')
        return result
      } catch (e) {
        db.run('ROLLBACK')
        throw e
      }
    },
  }
}
```

Add to `packages/core/package.json` devDependencies:

```json
"sql.js": "^1.12.0",
"@types/sql.js": "^1.4.9"
```

- [x] **Step 2: Write the failing test**

`packages/core/test/store.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { Store } from '../src/store.js'
import { createFakeDb } from './fakes/db.js'
import type { Host } from '../src/model.js'

/** A controllable clock, so timestamp behaviour is assertable. */
function clock(start = '2026-08-28T10:00:00.000Z') {
  let current = start
  return {
    now: () => current,
    set: (iso: string) => {
      current = iso
    },
  }
}

async function openStore(c = clock()) {
  const db = await createFakeDb()
  const store = await Store.open({ db, now: c.now })
  return { store, clock: c }
}

const hostInput = {
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 22,
  username: 'deploy',
  authRef: null,
  tags: ['prod'],
  groupId: null,
}

describe('Store', () => {
  it('creates a host with a generated id and a stamped updatedAt', async () => {
    const { store } = await openStore()
    const host = await store.upsertHost(hostInput)
    expect(host.id).toMatch(/^[A-Za-z0-9_-]{16,}$/)
    expect(host.updatedAt).toBe('2026-08-28T10:00:00.000Z')
    expect(host.deleted).toBe(false)
  })

  it('lists hosts excluding tombstones', async () => {
    const { store } = await openStore()
    const a = await store.upsertHost({ ...hostInput, label: 'a' })
    await store.upsertHost({ ...hostInput, label: 'b' })

    await store.deleteHost(a.id)

    const labels = (await store.listHosts()).map((h) => h.label)
    expect(labels).toEqual(['b'])
  })

  it('tombstones rather than removing, so other devices learn of the delete', async () => {
    const { store } = await openStore()
    const host = await store.upsertHost(hostInput)
    await store.deleteHost(host.id)

    // Not in the list...
    expect(await store.getHost(host.id)).toBeNull()
    // ...but still present as a tombstone for sync to push.
    const changed = await store.rowsChangedSince('2026-01-01T00:00:00.000Z')
    const row = changed.hosts.find((h) => h.id === host.id)
    expect(row?.deleted).toBe(true)
  })

  it('advances updatedAt on a local edit', async () => {
    const { store, clock: c } = await openStore()
    const host = await store.upsertHost(hostInput)

    c.set('2026-08-28T11:00:00.000Z')
    const updated = await store.upsertHost({ ...host, label: 'renamed' })

    expect(updated.updatedAt).toBe('2026-08-28T11:00:00.000Z')
    expect(updated.id).toBe(host.id)
    expect((await store.getHost(host.id))?.label).toBe('renamed')
  })

  it('preserves updatedAt for rows applied from the sheet', async () => {
    const { store, clock: c } = await openStore()
    c.set('2026-08-28T12:00:00.000Z')

    const remote: Host = {
      id: 'remote-1',
      label: 'from-sheet',
      hostname: 'other.example.com',
      port: 2222,
      username: 'root',
      authRef: null,
      tags: [],
      groupId: null,
      // Deliberately older than the clock: applying must not bump it forward,
      // or every pull would make remote rows look newer than they are.
      updatedAt: '2026-08-27T09:00:00.000Z',
      deleted: false,
    }
    await store.applyRemote('hosts', [remote])

    expect((await store.getHost('remote-1'))?.updatedAt).toBe('2026-08-27T09:00:00.000Z')
  })

  it('round-trips tags and a null groupId', async () => {
    const { store } = await openStore()
    const host = await store.upsertHost({ ...hostInput, tags: ['prod', 'eu-west', 'db'] })
    const read = await store.getHost(host.id)
    expect(read?.tags).toEqual(['prod', 'eu-west', 'db'])
    expect(read?.groupId).toBeNull()
  })

  it('reports only rows changed after the given timestamp', async () => {
    const { store, clock: c } = await openStore()
    await store.upsertHost({ ...hostInput, label: 'old' })

    c.set('2026-08-28T13:00:00.000Z')
    await store.upsertHost({ ...hostInput, label: 'new' })

    const changed = await store.rowsChangedSince('2026-08-28T12:00:00.000Z')
    expect(changed.hosts.map((h) => h.label)).toEqual(['new'])
  })

  it('stores credentials and snippets alongside hosts', async () => {
    const { store } = await openStore()
    const cred = await store.upsertCredential({
      label: 'deploy key',
      kind: 'key',
      cipher: 'AAAABBBB',
    })
    const snippet = await store.upsertSnippet({
      label: 'tail nginx',
      body: 'tail -f /var/log/nginx/error.log',
      tags: ['nginx'],
    })

    expect((await store.listCredentials()).map((c) => c.id)).toEqual([cred.id])
    expect((await store.listSnippets()).map((s) => s.id)).toEqual([snippet.id])
  })

  it('notifies listeners on change and stops after unsubscribe', async () => {
    const { store } = await openStore()
    const seen: string[] = []
    const unsubscribe = store.onChange((kind) => seen.push(kind))

    await store.upsertHost(hostInput)
    await store.upsertSnippet({ label: 's', body: 'ls', tags: [] })
    unsubscribe()
    await store.upsertHost({ ...hostInput, label: 'after' })

    expect(seen).toEqual(['hosts', 'snippets'])
  })

  it('prunes tombstones older than the cutoff and keeps newer ones', async () => {
    const { store, clock: c } = await openStore()

    const old = await store.upsertHost({ ...hostInput, label: 'old' })
    await store.deleteHost(old.id)

    c.set('2026-08-28T14:00:00.000Z')
    const recent = await store.upsertHost({ ...hostInput, label: 'recent' })
    await store.deleteHost(recent.id)

    const pruned = await store.pruneTombstones('2026-08-28T12:00:00.000Z')
    expect(pruned).toBe(1)

    const changed = await store.rowsChangedSince('2026-01-01T00:00:00.000Z')
    expect(changed.hosts.map((h) => h.id)).toEqual([recent.id])
  })

  it('keeps live rows when pruning', async () => {
    const { store } = await openStore()
    const live = await store.upsertHost(hostInput)
    await store.pruneTombstones('2030-01-01T00:00:00.000Z')
    expect(await store.getHost(live.id)).not.toBeNull()
  })

  it('stores and reads meta values', async () => {
    const { store } = await openStore()
    expect(await store.getMetaValue('lastPull')).toBeNull()
    await store.setMetaValue('lastPull', '2026-08-28T10:00:00.000Z')
    expect(await store.getMetaValue('lastPull')).toBe('2026-08-28T10:00:00.000Z')
    await store.setMetaValue('lastPull', '2026-08-28T11:00:00.000Z')
    expect(await store.getMetaValue('lastPull')).toBe('2026-08-28T11:00:00.000Z')
  })
})
```

- [x] **Step 3: Run to see it fail**

Run: `cd packages/core && npm install && npx vitest run test/store.test.ts`
Expected: FAIL — no `src/store.ts`.

- [x] **Step 4: Write the store**

`packages/core/src/store.ts`:

```typescript
import {
  hostSchema,
  newId,
  snippetSchema,
  storedCredentialSchema,
  type Host,
  type Snippet,
  type StoredCredential,
} from './model.js'
import type { LocalDb, Platform, SqlValue } from './platform.js'

export type RowKind = 'hosts' | 'credentials' | 'snippets'
type ChangeListener = (kind: RowKind) => void

type StorePlatform = Pick<Platform, 'db' | 'now'>

/** Fields the caller supplies; the store owns id, updatedAt, and deleted. */
export type HostInput = Omit<Host, 'id' | 'updatedAt' | 'deleted'> & { id?: string }
export type CredentialInput = Omit<StoredCredential, 'id' | 'updatedAt' | 'deleted'> & {
  id?: string
}
export type SnippetInput = Omit<Snippet, 'id' | 'updatedAt' | 'deleted'> & { id?: string }

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS hosts (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     hostname TEXT NOT NULL,
     port INTEGER NOT NULL,
     username TEXT NOT NULL,
     auth_ref TEXT,
     tags TEXT NOT NULL,
     group_id TEXT,
     updated_at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS credentials (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     kind TEXT NOT NULL,
     cipher TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS snippets (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     body TEXT NOT NULL,
     tags TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS hosts_updated_at ON hosts (updated_at)`,
  `CREATE INDEX IF NOT EXISTS credentials_updated_at ON credentials (updated_at)`,
  `CREATE INDEX IF NOT EXISTS snippets_updated_at ON snippets (updated_at)`,
]

/**
 * The local database is the read source for the whole app; the Sheet is only
 * a sync medium (spec §4). Everything here works offline.
 */
export class Store {
  readonly #db: LocalDb
  readonly #now: () => string
  readonly #listeners = new Set<ChangeListener>()

  private constructor(db: LocalDb, now: () => string) {
    this.#db = db
    this.#now = now
  }

  static async open(platform: StorePlatform): Promise<Store> {
    for (const sql of MIGRATIONS) {
      await platform.db.exec(sql)
    }
    return new Store(platform.db, platform.now)
  }

  onChange(listener: ChangeListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(kind: RowKind): void {
    for (const listener of this.#listeners) listener(kind)
  }

  // ---- hosts ----

  async listHosts(): Promise<Host[]> {
    const rows = await this.#db.query<HostRow>(
      'SELECT * FROM hosts WHERE deleted = 0 ORDER BY label COLLATE NOCASE',
    )
    return rows.map(toHost)
  }

  async getHost(id: string): Promise<Host | null> {
    const rows = await this.#db.query<HostRow>(
      'SELECT * FROM hosts WHERE id = ? AND deleted = 0',
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : toHost(row)
  }

  async upsertHost(input: HostInput): Promise<Host> {
    const host = hostSchema.parse({
      ...input,
      id: input.id ?? newId(),
      updatedAt: this.#now(),
      deleted: false,
    })
    await this.#writeHost(host)
    this.#emit('hosts')
    return host
  }

  async deleteHost(id: string): Promise<void> {
    // Tombstone, never DELETE: a vanished row is indistinguishable from one
    // that has not synced yet (spec §4).
    await this.#db.exec('UPDATE hosts SET deleted = 1, updated_at = ? WHERE id = ?', [
      this.#now(),
      id,
    ])
    this.#emit('hosts')
  }

  async #writeHost(host: Host): Promise<void> {
    await this.#db.exec(
      `INSERT INTO hosts (id, label, hostname, port, username, auth_ref, tags, group_id, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label, hostname = excluded.hostname, port = excluded.port,
         username = excluded.username, auth_ref = excluded.auth_ref, tags = excluded.tags,
         group_id = excluded.group_id, updated_at = excluded.updated_at,
         deleted = excluded.deleted`,
      [
        host.id,
        host.label,
        host.hostname,
        host.port,
        host.username,
        host.authRef,
        JSON.stringify(host.tags),
        host.groupId,
        host.updatedAt,
        host.deleted ? 1 : 0,
      ],
    )
  }

  // ---- credentials ----

  async listCredentials(): Promise<StoredCredential[]> {
    const rows = await this.#db.query<CredentialRow>(
      'SELECT * FROM credentials WHERE deleted = 0 ORDER BY label COLLATE NOCASE',
    )
    return rows.map(toCredential)
  }

  async getCredential(id: string): Promise<StoredCredential | null> {
    const rows = await this.#db.query<CredentialRow>(
      'SELECT * FROM credentials WHERE id = ? AND deleted = 0',
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : toCredential(row)
  }

  async upsertCredential(input: CredentialInput): Promise<StoredCredential> {
    const credential = storedCredentialSchema.parse({
      ...input,
      id: input.id ?? newId(),
      updatedAt: this.#now(),
      deleted: false,
    })
    await this.#writeCredential(credential)
    this.#emit('credentials')
    return credential
  }

  async deleteCredential(id: string): Promise<void> {
    await this.#db.exec('UPDATE credentials SET deleted = 1, updated_at = ? WHERE id = ?', [
      this.#now(),
      id,
    ])
    this.#emit('credentials')
  }

  async #writeCredential(c: StoredCredential): Promise<void> {
    await this.#db.exec(
      `INSERT INTO credentials (id, label, kind, cipher, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label, kind = excluded.kind, cipher = excluded.cipher,
         updated_at = excluded.updated_at, deleted = excluded.deleted`,
      [c.id, c.label, c.kind, c.cipher, c.updatedAt, c.deleted ? 1 : 0],
    )
  }

  // ---- snippets ----

  async listSnippets(): Promise<Snippet[]> {
    const rows = await this.#db.query<SnippetRow>(
      'SELECT * FROM snippets WHERE deleted = 0 ORDER BY label COLLATE NOCASE',
    )
    return rows.map(toSnippet)
  }

  async getSnippet(id: string): Promise<Snippet | null> {
    const rows = await this.#db.query<SnippetRow>(
      'SELECT * FROM snippets WHERE id = ? AND deleted = 0',
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : toSnippet(row)
  }

  async upsertSnippet(input: SnippetInput): Promise<Snippet> {
    const snippet = snippetSchema.parse({
      ...input,
      id: input.id ?? newId(),
      updatedAt: this.#now(),
      deleted: false,
    })
    await this.#writeSnippet(snippet)
    this.#emit('snippets')
    return snippet
  }

  async deleteSnippet(id: string): Promise<void> {
    await this.#db.exec('UPDATE snippets SET deleted = 1, updated_at = ? WHERE id = ?', [
      this.#now(),
      id,
    ])
    this.#emit('snippets')
  }

  async #writeSnippet(s: Snippet): Promise<void> {
    await this.#db.exec(
      `INSERT INTO snippets (id, label, body, tags, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label, body = excluded.body, tags = excluded.tags,
         updated_at = excluded.updated_at, deleted = excluded.deleted`,
      [s.id, s.label, s.body, JSON.stringify(s.tags), s.updatedAt, s.deleted ? 1 : 0],
    )
  }

  // ---- sync support ----

  async rowsChangedSince(iso: string): Promise<{
    hosts: Host[]
    credentials: StoredCredential[]
    snippets: Snippet[]
  }> {
    const [hosts, credentials, snippets] = await Promise.all([
      this.#db.query<HostRow>('SELECT * FROM hosts WHERE updated_at > ?', [iso]),
      this.#db.query<CredentialRow>('SELECT * FROM credentials WHERE updated_at > ?', [iso]),
      this.#db.query<SnippetRow>('SELECT * FROM snippets WHERE updated_at > ?', [iso]),
    ])
    return {
      hosts: hosts.map(toHost),
      credentials: credentials.map(toCredential),
      snippets: snippets.map(toSnippet),
    }
  }

  /**
   * Writes rows that came from the sheet. Unlike `upsert*`, this keeps each
   * row's own `updatedAt` — re-stamping it would push remote rows forward on
   * every pull and break last-write-wins.
   */
  async applyRemote(
    kind: RowKind,
    rows: readonly (Host | StoredCredential | Snippet)[],
  ): Promise<void> {
    if (rows.length === 0) return

    await this.#db.transaction(async () => {
      for (const row of rows) {
        if (kind === 'hosts') await this.#writeHost(hostSchema.parse(row))
        else if (kind === 'credentials') await this.#writeCredential(storedCredentialSchema.parse(row))
        else await this.#writeSnippet(snippetSchema.parse(row))
      }
    })
    this.#emit(kind)
  }

  /** Returns how many tombstones were removed. */
  async pruneTombstones(olderThanIso: string): Promise<number> {
    let removed = 0
    for (const table of ['hosts', 'credentials', 'snippets'] as const) {
      const before = await this.#db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE deleted = 1 AND updated_at < ?`,
        [olderThanIso],
      )
      removed += before[0]?.n ?? 0
      await this.#db.exec(
        `DELETE FROM ${table} WHERE deleted = 1 AND updated_at < ?`,
        [olderThanIso],
      )
    }
    return removed
  }

  async getMetaValue(key: string): Promise<string | null> {
    const rows = await this.#db.query<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      [key],
    )
    return rows[0]?.value ?? null
  }

  async setMetaValue(key: string, value: string): Promise<void> {
    await this.#db.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    )
  }
}

// ---- row mapping ----

interface HostRow {
  id: string
  label: string
  hostname: string
  port: number
  username: string
  auth_ref: string | null
  tags: string
  group_id: string | null
  updated_at: string
  deleted: number
}

interface CredentialRow {
  id: string
  label: string
  kind: string
  cipher: string
  updated_at: string
  deleted: number
}

interface SnippetRow {
  id: string
  label: string
  body: string
  tags: string
  updated_at: string
  deleted: number
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function toHost(row: HostRow): Host {
  return {
    id: row.id,
    label: row.label,
    hostname: row.hostname,
    port: row.port,
    username: row.username,
    authRef: row.auth_ref,
    tags: parseTags(row.tags),
    groupId: row.group_id,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
  }
}

function toCredential(row: CredentialRow): StoredCredential {
  return storedCredentialSchema.parse({
    id: row.id,
    label: row.label,
    kind: row.kind,
    cipher: row.cipher,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
  })
}

function toSnippet(row: SnippetRow): Snippet {
  return {
    id: row.id,
    label: row.label,
    body: row.body,
    tags: parseTags(row.tags),
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
  }
}
```

Note: `Store.open` takes `Pick<Platform, 'db' | 'now'>` rather than the whole platform, so a test needs only what it uses. `SqlValue` is imported for the row types' benefit.

Modify `packages/core/src/index.ts` to add:

```typescript
export * from './store.js'
```

- [x] **Step 5: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run test/store.test.ts`
Expected: PASS, 12 tests.

- [x] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add local store with tombstones and change events"
```

---

## Task 6: Last-write-wins merge

**Files:**
- Create: `packages/core/src/sheet/merge.ts`
- Test: `packages/core/test/merge.test.ts`

**Interfaces:**
- Consumes: `Host`, `StoredCredential`, `Snippet`.
- Produces:
  - `mergeRows<T extends Syncable>(local: readonly T[], remote: readonly T[]): MergeResult<T>`
  - `type Syncable = { id: string; updatedAt: string }`
  - `type MergeResult<T> = { toApplyLocally: T[]; toPushRemotely: T[] }`
  - `tombstoneCutoff(nowIso: string, days?: number): string` — default 90 days (spec §4)

This is the single most bug-prone piece of logic in the plan, which is why it gets a whole task and a case table: both sides edited, one deleted while the other edited, identical timestamps, rows present on only one side.

- [x] **Step 1: Write the failing test**

`packages/core/test/merge.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { mergeRows, tombstoneCutoff } from '../src/sheet/merge.js'

interface Row {
  id: string
  updatedAt: string
  value: string
  deleted?: boolean
}

const row = (id: string, updatedAt: string, value: string, deleted = false): Row => ({
  id,
  updatedAt,
  value,
  deleted,
})

const T0 = '2026-08-28T10:00:00.000Z'
const T1 = '2026-08-28T11:00:00.000Z'
const T2 = '2026-08-28T12:00:00.000Z'

describe('mergeRows', () => {
  it('pushes a row that exists only locally', () => {
    const result = mergeRows([row('a', T0, 'local')], [])
    expect(result.toPushRemotely.map((r) => r.id)).toEqual(['a'])
    expect(result.toApplyLocally).toEqual([])
  })

  it('applies a row that exists only remotely', () => {
    const result = mergeRows<Row>([], [row('a', T0, 'remote')])
    expect(result.toApplyLocally.map((r) => r.value)).toEqual(['remote'])
    expect(result.toPushRemotely).toEqual([])
  })

  it('keeps the newer side when both edited the same row', () => {
    const newerRemote = mergeRows([row('a', T0, 'local')], [row('a', T1, 'remote')])
    expect(newerRemote.toApplyLocally.map((r) => r.value)).toEqual(['remote'])
    expect(newerRemote.toPushRemotely).toEqual([])

    const newerLocal = mergeRows([row('a', T2, 'local')], [row('a', T1, 'remote')])
    expect(newerLocal.toPushRemotely.map((r) => r.value)).toEqual(['local'])
    expect(newerLocal.toApplyLocally).toEqual([])
  })

  it('does nothing when both sides are already identical in time', () => {
    const result = mergeRows([row('a', T1, 'same')], [row('a', T1, 'same')])
    expect(result.toApplyLocally).toEqual([])
    expect(result.toPushRemotely).toEqual([])
  })

  it('breaks an updatedAt tie deterministically, so all devices converge', () => {
    // Same timestamp, different content: without a tie-break, two devices
    // could each keep their own copy forever.
    const seenFromA = mergeRows([row('a', T1, 'from-a')], [row('a', T1, 'from-b')])
    const seenFromB = mergeRows([row('a', T1, 'from-b')], [row('a', T1, 'from-a')])

    const winnerA =
      seenFromA.toApplyLocally[0]?.value ?? seenFromA.toPushRemotely[0]?.value ?? 'from-a'
    const winnerB =
      seenFromB.toApplyLocally[0]?.value ?? seenFromB.toPushRemotely[0]?.value ?? 'from-b'
    expect(winnerA).toBe(winnerB)
  })

  it('lets a newer delete win over an older edit', () => {
    const result = mergeRows([row('a', T0, 'edited')], [row('a', T1, 'gone', true)])
    expect(result.toApplyLocally[0]?.deleted).toBe(true)
  })

  it('lets a newer edit win over an older delete', () => {
    // Undeleting by editing is intentional: the later action is the user's
    // most recent intent.
    const result = mergeRows([row('a', T2, 'edited-again')], [row('a', T1, 'gone', true)])
    expect(result.toPushRemotely[0]?.deleted).toBe(false)
    expect(result.toApplyLocally).toEqual([])
  })

  it('handles a mixed batch in one pass', () => {
    const local = [row('a', T2, 'local-newer'), row('b', T0, 'local-older'), row('c', T1, 'local-only')]
    const remote = [row('a', T0, 'remote-older'), row('b', T2, 'remote-newer'), row('d', T1, 'remote-only')]

    const result = mergeRows(local, remote)

    expect(result.toApplyLocally.map((r) => r.id).sort()).toEqual(['b', 'd'])
    expect(result.toPushRemotely.map((r) => r.id).sort()).toEqual(['a', 'c'])
  })

  it('does not mutate its inputs', () => {
    const local = [row('a', T0, 'local')]
    const remote = [row('a', T1, 'remote')]
    const localCopy = structuredClone(local)
    const remoteCopy = structuredClone(remote)

    mergeRows(local, remote)

    expect(local).toEqual(localCopy)
    expect(remote).toEqual(remoteCopy)
  })
})

describe('tombstoneCutoff', () => {
  it('defaults to 90 days back', () => {
    expect(tombstoneCutoff('2026-08-28T10:00:00.000Z')).toBe('2026-05-30T10:00:00.000Z')
  })

  it('accepts a custom window', () => {
    expect(tombstoneCutoff('2026-08-28T10:00:00.000Z', 1)).toBe('2026-08-27T10:00:00.000Z')
  })
})
```

- [x] **Step 2: Run to see it fail**

Run: `cd packages/core && npx vitest run test/merge.test.ts`
Expected: FAIL — no `src/sheet/merge.ts`.

- [x] **Step 3: Write the merge**

`packages/core/src/sheet/merge.ts`:

```typescript
export interface Syncable {
  id: string
  updatedAt: string
}

export interface MergeResult<T> {
  /** Remote rows that win and should be written into the local store. */
  toApplyLocally: T[]
  /** Local rows that win and should be written to the sheet. */
  toPushRemotely: T[]
}

/**
 * Per-row last-write-wins on `updatedAt` (spec §4). A single-user app almost
 * never sees a real conflict, and an event log would cost far more than it
 * saves here.
 *
 * `updatedAt` is ISO-8601 UTC with fixed width, so string comparison is also
 * chronological comparison. When two sides carry the same timestamp, the
 * larger `id` wins: an arbitrary but *identical* choice on every device, which
 * is what makes the devices converge instead of ping-ponging.
 */
export function mergeRows<T extends Syncable>(
  local: readonly T[],
  remote: readonly T[],
): MergeResult<T> {
  const localById = new Map(local.map((r) => [r.id, r]))
  const remoteById = new Map(remote.map((r) => [r.id, r]))

  const toApplyLocally: T[] = []
  const toPushRemotely: T[] = []

  for (const [id, remoteRow] of remoteById) {
    const localRow = localById.get(id)
    if (localRow === undefined) {
      toApplyLocally.push(remoteRow)
      continue
    }
    const winner = pickWinner(localRow, remoteRow)
    if (winner === 'remote') toApplyLocally.push(remoteRow)
    else if (winner === 'local') toPushRemotely.push(localRow)
    // 'equal' means both sides already agree; nothing to do.
  }

  for (const [id, localRow] of localById) {
    if (!remoteById.has(id)) toPushRemotely.push(localRow)
  }

  return { toApplyLocally, toPushRemotely }
}

function pickWinner<T extends Syncable>(local: T, remote: T): 'local' | 'remote' | 'equal' {
  if (local.updatedAt > remote.updatedAt) return 'local'
  if (local.updatedAt < remote.updatedAt) return 'remote'

  // Same instant. Compare content to avoid a pointless write, then fall back
  // to the id so every device makes the same choice.
  if (sameContent(local, remote)) return 'equal'
  return local.id >= remote.id ? 'local' : 'remote'
}

/**
 * Key-order-independent comparison. Row values are scalars or arrays of
 * scalars, so a shallow walk is enough — and unlike `JSON.stringify`, this does
 * not report a difference merely because two objects list their keys in a
 * different order.
 */
function sameContent(a: object, b: object): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const av = (a as Record<string, unknown>)[key]
    const bv = (b as Record<string, unknown>)[key]
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length || av.some((v, i) => v !== bv[i])) return false
    } else if (av !== bv) {
      return false
    }
  }
  return true
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Tombstones older than this can go: every device has had ample time to see
 * the delete (spec §4).
 */
export function tombstoneCutoff(nowIso: string, days = 90): string {
  return new Date(Date.parse(nowIso) - days * MS_PER_DAY).toISOString()
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run test/merge.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add last-write-wins row merge with deterministic tie-break"
```

---

## Task 7: Sheet row serialisation and REST client

**Files:**
- Create: `packages/core/src/sheet/rows.ts`, `packages/core/src/sheet/client.ts`
- Create: `packages/core/test/fakes/http.ts`
- Test: `packages/core/test/sheetRows.test.ts`, `packages/core/test/sheetClient.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `Host`, `StoredCredential`, `Snippet`, `VaultMeta`, `CoreError`.
- Produces from `rows.ts`:
  - `HOST_COLUMNS`, `CREDENTIAL_COLUMNS`, `SNIPPET_COLUMNS` — the header rows, in order
  - `hostToRow(h): string[]` / `rowToHost(cells): Host` (and the same pairs for credentials and snippets)
  - `metaToRows(m): string[][]` / `rowsToMeta(rows): VaultMeta`
- Produces from `client.ts` a `SheetClient` class:
  - `constructor(net: HttpClient, accessToken: () => Promise<string>)`
  - `async createSpreadsheet(title): Promise<string>` — creates the four tabs with headers, returns the id
  - `async findSpreadsheetByTitle(title): Promise<string | null>` — Drive `files.list` under `drive.file`; a second device must reuse the existing sheet (spec §4)
  - `async readTab(spreadsheetId, tab): Promise<string[][]>`
  - `async writeRows(spreadsheetId, tab, rowIndexToCells): Promise<void>` — one `values:batchUpdate`
  - `async appendRows(spreadsheetId, tab, rows): Promise<void>`
  - `async findRowIndexes(spreadsheetId, tab): Promise<Map<string, number>>` — id → 1-based row number
- `SheetClient` retries `429` and `5xx` with exponential backoff and jitter, and surfaces `CoreError('sheet_quota')` when it gives up (spec §7).

- [x] **Step 1: Write the fake HTTP client**

`packages/core/test/fakes/http.ts`:

```typescript
import type { HttpClient, HttpResponse } from '../../src/platform.js'

export interface RecordedRequest {
  method: string
  url: string
  body: string | undefined
  headers: Record<string, string>
}

type Responder = (req: RecordedRequest) => HttpResponse | Promise<HttpResponse>

export class FakeHttp implements HttpClient {
  readonly requests: RecordedRequest[] = []
  #responders: Responder[] = []
  #fallback: HttpResponse = { status: 200, body: '{}' }

  /** Queues one response, consumed by the next matching request. */
  enqueue(...responses: (HttpResponse | Responder)[]): void {
    for (const r of responses) {
      this.#responders.push(typeof r === 'function' ? r : () => r)
    }
  }

  setFallback(response: HttpResponse): void {
    this.#fallback = response
  }

  async request(init: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    headers?: Readonly<Record<string, string>>
    body?: string
  }): Promise<HttpResponse> {
    const recorded: RecordedRequest = {
      method: init.method,
      url: init.url,
      body: init.body,
      headers: { ...(init.headers ?? {}) },
    }
    this.requests.push(recorded)

    const responder = this.#responders.shift()
    return responder === undefined ? this.#fallback : responder(recorded)
  }
}

export const json = (status: number, value: unknown): HttpResponse => ({
  status,
  body: JSON.stringify(value),
})
```

- [x] **Step 2: Write the failing row-serialisation test**

`packages/core/test/sheetRows.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_COLUMNS,
  HOST_COLUMNS,
  SNIPPET_COLUMNS,
  credentialToRow,
  hostToRow,
  metaToRows,
  rowToCredential,
  rowToHost,
  rowToSnippet,
  rowsToMeta,
  snippetToRow,
} from '../src/sheet/rows.js'
import { DEFAULT_KDF_PARAMS, SCHEMA_VERSION, type Host } from '../src/model.js'

const host: Host = {
  id: 'h1',
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 2222,
  username: 'deploy',
  authRef: 'c1',
  tags: ['prod', 'eu'],
  groupId: 'g1',
  updatedAt: '2026-08-28T10:00:00.000Z',
  deleted: false,
}

describe('host rows', () => {
  it('round-trips a host', () => {
    expect(rowToHost(hostToRow(host))).toEqual(host)
  })

  it('emits one cell per declared column, in order', () => {
    const row = hostToRow(host)
    expect(row).toHaveLength(HOST_COLUMNS.length)
    expect(row[HOST_COLUMNS.indexOf('hostname')]).toBe('web1.example.com')
  })

  it('keeps hostname and username as plaintext, which the spec chose deliberately', () => {
    const row = hostToRow(host)
    expect(row).toContain('web1.example.com')
    expect(row).toContain('deploy')
  })

  it('round-trips nulls as empty cells', () => {
    const bare = { ...host, authRef: null, groupId: null }
    const row = hostToRow(bare)
    expect(row[HOST_COLUMNS.indexOf('auth_ref')]).toBe('')
    expect(rowToHost(row)).toEqual(bare)
  })

  it('round-trips an empty tag list', () => {
    const untagged = { ...host, tags: [] }
    expect(rowToHost(hostToRow(untagged)).tags).toEqual([])
  })

  it('round-trips a tombstone', () => {
    const gone = { ...host, deleted: true }
    expect(rowToHost(hostToRow(gone)).deleted).toBe(true)
  })

  it('tolerates a short row from a hand-edited sheet by treating missing cells as empty', () => {
    const row = hostToRow(host).slice(0, 5)
    expect(() => rowToHost(row)).toThrow()
  })

  it('rejects a row whose port is not a number', () => {
    const row = hostToRow(host)
    row[HOST_COLUMNS.indexOf('port')] = 'twenty-two'
    expect(() => rowToHost(row)).toThrow()
  })
})

describe('credential rows', () => {
  it('round-trips a credential and keeps the cipher opaque', () => {
    const credential = {
      id: 'c1',
      label: 'deploy key',
      kind: 'key' as const,
      cipher: 'AAAABBBBCCCC',
      updatedAt: '2026-08-28T10:00:00.000Z',
      deleted: false,
    }
    const row = credentialToRow(credential)
    expect(row).toHaveLength(CREDENTIAL_COLUMNS.length)
    expect(row[CREDENTIAL_COLUMNS.indexOf('cipher')]).toBe('AAAABBBBCCCC')
    expect(rowToCredential(row)).toEqual(credential)
  })
})

describe('snippet rows', () => {
  it('round-trips a multi-line body', () => {
    const snippet = {
      id: 's1',
      label: 'restart',
      body: 'systemctl restart nginx\nsystemctl status nginx',
      tags: ['nginx'],
      updatedAt: '2026-08-28T10:00:00.000Z',
      deleted: false,
    }
    const row = snippetToRow(snippet)
    expect(row).toHaveLength(SNIPPET_COLUMNS.length)
    expect(rowToSnippet(row)).toEqual(snippet)
  })
})

describe('meta rows', () => {
  it('round-trips vault meta as key/value pairs', () => {
    const meta = {
      schemaVersion: SCHEMA_VERSION,
      kdfSalt: 'c2FsdA',
      kdfParams: DEFAULT_KDF_PARAMS,
      vaultCheck: 'Y2hlY2s',
    }
    expect(rowsToMeta(metaToRows(meta))).toEqual(meta)
  })

  it('throws when a required meta key is missing', () => {
    expect(() => rowsToMeta([['schema_version', '1']])).toThrow()
  })
})
```

- [x] **Step 3: Run to see it fail**

Run: `cd packages/core && npx vitest run test/sheetRows.test.ts`
Expected: FAIL — no `src/sheet/rows.ts`.

- [x] **Step 4: Write the row serialisation**

`packages/core/src/sheet/rows.ts`:

```typescript
import { CoreError } from '../errors.js'
import {
  hostSchema,
  snippetSchema,
  storedCredentialSchema,
  vaultMetaSchema,
  type Host,
  type Snippet,
  type StoredCredential,
  type VaultMeta,
} from '../model.js'

/**
 * Column order is API: existing sheets are read by position. Append new
 * columns at the end; never reorder or remove.
 */
export const HOST_COLUMNS = [
  'id',
  'label',
  'hostname',
  'port',
  'username',
  'auth_ref',
  'tags',
  'group_id',
  'updated_at',
  'deleted',
] as const

export const CREDENTIAL_COLUMNS = [
  'id',
  'label',
  'kind',
  'cipher',
  'updated_at',
  'deleted',
] as const

export const SNIPPET_COLUMNS = ['id', 'label', 'body', 'tags', 'updated_at', 'deleted'] as const

export const META_COLUMNS = ['key', 'value'] as const

export const TABS = {
  hosts: 'hosts',
  credentials: 'credentials',
  snippets: 'snippets',
  meta: 'meta',
} as const

export type TabName = (typeof TABS)[keyof typeof TABS]

function cell(cells: readonly string[], columns: readonly string[], name: string): string {
  const index = columns.indexOf(name)
  const value = cells[index]
  if (value === undefined) {
    throw new CoreError(
      'sheet_bad_row',
      `row is missing the ${name} column (expected ${columns.length} cells, got ${cells.length})`,
    )
  }
  return value
}

const encodeTags = (tags: readonly string[]): string => tags.join(',')
const decodeTags = (raw: string): string[] =>
  raw.length === 0 ? [] : raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0)

const encodeBool = (v: boolean): string => (v ? 'TRUE' : 'FALSE')
const decodeBool = (raw: string): boolean => raw.toUpperCase() === 'TRUE'

const encodeNullable = (v: string | null): string => v ?? ''
const decodeNullable = (raw: string): string | null => (raw.length === 0 ? null : raw)

export function hostToRow(host: Host): string[] {
  return [
    host.id,
    host.label,
    host.hostname,
    String(host.port),
    host.username,
    encodeNullable(host.authRef),
    encodeTags(host.tags),
    encodeNullable(host.groupId),
    host.updatedAt,
    encodeBool(host.deleted),
  ]
}

export function rowToHost(cells: readonly string[]): Host {
  const get = (name: string): string => cell(cells, HOST_COLUMNS, name)
  const port = Number(get('port'))
  if (!Number.isInteger(port)) {
    throw new CoreError('sheet_bad_row', `port is not an integer: ${get('port')}`)
  }
  return hostSchema.parse({
    id: get('id'),
    label: get('label'),
    hostname: get('hostname'),
    port,
    username: get('username'),
    authRef: decodeNullable(get('auth_ref')),
    tags: decodeTags(get('tags')),
    groupId: decodeNullable(get('group_id')),
    updatedAt: get('updated_at'),
    deleted: decodeBool(get('deleted')),
  })
}

export function credentialToRow(c: StoredCredential): string[] {
  return [c.id, c.label, c.kind, c.cipher, c.updatedAt, encodeBool(c.deleted)]
}

export function rowToCredential(cells: readonly string[]): StoredCredential {
  const get = (name: string): string => cell(cells, CREDENTIAL_COLUMNS, name)
  return storedCredentialSchema.parse({
    id: get('id'),
    label: get('label'),
    kind: get('kind'),
    cipher: get('cipher'),
    updatedAt: get('updated_at'),
    deleted: decodeBool(get('deleted')),
  })
}

export function snippetToRow(s: Snippet): string[] {
  return [s.id, s.label, s.body, encodeTags(s.tags), s.updatedAt, encodeBool(s.deleted)]
}

export function rowToSnippet(cells: readonly string[]): Snippet {
  const get = (name: string): string => cell(cells, SNIPPET_COLUMNS, name)
  return snippetSchema.parse({
    id: get('id'),
    label: get('label'),
    body: get('body'),
    tags: decodeTags(get('tags')),
    updatedAt: get('updated_at'),
    deleted: decodeBool(get('deleted')),
  })
}

/** `meta` is key/value rather than columnar, so new settings need no migration. */
export function metaToRows(meta: VaultMeta): string[][] {
  return [
    ['schema_version', String(meta.schemaVersion)],
    ['kdf_salt', meta.kdfSalt],
    ['kdf_m', String(meta.kdfParams.m)],
    ['kdf_t', String(meta.kdfParams.t)],
    ['kdf_p', String(meta.kdfParams.p)],
    ['vault_check', meta.vaultCheck],
  ]
}

export function rowsToMeta(rows: readonly (readonly string[])[]): VaultMeta {
  const map = new Map<string, string>()
  for (const row of rows) {
    const key = row[0]
    const value = row[1]
    if (key !== undefined && value !== undefined) map.set(key, value)
  }

  const need = (key: string): string => {
    const value = map.get(key)
    if (value === undefined) {
      throw new CoreError('sheet_bad_meta', `the meta tab is missing ${key}`)
    }
    return value
  }

  return vaultMetaSchema.parse({
    schemaVersion: Number(need('schema_version')),
    kdfSalt: need('kdf_salt'),
    kdfParams: { m: Number(need('kdf_m')), t: Number(need('kdf_t')), p: Number(need('kdf_p')) },
    vaultCheck: need('vault_check'),
  })
}
```

- [x] **Step 5: Run the row test to verify it passes**

Run: `cd packages/core && npx vitest run test/sheetRows.test.ts`
Expected: PASS, 13 tests.

- [x] **Step 6: Write the failing client test**

`packages/core/test/sheetClient.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { SheetClient } from '../src/sheet/client.js'
import { FakeHttp, json } from './fakes/http.js'

const token = async () => 'test-access-token'
/** No real waiting in tests: the backoff schedule is injected. */
const noSleep = async () => {}

function client(http: FakeHttp) {
  return new SheetClient(http, token, { sleep: noSleep, maxAttempts: 4 })
}

describe('SheetClient', () => {
  it('sends the bearer token on every request', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { values: [] }))
    await client(http).readTab('sheet-1', 'hosts')
    expect(http.requests[0]?.headers.Authorization).toBe('Bearer test-access-token')
  })

  it('reads a tab and drops the header row', async () => {
    const http = new FakeHttp()
    http.enqueue(
      json(200, {
        values: [
          ['id', 'label'],
          ['h1', 'web-1'],
          ['h2', 'web-2'],
        ],
      }),
    )
    const rows = await client(http).readTab('sheet-1', 'hosts')
    expect(rows).toEqual([
      ['h1', 'web-1'],
      ['h2', 'web-2'],
    ])
  })

  it('returns an empty array for a tab with only a header', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { values: [['id', 'label']] }))
    expect(await client(http).readTab('sheet-1', 'hosts')).toEqual([])
  })

  it('returns an empty array when the response has no values at all', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, {}))
    expect(await client(http).readTab('sheet-1', 'hosts')).toEqual([])
  })

  it('writes rows by index in a single batchUpdate', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { totalUpdatedCells: 4 }))

    await client(http).writeRows(
      'sheet-1',
      'hosts',
      new Map([
        [2, ['h1', 'web-1']],
        [5, ['h2', 'web-2']],
      ]),
    )

    expect(http.requests).toHaveLength(1)
    const request = http.requests[0]!
    expect(request.url).toContain('/values:batchUpdate')
    const body = JSON.parse(request.body ?? '{}') as {
      valueInputOption: string
      data: { range: string; values: string[][] }[]
    }
    // RAW so a hostname like "=cmd" is never interpreted as a formula.
    expect(body.valueInputOption).toBe('RAW')
    expect(body.data).toHaveLength(2)
    expect(body.data[0]?.range).toBe('hosts!A2')
    expect(body.data[1]?.range).toBe('hosts!A5')
  })

  it('makes no request when there is nothing to write', async () => {
    const http = new FakeHttp()
    await client(http).writeRows('sheet-1', 'hosts', new Map())
    expect(http.requests).toEqual([])
  })

  it('appends rows with INSERT_ROWS', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { updates: { updatedRows: 1 } }))

    await client(http).appendRows('sheet-1', 'hosts', [['h3', 'web-3']])

    const request = http.requests[0]!
    expect(request.url).toContain(':append')
    expect(request.url).toContain('insertDataOption=INSERT_ROWS')
  })

  it('maps ids to 1-based row numbers, accounting for the header', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { values: [['id'], ['h1'], ['h2'], ['h3']] }))

    const indexes = await client(http).findRowIndexes('sheet-1', 'hosts')

    // Header is row 1, so the first data row is row 2.
    expect(indexes.get('h1')).toBe(2)
    expect(indexes.get('h3')).toBe(4)
    expect(indexes.size).toBe(3)
  })

  it('retries a 429 and succeeds', async () => {
    const http = new FakeHttp()
    http.enqueue(json(429, { error: { message: 'quota' } }), json(200, { values: [] }))

    const rows = await client(http).readTab('sheet-1', 'hosts')

    expect(rows).toEqual([])
    expect(http.requests).toHaveLength(2)
  })

  it('retries a 503 and succeeds', async () => {
    const http = new FakeHttp()
    http.enqueue(json(503, {}), json(200, { values: [] }))
    await client(http).readTab('sheet-1', 'hosts')
    expect(http.requests).toHaveLength(2)
  })

  it('gives up after maxAttempts and reports a quota error', async () => {
    const http = new FakeHttp()
    http.setFallback(json(429, { error: { message: 'quota exceeded' } }))

    await expect(client(http).readTab('sheet-1', 'hosts')).rejects.toMatchObject({
      code: 'sheet_quota',
    })
    expect(http.requests).toHaveLength(4)
  })

  it('does not retry a 400, which will never succeed', async () => {
    const http = new FakeHttp()
    http.setFallback(json(400, { error: { message: 'bad range' } }))

    await expect(client(http).readTab('sheet-1', 'hosts')).rejects.toMatchObject({
      code: 'sheet_request',
    })
    expect(http.requests).toHaveLength(1)
  })

  it('reports an auth failure distinctly, since it needs a new token not a retry', async () => {
    const http = new FakeHttp()
    http.setFallback(json(401, { error: { message: 'invalid credentials' } }))

    await expect(client(http).readTab('sheet-1', 'hosts')).rejects.toMatchObject({
      code: 'sheet_unauthorized',
    })
    expect(http.requests).toHaveLength(1)
  })

  it('creates a spreadsheet with all four tabs and their headers', async () => {
    const http = new FakeHttp()
    http.enqueue(
      json(200, { spreadsheetId: 'new-sheet-id' }),
      json(200, { totalUpdatedCells: 24 }),
    )

    const id = await client(http).createSpreadsheet('Termif')

    expect(id).toBe('new-sheet-id')
    const create = JSON.parse(http.requests[0]?.body ?? '{}') as {
      sheets: { properties: { title: string } }[]
    }
    expect(create.sheets.map((s) => s.properties.title)).toEqual([
      'hosts',
      'credentials',
      'snippets',
      'meta',
    ])

    // The second call writes the header row into each tab.
    const headers = JSON.parse(http.requests[1]?.body ?? '{}') as {
      data: { range: string; values: string[][] }[]
    }
    expect(headers.data).toHaveLength(4)
    expect(headers.data[0]?.values[0]?.[0]).toBe('id')
  })

  it('finds an existing Termif spreadsheet by title', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { files: [{ id: 'existing-sheet' }] }))

    expect(await client(http).findSpreadsheetByTitle('Termif')).toBe('existing-sheet')

    const url = http.requests[0]?.url ?? ''
    expect(url).toContain('https://www.googleapis.com/drive/v3/files')
    expect(url).toContain(encodeURIComponent("name = 'Termif'"))
    expect(url).toContain('orderBy=createdTime')
  })

  it('returns null when no Termif spreadsheet exists yet', async () => {
    const http = new FakeHttp()
    http.enqueue(json(200, { files: [] }))

    expect(await client(http).findSpreadsheetByTitle('Termif')).toBeNull()
  })
})
```

- [x] **Step 7: Run to see it fail**

Run: `cd packages/core && npx vitest run test/sheetClient.test.ts`
Expected: FAIL — no `src/sheet/client.ts`.

- [x] **Step 8: Write the client**

`packages/core/src/sheet/client.ts`:

```typescript
import { CoreError } from '../errors.js'
import type { HttpClient } from '../platform.js'
import {
  CREDENTIAL_COLUMNS,
  HOST_COLUMNS,
  META_COLUMNS,
  SNIPPET_COLUMNS,
  TABS,
  type TabName,
} from './rows.js'

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

export interface SheetClientOptions {
  /** Injected so tests do not wait. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Thin wrapper over the Sheets REST API. Retries the failures that are worth
 * retrying and gives up loudly on the ones that are not, so `sync` can decide
 * whether to stay offline (spec §7).
 */
export class SheetClient {
  readonly #net: HttpClient
  readonly #accessToken: () => Promise<string>
  readonly #sleep: (ms: number) => Promise<void>
  readonly #maxAttempts: number

  constructor(
    net: HttpClient,
    accessToken: () => Promise<string>,
    options: SheetClientOptions = {},
  ) {
    this.#net = net
    this.#accessToken = accessToken
    this.#sleep = options.sleep ?? defaultSleep
    this.#maxAttempts = options.maxAttempts ?? 5
  }

  async createSpreadsheet(title: string): Promise<string> {
    const created = await this.#send<{ spreadsheetId?: string }>({
      method: 'POST',
      url: API,
      body: {
        properties: { title },
        sheets: Object.values(TABS).map((name) => ({ properties: { title: name } })),
      },
    })

    const id = created.spreadsheetId
    if (id === undefined) {
      throw new CoreError('sheet_request', 'Sheets did not return a spreadsheet id')
    }

    // Header rows, written positionally, because readers index by column order.
    await this.#send({
      method: 'POST',
      url: `${API}/${id}/values:batchUpdate`,
      body: {
        valueInputOption: 'RAW',
        data: [
          { range: `${TABS.hosts}!A1`, values: [[...HOST_COLUMNS]] },
          { range: `${TABS.credentials}!A1`, values: [[...CREDENTIAL_COLUMNS]] },
          { range: `${TABS.snippets}!A1`, values: [[...SNIPPET_COLUMNS]] },
          { range: `${TABS.meta}!A1`, values: [[...META_COLUMNS]] },
        ],
      },
    })

    return id
  }

  /**
   * A second device must attach the sheet the first device created, not open a
   * new vault. `drive.file` lists only files this app created for this user.
   * Oldest match wins so two racing first-runs still converge.
   */
  async findSpreadsheetByTitle(title: string): Promise<string | null> {
    const escaped = title.replace(/'/g, "\\'")
    const q = encodeURIComponent(
      `name = '${escaped}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    )
    const response = await this.#send<{ files?: { id?: string }[] }>({
      method: 'GET',
      url: `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime&pageSize=1`,
    })
    const id = response.files?.[0]?.id
    return id === undefined || id.length === 0 ? null : id
  }

  /** Returns data rows only; the header row is dropped. */
  async readTab(spreadsheetId: string, tab: TabName): Promise<string[][]> {
    const range = encodeURIComponent(`${tab}!A1:Z100000`)
    const response = await this.#send<{ values?: string[][] }>({
      method: 'GET',
      url: `${API}/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`,
    })
    const values = response.values ?? []
    return values.slice(1).map((row) => row.map((cell) => (cell === null ? '' : String(cell))))
  }

  /** `rowIndexToCells` keys are 1-based sheet row numbers. */
  async writeRows(
    spreadsheetId: string,
    tab: TabName,
    rowIndexToCells: ReadonlyMap<number, readonly string[]>,
  ): Promise<void> {
    if (rowIndexToCells.size === 0) return

    const data = [...rowIndexToCells.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rowIndex, cells]) => ({ range: `${tab}!A${rowIndex}`, values: [[...cells]] }))

    await this.#send({
      method: 'POST',
      url: `${API}/${spreadsheetId}/values:batchUpdate`,
      // RAW, never USER_ENTERED: a label or hostname beginning with "=" must
      // stay text rather than becoming a formula.
      body: { valueInputOption: 'RAW', data },
    })
  }

  async appendRows(
    spreadsheetId: string,
    tab: TabName,
    rows: readonly (readonly string[])[],
  ): Promise<void> {
    if (rows.length === 0) return

    const range = encodeURIComponent(`${tab}!A1`)
    await this.#send({
      method: 'POST',
      url: `${API}/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      body: { values: rows.map((row) => [...row]) },
    })
  }

  /** id → 1-based row number, so an update can target the row that holds it. */
  async findRowIndexes(spreadsheetId: string, tab: TabName): Promise<Map<string, number>> {
    const range = encodeURIComponent(`${tab}!A1:A100000`)
    const response = await this.#send<{ values?: string[][] }>({
      method: 'GET',
      url: `${API}/${spreadsheetId}/values/${range}`,
    })
    const values = response.values ?? []

    const indexes = new Map<string, number>()
    // Skip the header at index 0; sheet rows are 1-based.
    for (let i = 1; i < values.length; i += 1) {
      const id = values[i]?.[0]
      if (id !== undefined && id.length > 0) indexes.set(String(id), i + 1)
    }
    return indexes
  }

  async #send<T>(init: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    body?: unknown
  }): Promise<T> {
    const token = await this.#accessToken()

    let lastStatus = 0
    let lastBody = ''

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const response = await this.#net.request({
        method: init.method,
        url: init.url,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      })

      lastStatus = response.status
      lastBody = response.body

      if (response.status >= 200 && response.status < 300) {
        return (response.body.length === 0 ? {} : JSON.parse(response.body)) as T
      }

      // 401/403 need a fresh token or a scope fix, not a retry.
      if (response.status === 401 || response.status === 403) {
        throw new CoreError('sheet_unauthorized', describe(response.status, response.body))
      }

      // Anything else in the 4xx range will fail identically next time.
      if (response.status < 500 && response.status !== 429) {
        throw new CoreError('sheet_request', describe(response.status, response.body))
      }

      if (attempt < this.#maxAttempts) {
        // Exponential with jitter: several devices retrying in lockstep would
        // otherwise re-collide on every attempt.
        const base = 500 * 2 ** (attempt - 1)
        await this.#sleep(base + Math.floor(Math.random() * 250))
      }
    }

    throw new CoreError('sheet_quota', describe(lastStatus, lastBody))
  }
}

function describe(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    const message = parsed.error?.message
    if (message !== undefined) return `Sheets returned ${status}: ${message}`
  } catch {
    // fall through to the raw body
  }
  return `Sheets returned ${status}: ${body.slice(0, 200)}`
}
```

- [x] **Step 9: Run the client test to verify it passes**

Run: `cd packages/core && npx vitest run test/sheetClient.test.ts`
Expected: PASS, 16 tests.

- [x] **Step 10: Commit**

```bash
git add packages/core
git commit -m "feat(core): add sheet row serialisation and REST client with backoff"
```

---

## Task 8: Sync orchestration

**Files:**
- Create: `packages/core/src/sync.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/sync.test.ts`

**Interfaces:**
- Consumes: `Store`, `SheetClient`, `mergeRows`, `tombstoneCutoff`, row serialisers, `Platform['now']`.
- Produces `SyncEngine` class:
  - `constructor(deps: { store, client, spreadsheetId, now })`
  - `async syncNow(): Promise<SyncOutcome>`
  - `requestSync(): void` — debounced by `debounceMs` (default 2000), coalescing bursts
  - `get status(): SyncStatus` and `onStatus(listener): () => void`
  - `type SyncStatus = { state: 'idle' | 'running' | 'failed'; lastSuccessAt: string | null; lastError: CoreError | null }`
  - `type SyncOutcome = { pulled: number; pushed: number; pruned: number }`
- Never throws from `requestSync`; failures land in `status` so the UI stays usable offline (spec §7).

- [x] **Step 1: Write the failing test**

`packages/core/test/sync.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { SyncEngine } from '../src/sync.js'
import { SheetClient } from '../src/sheet/client.js'
import { Store } from '../src/store.js'
import { createFakeDb } from './fakes/db.js'
import { FakeHttp, json } from './fakes/http.js'
import { hostToRow, HOST_COLUMNS } from '../src/sheet/rows.js'
import type { Host } from '../src/model.js'

const SHEET_ID = 'sheet-1'

function clock(start = '2026-08-28T10:00:00.000Z') {
  let current = start
  return { now: () => current, set: (iso: string) => void (current = iso) }
}

async function setup(c = clock()) {
  const db = await createFakeDb()
  const store = await Store.open({ db, now: c.now })
  const http = new FakeHttp()
  const client = new SheetClient(http, async () => 'token', {
    sleep: async () => {},
    maxAttempts: 2,
  })
  const engine = new SyncEngine({ store, client, spreadsheetId: SHEET_ID, now: c.now })
  return { store, http, engine, clock: c }
}

const remoteHost = (over: Partial<Host> = {}): Host => ({
  id: 'remote-1',
  label: 'from-sheet',
  hostname: 'remote.example.com',
  port: 22,
  username: 'root',
  authRef: null,
  tags: [],
  groupId: null,
  updatedAt: '2026-08-28T09:00:00.000Z',
  deleted: false,
  ...over,
})

/** The four reads a pull performs, in tab order, then the writes. */
function enqueuePull(
  http: FakeHttp,
  opts: { hosts?: string[][]; credentials?: string[][]; snippets?: string[][] } = {},
) {
  http.enqueue(
    json(200, { values: [[...HOST_COLUMNS], ...(opts.hosts ?? [])] }),
    json(200, { values: [['id', 'label', 'kind', 'cipher', 'updated_at', 'deleted'], ...(opts.credentials ?? [])] }),
    json(200, { values: [['id', 'label', 'body', 'tags', 'updated_at', 'deleted'], ...(opts.snippets ?? [])] }),
  )
}

describe('SyncEngine', () => {
  it('pulls a remote row into the local store', async () => {
    const { store, http, engine } = await setup()
    const host = remoteHost()
    enqueuePull(http, { hosts: [hostToRow(host)] })
    http.setFallback(json(200, {}))

    const outcome = await engine.syncNow()

    expect(outcome.pulled).toBeGreaterThanOrEqual(1)
    const local = await store.getHost('remote-1')
    expect(local?.label).toBe('from-sheet')
    // The remote row keeps its own timestamp.
    expect(local?.updatedAt).toBe('2026-08-28T09:00:00.000Z')
  })

  it('pushes a local-only row to the sheet', async () => {
    const { store, http, engine } = await setup()
    await store.upsertHost({
      label: 'local-1',
      hostname: 'local.example.com',
      port: 22,
      username: 'me',
      authRef: null,
      tags: [],
      groupId: null,
    })

    enqueuePull(http)
    // findRowIndexes for hosts, then the append.
    http.enqueue(json(200, { values: [[...HOST_COLUMNS]] }), json(200, { updates: {} }))
    http.setFallback(json(200, {}))

    const outcome = await engine.syncNow()

    expect(outcome.pushed).toBeGreaterThanOrEqual(1)
    const appended = http.requests.find((r) => r.url.includes(':append'))
    expect(appended).toBeDefined()
    expect(appended?.body).toContain('local.example.com')
  })

  it('updates an existing sheet row in place rather than appending a duplicate', async () => {
    const { store, http, engine, clock: c } = await setup()

    // A row that exists in both places, newer locally.
    const shared = await store.upsertHost({
      id: 'shared-1',
      label: 'renamed-locally',
      hostname: 'shared.example.com',
      port: 22,
      username: 'me',
      authRef: null,
      tags: [],
      groupId: null,
    })
    const older = { ...shared, label: 'old-name', updatedAt: '2026-08-27T10:00:00.000Z' }

    enqueuePull(http, { hosts: [hostToRow(older)] })
    // findRowIndexes says shared-1 lives on sheet row 2.
    http.enqueue(
      json(200, { values: [['id'], ['shared-1']] }),
      json(200, { totalUpdatedCells: 10 }),
    )
    http.setFallback(json(200, {}))

    await engine.syncNow()

    const batch = http.requests.find((r) => r.url.includes('/values:batchUpdate'))
    expect(batch).toBeDefined()
    const body = JSON.parse(batch?.body ?? '{}') as { data: { range: string }[] }
    expect(body.data[0]?.range).toBe('hosts!A2')
    expect(http.requests.some((r) => r.url.includes(':append'))).toBe(false)
  })

  it('lets the newer side win when both edited the same row', async () => {
    const { store, http, engine } = await setup()

    await store.upsertHost({
      id: 'conflict-1',
      label: 'local-older',
      hostname: 'c.example.com',
      port: 22,
      username: 'me',
      authRef: null,
      tags: [],
      groupId: null,
    })

    const remoteNewer = remoteHost({
      id: 'conflict-1',
      label: 'remote-newer',
      hostname: 'c.example.com',
      username: 'me',
      updatedAt: '2026-08-28T23:00:00.000Z',
    })
    enqueuePull(http, { hosts: [hostToRow(remoteNewer)] })
    http.setFallback(json(200, {}))

    await engine.syncNow()

    expect((await store.getHost('conflict-1'))?.label).toBe('remote-newer')
  })

  it('records lastSuccessAt and returns to idle after a successful sync', async () => {
    const { http, engine, clock: c } = await setup()
    enqueuePull(http)
    http.setFallback(json(200, {}))

    c.set('2026-08-28T15:00:00.000Z')
    await engine.syncNow()

    expect(engine.status.state).toBe('idle')
    expect(engine.status.lastSuccessAt).toBe('2026-08-28T15:00:00.000Z')
    expect(engine.status.lastError).toBeNull()
  })

  it('records a failure without throwing, so the app keeps working offline', async () => {
    const { http, engine } = await setup()
    http.setFallback(json(429, { error: { message: 'quota' } }))

    const outcome = await engine.syncNow()

    expect(outcome).toEqual({ pulled: 0, pushed: 0, pruned: 0 })
    expect(engine.status.state).toBe('failed')
    expect(engine.status.lastError?.code).toBe('sheet_quota')
  })

  it('notifies status listeners through running and back to idle', async () => {
    const { http, engine } = await setup()
    enqueuePull(http)
    http.setFallback(json(200, {}))

    const states: string[] = []
    engine.onStatus((s) => states.push(s.state))
    await engine.syncNow()

    expect(states[0]).toBe('running')
    expect(states.at(-1)).toBe('idle')
  })

  it('coalesces a burst of requestSync calls into one run', async () => {
    vi.useFakeTimers()
    try {
      const { http, engine } = await setup()
      enqueuePull(http)
      http.setFallback(json(200, {}))

      const spy = vi.spyOn(engine, 'syncNow')
      engine.requestSync()
      engine.requestSync()
      engine.requestSync()

      await vi.advanceTimersByTimeAsync(2100)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not start a second sync while one is running', async () => {
    const { http, engine } = await setup()
    enqueuePull(http)
    http.setFallback(json(200, {}))

    const [a, b] = await Promise.all([engine.syncNow(), engine.syncNow()])
    // The second call observes the first and returns a zero outcome rather
    // than issuing a duplicate set of requests.
    expect([a.pulled + b.pulled]).toBeDefined()
    const readCount = http.requests.filter((r) => r.method === 'GET').length
    expect(readCount).toBeLessThanOrEqual(4)
  })

  it('prunes tombstones older than the 90-day window', async () => {
    const { store, http, engine, clock: c } = await setup()

    const old = await store.upsertHost({
      label: 'ancient',
      hostname: 'a.example.com',
      port: 22,
      username: 'me',
      authRef: null,
      tags: [],
      groupId: null,
    })
    await store.deleteHost(old.id)

    // Move well past the tombstone window.
    c.set('2027-01-01T10:00:00.000Z')
    enqueuePull(http)
    http.setFallback(json(200, {}))

    const outcome = await engine.syncNow()
    expect(outcome.pruned).toBeGreaterThanOrEqual(1)
  })

  it('advances the lastPull marker so the next sync sends less', async () => {
    const { store, http, engine, clock: c } = await setup()
    enqueuePull(http)
    http.setFallback(json(200, {}))

    c.set('2026-08-28T16:00:00.000Z')
    await engine.syncNow()

    expect(await store.getMetaValue('lastPull')).toBe('2026-08-28T16:00:00.000Z')
  })
})
```

- [x] **Step 2: Run to see it fail**

Run: `cd packages/core && npx vitest run test/sync.test.ts`
Expected: FAIL — no `src/sync.ts`.

- [x] **Step 3: Write the sync engine**

`packages/core/src/sync.ts`:

```typescript
import { CoreError, parseFfiError } from './errors.js'
import type { Host, Snippet, StoredCredential } from './model.js'
import type { SheetClient } from './sheet/client.js'
import { mergeRows, tombstoneCutoff, type Syncable } from './sheet/merge.js'
import {
  credentialToRow,
  hostToRow,
  rowToCredential,
  rowToHost,
  rowToSnippet,
  snippetToRow,
  TABS,
  type TabName,
} from './sheet/rows.js'
import type { RowKind, Store } from './store.js'

export interface SyncStatus {
  state: 'idle' | 'running' | 'failed'
  lastSuccessAt: string | null
  lastError: CoreError | null
}

export interface SyncOutcome {
  pulled: number
  pushed: number
  pruned: number
}

export interface SyncEngineDeps {
  store: Store
  client: SheetClient
  spreadsheetId: string
  now: () => string
  /** Burst coalescing window for `requestSync`. */
  debounceMs?: number
  /** Tombstones older than this are pruned. */
  tombstoneDays?: number
}

const LAST_PULL_KEY = 'lastPull'

/** Per-kind wiring so the three row types share one code path. */
const KINDS = [
  {
    kind: 'hosts' as RowKind,
    tab: TABS.hosts as TabName,
    toRow: (r: Syncable) => hostToRow(r as Host),
    fromRow: (cells: string[]) => rowToHost(cells) as Syncable,
  },
  {
    kind: 'credentials' as RowKind,
    tab: TABS.credentials as TabName,
    toRow: (r: Syncable) => credentialToRow(r as StoredCredential),
    fromRow: (cells: string[]) => rowToCredential(cells) as Syncable,
  },
  {
    kind: 'snippets' as RowKind,
    tab: TABS.snippets as TabName,
    toRow: (r: Syncable) => snippetToRow(r as Snippet),
    fromRow: (cells: string[]) => rowToSnippet(cells) as Syncable,
  },
]

/**
 * Pull, merge per row, push. Not realtime: the Sheets API is not built for it
 * and quota would not survive (spec §4). A failure leaves the app fully usable
 * against the local store.
 */
export class SyncEngine {
  readonly #deps: Required<Pick<SyncEngineDeps, 'debounceMs' | 'tombstoneDays'>> & SyncEngineDeps
  readonly #listeners = new Set<(status: SyncStatus) => void>()
  #status: SyncStatus = { state: 'idle', lastSuccessAt: null, lastError: null }
  #running: Promise<SyncOutcome> | null = null
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: SyncEngineDeps) {
    this.#deps = { debounceMs: 2000, tombstoneDays: 90, ...deps }
  }

  get status(): SyncStatus {
    return { ...this.#status }
  }

  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #setStatus(next: Partial<SyncStatus>): void {
    this.#status = { ...this.#status, ...next }
    const snapshot = this.status
    for (const listener of this.#listeners) listener(snapshot)
  }

  /**
   * Debounced: an edit burst (renaming three hosts in a row) produces one
   * sync, not three. Never rejects — check `status` for failures.
   */
  requestSync(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.syncNow()
    }, this.#deps.debounceMs)
  }

  async syncNow(): Promise<SyncOutcome> {
    // A concurrent caller joins the in-flight run rather than duplicating it.
    if (this.#running !== null) return this.#running

    this.#running = this.#run()
    try {
      return await this.#running
    } finally {
      this.#running = null
    }
  }

  async #run(): Promise<SyncOutcome> {
    this.#setStatus({ state: 'running' })
    const startedAt = this.#deps.now()

    try {
      let pulled = 0
      let pushed = 0

      for (const spec of KINDS) {
        const remoteCells = await this.#deps.client.readTab(this.#deps.spreadsheetId, spec.tab)
        const remote: Syncable[] = []
        for (const cells of remoteCells) {
          // One malformed row must not abort the whole sync; skip it and keep going.
          try {
            remote.push(spec.fromRow(cells))
          } catch {
            continue
          }
        }

        const local = await this.#localRows(spec.kind)
        const { toApplyLocally, toPushRemotely } = mergeRows(local, remote)

        if (toApplyLocally.length > 0) {
          await this.#deps.store.applyRemote(
            spec.kind,
            toApplyLocally as unknown as (Host | StoredCredential | Snippet)[],
          )
          pulled += toApplyLocally.length
        }

        if (toPushRemotely.length > 0) {
          await this.#push(spec, toPushRemotely)
          pushed += toPushRemotely.length
        }
      }

      const pruned = await this.#deps.store.pruneTombstones(
        tombstoneCutoff(startedAt, this.#deps.tombstoneDays),
      )

      // Record the instant the pull started, not finished: a row written to the
      // sheet mid-sync must not fall into the gap.
      await this.#deps.store.setMetaValue(LAST_PULL_KEY, startedAt)
      this.#setStatus({ state: 'idle', lastSuccessAt: startedAt, lastError: null })
      return { pulled, pushed, pruned }
    } catch (e) {
      this.#setStatus({ state: 'failed', lastError: parseFfiError(e) })
      return { pulled: 0, pushed: 0, pruned: 0 }
    }
  }

  async #localRows(kind: RowKind): Promise<Syncable[]> {
    // Everything, tombstones included: the sheet needs the deletes too.
    const all = await this.#deps.store.rowsChangedSince('1970-01-01T00:00:00.000Z')
    if (kind === 'hosts') return all.hosts
    if (kind === 'credentials') return all.credentials
    return all.snippets
  }

  async #push(
    spec: (typeof KINDS)[number],
    rows: readonly Syncable[],
  ): Promise<void> {
    const indexes = await this.#deps.client.findRowIndexes(this.#deps.spreadsheetId, spec.tab)

    const updates = new Map<number, string[]>()
    const appends: string[][] = []
    for (const row of rows) {
      const rowIndex = indexes.get(row.id)
      if (rowIndex === undefined) appends.push(spec.toRow(row))
      else updates.set(rowIndex, spec.toRow(row))
    }

    await this.#deps.client.writeRows(this.#deps.spreadsheetId, spec.tab, updates)
    await this.#deps.client.appendRows(this.#deps.spreadsheetId, spec.tab, appends)
  }
}
```

Modify `packages/core/src/index.ts` to add:

```typescript
export * from './sheet/client.js'
export * from './sheet/merge.js'
export * from './sheet/rows.js'
export * from './sync.js'
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run test/sync.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 5: Run the whole suite and typecheck**

Run: `cd packages/core && npx vitest run && npm run typecheck`
Expected: PASS, no type errors.

- [x] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add sync engine with pull, merge, push, and debounce"
```

---

## Task 9: Sessions — drain loop, fan-out, reconnect

**Files:**
- Create: `packages/core/src/sessions.ts`
- Create: `packages/core/test/fakes/ssh.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/sessions.test.ts`

**Interfaces:**
- Consumes: `SshBridge`, `SshEvent`, `Host`, `Vault`, `StoredCredential`, `CoreError`, `t`.
- Produces `SessionManager` class:
  - `constructor(deps: { ssh: SshBridge; now: () => string })`
  - `async start(): Promise<void>` / `async stop(): Promise<void>` — owns the single drain loop
  - `async connect(host: Host, credential: { password?: string; privateKeyPem?: string; passphrase?: string }): Promise<bigint>`
  - `async openTab(sessionId: bigint, cols: number, rows: number): Promise<TabId>`
  - `async writeToTab(tab: TabId, data: Uint8Array): Promise<void>`
  - `async resizeTab(tab: TabId, cols: number, rows: number): Promise<void>`
  - `async closeTab(tab: TabId): Promise<void>`
  - `subscribeTab(tab: TabId, onData: (bytes: Uint8Array) => void): () => void`
  - `onTabClosed(listener: (tab: TabId, exitStatus: number | null) => void): () => void`
  - `onSessionState(listener: (sessionId: bigint, state: SessionState) => void): () => void`
  - `onBridgeEvent(listener: (event: SshEvent) => void): () => void` — tap on the one drain loop, fired before `#handle`. Plan 3 `bootApp` uses this to feed `TransferManager` and `ForwardManager`. A second `nextEvents` loop would race for the same events.
  - `type SessionState = 'connected' | 'reconnecting' | 'closed'`
  - `type TabId = string`
- Reconnect: on `sessionClosed` for a session the manager did not close deliberately, retry with backoff, then reopen a channel per tab. Terminal contents are not restored — plain SSH has no resume (spec §6).

- [x] **Step 1: Write the fake bridge**

`packages/core/test/fakes/ssh.ts`:

```typescript
import type { SshBridge, SshConnectConfig, SshDirEntry, SshEvent } from '../../src/platform.js'

/**
 * Scriptable stand-in for the FFI. `pushEvent` is how a test simulates the
 * Rust side, and `nextEvents` drains the same way the real bridge does.
 */
export class FakeSsh implements SshBridge {
  #events: SshEvent[] = []
  #waiters: (() => void)[] = []
  #nextId = 1n

  readonly connects: SshConnectConfig[] = []
  readonly writes: { channelId: bigint; data: Uint8Array }[] = []
  readonly resizes: { channelId: bigint; cols: number; rows: number }[] = []
  readonly closedChannels: bigint[] = []
  readonly disconnected: bigint[] = []
  readonly openedShells: { sessionId: bigint; cols: number; rows: number }[] = []

  /** Set to make the next `connect` reject. */
  connectError: Error | null = null
  /** Fails the first N connects, then succeeds — for reconnect tests. */
  failConnectsRemaining = 0

  pushEvent(event: SshEvent): void {
    this.#events.push(event)
    const waiter = this.#waiters.shift()
    waiter?.()
  }

  async init(): Promise<void> {}

  async connect(cfg: SshConnectConfig): Promise<bigint> {
    this.connects.push(cfg)
    if (this.failConnectsRemaining > 0) {
      this.failConnectsRemaining -= 1
      throw new Error('connect: refused')
    }
    if (this.connectError !== null) {
      const error = this.connectError
      this.connectError = null
      throw error
    }
    return this.#nextId++
  }

  async disconnect(sessionId: bigint): Promise<void> {
    this.disconnected.push(sessionId)
  }

  async trustHostKey(): Promise<void> {}

  async openShell(sessionId: bigint, cols: number, rows: number): Promise<bigint> {
    this.openedShells.push({ sessionId, cols, rows })
    return this.#nextId++
  }

  async write(channelId: bigint, data: Uint8Array): Promise<void> {
    this.writes.push({ channelId, data })
  }

  async resize(channelId: bigint, cols: number, rows: number): Promise<void> {
    this.resizes.push({ channelId, cols, rows })
  }

  async closeChannel(channelId: bigint): Promise<void> {
    this.closedChannels.push(channelId)
  }

  async sftpList(): Promise<SshDirEntry[]> {
    return []
  }
  async sftpStat(): Promise<SshDirEntry> {
    return { name: 'x', size: 0n, isDir: false, isSymlink: false, mode: 0o644, modifiedUnix: 0 }
  }
  async sftpMkdir(): Promise<void> {}
  async sftpRename(): Promise<void> {}
  async sftpRemove(): Promise<void> {}
  async sftpReadRange(): Promise<Uint8Array> {
    return new Uint8Array()
  }

  readonly uploads: { local: string; remote: string }[] = []
  readonly downloads: { remote: string; local: string }[] = []
  readonly cancelledTransfers: bigint[] = []

  async sftpUpload(_sessionId: bigint, local: string, remote: string): Promise<bigint> {
    this.uploads.push({ local, remote })
    return this.#nextId++
  }

  async sftpDownload(_sessionId: bigint, remote: string, local: string): Promise<bigint> {
    this.downloads.push({ remote, local })
    return this.#nextId++
  }

  async cancelTransfer(transferId: bigint): Promise<void> {
    this.cancelledTransfers.push(transferId)
  }

  readonly localForwards: { localBind: string; remoteHost: string; remotePort: number }[] = []
  readonly remoteForwards: unknown[] = []
  readonly socksForwards: string[] = []
  readonly closedForwards: bigint[] = []
  boundPort = 54321

  async forwardLocal(
    _sessionId: bigint,
    localBind: string,
    remoteHost: string,
    remotePort: number,
  ): Promise<bigint> {
    this.localForwards.push({ localBind, remoteHost, remotePort })
    return this.#nextId++
  }

  async forwardRemote(...args: unknown[]): Promise<bigint> {
    this.remoteForwards.push(args)
    return this.#nextId++
  }

  async forwardSocks(_sessionId: bigint, localBind: string): Promise<bigint> {
    this.socksForwards.push(localBind)
    return this.#nextId++
  }

  async forwardBoundPort(): Promise<number> {
    return this.boundPort
  }

  async closeForward(forwardId: bigint): Promise<void> {
    this.closedForwards.push(forwardId)
  }

  async nextEvents(timeoutMs: number): Promise<SshEvent[]> {
    if (this.#events.length > 0) {
      const batch = this.#events
      this.#events = []
      return batch
    }
    // Mirror the real long poll: resolve early if an event arrives.
    await new Promise<void>((resolve) => {
      this.#waiters.push(resolve)
      setTimeout(resolve, Math.min(timeoutMs, 20))
    })
    const batch = this.#events
    this.#events = []
    return batch
  }
}
```

- [x] **Step 2: Write the failing test**

`packages/core/test/sessions.test.ts`:

```typescript
import { afterEach, describe, expect, it } from 'vitest'
import { SessionManager } from '../src/sessions.js'
import { FakeSsh } from './fakes/ssh.js'
import type { Host } from '../src/model.js'

const host: Host = {
  id: 'h1',
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 22,
  username: 'deploy',
  authRef: 'c1',
  tags: [],
  groupId: null,
  updatedAt: '2026-08-28T10:00:00.000Z',
  deleted: false,
}

const managers: SessionManager[] = []

function makeManager(ssh: FakeSsh, reconnect?: { delaysMs: number[] }) {
  const manager = new SessionManager({
    ssh,
    now: () => '2026-08-28T10:00:00.000Z',
    ...(reconnect === undefined ? {} : { reconnectDelaysMs: reconnect.delaysMs }),
  })
  managers.push(manager)
  return manager
}

afterEach(async () => {
  while (managers.length > 0) await managers.pop()?.stop()
})

/** Waits for `check` to hold, polling briefly — events cross a real event loop. */
async function eventually(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('condition did not become true in time')
}

describe('SessionManager', () => {
  it('connects with a password credential', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })

    expect(sessionId).toBe(1n)
    expect(ssh.connects[0]?.host).toBe('web1.example.com')
    expect(ssh.connects[0]?.password).toBe('pw')
    expect(ssh.connects[0]?.privateKeyPem).toBeUndefined()
  })

  it('connects with a key credential and passes the passphrase through', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    await manager.connect(host, { privateKeyPem: '-----BEGIN-----', passphrase: 'secret' })

    expect(ssh.connects[0]?.privateKeyPem).toBe('-----BEGIN-----')
    expect(ssh.connects[0]?.passphrase).toBe('secret')
    expect(ssh.connects[0]?.password).toBeUndefined()
  })

  it('rejects a connect with neither credential', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    await expect(manager.connect(host, {})).rejects.toMatchObject({ code: 'auth' })
  })

  it('translates a bridge error into a CoreError with its code', async () => {
    const ssh = new FakeSsh()
    ssh.connectError = new Error('host_key_unknown: unknown host key for web1.example.com')
    const manager = makeManager(ssh)
    await manager.start()

    await expect(manager.connect(host, { password: 'pw' })).rejects.toMatchObject({
      code: 'host_key_unknown',
    })
  })

  it('delivers channel data only to the subscribing tab', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    const tabA = await manager.openTab(sessionId, 80, 24)
    const tabB = await manager.openTab(sessionId, 80, 24)

    const seenA: string[] = []
    const seenB: string[] = []
    manager.subscribeTab(tabA, (b) => seenA.push(new TextDecoder().decode(b)))
    manager.subscribeTab(tabB, (b) => seenB.push(new TextDecoder().decode(b)))

    const channelA = manager.channelIdForTab(tabA)!
    const channelB = manager.channelIdForTab(tabB)!
    ssh.pushEvent({ kind: 'channelData', channelId: channelA, bytes: new TextEncoder().encode('to-a') })
    ssh.pushEvent({ kind: 'channelData', channelId: channelB, bytes: new TextEncoder().encode('to-b') })

    await eventually(() => seenA.length > 0 && seenB.length > 0)
    expect(seenA).toEqual(['to-a'])
    expect(seenB).toEqual(['to-b'])
  })

  it('stops delivering after unsubscribe', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    const tab = await manager.openTab(sessionId, 80, 24)
    const seen: string[] = []
    const unsubscribe = manager.subscribeTab(tab, (b) => seen.push(new TextDecoder().decode(b)))

    const channel = manager.channelIdForTab(tab)!
    ssh.pushEvent({ kind: 'channelData', channelId: channel, bytes: new TextEncoder().encode('first') })
    await eventually(() => seen.length === 1)

    unsubscribe()
    ssh.pushEvent({ kind: 'channelData', channelId: channel, bytes: new TextEncoder().encode('second') })
    await new Promise((r) => setTimeout(r, 60))

    expect(seen).toEqual(['first'])
  })

  it('writes and resizes against the tab’s channel', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    const tab = await manager.openTab(sessionId, 80, 24)
    const channel = manager.channelIdForTab(tab)!

    await manager.writeToTab(tab, new TextEncoder().encode('ls\n'))
    await manager.resizeTab(tab, 132, 43)

    expect(ssh.writes[0]?.channelId).toBe(channel)
    expect(ssh.resizes[0]).toEqual({ channelId: channel, cols: 132, rows: 43 })
  })

  it('rejects a write to an unknown tab', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()
    await expect(manager.writeToTab('nope', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'no_such_tab',
    })
  })

  it('taps every drained event before handling it, including kinds it ignores', async () => {
    // Transfer and forward events share this queue. A second nextEvents loop
    // would race; a tap on the one loop is the only safe fan-out (Plan 3 boot).
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const seen: string[] = []
    const unsubscribe = manager.onBridgeEvent((event) => seen.push(event.kind))

    ssh.pushEvent({
      kind: 'transferProgress',
      transferId: 9n,
      done: 1n,
      total: 2n,
    })
    ssh.pushEvent({ kind: 'log', level: 'info', msg: 'hi' })
    await eventually(() => seen.length === 2)

    expect(seen).toEqual(['transferProgress', 'log'])

    unsubscribe()
    ssh.pushEvent({
      kind: 'transferDone',
      transferId: 9n,
      error: null,
    })
    await new Promise((r) => setTimeout(r, 60))
    expect(seen).toEqual(['transferProgress', 'log'])
  })

  it('reports a tab closing with its exit status', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    const tab = await manager.openTab(sessionId, 80, 24)
    const channel = manager.channelIdForTab(tab)!

    const closed: { tab: string; status: number | null }[] = []
    manager.onTabClosed((t, status) => closed.push({ tab: t, status }))

    ssh.pushEvent({ kind: 'channelClosed', channelId: channel, exitStatus: 130 })
    await eventually(() => closed.length === 1)

    expect(closed[0]).toEqual({ tab, status: 130 })
    expect(manager.channelIdForTab(tab)).toBeUndefined()
  })

  it('reconnects after an unexpected session close and reopens each tab', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh, { delaysMs: [1, 1, 1] })
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    await manager.openTab(sessionId, 80, 24)
    await manager.openTab(sessionId, 100, 30)
    expect(ssh.openedShells).toHaveLength(2)

    const states: string[] = []
    manager.onSessionState((_id, state) => states.push(state))

    ssh.pushEvent({ kind: 'sessionClosed', sessionId, reason: 'network changed' })

    // Two tabs are reopened on the new session.
    await eventually(() => ssh.openedShells.length === 4, 4000)
    expect(states).toContain('reconnecting')
    expect(states).toContain('connected')
    // Each tab keeps its own geometry across the reconnect.
    expect(ssh.openedShells[2]?.cols).toBe(80)
    expect(ssh.openedShells[3]?.cols).toBe(100)
  })

  it('gives up after exhausting the reconnect schedule and reports closed', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh, { delaysMs: [1, 1] })
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    await manager.openTab(sessionId, 80, 24)

    const states: string[] = []
    manager.onSessionState((_id, state) => states.push(state))

    ssh.failConnectsRemaining = 99
    ssh.pushEvent({ kind: 'sessionClosed', sessionId, reason: 'gone' })

    await eventually(() => states.includes('closed'), 4000)
    expect(states.filter((s) => s === 'reconnecting').length).toBeGreaterThanOrEqual(1)
  })

  it('does not reconnect a session the caller closed deliberately', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh, { delaysMs: [1] })
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    await manager.openTab(sessionId, 80, 24)
    const shellsBefore = ssh.openedShells.length

    await manager.disconnect(sessionId)
    ssh.pushEvent({ kind: 'sessionClosed', sessionId, reason: 'disconnected by application' })
    await new Promise((r) => setTimeout(r, 80))

    expect(ssh.openedShells).toHaveLength(shellsBefore)
  })

  it('runs exactly one drain loop no matter how many tabs exist', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()
    await manager.start() // second call must be a no-op

    const sessionId = await manager.connect(host, { password: 'pw' })
    await manager.openTab(sessionId, 80, 24)
    await manager.openTab(sessionId, 80, 24)

    expect(manager.drainLoopCount).toBe(1)
  })

  it('stops the drain loop on stop', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()
    await manager.stop()
    expect(manager.drainLoopCount).toBe(0)
  })
})
```

- [x] **Step 3: Run to see it fail**

Run: `cd packages/core && npx vitest run test/sessions.test.ts`
Expected: FAIL — no `src/sessions.ts`.

- [x] **Step 4: Write the session manager**

`packages/core/src/sessions.ts`:

```typescript
import { CoreError, parseFfiError } from './errors.js'
import type { Host } from './model.js'
import { newId } from './model.js'
import type { Platform, SshBridge, SshEvent } from './platform.js'

export type TabId = string
export type SessionState = 'connected' | 'reconnecting' | 'closed'

export interface ConnectCredential {
  password?: string | undefined
  privateKeyPem?: string | undefined
  passphrase?: string | undefined
}

export interface SessionManagerDeps {
  ssh: SshBridge
  now: () => string
  /** Backoff schedule for an unexpected disconnect. */
  reconnectDelaysMs?: number[]
  /** How long each `nextEvents` poll waits. */
  pollTimeoutMs?: number
}

interface TabRecord {
  id: TabId
  sessionId: bigint
  channelId: bigint | null
  cols: number
  rows: number
  subscribers: Set<(bytes: Uint8Array) => void>
}

interface SessionRecord {
  id: bigint
  host: Host
  credential: ConnectCredential
  /** True once the caller asked for a disconnect, which suppresses reconnect. */
  closingDeliberately: boolean
}

const DEFAULT_RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]

/**
 * Owns the single `nextEvents` drain loop and fans bytes out to tabs. Core
 * never parses ANSI — bytes go straight to the emulator, which does it better
 * and on the render thread (spec §6).
 */
export class SessionManager {
  readonly #ssh: SshBridge
  readonly #now: () => string
  readonly #reconnectDelays: number[]
  readonly #pollTimeoutMs: number

  readonly #sessions = new Map<bigint, SessionRecord>()
  readonly #tabs = new Map<TabId, TabRecord>()
  readonly #tabByChannel = new Map<bigint, TabId>()

  readonly #tabClosedListeners = new Set<(tab: TabId, exitStatus: number | null) => void>()
  readonly #sessionStateListeners = new Set<(sessionId: bigint, state: SessionState) => void>()
  readonly #logListeners = new Set<(level: string, msg: string) => void>()
  readonly #bridgeEventListeners = new Set<(event: SshEvent) => void>()

  #draining = false
  #drainPromise: Promise<void> | null = null

  constructor(deps: SessionManagerDeps) {
    this.#ssh = deps.ssh
    this.#now = deps.now
    this.#reconnectDelays = deps.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS
    this.#pollTimeoutMs = deps.pollTimeoutMs ?? 1000
  }

  /** 1 while the loop runs, 0 otherwise — asserted by tests. */
  get drainLoopCount(): number {
    return this.#draining ? 1 : 0
  }

  async start(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    this.#drainPromise = this.#drain()
  }

  async stop(): Promise<void> {
    this.#draining = false
    await this.#drainPromise
    this.#drainPromise = null
  }

  onTabClosed(listener: (tab: TabId, exitStatus: number | null) => void): () => void {
    this.#tabClosedListeners.add(listener)
    return () => this.#tabClosedListeners.delete(listener)
  }

  onSessionState(listener: (sessionId: bigint, state: SessionState) => void): () => void {
    this.#sessionStateListeners.add(listener)
    return () => this.#sessionStateListeners.delete(listener)
  }

  onLog(listener: (level: string, msg: string) => void): () => void {
    this.#logListeners.add(listener)
    return () => this.#logListeners.delete(listener)
  }

  onBridgeEvent(listener: (event: SshEvent) => void): () => void {
    this.#bridgeEventListeners.add(listener)
    return () => this.#bridgeEventListeners.delete(listener)
  }

  async connect(host: Host, credential: ConnectCredential): Promise<bigint> {
    const sessionId = await this.#openConnection(host, credential)
    this.#sessions.set(sessionId, {
      id: sessionId,
      host,
      credential,
      closingDeliberately: false,
    })
    this.#emitSessionState(sessionId, 'connected')
    return sessionId
  }

  async disconnect(sessionId: bigint): Promise<void> {
    const session = this.#sessions.get(sessionId)
    if (session !== undefined) session.closingDeliberately = true

    for (const tab of [...this.#tabs.values()]) {
      if (tab.sessionId === sessionId) this.#forgetTab(tab.id)
    }
    this.#sessions.delete(sessionId)

    try {
      await this.#ssh.disconnect(sessionId)
    } catch (e) {
      // Already gone is not a failure worth surfacing.
      this.#emitLog('debug', `disconnect: ${parseFfiError(e).message}`)
    }
  }

  async openTab(sessionId: bigint, cols: number, rows: number): Promise<TabId> {
    if (!this.#sessions.has(sessionId)) {
      throw new CoreError('no_such_session', 'that session is not open')
    }
    const channelId = await this.#call(() => this.#ssh.openShell(sessionId, cols, rows))
    const id = newId()

    this.#tabs.set(id, { id, sessionId, channelId, cols, rows, subscribers: new Set() })
    this.#tabByChannel.set(channelId, id)
    return id
  }

  subscribeTab(tab: TabId, onData: (bytes: Uint8Array) => void): () => void {
    const record = this.#requireTab(tab)
    record.subscribers.add(onData)
    return () => record.subscribers.delete(onData)
  }

  async writeToTab(tab: TabId, data: Uint8Array): Promise<void> {
    const channelId = this.#requireChannel(tab)
    await this.#call(() => this.#ssh.write(channelId, data))
  }

  async resizeTab(tab: TabId, cols: number, rows: number): Promise<void> {
    const record = this.#requireTab(tab)
    record.cols = cols
    record.rows = rows

    // Bound locally so `strict` keeps the narrowing across the closure.
    const channelId = record.channelId
    if (channelId === null) return // mid-reconnect; the new channel gets this size
    await this.#call(() => this.#ssh.resize(channelId, cols, rows))
  }

  async closeTab(tab: TabId): Promise<void> {
    const record = this.#requireTab(tab)
    const channelId = record.channelId
    this.#forgetTab(tab)
    if (channelId !== null) {
      try {
        await this.#ssh.closeChannel(channelId)
      } catch (e) {
        this.#emitLog('debug', `closeChannel: ${parseFfiError(e).message}`)
      }
    }
  }

  channelIdForTab(tab: TabId): bigint | undefined {
    return this.#tabs.get(tab)?.channelId ?? undefined
  }

  tabsForSession(sessionId: bigint): TabId[] {
    return [...this.#tabs.values()].filter((t) => t.sessionId === sessionId).map((t) => t.id)
  }

  // ---- internals ----

  async #openConnection(host: Host, credential: ConnectCredential): Promise<bigint> {
    const hasPassword = credential.password !== undefined && credential.password.length > 0
    const hasKey = credential.privateKeyPem !== undefined && credential.privateKeyPem.length > 0
    if (hasPassword === hasKey) {
      throw new CoreError('auth', 'supply exactly one of a password or a private key')
    }

    return this.#call(() =>
      this.#ssh.connect({
        host: host.hostname,
        port: host.port,
        username: host.username,
        ...(hasPassword ? { password: credential.password } : {}),
        ...(hasKey ? { privateKeyPem: credential.privateKeyPem } : {}),
        ...(credential.passphrase === undefined ? {} : { passphrase: credential.passphrase }),
        connectTimeoutMs: 15000,
        keepaliveSecs: 30,
      }),
    )
  }

  /** Every bridge call funnels through here so errors arrive as `CoreError`. */
  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw parseFfiError(e)
    }
  }

  async #drain(): Promise<void> {
    while (this.#draining) {
      let events: SshEvent[] = []
      try {
        events = await this.#ssh.nextEvents(this.#pollTimeoutMs)
      } catch (e) {
        this.#emitLog('warn', `nextEvents: ${parseFfiError(e).message}`)
        // Do not spin on a persistent bridge failure.
        await sleep(500)
        continue
      }
      for (const event of events) {
        for (const listener of this.#bridgeEventListeners) listener(event)
        this.#handle(event)
      }
    }
  }

  #handle(event: SshEvent): void {
    switch (event.kind) {
      case 'channelData': {
        const tabId = this.#tabByChannel.get(event.channelId)
        if (tabId === undefined) return
        const record = this.#tabs.get(tabId)
        if (record === undefined) return
        for (const subscriber of record.subscribers) subscriber(event.bytes)
        return
      }
      case 'channelClosed': {
        const tabId = this.#tabByChannel.get(event.channelId)
        if (tabId === undefined) return
        this.#forgetTab(tabId)
        for (const listener of this.#tabClosedListeners) listener(tabId, event.exitStatus)
        return
      }
      case 'sessionClosed': {
        const session = this.#sessions.get(event.sessionId)
        if (session === undefined || session.closingDeliberately) return
        void this.#reconnect(session)
        return
      }
      case 'log': {
        this.#emitLog(event.level, event.msg)
        return
      }
      // transferProgress, transferDone, and forwardAccepted belong to the
      // transfer and forward managers. They tap this loop via onBridgeEvent
      // (Plan 3 bootApp) rather than opening a second nextEvents poll.
      default:
        return
    }
  }

  /**
   * Rebuilds the connection and one channel per tab. Terminal contents cannot
   * be restored — plain SSH has no resume, and pretending otherwise would be a
   * lie to the user (spec §6).
   */
  async #reconnect(session: SessionRecord): Promise<void> {
    const tabs = [...this.#tabs.values()].filter((t) => t.sessionId === session.id)
    for (const tab of tabs) {
      if (tab.channelId !== null) this.#tabByChannel.delete(tab.channelId)
      tab.channelId = null
    }
    this.#sessions.delete(session.id)
    this.#emitSessionState(session.id, 'reconnecting')

    for (const delay of this.#reconnectDelays) {
      if (!this.#draining) return
      await sleep(delay)

      try {
        const newId = await this.#openConnection(session.host, session.credential)
        this.#sessions.set(newId, { ...session, id: newId, closingDeliberately: false })

        for (const tab of tabs) {
          const channelId = await this.#ssh.openShell(newId, tab.cols, tab.rows)
          tab.sessionId = newId
          tab.channelId = channelId
          this.#tabByChannel.set(channelId, tab.id)
        }

        this.#emitSessionState(newId, 'connected')
        return
      } catch (e) {
        this.#emitLog('warn', `reconnect failed: ${parseFfiError(e).message}`)
      }
    }

    this.#emitSessionState(session.id, 'closed')
    for (const tab of tabs) {
      this.#forgetTab(tab.id)
      for (const listener of this.#tabClosedListeners) listener(tab.id, null)
    }
  }

  #forgetTab(tab: TabId): void {
    const record = this.#tabs.get(tab)
    if (record === undefined) return
    if (record.channelId !== null) this.#tabByChannel.delete(record.channelId)
    record.subscribers.clear()
    this.#tabs.delete(tab)
  }

  #requireTab(tab: TabId): TabRecord {
    const record = this.#tabs.get(tab)
    if (record === undefined) throw new CoreError('no_such_tab', 'that tab is not open')
    return record
  }

  #requireChannel(tab: TabId): bigint {
    const record = this.#requireTab(tab)
    if (record.channelId === null) {
      throw new CoreError('tab_reconnecting', 'the tab is reconnecting')
    }
    return record.channelId
  }

  #emitSessionState(sessionId: bigint, state: SessionState): void {
    for (const listener of this.#sessionStateListeners) listener(sessionId, state)
  }

  #emitLog(level: string, msg: string): void {
    for (const listener of this.#logListeners) listener(level, msg)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
```

- [x] **Step 5: Export it and run the test**

Add to `packages/core/src/index.ts`:

```typescript
export * from './sessions.js'
```

Run: `cd packages/core && npx vitest run test/sessions.test.ts && npm run typecheck`
Expected: PASS, 15 tests, no type errors.

- [x] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add session manager with single drain loop and reconnect"
```

---

## Task 10: Transfer queue

**Files:**
- Create: `packages/core/src/transfers.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/transfers.test.ts`

**Interfaces:**
- Consumes: `SshBridge`, `SshEvent`, `CoreError`.
- Produces `TransferManager` class:
  - `constructor(deps: { ssh: SshBridge; maxConcurrent?: number })`
  - `async enqueueUpload(sessionId, local, remote): Promise<string>` (a local queue id)
  - `async enqueueDownload(sessionId, remote, local): Promise<string>`
  - `async cancel(queueId): Promise<void>`
  - `handleEvent(event: SshEvent): void` — fed by the session manager's drain loop
  - `list(): TransferView[]` where `TransferView = { id, kind, local, remote, state, done, total, error }`
  - `onChange(listener: () => void): () => void`
- `maxConcurrent` defaults to 2: more parallel SFTP streams on one session mostly fight each other for the same bandwidth while multiplying memory.

- [x] **Step 1: Write the failing test**

`packages/core/test/transfers.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { TransferManager } from '../src/transfers.js'
import { FakeSsh } from './fakes/ssh.js'

async function eventually(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('condition did not become true in time')
}

describe('TransferManager', () => {
  it('starts an upload and reports it as running', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })

    const id = await manager.enqueueUpload(1n, '/local/a.bin', 'remote/a.bin')

    expect(ssh.uploads).toEqual([{ local: '/local/a.bin', remote: 'remote/a.bin' }])
    const view = manager.list().find((t) => t.id === id)
    expect(view?.state).toBe('running')
    expect(view?.kind).toBe('upload')
  })

  it('starts a download with the arguments in the right order', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })

    await manager.enqueueDownload(1n, 'remote/b.bin', '/local/b.bin')

    expect(ssh.downloads).toEqual([{ remote: 'remote/b.bin', local: '/local/b.bin' }])
  })

  it('updates progress from transferProgress events', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    const id = await manager.enqueueUpload(1n, '/local/a.bin', 'remote/a.bin')
    const bridgeId = manager.bridgeIdFor(id)!

    manager.handleEvent({ kind: 'transferProgress', transferId: bridgeId, done: 512n, total: 2048n })

    const view = manager.list().find((t) => t.id === id)
    expect(view?.done).toBe(512n)
    expect(view?.total).toBe(2048n)
  })

  it('marks a transfer done on success', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    const id = await manager.enqueueUpload(1n, '/local/a.bin', 'remote/a.bin')
    const bridgeId = manager.bridgeIdFor(id)!

    manager.handleEvent({ kind: 'transferDone', transferId: bridgeId, error: null })

    expect(manager.list().find((t) => t.id === id)?.state).toBe('done')
  })

  it('marks a transfer failed and keeps the reason', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    const id = await manager.enqueueUpload(1n, '/local/a.bin', 'remote/a.bin')
    const bridgeId = manager.bridgeIdFor(id)!

    manager.handleEvent({ kind: 'transferDone', transferId: bridgeId, error: 'sftp: permission denied' })

    const view = manager.list().find((t) => t.id === id)
    expect(view?.state).toBe('failed')
    expect(view?.error).toBe('sftp: permission denied')
  })

  it('ignores an event for a transfer it does not know', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    expect(() =>
      manager.handleEvent({ kind: 'transferDone', transferId: 999n, error: null }),
    ).not.toThrow()
  })

  it('queues beyond maxConcurrent and starts the next when one finishes', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh, maxConcurrent: 1 })

    const first = await manager.enqueueUpload(1n, '/a', 'a')
    const second = await manager.enqueueUpload(1n, '/b', 'b')

    // Only the first reached the bridge.
    expect(ssh.uploads).toHaveLength(1)
    expect(manager.list().find((t) => t.id === second)?.state).toBe('queued')

    manager.handleEvent({ kind: 'transferDone', transferId: manager.bridgeIdFor(first)!, error: null })

    await eventually(() => ssh.uploads.length === 2)
    expect(manager.list().find((t) => t.id === second)?.state).toBe('running')
  })

  it('cancels a running transfer through the bridge', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    const id = await manager.enqueueUpload(1n, '/a', 'a')
    const bridgeId = manager.bridgeIdFor(id)!

    await manager.cancel(id)

    expect(ssh.cancelledTransfers).toEqual([bridgeId])
  })

  it('cancels a queued transfer without touching the bridge', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh, maxConcurrent: 1 })
    await manager.enqueueUpload(1n, '/a', 'a')
    const queued = await manager.enqueueUpload(1n, '/b', 'b')

    await manager.cancel(queued)

    expect(ssh.cancelledTransfers).toEqual([])
    expect(manager.list().find((t) => t.id === queued)?.state).toBe('cancelled')
  })

  it('rejects cancelling an unknown transfer', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    await expect(manager.cancel('nope')).rejects.toMatchObject({ code: 'no_such_transfer' })
  })

  it('notifies listeners on state changes', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    let notifications = 0
    manager.onChange(() => notifications += 1)

    const id = await manager.enqueueUpload(1n, '/a', 'a')
    manager.handleEvent({ kind: 'transferProgress', transferId: manager.bridgeIdFor(id)!, done: 1n, total: 2n })
    manager.handleEvent({ kind: 'transferDone', transferId: manager.bridgeIdFor(id)!, error: null })

    expect(notifications).toBeGreaterThanOrEqual(3)
  })
})
```

- [x] **Step 2: Run to see it fail**

Run: `cd packages/core && npx vitest run test/transfers.test.ts`
Expected: FAIL — no `src/transfers.ts`.

- [x] **Step 3: Write the transfer manager**

`packages/core/src/transfers.ts`:

```typescript
import { CoreError, parseFfiError } from './errors.js'
import { newId } from './model.js'
import type { SshBridge, SshEvent } from './platform.js'

export type TransferKind = 'upload' | 'download'
export type TransferState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TransferView {
  id: string
  kind: TransferKind
  local: string
  remote: string
  state: TransferState
  done: bigint
  total: bigint
  error: string | null
}

interface TransferRecord extends TransferView {
  sessionId: bigint
  /** The id the Rust side gave us; absent while queued. */
  bridgeId: bigint | null
}

export interface TransferManagerDeps {
  ssh: SshBridge
  /**
   * Parallel transfers on one session mostly compete for the same bandwidth
   * while multiplying memory, so the default is deliberately low.
   */
  maxConcurrent?: number
}

export class TransferManager {
  readonly #ssh: SshBridge
  readonly #maxConcurrent: number
  readonly #records = new Map<string, TransferRecord>()
  readonly #byBridgeId = new Map<bigint, string>()
  readonly #listeners = new Set<() => void>()

  constructor(deps: TransferManagerDeps) {
    this.#ssh = deps.ssh
    this.#maxConcurrent = deps.maxConcurrent ?? 2
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  list(): TransferView[] {
    return [...this.#records.values()].map(
      ({ sessionId: _s, bridgeId: _b, ...view }) => ({ ...view }),
    )
  }

  bridgeIdFor(id: string): bigint | undefined {
    return this.#records.get(id)?.bridgeId ?? undefined
  }

  async enqueueUpload(sessionId: bigint, local: string, remote: string): Promise<string> {
    return this.#enqueue('upload', sessionId, local, remote)
  }

  async enqueueDownload(sessionId: bigint, remote: string, local: string): Promise<string> {
    return this.#enqueue('download', sessionId, local, remote)
  }

  async cancel(id: string): Promise<void> {
    const record = this.#records.get(id)
    if (record === undefined) {
      throw new CoreError('no_such_transfer', 'that transfer is not in the queue')
    }

    if (record.bridgeId === null) {
      // Never started, so there is nothing for Rust to cancel.
      record.state = 'cancelled'
      this.#emit()
      void this.#pump()
      return
    }

    try {
      await this.#ssh.cancelTransfer(record.bridgeId)
    } catch (e) {
      throw parseFfiError(e)
    }
  }

  /** Fed from the session manager's drain loop. */
  handleEvent(event: SshEvent): void {
    if (event.kind === 'transferProgress') {
      const record = this.#lookup(event.transferId)
      if (record === undefined) return
      record.done = event.done
      record.total = event.total
      this.#emit()
      return
    }

    if (event.kind === 'transferDone') {
      const record = this.#lookup(event.transferId)
      if (record === undefined) return
      record.error = event.error
      record.state =
        event.error === null
          ? 'done'
          : event.error.toLowerCase().includes('cancel')
            ? 'cancelled'
            : 'failed'
      this.#emit()
      void this.#pump()
    }
  }

  async #enqueue(
    kind: TransferKind,
    sessionId: bigint,
    local: string,
    remote: string,
  ): Promise<string> {
    const id = newId()
    this.#records.set(id, {
      id,
      kind,
      local,
      remote,
      state: 'queued',
      done: 0n,
      total: 0n,
      error: null,
      sessionId,
      bridgeId: null,
    })
    this.#emit()
    await this.#pump()
    return id
  }

  /** Starts queued transfers up to the concurrency limit. */
  async #pump(): Promise<void> {
    const running = [...this.#records.values()].filter((r) => r.state === 'running').length
    let slots = this.#maxConcurrent - running
    if (slots <= 0) return

    for (const record of this.#records.values()) {
      if (slots <= 0) break
      if (record.state !== 'queued') continue

      try {
        const bridgeId =
          record.kind === 'upload'
            ? await this.#ssh.sftpUpload(record.sessionId, record.local, record.remote)
            : await this.#ssh.sftpDownload(record.sessionId, record.remote, record.local)

        record.bridgeId = bridgeId
        record.state = 'running'
        this.#byBridgeId.set(bridgeId, record.id)
        slots -= 1
      } catch (e) {
        record.state = 'failed'
        record.error = parseFfiError(e).message
      }
      this.#emit()
    }
  }

  #lookup(bridgeId: bigint): TransferRecord | undefined {
    const id = this.#byBridgeId.get(bridgeId)
    return id === undefined ? undefined : this.#records.get(id)
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}
```

Modify `packages/core/src/index.ts` to add:

```typescript
export * from './transfers.js'
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run test/transfers.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add transfer queue with concurrency limit and cancellation"
```

---

## Task 11: Forward manager

**Files:**
- Create: `packages/core/src/forwards.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/forwards.test.ts`

**Interfaces:**
- Consumes: `SshBridge`, `SshEvent`, `CoreError`.
- Produces `ForwardManager` class:
  - `constructor(deps: { ssh: SshBridge; platformKind: PlatformKind })` where `PlatformKind = 'desktop' | 'ios' | 'android'`
  - `async openLocal(sessionId, localBind, remoteHost, remotePort): Promise<string>`
  - `async openRemote(sessionId, remoteBindHost, remoteBindPort, localHost, localPort): Promise<string>`
  - `async openSocks(sessionId, localBind): Promise<string>`
  - `async close(id): Promise<void>`
  - `handleEvent(event: SshEvent): void`
  - `list(): ForwardView[]` where `ForwardView = { id, kind, description, boundPort, acceptedCount, lastPeer, note }`
  - `async rebuildForSession(oldSessionId, newSessionId): Promise<void>` — called after a reconnect
  - `onChange(listener): () => void`
- `note` carries the platform caveat: on iOS a local or SOCKS forward is foreground-only (spec §5). The manager reports it; it does not pretend to work around an OS limit.

**Scope note (2026-08-28).** v1 ships desktop only, so in practice
`platformKind` is always `'desktop'` and `note` is always `null`. Both are
built anyway, and deliberately:

- `note` is a field on `ForwardView`, which every shell renders. Adding it
  later means changing a type each shell consumes, plus its tests. Leaving the
  seam open costs one nullable field.
- `#noteFor` is four lines and fully covered by the tests below. Deleting the
  two mobile branches would save nothing and lose the record of *why* the field
  exists — which is the part that gets forgotten.

Do not extend this to other platform branching. A nullable field and one small
pure function are the whole budget; anything larger waits until a mobile shell
actually exists to exercise it.

- [x] **Step 1: Write the failing test**

`packages/core/test/forwards.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { ForwardManager } from '../src/forwards.js'
import { FakeSsh } from './fakes/ssh.js'
import { t } from '../src/i18n/index.js'

describe('ForwardManager', () => {
  it('opens a local forward and reports its bound port', async () => {
    const ssh = new FakeSsh()
    ssh.boundPort = 51000
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })

    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)

    expect(ssh.localForwards).toEqual([
      { localBind: '127.0.0.1:0', remoteHost: 'db.internal', remotePort: 5432 },
    ])
    const view = manager.list().find((f) => f.id === id)
    expect(view?.boundPort).toBe(51000)
    expect(view?.kind).toBe('local')
    expect(view?.description).toContain('5432')
  })

  it('opens a SOCKS forward', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openSocks(1n, '127.0.0.1:0')

    expect(ssh.socksForwards).toEqual(['127.0.0.1:0'])
    expect(manager.list().find((f) => f.id === id)?.kind).toBe('socks')
  })

  it('opens a remote forward', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openRemote(1n, '0.0.0.0', 8080, '127.0.0.1', 3000)

    expect(ssh.remoteForwards).toHaveLength(1)
    expect(manager.list().find((f) => f.id === id)?.kind).toBe('remote')
  })

  it('adds the iOS foreground-only note to a local forward', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'ios' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)

    expect(manager.list().find((f) => f.id === id)?.note).toBe(t('forward.iosForegroundOnly'))
  })

  it('adds no note to a remote forward on iOS, which needs no local listener', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'ios' })
    const id = await manager.openRemote(1n, '0.0.0.0', 8080, '127.0.0.1', 3000)

    expect(manager.list().find((f) => f.id === id)?.note).toBeNull()
  })

  it('notes the background service on Android', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'android' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)

    expect(manager.list().find((f) => f.id === id)?.note).toBe(t('forward.androidBackground'))
  })

  it('adds no note on desktop', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)
    expect(manager.list().find((f) => f.id === id)?.note).toBeNull()
  })

  it('counts accepted connections and remembers the last peer', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)
    const bridgeId = manager.bridgeIdFor(id)!

    manager.handleEvent({ kind: 'forwardAccepted', forwardId: bridgeId, peer: '127.0.0.1:40001' })
    manager.handleEvent({ kind: 'forwardAccepted', forwardId: bridgeId, peer: '127.0.0.1:40002' })

    const view = manager.list().find((f) => f.id === id)
    expect(view?.acceptedCount).toBe(2)
    expect(view?.lastPeer).toBe('127.0.0.1:40002')
  })

  it('ignores an accepted event for an unknown forward', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    expect(() =>
      manager.handleEvent({ kind: 'forwardAccepted', forwardId: 999n, peer: 'x' }),
    ).not.toThrow()
  })

  it('closes a forward and drops it from the list', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)
    const bridgeId = manager.bridgeIdFor(id)!

    await manager.close(id)

    expect(ssh.closedForwards).toEqual([bridgeId])
    expect(manager.list()).toEqual([])
  })

  it('rejects closing an unknown forward', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    await expect(manager.close('nope')).rejects.toMatchObject({ code: 'no_such_forward' })
  })

  it('translates a bind failure into a CoreError', async () => {
    const ssh = new FakeSsh()
    ssh.forwardLocal = async () => {
      throw new Error('forward: Address already in use')
    }
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })

    await expect(manager.openLocal(1n, '127.0.0.1:80', 'x', 1)).rejects.toMatchObject({
      code: 'forward',
    })
    expect(manager.list()).toEqual([])
  })

  it('rebuilds forwards onto the new session after a reconnect', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)
    await manager.openSocks(1n, '127.0.0.1:0')
    const before = manager.list().map((f) => f.id)

    await manager.rebuildForSession(1n, 2n)

    // Same logical forwards, re-established on the new session.
    expect(manager.list().map((f) => f.id)).toEqual(before)
    expect(ssh.localForwards).toHaveLength(2)
    expect(ssh.socksForwards).toHaveLength(2)
  })

  it('drops a forward that cannot be rebuilt rather than showing a dead one', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)

    ssh.forwardLocal = async () => {
      throw new Error('forward: Address already in use')
    }
    await manager.rebuildForSession(1n, 2n)

    expect(manager.list().find((f) => f.id === id)).toBeUndefined()
  })
})
```

- [x] **Step 2: Run to see it fail**

Run: `cd packages/core && npx vitest run test/forwards.test.ts`
Expected: FAIL — no `src/forwards.ts`.

- [x] **Step 3: Write the forward manager**

`packages/core/src/forwards.ts`:

```typescript
import { CoreError, parseFfiError } from './errors.js'
import { t } from './i18n/index.js'
import { newId } from './model.js'
import type { SshBridge, SshEvent } from './platform.js'

export type PlatformKind = 'desktop' | 'ios' | 'android'
export type ForwardKind = 'local' | 'remote' | 'socks'

export interface ForwardView {
  id: string
  kind: ForwardKind
  description: string
  boundPort: number | null
  acceptedCount: number
  lastPeer: string | null
  /** Platform caveat to show alongside the forward, or null. */
  note: string | null
}

/** Enough to re-establish the forward after a reconnect. */
type ForwardSpec =
  | { kind: 'local'; localBind: string; remoteHost: string; remotePort: number }
  | {
      kind: 'remote'
      remoteBindHost: string
      remoteBindPort: number
      localHost: string
      localPort: number
    }
  | { kind: 'socks'; localBind: string }

interface ForwardRecord extends ForwardView {
  sessionId: bigint
  bridgeId: bigint
  spec: ForwardSpec
}

export interface ForwardManagerDeps {
  ssh: SshBridge
  platformKind: PlatformKind
}

export class ForwardManager {
  readonly #ssh: SshBridge
  readonly #platformKind: PlatformKind
  readonly #records = new Map<string, ForwardRecord>()
  readonly #byBridgeId = new Map<bigint, string>()
  readonly #listeners = new Set<() => void>()

  constructor(deps: ForwardManagerDeps) {
    this.#ssh = deps.ssh
    this.#platformKind = deps.platformKind
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  list(): ForwardView[] {
    return [...this.#records.values()].map(
      ({ sessionId: _s, bridgeId: _b, spec: _spec, ...view }) => ({ ...view }),
    )
  }

  bridgeIdFor(id: string): bigint | undefined {
    return this.#records.get(id)?.bridgeId
  }

  async openLocal(
    sessionId: bigint,
    localBind: string,
    remoteHost: string,
    remotePort: number,
  ): Promise<string> {
    return this.#open(sessionId, { kind: 'local', localBind, remoteHost, remotePort })
  }

  async openRemote(
    sessionId: bigint,
    remoteBindHost: string,
    remoteBindPort: number,
    localHost: string,
    localPort: number,
  ): Promise<string> {
    return this.#open(sessionId, {
      kind: 'remote',
      remoteBindHost,
      remoteBindPort,
      localHost,
      localPort,
    })
  }

  async openSocks(sessionId: bigint, localBind: string): Promise<string> {
    return this.#open(sessionId, { kind: 'socks', localBind })
  }

  async close(id: string): Promise<void> {
    const record = this.#records.get(id)
    if (record === undefined) {
      throw new CoreError('no_such_forward', 'that forward is not open')
    }

    try {
      await this.#ssh.closeForward(record.bridgeId)
    } catch (e) {
      // Report but still forget it: a forward we cannot close is not one we
      // should keep showing as live.
      const parsed = parseFfiError(e)
      this.#forget(id)
      throw parsed
    }
    this.#forget(id)
  }

  handleEvent(event: SshEvent): void {
    if (event.kind !== 'forwardAccepted') return
    const id = this.#byBridgeId.get(event.forwardId)
    if (id === undefined) return
    const record = this.#records.get(id)
    if (record === undefined) return

    record.acceptedCount += 1
    record.lastPeer = event.peer
    this.#emit()
  }

  /**
   * After a reconnect the old bridge handles are dead, so each forward is
   * re-established on the new session under its original local id — the UI's
   * list stays stable across a network change.
   */
  async rebuildForSession(oldSessionId: bigint, newSessionId: bigint): Promise<void> {
    const affected = [...this.#records.values()].filter((r) => r.sessionId === oldSessionId)

    for (const record of affected) {
      this.#byBridgeId.delete(record.bridgeId)
      try {
        const bridgeId = await this.#start(newSessionId, record.spec)
        record.bridgeId = bridgeId
        record.sessionId = newSessionId
        record.boundPort = await this.#boundPortOrNull(record.spec, bridgeId)
        this.#byBridgeId.set(bridgeId, record.id)
      } catch {
        // A forward that will not come back must not linger as a dead row.
        this.#records.delete(record.id)
      }
    }
    this.#emit()
  }

  async #open(sessionId: bigint, spec: ForwardSpec): Promise<string> {
    let bridgeId: bigint
    try {
      bridgeId = await this.#start(sessionId, spec)
    } catch (e) {
      throw parseFfiError(e)
    }

    const id = newId()
    this.#records.set(id, {
      id,
      kind: spec.kind,
      description: describe(spec),
      boundPort: await this.#boundPortOrNull(spec, bridgeId),
      acceptedCount: 0,
      lastPeer: null,
      note: this.#noteFor(spec.kind),
      sessionId,
      bridgeId,
      spec,
    })
    this.#byBridgeId.set(bridgeId, id)
    this.#emit()
    return id
  }

  async #start(sessionId: bigint, spec: ForwardSpec): Promise<bigint> {
    if (spec.kind === 'local') {
      return this.#ssh.forwardLocal(sessionId, spec.localBind, spec.remoteHost, spec.remotePort)
    }
    if (spec.kind === 'socks') {
      return this.#ssh.forwardSocks(sessionId, spec.localBind)
    }
    return this.#ssh.forwardRemote(
      sessionId,
      spec.remoteBindHost,
      spec.remoteBindPort,
      spec.localHost,
      spec.localPort,
    )
  }

  /** A remote forward has no local listener, so it has no local bound port. */
  async #boundPortOrNull(spec: ForwardSpec, bridgeId: bigint): Promise<number | null> {
    if (spec.kind === 'remote') return null
    try {
      return await this.#ssh.forwardBoundPort(bridgeId)
    } catch {
      return null
    }
  }

  /**
   * States the OS constraint rather than working around it: iOS will not let a
   * background app hold a listening socket, and Android needs a foreground
   * service (spec §5).
   */
  #noteFor(kind: ForwardKind): string | null {
    if (kind === 'remote') return null // no local listener involved
    if (this.#platformKind === 'ios') return t('forward.iosForegroundOnly')
    if (this.#platformKind === 'android') return t('forward.androidBackground')
    return null
  }

  #forget(id: string): void {
    const record = this.#records.get(id)
    if (record !== undefined) this.#byBridgeId.delete(record.bridgeId)
    this.#records.delete(id)
    this.#emit()
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}

function describe(spec: ForwardSpec): string {
  if (spec.kind === 'local') {
    return t('forward.active', { from: spec.localBind, to: `${spec.remoteHost}:${spec.remotePort}` })
  }
  if (spec.kind === 'socks') {
    return t('forward.active', { from: spec.localBind, to: 'SOCKS5' })
  }
  return t('forward.active', {
    from: `${spec.remoteBindHost}:${spec.remoteBindPort}`,
    to: `${spec.localHost}:${spec.localPort}`,
  })
}
```

Modify `packages/core/src/index.ts` to add:

```typescript
export * from './forwards.js'
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run test/forwards.test.ts`
Expected: PASS, 14 tests.

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add forward manager with platform notes and reconnect rebuild"
```

---

## Task 12: Platform-purity guard and CI

**Files:**
- Create: `packages/core/scripts/check-purity.mjs`
- Create: `.github/workflows/core.yml`
- Modify: `packages/core/package.json`
- Test: the script itself is the test; it must fail on a planted violation.

**Interfaces:**
- Consumes: nothing.
- Produces: an `npm run check:purity` script that exits non-zero when `src/` imports a forbidden module, and a CI job that runs typecheck, tests, and the purity check.

This is the mechanical enforcement of the constraint that makes the whole plan work, and a comment asking people not to do it is not enforcement (spec §6).

Two things it buys in v1, before any second shell exists:

- Every test in Tasks 4–11 runs against a fake `Platform` with no Electron in
  the process. One `import { ipcRenderer }` in `src/` and those tests start
  needing a real main process to run at all.
- An accidental `node:crypto` or `node:fs` import would put core's behaviour on
  the host's version of those modules instead of the injected seam, which is
  how a "works on my machine" crypto bug gets in.

`react-native` and its friends stay in the forbidden list. They cannot be
imported today, so the entry costs nothing and holds the line for spec §11.

- [x] **Step 1: Write the checker**

`packages/core/scripts/check-purity.mjs`:

```javascript
#!/usr/bin/env node
// Fails if packages/core/src imports anything platform-specific. Core reaches
// the outside world only through the injected `Platform` interface (spec §6).

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname

const FORBIDDEN = [
  'electron',
  'react-native',
  'react',
  'react-dom',
  '@react-native-async-storage/async-storage',
  'node:fs',
  'node:path',
  'node:os',
  'node:child_process',
  'node:crypto',
  'fs',
  'path',
  'os',
  'child_process',
  'crypto',
]

/** Matches the module specifier of a static import, export-from, or require. */
const SPECIFIER = /(?:from\s+|import\s+|require\()\s*['"]([^'"]+)['"]/g

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.ts')) yield full
  }
}

const violations = []

for await (const file of walk(SRC)) {
  const source = await readFile(file, 'utf8')
  const lines = source.split('\n')

  for (const [index, line] of lines.entries()) {
    // Skip comments so a mention in prose is not a violation.
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

    for (const match of line.matchAll(SPECIFIER)) {
      const specifier = match[1]
      if (FORBIDDEN.includes(specifier)) {
        violations.push(`${file}:${index + 1}: forbidden import of "${specifier}"`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error('packages/core must not import platform modules:\n')
  for (const violation of violations) console.error(`  ${violation}`)
  console.error(
    '\nReach the platform through the injected `Platform` interface instead.',
  )
  process.exit(1)
}

console.log('purity check passed: core imports no platform modules')
```

Add to `packages/core/package.json` scripts:

```json
"check:purity": "node scripts/check-purity.mjs"
```

- [x] **Step 2: Verify the checker passes on the clean tree**

Run: `cd packages/core && npm run check:purity`
Expected: `purity check passed: core imports no platform modules`

- [x] **Step 3: Verify the checker actually catches a violation**

Run:

```bash
cd packages/core
printf "import { readFile } from 'node:fs'\nexport const x = readFile\n" > src/__purity_probe.ts
npm run check:purity; echo "exit code: $?"
rm src/__purity_probe.ts
npm run check:purity
```

Expected: the first check prints `src/__purity_probe.ts:1: forbidden import of "node:fs"` and exits 1; after removing the probe, it passes again. A guard that has never failed is not known to work.

- [x] **Step 4: Write the CI workflow**

`.github/workflows/core.yml`:

```yaml
name: core

on:
  push:
    branches: [main]
  pull_request:

jobs:
  core:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: packages/core/package-lock.json

      - name: Install
        working-directory: packages/core
        run: npm ci

      # Runs first: a platform import is a design break, not a test failure.
      - name: Purity check
        working-directory: packages/core
        run: npm run check:purity

      - name: Typecheck
        working-directory: packages/core
        run: npm run typecheck

      - name: Tests
        working-directory: packages/core
        run: npm test

      - name: Build
        working-directory: packages/core
        run: npm run build
```

- [x] **Step 5: Run the full local gate**

Run:

```bash
cd packages/core
npm run check:purity && npm run typecheck && npm test && npm run build
```

Expected: all four pass. If `npm ci` in CI needs a lockfile, commit `packages/core/package-lock.json` produced by the earlier `npm install`.

- [x] **Step 6: Commit**

```bash
git add packages/core .github/workflows/core.yml
git commit -m "ci(core): enforce platform purity, typecheck, and tests"
```

---

## Plan 2 Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| §4 four tabs and their columns | Task 7 (`HOST_COLUMNS`, `CREDENTIAL_COLUMNS`, `SNIPPET_COLUMNS`, `META_COLUMNS`) |
| §4 only `cipher` encrypted, hostname plaintext | Tasks 4, 7 (a test asserts the plaintext hostname) |
| §4 tombstones, not row deletion | Task 5 (`deleteHost` sets `deleted`), Task 6 |
| §4 90-day tombstone pruning | Tasks 6, 8 |
| §4 Argon2id with params in `meta` | Tasks 3, 4, 7 |
| §4 XChaCha20-Poly1305, AAD = row id | Task 4 |
| §4 `vault_check`, no password hash stored | Task 4 |
| §4 vault key in memory, zeroed on lock | Task 4 |
| §4 "remember this device" behind biometrics | Task 4 |
| §4 pull, merge LWW with id tie-break, push | Tasks 6, 8 |
| §4 find existing spreadsheet before creating one | Task 7 (`findSpreadsheetByTitle`) |
| §4 debounced sync, not realtime | Task 8 |
| §6 one drain loop with a tap for transfers/forwards | Task 9 (`onBridgeEvent`) |
| §6 `Platform` injection, no platform imports | Tasks 1, 12 |
| §6 six core modules | Tasks 4, 5, 8, 9, 10, 11 |
| §6 one drain loop, fan-out, no ANSI parsing | Task 9 |
| §6 reconnect rebuilds channels and forwards; contents not restored | Tasks 9, 11 |
| §6 i18n through `t()`, `en` only | Task 2 |
| §7 error classes, offline default | Tasks 1, 7, 8 |
| §7 host key mismatch is a hard block | Task 1 (`isSecurityBlock`) |
| §8 unit tests with a fake `Platform` | Tasks 4–11 (fakes in `test/fakes/`) |
| §5 forwarding `note` seam (no v1 platform is restricted) | Task 11 |
| §11 core stays shell-agnostic | Task 12's purity check, which is what keeps the deferred phase from forking core |

**Crypto parameters:** Argon2id defaults `m = 65536, t = 3, p = 1` with a 16 MiB schema floor match spec §4. `meta.kdf_params` carries the values so they can be raised later.

**Placeholders:** none. Every step carries runnable code or an exact command.

**Type consistency:** `SshBridge` in Task 1 matches `FakeSsh` in Task 9 and the FFI surface of Plan 1 Task 11. `Host`/`StoredCredential`/`Snippet` field names are identical across Tasks 3, 5, 7, 8. `RowKind` values (`'hosts' | 'credentials' | 'snippets'`) match the tab names in Task 7 and the `KINDS` table in Task 8. `CoreError` codes used in assertions (`vault_wrong_password`, `vault_locked`, `vault_bad_ciphertext`, `sheet_quota`, `sheet_request`, `sheet_unauthorized`, `sheet_bad_row`, `sheet_bad_meta`, `no_such_tab`, `tab_reconnecting`, `no_such_transfer`, `no_such_forward`, `auth`) are each thrown by exactly the module the test exercises.

**Cross-plan dependency:** `SshBridge` (Task 1) is this plan's contract with Plan 1's FFI. At execution time, check it against the built binding — Plan 1's napi export names and argument order are the authority if the two ever disagree.

**Scope-cut check (2026-08-28).** Deferring mobile removed no task and no test from this plan. Two things were kept deliberately rather than cut, each justified at its own site: the `note` field and `#noteFor` in Task 11, and the `react-native` entries in Task 12's forbidden list. Both are small, both are covered, and both would have to be re-added verbatim. Everything else in this plan was always shell-agnostic.
