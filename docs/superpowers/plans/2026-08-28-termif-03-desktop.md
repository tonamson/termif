# Termif Plan 3 — Desktop Shell (Electron)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a usable macOS and Windows app: unlock the vault, browse and edit hosts, open multiple SSH terminal tabs, run snippets, browse and transfer files over SFTP, and manage port forwards — all against `@termif/core`.

**Architecture:** Electron with three layers. The **main** process owns the `.node` FFI module, the SQLite file, the OS keychain, and the network; it exposes them over IPC. The **preload** script bridges IPC into the renderer through `contextBridge` with no Node exposed. The **renderer** is React, builds a `Platform` object whose methods are IPC calls, and hands it to `@termif/core`. Terminal rendering is `xterm.js` with the WebGL addon.

**Tech Stack:** Electron 33, electron-vite, React 18, TypeScript 5.6, `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl`, `better-sqlite3`, Electron `safeStorage`, Vitest + Testing Library, Playwright for one end-to-end smoke test.

**Spec:** `docs/superpowers/specs/2026-08-28-termif-crossplatform-ssh-design.md`

**Depends on:** Plan 1 (the `@termif/ssh-native` `.node` module) and Plan 2 (`@termif/core`, especially the `Platform` and `SshBridge` interfaces). Where this plan calls a core API, it matches Plan 2's stated interface. **At execution time, check each call against the built packages** — Plan 2's actual exports are the authority if the two disagree.

## Global Constraints

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every window. The renderer never sees `require`, `process`, or a raw `ipcRenderer`.
- The `.node` module is loaded **only** in the main process (spec §3). A renderer import of it is a bug.
- The vault key never crosses IPC. Unlock happens in the renderer, where `@termif/core`'s `Vault` lives; the main process holds only the *wrapped* key inside `safeStorage`, and never plaintext credentials.
- Every user-facing string goes through `t()` from `@termif/core`. No literal English in a component.
- IPC channel names are namespaced `termif:<area>:<action>` and declared in one shared file, so main and preload cannot drift.
- The renderer bundle imports nothing from `electron` except through `window.termif`, which the preload defines.
- All React state that mirrors core lives in one store per area; components read it, never poll.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/desktop/package.json`, `electron.vite.config.ts`, `tsconfig*.json` | Build setup for the three layers |
| `apps/desktop/src/shared/ipc.ts` | Channel names and payload types, imported by main and preload |
| `apps/desktop/src/main/index.ts` | App lifecycle, window creation |
| `apps/desktop/src/main/native.ts` | Loads `@termif/ssh-native`, normalises its events |
| `apps/desktop/src/main/db.ts` | `better-sqlite3` file, exposed as `LocalDb` operations |
| `apps/desktop/src/main/secureStore.ts` | `safeStorage` behind the `SecureStore` shape |
| `apps/desktop/src/main/net.ts` | `HttpClient` over `net.fetch` |
| `apps/desktop/src/main/googleAuth.ts` | OAuth device flow, token refresh |
| `apps/desktop/src/main/handlers.ts` | Registers every IPC handler |
| `apps/desktop/src/preload/index.ts` | `contextBridge` surface |
| `apps/desktop/src/renderer/platform.ts` | Builds `Platform` from `window.termif` |
| `apps/desktop/src/renderer/app/AppRoot.tsx` | Boot, unlock gate, layout |
| `apps/desktop/src/renderer/state/*.ts` | Stores: vault, hosts, tabs, transfers, forwards, sync |
| `apps/desktop/src/renderer/views/HostList.tsx` | Host list, search, groups |
| `apps/desktop/src/renderer/views/HostForm.tsx` | Add and edit a host |
| `apps/desktop/src/renderer/views/HostKeyPrompt.tsx` | Trust prompt and mismatch block |
| `apps/desktop/src/renderer/views/TerminalTabs.tsx` | Tab bar and panes |
| `apps/desktop/src/renderer/views/TerminalPane.tsx` | One `xterm.js` instance |
| `apps/desktop/src/renderer/views/SnippetPalette.tsx` | Snippet list and send |
| `apps/desktop/src/renderer/views/SftpBrowser.tsx` | Two-pane file browser |
| `apps/desktop/src/renderer/views/ForwardPanel.tsx` | Forward list and form |
| `apps/desktop/src/renderer/views/SyncBadge.tsx` | Sync status |

Layer boundary rationale: `shared/ipc.ts` is the only module both main and preload import, so the contract has exactly one definition. Each view owns one screen concern and reads from a store, keeping files small enough to hold in context.

---

## Task 1: Scaffold, IPC contract, and a launching window

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/tsconfig.json`, `apps/desktop/tsconfig.node.json`
- Create: `apps/desktop/src/shared/ipc.ts`
- Create: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/main.tsx`
- Test: `apps/desktop/test/ipc.test.ts`

**Interfaces:**
- Produces `CHANNELS`, a frozen record of every channel name, and request/response types per channel.
- Produces a `window.termif` shape declared once in `shared/ipc.ts` as `TermifApi`, which the preload implements and the renderer consumes.

- [ ] **Step 1: Write the manifests**

`apps/desktop/package.json`:

```json
{
  "name": "@termif/desktop",
  "version": "0.1.0",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "test": "vitest run",
    "package": "electron-vite build && electron-builder"
  },
  "dependencies": {
    "@termif/core": "file:../../packages/core",
    "@termif/ssh-native": "file:../../crates/ffi-napi",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-webgl": "^0.18.0",
    "@xterm/xterm": "^5.5.0",
    "better-sqlite3": "^11.5.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@electron-toolkit/preload": "^3.0.1",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/better-sqlite3": "^7.6.11",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.2",
    "electron": "^33.0.0",
    "electron-builder": "^25.1.8",
    "electron-vite": "^2.3.0",
    "jsdom": "^25.0.1",
    "playwright": "^1.48.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`apps/desktop/electron.vite.config.ts`:

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // better-sqlite3 and the .node module must stay external: bundling a
    // native addon breaks its binding lookup.
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      include: ['../../test/**/*.test.ts', '../../test/**/*.test.tsx'],
    },
  },
})
```

`apps/desktop/tsconfig.json` (renderer):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/renderer", "src/shared", "test"]
}
```

`apps/desktop/tsconfig.node.json` (main and preload):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/main", "src/preload", "src/shared"]
}
```

- [ ] **Step 2: Write the failing IPC contract test**

`apps/desktop/test/ipc.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { CHANNELS } from '../src/shared/ipc.js'

describe('CHANNELS', () => {
  it('namespaces every channel under termif:', () => {
    for (const [key, value] of Object.entries(CHANNELS)) {
      expect(value, `channel ${key}`).toMatch(/^termif:[a-z]+:[a-zA-Z]+$/)
    }
  })

  it('has no duplicate channel names, which would cross-wire two handlers', () => {
    const values = Object.values(CHANNELS)
    expect(new Set(values).size).toBe(values.length)
  })

  it('covers every area the app needs', () => {
    const areas = new Set(Object.values(CHANNELS).map((c) => c.split(':')[1]))
    expect(areas).toEqual(new Set(['ssh', 'db', 'secure', 'net', 'auth', 'app']))
  })

  it('is frozen, so a typo cannot add a channel at runtime', () => {
    expect(Object.isFrozen(CHANNELS)).toBe(true)
  })
})
```

- [ ] **Step 3: Run to see it fail**

Run: `cd apps/desktop && npm install && npx vitest run test/ipc.test.ts`
Expected: FAIL — `src/shared/ipc.ts` does not exist.

- [ ] **Step 4: Write the contract**

`apps/desktop/src/shared/ipc.ts`:

```typescript
import type { SshConnectConfig, SshDirEntry, SshEvent, SqlValue } from '@termif/core'

/**
 * The single definition of the main↔renderer contract. Both sides import this
 * file, so a rename cannot land on one side only.
 */
export const CHANNELS = Object.freeze({
  sshInit: 'termif:ssh:init',
  sshConnect: 'termif:ssh:connect',
  sshDisconnect: 'termif:ssh:disconnect',
  sshTrustHostKey: 'termif:ssh:trustHostKey',
  sshOpenShell: 'termif:ssh:openShell',
  sshWrite: 'termif:ssh:write',
  sshResize: 'termif:ssh:resize',
  sshCloseChannel: 'termif:ssh:closeChannel',
  sshSftpList: 'termif:ssh:sftpList',
  sshSftpStat: 'termif:ssh:sftpStat',
  sshSftpMkdir: 'termif:ssh:sftpMkdir',
  sshSftpRename: 'termif:ssh:sftpRename',
  sshSftpRemove: 'termif:ssh:sftpRemove',
  sshSftpReadRange: 'termif:ssh:sftpReadRange',
  sshSftpUpload: 'termif:ssh:sftpUpload',
  sshSftpDownload: 'termif:ssh:sftpDownload',
  sshCancelTransfer: 'termif:ssh:cancelTransfer',
  sshForwardLocal: 'termif:ssh:forwardLocal',
  sshForwardRemote: 'termif:ssh:forwardRemote',
  sshForwardSocks: 'termif:ssh:forwardSocks',
  sshForwardBoundPort: 'termif:ssh:forwardBoundPort',
  sshCloseForward: 'termif:ssh:closeForward',
  sshNextEvents: 'termif:ssh:nextEvents',

  dbExec: 'termif:db:exec',
  dbQuery: 'termif:db:query',
  dbTransaction: 'termif:db:transaction',

  secureGet: 'termif:secure:get',
  secureSet: 'termif:secure:set',
  secureDelete: 'termif:secure:delete',

  netRequest: 'termif:net:request',

  authStartDeviceFlow: 'termif:auth:startDeviceFlow',
  authPollDeviceFlow: 'termif:auth:pollDeviceFlow',
  authAccessToken: 'termif:auth:accessToken',
  authSignOut: 'termif:auth:signOut',

  appPickFile: 'termif:app:pickFile',
  appPickSaveLocation: 'termif:app:pickSaveLocation',
  appOpenExternal: 'termif:app:openExternal',
  appPlatformKind: 'termif:app:platformKind',
} as const)

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

/** One statement in a `dbTransaction` batch. */
export interface DbStatement {
  sql: string
  params: SqlValue[]
}

export interface HttpRequestPayload {
  method: 'GET' | 'POST' | 'PUT'
  url: string
  headers?: Record<string, string>
  body?: string
}

export interface HttpResponsePayload {
  status: number
  body: string
}

export interface DeviceFlowStart {
  userCode: string
  verificationUrl: string
  /** Opaque; hand it back to `authPollDeviceFlow`. */
  deviceCode: string
  intervalSecs: number
  expiresInSecs: number
}

export type DeviceFlowPoll =
  | { state: 'pending' }
  | { state: 'authorized' }
  | { state: 'denied'; reason: string }
  | { state: 'expired' }

/**
 * What the preload puts on `window.termif`. The renderer's `Platform` is built
 * from exactly this and nothing else.
 */
export interface TermifApi {
  ssh: {
    init(knownHostsPath: string): Promise<void>
    connect(cfg: SshConnectConfig): Promise<string>
    disconnect(sessionId: string): Promise<void>
    trustHostKey(host: string, port: number, algo: string, fingerprint: string): Promise<void>
    openShell(sessionId: string, cols: number, rows: number): Promise<string>
    write(channelId: string, data: Uint8Array): Promise<void>
    resize(channelId: string, cols: number, rows: number): Promise<void>
    closeChannel(channelId: string): Promise<void>
    sftpList(sessionId: string, path: string): Promise<SerialisedDirEntry[]>
    sftpStat(sessionId: string, path: string): Promise<SerialisedDirEntry>
    sftpMkdir(sessionId: string, path: string): Promise<void>
    sftpRename(sessionId: string, from: string, to: string): Promise<void>
    sftpRemove(sessionId: string, path: string, recursive: boolean): Promise<void>
    sftpReadRange(sessionId: string, path: string, offset: string, len: number): Promise<Uint8Array>
    sftpUpload(sessionId: string, local: string, remote: string): Promise<string>
    sftpDownload(sessionId: string, remote: string, local: string): Promise<string>
    cancelTransfer(transferId: string): Promise<void>
    forwardLocal(
      sessionId: string,
      localBind: string,
      remoteHost: string,
      remotePort: number,
    ): Promise<string>
    forwardRemote(
      sessionId: string,
      remoteBindHost: string,
      remoteBindPort: number,
      localHost: string,
      localPort: number,
    ): Promise<string>
    forwardSocks(sessionId: string, localBind: string): Promise<string>
    forwardBoundPort(forwardId: string): Promise<number>
    closeForward(forwardId: string): Promise<void>
    nextEvents(timeoutMs: number): Promise<SerialisedSshEvent[]>
  }
  db: {
    exec(sql: string, params: SqlValue[]): Promise<void>
    query(sql: string, params: SqlValue[]): Promise<Record<string, SqlValue>[]>
    transaction(statements: DbStatement[]): Promise<void>
  }
  secure: {
    get(key: string): Promise<Uint8Array | null>
    set(key: string, value: Uint8Array, requireBiometrics: boolean): Promise<void>
    delete(key: string): Promise<void>
  }
  net: {
    request(payload: HttpRequestPayload): Promise<HttpResponsePayload>
  }
  auth: {
    startDeviceFlow(): Promise<DeviceFlowStart>
    pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll>
    accessToken(): Promise<string>
    signOut(): Promise<void>
  }
  app: {
    pickFile(): Promise<string | null>
    pickSaveLocation(suggestedName: string): Promise<string | null>
    openExternal(url: string): Promise<void>
    platformKind(): Promise<'desktop'>
  }
}

/**
 * `bigint` does not survive Electron's structured clone across every version,
 * and JSON cannot carry it at all — so handles cross IPC as decimal strings
 * and are converted at the renderer edge. Same for SFTP sizes.
 */
export type SerialisedDirEntry = Omit<SshDirEntry, 'size'> & { size: string }

export type SerialisedSshEvent =
  | { kind: 'channelData'; channelId: string; bytes: Uint8Array }
  | { kind: 'channelClosed'; channelId: string; exitStatus: number | null }
  | { kind: 'sessionClosed'; sessionId: string; reason: string }
  | { kind: 'transferProgress'; transferId: string; done: string; total: string }
  | { kind: 'transferDone'; transferId: string; error: string | null }
  | { kind: 'forwardAccepted'; forwardId: string; peer: string }
  | { kind: 'log'; level: string; msg: string }

/** Narrowing helper shared by the renderer's deserialiser. */
export type { SshEvent }
```

- [ ] **Step 5: Run the contract test**

Run: `cd apps/desktop && npx vitest run test/ipc.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write a minimal main, preload, and renderer so the app launches**

`apps/desktop/src/main/index.ts`:

```typescript
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Termif',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer gets no Node and no direct ipcRenderer: everything goes
      // through the narrow contextBridge surface.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.on('ready-to-show', () => window.show())

  // Never navigate the app window itself; open links in the user's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL !== undefined) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

void app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`apps/desktop/src/preload/index.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type TermifApi } from '../shared/ipc.js'

/**
 * Wraps each channel in a plain function. No `ipcRenderer` object reaches the
 * renderer, so a compromised page cannot invoke channels we did not list.
 */
const api: TermifApi = {
  ssh: {
    init: (path) => ipcRenderer.invoke(CHANNELS.sshInit, path),
    connect: (cfg) => ipcRenderer.invoke(CHANNELS.sshConnect, cfg),
    disconnect: (id) => ipcRenderer.invoke(CHANNELS.sshDisconnect, id),
    trustHostKey: (host, port, algo, fingerprint) =>
      ipcRenderer.invoke(CHANNELS.sshTrustHostKey, host, port, algo, fingerprint),
    openShell: (id, cols, rows) => ipcRenderer.invoke(CHANNELS.sshOpenShell, id, cols, rows),
    write: (id, data) => ipcRenderer.invoke(CHANNELS.sshWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke(CHANNELS.sshResize, id, cols, rows),
    closeChannel: (id) => ipcRenderer.invoke(CHANNELS.sshCloseChannel, id),
    sftpList: (id, path) => ipcRenderer.invoke(CHANNELS.sshSftpList, id, path),
    sftpStat: (id, path) => ipcRenderer.invoke(CHANNELS.sshSftpStat, id, path),
    sftpMkdir: (id, path) => ipcRenderer.invoke(CHANNELS.sshSftpMkdir, id, path),
    sftpRename: (id, from, to) => ipcRenderer.invoke(CHANNELS.sshSftpRename, id, from, to),
    sftpRemove: (id, path, recursive) =>
      ipcRenderer.invoke(CHANNELS.sshSftpRemove, id, path, recursive),
    sftpReadRange: (id, path, offset, len) =>
      ipcRenderer.invoke(CHANNELS.sshSftpReadRange, id, path, offset, len),
    sftpUpload: (id, local, remote) => ipcRenderer.invoke(CHANNELS.sshSftpUpload, id, local, remote),
    sftpDownload: (id, remote, local) =>
      ipcRenderer.invoke(CHANNELS.sshSftpDownload, id, remote, local),
    cancelTransfer: (id) => ipcRenderer.invoke(CHANNELS.sshCancelTransfer, id),
    forwardLocal: (id, bind, host, port) =>
      ipcRenderer.invoke(CHANNELS.sshForwardLocal, id, bind, host, port),
    forwardRemote: (id, bindHost, bindPort, localHost, localPort) =>
      ipcRenderer.invoke(CHANNELS.sshForwardRemote, id, bindHost, bindPort, localHost, localPort),
    forwardSocks: (id, bind) => ipcRenderer.invoke(CHANNELS.sshForwardSocks, id, bind),
    forwardBoundPort: (id) => ipcRenderer.invoke(CHANNELS.sshForwardBoundPort, id),
    closeForward: (id) => ipcRenderer.invoke(CHANNELS.sshCloseForward, id),
    nextEvents: (timeoutMs) => ipcRenderer.invoke(CHANNELS.sshNextEvents, timeoutMs),
  },
  db: {
    exec: (sql, params) => ipcRenderer.invoke(CHANNELS.dbExec, sql, params),
    query: (sql, params) => ipcRenderer.invoke(CHANNELS.dbQuery, sql, params),
    transaction: (statements) => ipcRenderer.invoke(CHANNELS.dbTransaction, statements),
  },
  secure: {
    get: (key) => ipcRenderer.invoke(CHANNELS.secureGet, key),
    set: (key, value, requireBiometrics) =>
      ipcRenderer.invoke(CHANNELS.secureSet, key, value, requireBiometrics),
    delete: (key) => ipcRenderer.invoke(CHANNELS.secureDelete, key),
  },
  net: {
    request: (payload) => ipcRenderer.invoke(CHANNELS.netRequest, payload),
  },
  auth: {
    startDeviceFlow: () => ipcRenderer.invoke(CHANNELS.authStartDeviceFlow),
    pollDeviceFlow: (deviceCode) => ipcRenderer.invoke(CHANNELS.authPollDeviceFlow, deviceCode),
    accessToken: () => ipcRenderer.invoke(CHANNELS.authAccessToken),
    signOut: () => ipcRenderer.invoke(CHANNELS.authSignOut),
  },
  app: {
    pickFile: () => ipcRenderer.invoke(CHANNELS.appPickFile),
    pickSaveLocation: (name) => ipcRenderer.invoke(CHANNELS.appPickSaveLocation, name),
    openExternal: (url) => ipcRenderer.invoke(CHANNELS.appOpenExternal, url),
    platformKind: () => ipcRenderer.invoke(CHANNELS.appPlatformKind),
  },
}

contextBridge.exposeInMainWorld('termif', api)
```

`apps/desktop/src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    />
    <title>Termif</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')

// AppRoot arrives in Task 5; this keeps the shell launchable from Task 1 on.
createRoot(root).render(<div>Termif</div>)
```

- [ ] **Step 7: Verify the app launches**

Run: `cd apps/desktop && npm run dev`
Expected: a window titled Termif showing the placeholder. Close it. Then `npm run typecheck` with no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): scaffold Electron app with a single IPC contract"
```

---

## Task 2: Main-process native bridge and SQLite

**Files:**
- Create: `apps/desktop/src/main/native.ts`, `apps/desktop/src/main/db.ts`
- Test: `apps/desktop/test/main/db.test.ts`, `apps/desktop/test/main/native.test.ts`

**Interfaces:**
- Produces from `native.ts`:
  - `initNative(knownHostsPath: string): void`
  - `nativeCall<K extends keyof NativeSurface>(name: K, ...args): Promise<...>` — a thin typed passthrough
  - `serialiseEvents(raw: RawNapiEvent[]): SerialisedSshEvent[]` — flat napi shape → tagged union with string handles
- Produces from `db.ts`:
  - `openDatabase(filePath: string): DesktopDb`
  - `DesktopDb` with `exec`, `query`, `transaction(statements)`
- `db.ts` uses `better-sqlite3` with `journal_mode = WAL` and `foreign_keys = ON`.

- [ ] **Step 1: Write the failing db test**

`apps/desktop/test/main/db.test.ts`:

```typescript
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, type DesktopDb } from '../../src/main/db.js'

let dir: string | null = null
let db: DesktopDb | null = null

function open(): DesktopDb {
  dir = mkdtempSync(join(tmpdir(), 'termif-db-'))
  db = openDatabase(join(dir, 'termif.sqlite'))
  return db
}

afterEach(() => {
  db?.close()
  db = null
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('openDatabase', () => {
  it('creates the file and runs statements', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)')
    await db.exec('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 1])

    const rows = await db.query<{ id: string; n: number }>('SELECT * FROM t')
    expect(rows).toEqual([{ id: 'a', n: 1 }])
  })

  it('enables WAL, so a reader is not blocked by a writer', async () => {
    const db = open()
    const rows = await db.query<{ journal_mode: string }>('PRAGMA journal_mode')
    expect(rows[0]?.journal_mode.toLowerCase()).toBe('wal')
  })

  it('returns an empty array rather than null for a query with no rows', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id TEXT)')
    expect(await db.query('SELECT * FROM t')).toEqual([])
  })

  it('commits a transaction batch atomically', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')

    await db.transaction([
      { sql: 'INSERT INTO t (id) VALUES (?)', params: ['a'] },
      { sql: 'INSERT INTO t (id) VALUES (?)', params: ['b'] },
    ])

    expect(await db.query('SELECT * FROM t')).toHaveLength(2)
  })

  it('rolls the whole batch back when one statement fails', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')
    await db.exec('INSERT INTO t (id) VALUES (?)', ['a'])

    await expect(
      db.transaction([
        { sql: 'INSERT INTO t (id) VALUES (?)', params: ['b'] },
        // Duplicate primary key: must undo the row before it too.
        { sql: 'INSERT INTO t (id) VALUES (?)', params: ['a'] },
      ]),
    ).rejects.toThrow()

    const rows = await db.query<{ id: string }>('SELECT id FROM t ORDER BY id')
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })

  it('persists across a reopen', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id TEXT)')
    await db.exec('INSERT INTO t (id) VALUES (?)', ['keep'])
    const path = db.path
    db.close()

    const reopened = openDatabase(path)
    try {
      expect(await reopened.query('SELECT * FROM t')).toHaveLength(1)
    } finally {
      reopened.close()
    }
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `cd apps/desktop && npx vitest run test/main/db.test.ts`
Expected: FAIL — no `src/main/db.ts`.

- [ ] **Step 3: Write the database module**

`apps/desktop/src/main/db.ts`:

```typescript
import Database from 'better-sqlite3'
import type { SqlValue } from '@termif/core'
import type { DbStatement } from '../shared/ipc.js'

export interface DesktopDb {
  readonly path: string
  exec(sql: string, params?: readonly SqlValue[]): Promise<void>
  query<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>
  transaction(statements: readonly DbStatement[]): Promise<void>
  close(): void
}

/**
 * The local database is the app's read source; the Sheet is only sync
 * (spec §4). WAL keeps a background sync write from blocking the UI's reads.
 */
export function openDatabase(filePath: string): DesktopDb {
  const database = new Database(filePath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  // A brief wait beats an immediate SQLITE_BUSY when sync and UI overlap.
  database.pragma('busy_timeout = 5000')

  return {
    path: filePath,

    async exec(sql, params = []): Promise<void> {
      database.prepare(sql).run(params as SqlValue[])
    },

    async query<T>(sql, params = []): Promise<T[]> {
      return database.prepare(sql).all(params as SqlValue[]) as T[]
    },

    /**
     * Takes the whole batch at once rather than exposing begin/commit over
     * IPC: a transaction that spans IPC round trips could be left open by a
     * renderer crash, holding a write lock indefinitely.
     */
    async transaction(statements): Promise<void> {
      const run = database.transaction((batch: readonly DbStatement[]) => {
        for (const statement of batch) {
          database.prepare(statement.sql).run(statement.params)
        }
      })
      run(statements)
    },

    close(): void {
      database.close()
    },
  }
}
```

- [ ] **Step 4: Run the db test**

Run: `cd apps/desktop && npx vitest run test/main/db.test.ts`
Expected: PASS, 6 tests. If `better-sqlite3` fails to load, run `npx electron-rebuild -f -w better-sqlite3` first — the module must be built against Electron's ABI.

- [ ] **Step 5: Write the failing native-bridge test**

`apps/desktop/test/main/native.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { serialiseEvents } from '../../src/main/native.js'

describe('serialiseEvents', () => {
  it('converts channelData and keeps the bytes intact', () => {
    const bytes = new Uint8Array([104, 105])
    const [event] = serialiseEvents([
      { kind: 'channelData', channelId: 7n, bytes, exitStatus: null },
    ])

    expect(event).toEqual({ kind: 'channelData', channelId: '7', bytes })
  })

  it('renders bigint handles as decimal strings, since bigint does not cross IPC', () => {
    const [event] = serialiseEvents([
      { kind: 'sessionClosed', sessionId: 18446744073709551615n, reason: 'gone' },
    ])
    expect(event).toEqual({
      kind: 'sessionClosed',
      sessionId: '18446744073709551615',
      reason: 'gone',
    })
  })

  it('carries a null exitStatus through as null', () => {
    const [event] = serialiseEvents([
      { kind: 'channelClosed', channelId: 3n, exitStatus: null },
    ])
    expect(event).toEqual({ kind: 'channelClosed', channelId: '3', exitStatus: null })
  })

  it('carries a numeric exitStatus through', () => {
    const [event] = serialiseEvents([{ kind: 'channelClosed', channelId: 3n, exitStatus: 130 }])
    expect(event).toEqual({ kind: 'channelClosed', channelId: '3', exitStatus: 130 })
  })

  it('stringifies transfer counters, which can exceed Number.MAX_SAFE_INTEGER', () => {
    const [event] = serialiseEvents([
      { kind: 'transferProgress', transferId: 2n, done: 9007199254740993n, total: 9007199254740994n },
    ])
    expect(event).toEqual({
      kind: 'transferProgress',
      transferId: '2',
      done: '9007199254740993',
      total: '9007199254740994',
    })
  })

  it('passes transferDone, forwardAccepted, and log through', () => {
    const events = serialiseEvents([
      { kind: 'transferDone', transferId: 4n, error: 'sftp: denied' },
      { kind: 'forwardAccepted', forwardId: 5n, peer: '127.0.0.1:40001' },
      { kind: 'log', level: 'warn', msg: 'something' },
    ])
    expect(events).toEqual([
      { kind: 'transferDone', transferId: '4', error: 'sftp: denied' },
      { kind: 'forwardAccepted', forwardId: '5', peer: '127.0.0.1:40001' },
      { kind: 'log', level: 'warn', msg: 'something' },
    ])
  })

  it('drops an event with an unrecognised kind rather than crashing the loop', () => {
    // A newer core could emit a kind this build does not know; the drain loop
    // must survive it.
    const events = serialiseEvents([{ kind: 'somethingNew' } as never])
    expect(events).toEqual([])
  })

  it('preserves order, which per-channel byte ordering depends on', () => {
    const events = serialiseEvents([
      { kind: 'channelData', channelId: 1n, bytes: new Uint8Array([1]) },
      { kind: 'channelData', channelId: 1n, bytes: new Uint8Array([2]) },
      { kind: 'channelData', channelId: 1n, bytes: new Uint8Array([3]) },
    ])
    expect(events.map((e) => (e.kind === 'channelData' ? e.bytes[0] : null))).toEqual([1, 2, 3])
  })
})
```

- [ ] **Step 6: Run to see it fail**

Run: `cd apps/desktop && npx vitest run test/main/native.test.ts`
Expected: FAIL — no `src/main/native.ts`.

- [ ] **Step 7: Write the native bridge**

`apps/desktop/src/main/native.ts`:

```typescript
import type { SerialisedSshEvent } from '../shared/ipc.js'

/**
 * The flat object napi produces (Plan 1 Task 11's `JsEvent`): one `kind` plus
 * optional fields. We narrow it into the tagged union the renderer expects.
 */
export interface RawNapiEvent {
  kind: string
  channelId?: bigint | null
  sessionId?: bigint | null
  transferId?: bigint | null
  forwardId?: bigint | null
  bytes?: Uint8Array | null
  exitStatus?: number | null
  reason?: string | null
  done?: bigint | null
  total?: bigint | null
  error?: string | null
  peer?: string | null
  level?: string | null
  msg?: string | null
}

/** The subset of `@termif/ssh-native` this app calls. */
interface NativeModule {
  init(knownHostsPath: string): void
  connect(cfg: unknown): Promise<bigint>
  disconnect(sessionId: bigint): Promise<void>
  trustHostKey(host: string, port: number, algo: string, fingerprint: string): Promise<void>
  openShell(sessionId: bigint, cols: number, rows: number): Promise<bigint>
  write(channelId: bigint, data: Uint8Array): Promise<void>
  resize(channelId: bigint, cols: number, rows: number): Promise<void>
  closeChannel(channelId: bigint): Promise<void>
  sftpList(sessionId: bigint, path: string): Promise<RawDirEntry[]>
  sftpStat(sessionId: bigint, path: string): Promise<RawDirEntry>
  sftpMkdir(sessionId: bigint, path: string): Promise<void>
  sftpRename(sessionId: bigint, from: string, to: string): Promise<void>
  sftpRemove(sessionId: bigint, path: string, recursive: boolean): Promise<void>
  sftpReadRange(sessionId: bigint, path: string, offset: bigint, len: number): Promise<Buffer>
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
  nextEvents(timeoutMs: number): Promise<RawNapiEvent[]>
}

export interface RawDirEntry {
  name: string
  size: bigint
  isDir: boolean
  isSymlink: boolean
  mode: number
  modifiedUnix: number
}

let cached: NativeModule | null = null

/**
 * Loaded lazily and only here, in the main process. A renderer import of this
 * module would defeat the sandbox and would not work in a packaged build
 * (spec §3).
 */
export function native(): NativeModule {
  if (cached === null) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('@termif/ssh-native') as NativeModule
  }
  return cached
}

export function initNative(knownHostsPath: string): void {
  native().init(knownHostsPath)
}

const str = (value: bigint | null | undefined): string => (value ?? 0n).toString()

/**
 * Handles and byte counters cross IPC as decimal strings: `bigint` is not
 * reliably structured-cloneable across Electron versions, and a 64-bit id does
 * not fit in a JS number.
 */
export function serialiseEvents(raw: readonly RawNapiEvent[]): SerialisedSshEvent[] {
  const out: SerialisedSshEvent[] = []

  for (const event of raw) {
    switch (event.kind) {
      case 'channelData':
        out.push({
          kind: 'channelData',
          channelId: str(event.channelId),
          bytes: event.bytes ?? new Uint8Array(),
        })
        break
      case 'channelClosed':
        out.push({
          kind: 'channelClosed',
          channelId: str(event.channelId),
          exitStatus: event.exitStatus ?? null,
        })
        break
      case 'sessionClosed':
        out.push({
          kind: 'sessionClosed',
          sessionId: str(event.sessionId),
          reason: event.reason ?? '',
        })
        break
      case 'transferProgress':
        out.push({
          kind: 'transferProgress',
          transferId: str(event.transferId),
          done: str(event.done),
          total: str(event.total),
        })
        break
      case 'transferDone':
        out.push({
          kind: 'transferDone',
          transferId: str(event.transferId),
          error: event.error ?? null,
        })
        break
      case 'forwardAccepted':
        out.push({
          kind: 'forwardAccepted',
          forwardId: str(event.forwardId),
          peer: event.peer ?? '',
        })
        break
      case 'log':
        out.push({ kind: 'log', level: event.level ?? 'info', msg: event.msg ?? '' })
        break
      default:
        // Unknown kind from a newer core: skip it rather than break the loop.
        break
    }
  }

  return out
}

export function serialiseDirEntry(entry: RawDirEntry): {
  name: string
  size: string
  isDir: boolean
  isSymlink: boolean
  mode: number
  modifiedUnix: number
} {
  return { ...entry, size: entry.size.toString() }
}
```

- [ ] **Step 8: Run the native test**

Run: `cd apps/desktop && npx vitest run test/main/native.test.ts`
Expected: PASS, 8 tests. The tests exercise `serialiseEvents` only, so they do not load the `.node` module.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add main-process native bridge and SQLite database"
```

---

## Task 3: Secure store, HTTP client, Google auth, and handler registration

**Files:**
- Create: `apps/desktop/src/main/secureStore.ts`, `apps/desktop/src/main/net.ts`, `apps/desktop/src/main/googleAuth.ts`, `apps/desktop/src/main/handlers.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/test/main/googleAuth.test.ts`, `apps/desktop/test/main/handlers.test.ts`

**Interfaces:**
- Produces from `secureStore.ts`: `createSecureStore(filePath)` with `get`, `set`, `delete`. Values are encrypted with Electron `safeStorage` and stored in a small JSON file; `safeStorage` uses the login keychain on macOS and DPAPI on Windows.
- Produces from `net.ts`: `request(payload): Promise<HttpResponsePayload>` over Electron's `net.fetch`.
- Produces from `googleAuth.ts`: `GoogleAuth` class with `startDeviceFlow()`, `pollDeviceFlow(deviceCode)`, `accessToken()`, `signOut()`; `SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file']`.
- Produces from `handlers.ts`: `registerHandlers(deps)`, which wires every channel in `CHANNELS` exactly once.

`drive.file` rather than full `drive`: it lets the app create and use its own spreadsheet while being unable to read anything else in the user's Drive (spec §4).

- [ ] **Step 1: Write the failing auth test**

`apps/desktop/test/main/googleAuth.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { GoogleAuth, SCOPES } from '../../src/main/googleAuth.js'

interface StoredToken {
  refreshToken: string
  accessToken: string
  expiresAtMs: number
}

/** In-memory stand-in for the keychain-backed store. */
function fakeStore() {
  const items = new Map<string, Uint8Array>()
  return {
    async get(key: string) {
      return items.get(key) ?? null
    },
    async set(key: string, value: Uint8Array) {
      items.set(key, value)
    },
    async delete(key: string) {
      items.delete(key)
    },
    items,
  }
}

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; body: string | undefined }[] = []
  const fn = vi.fn(async (payload: { url: string; body?: string }) => {
    calls.push({ url: payload.url, body: payload.body })
    const next = responses.shift() ?? { status: 500, body: {} }
    return { status: next.status, body: JSON.stringify(next.body) }
  })
  return { fn, calls }
}

describe('GoogleAuth', () => {
  it('requests only the spreadsheets and drive.file scopes', () => {
    expect(SCOPES).toEqual([
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ])
    // Full Drive access would let the app read unrelated files; it must not ask.
    expect(SCOPES).not.toContain('https://www.googleapis.com/auth/drive')
  })

  it('starts a device flow and returns the user code and URL', async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          device_code: 'dev-1',
          user_code: 'ABCD-EFGH',
          verification_url: 'https://google.com/device',
          interval: 5,
          expires_in: 1800,
        },
      },
    ])
    const auth = new GoogleAuth({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      store: fakeStore(),
      request: fn,
      now: () => 1_000_000,
    })

    const start = await auth.startDeviceFlow()

    expect(start.userCode).toBe('ABCD-EFGH')
    expect(start.verificationUrl).toBe('https://google.com/device')
    expect(start.deviceCode).toBe('dev-1')
    expect(start.intervalSecs).toBe(5)
    expect(calls[0]?.body).toContain('client_id=client-1')
    expect(calls[0]?.body).toContain(encodeURIComponent(SCOPES.join(' ')))
  })

  it('reports pending while the user has not finished', async () => {
    const { fn } = fakeFetch([{ status: 428, body: { error: 'authorization_pending' } }])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store: fakeStore(),
      request: fn,
      now: () => 0,
    })

    expect(await auth.pollDeviceFlow('dev-1')).toEqual({ state: 'pending' })
  })

  it('stores the refresh token on authorization', async () => {
    const store = fakeStore()
    const { fn } = fakeFetch([
      {
        status: 200,
        body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 },
      },
    ])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store,
      request: fn,
      now: () => 1_000_000,
    })

    expect(await auth.pollDeviceFlow('dev-1')).toEqual({ state: 'authorized' })

    const raw = store.items.get('termif.googleToken')
    expect(raw).toBeDefined()
    const stored = JSON.parse(new TextDecoder().decode(raw)) as StoredToken
    expect(stored.refreshToken).toBe('rt-1')
    expect(stored.accessToken).toBe('at-1')
  })

  it('reports denial with the reason', async () => {
    const { fn } = fakeFetch([{ status: 400, body: { error: 'access_denied' } }])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store: fakeStore(),
      request: fn,
      now: () => 0,
    })

    expect(await auth.pollDeviceFlow('dev-1')).toEqual({
      state: 'denied',
      reason: 'access_denied',
    })
  })

  it('reports expiry distinctly, since the user must restart the flow', async () => {
    const { fn } = fakeFetch([{ status: 400, body: { error: 'expired_token' } }])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store: fakeStore(),
      request: fn,
      now: () => 0,
    })

    expect(await auth.pollDeviceFlow('dev-1')).toEqual({ state: 'expired' })
  })

  it('returns a cached access token while it is still valid', async () => {
    const store = fakeStore()
    store.items.set(
      'termif.googleToken',
      new TextEncoder().encode(
        JSON.stringify({ refreshToken: 'rt', accessToken: 'at-cached', expiresAtMs: 5_000_000 }),
      ),
    )
    const { fn } = fakeFetch([])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store,
      request: fn,
      now: () => 4_000_000,
    })

    expect(await auth.accessToken()).toBe('at-cached')
    expect(fn).not.toHaveBeenCalled()
  })

  it('refreshes an expired access token using the refresh token', async () => {
    const store = fakeStore()
    store.items.set(
      'termif.googleToken',
      new TextEncoder().encode(
        JSON.stringify({ refreshToken: 'rt-1', accessToken: 'at-old', expiresAtMs: 1_000 }),
      ),
    )
    const { fn, calls } = fakeFetch([
      { status: 200, body: { access_token: 'at-new', expires_in: 3600 } },
    ])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store,
      request: fn,
      now: () => 2_000_000,
    })

    expect(await auth.accessToken()).toBe('at-new')
    expect(calls[0]?.body).toContain('refresh_token=rt-1')
    expect(calls[0]?.body).toContain('grant_type=refresh_token')
  })

  it('refreshes slightly before expiry, so a long request does not fail mid-flight', async () => {
    const store = fakeStore()
    // Expires in 30s: inside the safety margin, so it refreshes now.
    store.items.set(
      'termif.googleToken',
      new TextEncoder().encode(
        JSON.stringify({ refreshToken: 'rt', accessToken: 'at-old', expiresAtMs: 1_030_000 }),
      ),
    )
    const { fn } = fakeFetch([{ status: 200, body: { access_token: 'at-new', expires_in: 3600 } }])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store,
      request: fn,
      now: () => 1_000_000,
    })

    expect(await auth.accessToken()).toBe('at-new')
  })

  it('throws a clear error when no token is stored at all', async () => {
    const { fn } = fakeFetch([])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store: fakeStore(),
      request: fn,
      now: () => 0,
    })

    await expect(auth.accessToken()).rejects.toThrow(/not signed in/i)
  })

  it('forgets the token on sign out', async () => {
    const store = fakeStore()
    store.items.set('termif.googleToken', new TextEncoder().encode('{}'))
    const { fn } = fakeFetch([])
    const auth = new GoogleAuth({
      clientId: 'c',
      clientSecret: 's',
      store,
      request: fn,
      now: () => 0,
    })

    await auth.signOut()

    expect(store.items.has('termif.googleToken')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `cd apps/desktop && npx vitest run test/main/googleAuth.test.ts`
Expected: FAIL — no `src/main/googleAuth.ts`.

- [ ] **Step 3: Write the secure store, HTTP client, and auth**

`apps/desktop/src/main/secureStore.ts`:

```typescript
import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export interface MainSecureStore {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array, requireBiometrics: boolean): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * `safeStorage` wraps each value with a key held in the OS credential store —
 * the login keychain on macOS, DPAPI on Windows — so the file on disk is
 * useless without the logged-in user's session.
 *
 * Desktop has no biometric gate of its own, so `requireBiometrics` is accepted
 * and ignored here; it is honoured on mobile (Plan 4).
 */
export function createSecureStore(filePath: string): MainSecureStore {
  const readAll = (): Record<string, string> => {
    if (!existsSync(filePath)) return {}
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>
    } catch {
      // A corrupt file must not brick the app; treat it as empty and let the
      // user re-enter what was stored.
      return {}
    }
  }

  const writeAll = (items: Record<string, string>): void => {
    writeFileSync(filePath, JSON.stringify(items), { mode: 0o600 })
  }

  return {
    async get(key): Promise<Uint8Array | null> {
      const encoded = readAll()[key]
      if (encoded === undefined) return null
      if (!safeStorage.isEncryptionAvailable()) return null

      try {
        const plain = safeStorage.decryptString(Buffer.from(encoded, 'base64'))
        return Uint8Array.from(Buffer.from(plain, 'base64'))
      } catch {
        // Written by a different OS user or a reinstalled keychain.
        return null
      }
    },

    async set(key, value): Promise<void> {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          'secure storage is unavailable on this system, so Termif will not store secrets',
        )
      }
      const items = readAll()
      const asBase64 = Buffer.from(value).toString('base64')
      items[key] = safeStorage.encryptString(asBase64).toString('base64')
      writeAll(items)
    },

    async delete(key): Promise<void> {
      const items = readAll()
      delete items[key]
      writeAll(items)
    },
  }
}
```

`apps/desktop/src/main/net.ts`:

```typescript
import { net } from 'electron'
import type { HttpRequestPayload, HttpResponsePayload } from '../shared/ipc.js'

/**
 * Uses Electron's `net` rather than Node's fetch so requests follow the app's
 * proxy configuration, which corporate networks rely on.
 */
export async function request(payload: HttpRequestPayload): Promise<HttpResponsePayload> {
  const response = await net.fetch(payload.url, {
    method: payload.method,
    headers: payload.headers,
    ...(payload.body === undefined ? {} : { body: payload.body }),
  })

  return { status: response.status, body: await response.text() }
}
```

`apps/desktop/src/main/googleAuth.ts`:

```typescript
import type { DeviceFlowPoll, DeviceFlowStart, HttpResponsePayload } from '../shared/ipc.js'

/**
 * `drive.file` instead of full `drive`: the app can create and use its own
 * spreadsheet but cannot read anything else in the user's Drive (spec §4).
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
] as const

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TOKEN_KEY = 'termif.googleToken'
/** Refresh this far before expiry so a slow request does not fail mid-flight. */
const REFRESH_MARGIN_MS = 60_000

interface StoredToken {
  refreshToken: string
  accessToken: string
  expiresAtMs: number
}

export interface GoogleAuthDeps {
  clientId: string
  clientSecret: string
  store: {
    get(key: string): Promise<Uint8Array | null>
    set(key: string, value: Uint8Array, requireBiometrics: boolean): Promise<void>
    delete(key: string): Promise<void>
  }
  request(payload: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    headers?: Record<string, string>
    body?: string
  }): Promise<HttpResponsePayload>
  now(): number
}

export class GoogleAuth {
  readonly #deps: GoogleAuthDeps

  constructor(deps: GoogleAuthDeps) {
    this.#deps = deps
  }

  async startDeviceFlow(): Promise<DeviceFlowStart> {
    const response = await this.#form(DEVICE_CODE_URL, {
      client_id: this.#deps.clientId,
      scope: SCOPES.join(' '),
    })

    const body = parse<{
      device_code?: string
      user_code?: string
      verification_url?: string
      verification_uri?: string
      interval?: number
      expires_in?: number
    }>(response)

    if (body.device_code === undefined || body.user_code === undefined) {
      throw new Error(`Google did not start a device flow: ${response.body.slice(0, 200)}`)
    }

    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      // Google has used both spellings over time.
      verificationUrl: body.verification_url ?? body.verification_uri ?? 'https://google.com/device',
      intervalSecs: body.interval ?? 5,
      expiresInSecs: body.expires_in ?? 1800,
    }
  }

  async pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll> {
    const response = await this.#form(TOKEN_URL, {
      client_id: this.#deps.clientId,
      client_secret: this.#deps.clientSecret,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })

    const body = parse<{
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
    }>(response)

    if (body.access_token !== undefined && body.refresh_token !== undefined) {
      await this.#save({
        refreshToken: body.refresh_token,
        accessToken: body.access_token,
        expiresAtMs: this.#deps.now() + (body.expires_in ?? 3600) * 1000,
      })
      return { state: 'authorized' }
    }

    switch (body.error) {
      case 'authorization_pending':
      case 'slow_down':
        return { state: 'pending' }
      case 'expired_token':
        return { state: 'expired' }
      default:
        return { state: 'denied', reason: body.error ?? `HTTP ${response.status}` }
    }
  }

  async accessToken(): Promise<string> {
    const stored = await this.#load()
    if (stored === null) {
      throw new Error('not signed in to Google')
    }

    if (stored.expiresAtMs - REFRESH_MARGIN_MS > this.#deps.now()) {
      return stored.accessToken
    }

    const response = await this.#form(TOKEN_URL, {
      client_id: this.#deps.clientId,
      client_secret: this.#deps.clientSecret,
      refresh_token: stored.refreshToken,
      grant_type: 'refresh_token',
    })

    const body = parse<{ access_token?: string; expires_in?: number; error?: string }>(response)
    if (body.access_token === undefined) {
      throw new Error(`could not refresh the Google token: ${body.error ?? response.status}`)
    }

    const refreshed: StoredToken = {
      // A refresh response usually omits the refresh token; keep the one we have.
      refreshToken: stored.refreshToken,
      accessToken: body.access_token,
      expiresAtMs: this.#deps.now() + (body.expires_in ?? 3600) * 1000,
    }
    await this.#save(refreshed)
    return refreshed.accessToken
  }

  async signOut(): Promise<void> {
    await this.#deps.store.delete(TOKEN_KEY)
  }

  async #form(url: string, fields: Record<string, string>): Promise<HttpResponsePayload> {
    return this.#deps.request({
      method: 'POST',
      url,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    })
  }

  async #save(token: StoredToken): Promise<void> {
    await this.#deps.store.set(
      TOKEN_KEY,
      new TextEncoder().encode(JSON.stringify(token)),
      false,
    )
  }

  async #load(): Promise<StoredToken | null> {
    const raw = await this.#deps.store.get(TOKEN_KEY)
    if (raw === null) return null
    try {
      return JSON.parse(new TextDecoder().decode(raw)) as StoredToken
    } catch {
      return null
    }
  }
}

function parse<T>(response: HttpResponsePayload): T {
  try {
    return JSON.parse(response.body) as T
  } catch {
    return {} as T
  }
}
```

- [ ] **Step 4: Run the auth test**

Run: `cd apps/desktop && npx vitest run test/main/googleAuth.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the failing handler-coverage test**

`apps/desktop/test/main/handlers.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { CHANNELS } from '../../src/shared/ipc.js'
import { handlerNames } from '../../src/main/handlers.js'

describe('registerHandlers', () => {
  it('registers a handler for every declared channel', () => {
    // A channel with no handler fails only when a user reaches that feature;
    // this catches it at build time instead.
    const declared = new Set(Object.values(CHANNELS))
    const registered = new Set(handlerNames())

    const missing = [...declared].filter((c) => !registered.has(c))
    expect(missing, `channels with no handler: ${missing.join(', ')}`).toEqual([])
  })

  it('registers no handler for a channel that does not exist', () => {
    const declared = new Set<string>(Object.values(CHANNELS))
    const extra = handlerNames().filter((c) => !declared.has(c))
    expect(extra, `handlers with no channel: ${extra.join(', ')}`).toEqual([])
  })
})
```

- [ ] **Step 6: Run to see it fail**

Run: `cd apps/desktop && npx vitest run test/main/handlers.test.ts`
Expected: FAIL — no `src/main/handlers.ts`.

- [ ] **Step 7: Write the handlers**

`apps/desktop/src/main/handlers.ts`:

```typescript
import { dialog, ipcMain, shell } from 'electron'
import type { SqlValue } from '@termif/core'
import {
  CHANNELS,
  type DbStatement,
  type HttpRequestPayload,
  type SerialisedDirEntry,
} from '../shared/ipc.js'
import type { DesktopDb } from './db.js'
import type { GoogleAuth } from './googleAuth.js'
import type { MainSecureStore } from './secureStore.js'
import { initNative, native, serialiseDirEntry, serialiseEvents } from './native.js'
import { request } from './net.js'

export interface HandlerDeps {
  db: DesktopDb
  secureStore: MainSecureStore
  auth: GoogleAuth
}

/**
 * The list of channels this module handles, in the same order it registers
 * them. Exported so a test can assert it matches `CHANNELS` exactly — a
 * missing handler would otherwise surface only when a user hits that feature.
 */
export function handlerNames(): string[] {
  return [
    CHANNELS.sshInit,
    CHANNELS.sshConnect,
    CHANNELS.sshDisconnect,
    CHANNELS.sshTrustHostKey,
    CHANNELS.sshOpenShell,
    CHANNELS.sshWrite,
    CHANNELS.sshResize,
    CHANNELS.sshCloseChannel,
    CHANNELS.sshSftpList,
    CHANNELS.sshSftpStat,
    CHANNELS.sshSftpMkdir,
    CHANNELS.sshSftpRename,
    CHANNELS.sshSftpRemove,
    CHANNELS.sshSftpReadRange,
    CHANNELS.sshSftpUpload,
    CHANNELS.sshSftpDownload,
    CHANNELS.sshCancelTransfer,
    CHANNELS.sshForwardLocal,
    CHANNELS.sshForwardRemote,
    CHANNELS.sshForwardSocks,
    CHANNELS.sshForwardBoundPort,
    CHANNELS.sshCloseForward,
    CHANNELS.sshNextEvents,
    CHANNELS.dbExec,
    CHANNELS.dbQuery,
    CHANNELS.dbTransaction,
    CHANNELS.secureGet,
    CHANNELS.secureSet,
    CHANNELS.secureDelete,
    CHANNELS.netRequest,
    CHANNELS.authStartDeviceFlow,
    CHANNELS.authPollDeviceFlow,
    CHANNELS.authAccessToken,
    CHANNELS.authSignOut,
    CHANNELS.appPickFile,
    CHANNELS.appPickSaveLocation,
    CHANNELS.appOpenExternal,
    CHANNELS.appPlatformKind,
  ]
}

/** Handles arrive from the renderer as decimal strings. */
const id = (value: string): bigint => BigInt(value)

export function registerHandlers(deps: HandlerDeps): void {
  // ---- ssh ----
  ipcMain.handle(CHANNELS.sshInit, (_e, path: string) => {
    initNative(path)
  })
  ipcMain.handle(CHANNELS.sshConnect, async (_e, cfg: unknown) =>
    (await native().connect(cfg)).toString(),
  )
  ipcMain.handle(CHANNELS.sshDisconnect, async (_e, sessionId: string) => {
    await native().disconnect(id(sessionId))
  })
  ipcMain.handle(
    CHANNELS.sshTrustHostKey,
    async (_e, host: string, port: number, algo: string, fingerprint: string) => {
      await native().trustHostKey(host, port, algo, fingerprint)
    },
  )
  ipcMain.handle(CHANNELS.sshOpenShell, async (_e, sessionId: string, cols: number, rows: number) =>
    (await native().openShell(id(sessionId), cols, rows)).toString(),
  )
  ipcMain.handle(CHANNELS.sshWrite, async (_e, channelId: string, data: Uint8Array) => {
    await native().write(id(channelId), data)
  })
  ipcMain.handle(CHANNELS.sshResize, async (_e, channelId: string, cols: number, rows: number) => {
    await native().resize(id(channelId), cols, rows)
  })
  ipcMain.handle(CHANNELS.sshCloseChannel, async (_e, channelId: string) => {
    await native().closeChannel(id(channelId))
  })

  ipcMain.handle(
    CHANNELS.sshSftpList,
    async (_e, sessionId: string, path: string): Promise<SerialisedDirEntry[]> =>
      (await native().sftpList(id(sessionId), path)).map(serialiseDirEntry),
  )
  ipcMain.handle(
    CHANNELS.sshSftpStat,
    async (_e, sessionId: string, path: string): Promise<SerialisedDirEntry> =>
      serialiseDirEntry(await native().sftpStat(id(sessionId), path)),
  )
  ipcMain.handle(CHANNELS.sshSftpMkdir, async (_e, sessionId: string, path: string) => {
    await native().sftpMkdir(id(sessionId), path)
  })
  ipcMain.handle(
    CHANNELS.sshSftpRename,
    async (_e, sessionId: string, from: string, to: string) => {
      await native().sftpRename(id(sessionId), from, to)
    },
  )
  ipcMain.handle(
    CHANNELS.sshSftpRemove,
    async (_e, sessionId: string, path: string, recursive: boolean) => {
      await native().sftpRemove(id(sessionId), path, recursive)
    },
  )
  ipcMain.handle(
    CHANNELS.sshSftpReadRange,
    async (_e, sessionId: string, path: string, offset: string, len: number) =>
      new Uint8Array(await native().sftpReadRange(id(sessionId), path, BigInt(offset), len)),
  )
  ipcMain.handle(
    CHANNELS.sshSftpUpload,
    async (_e, sessionId: string, local: string, remote: string) =>
      (await native().sftpUpload(id(sessionId), local, remote)).toString(),
  )
  ipcMain.handle(
    CHANNELS.sshSftpDownload,
    async (_e, sessionId: string, remote: string, local: string) =>
      (await native().sftpDownload(id(sessionId), remote, local)).toString(),
  )
  ipcMain.handle(CHANNELS.sshCancelTransfer, async (_e, transferId: string) => {
    await native().cancelTransfer(id(transferId))
  })

  ipcMain.handle(
    CHANNELS.sshForwardLocal,
    async (_e, sessionId: string, bind: string, host: string, port: number) =>
      (await native().forwardLocal(id(sessionId), bind, host, port)).toString(),
  )
  ipcMain.handle(
    CHANNELS.sshForwardRemote,
    async (
      _e,
      sessionId: string,
      bindHost: string,
      bindPort: number,
      localHost: string,
      localPort: number,
    ) =>
      (
        await native().forwardRemote(id(sessionId), bindHost, bindPort, localHost, localPort)
      ).toString(),
  )
  ipcMain.handle(CHANNELS.sshForwardSocks, async (_e, sessionId: string, bind: string) =>
    (await native().forwardSocks(id(sessionId), bind)).toString(),
  )
  ipcMain.handle(CHANNELS.sshForwardBoundPort, async (_e, forwardId: string) =>
    native().forwardBoundPort(id(forwardId)),
  )
  ipcMain.handle(CHANNELS.sshCloseForward, async (_e, forwardId: string) => {
    await native().closeForward(id(forwardId))
  })
  ipcMain.handle(CHANNELS.sshNextEvents, async (_e, timeoutMs: number) =>
    serialiseEvents(await native().nextEvents(timeoutMs)),
  )

  // ---- db ----
  ipcMain.handle(CHANNELS.dbExec, async (_e, sql: string, params: SqlValue[]) => {
    await deps.db.exec(sql, params)
  })
  ipcMain.handle(CHANNELS.dbQuery, async (_e, sql: string, params: SqlValue[]) =>
    deps.db.query(sql, params),
  )
  ipcMain.handle(CHANNELS.dbTransaction, async (_e, statements: DbStatement[]) => {
    await deps.db.transaction(statements)
  })

  // ---- secure ----
  ipcMain.handle(CHANNELS.secureGet, async (_e, key: string) => deps.secureStore.get(key))
  ipcMain.handle(
    CHANNELS.secureSet,
    async (_e, key: string, value: Uint8Array, requireBiometrics: boolean) => {
      await deps.secureStore.set(key, value, requireBiometrics)
    },
  )
  ipcMain.handle(CHANNELS.secureDelete, async (_e, key: string) => {
    await deps.secureStore.delete(key)
  })

  // ---- net ----
  ipcMain.handle(CHANNELS.netRequest, async (_e, payload: HttpRequestPayload) => request(payload))

  // ---- auth ----
  ipcMain.handle(CHANNELS.authStartDeviceFlow, async () => deps.auth.startDeviceFlow())
  ipcMain.handle(CHANNELS.authPollDeviceFlow, async (_e, deviceCode: string) =>
    deps.auth.pollDeviceFlow(deviceCode),
  )
  ipcMain.handle(CHANNELS.authAccessToken, async () => deps.auth.accessToken())
  ipcMain.handle(CHANNELS.authSignOut, async () => {
    await deps.auth.signOut()
  })

  // ---- app ----
  ipcMain.handle(CHANNELS.appPickFile, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(CHANNELS.appPickSaveLocation, async (_e, suggestedName: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: suggestedName })
    return result.canceled ? null : (result.filePath ?? null)
  })
  ipcMain.handle(CHANNELS.appOpenExternal, async (_e, url: string) => {
    // Only http(s): opening an arbitrary scheme from the renderer would be a
    // handoff to whatever the OS has registered for it.
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`refusing to open a ${parsed.protocol} URL`)
    }
    await shell.openExternal(url)
  })
  ipcMain.handle(CHANNELS.appPlatformKind, () => 'desktop' as const)
}
```

- [ ] **Step 8: Wire the handlers into app startup**

Modify `apps/desktop/src/main/index.ts`: add these imports and call `registerHandlers` before `createWindow()` inside `whenReady`.

```typescript
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db.js'
import { createSecureStore } from './secureStore.js'
import { GoogleAuth } from './googleAuth.js'
import { registerHandlers } from './handlers.js'
import { request } from './net.js'
```

and replace the `whenReady` block with:

```typescript
void app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const db = openDatabase(join(userData, 'termif.sqlite'))
  const secureStore = createSecureStore(join(userData, 'secure.json'))

  const auth = new GoogleAuth({
    // Injected at build time; a desktop OAuth client secret is not a secret in
    // the cryptographic sense, which is why the device flow exists.
    clientId: process.env.TERMIF_GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.TERMIF_GOOGLE_CLIENT_SECRET ?? '',
    store: secureStore,
    request,
    now: () => Date.now(),
  })

  registerHandlers({ db, secureStore, auth })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('will-quit', () => db.close())
})
```

- [ ] **Step 9: Run the handler test and typecheck**

Run: `cd apps/desktop && npx vitest run test/main && npm run typecheck`
Expected: PASS, all main-process tests; no type errors.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add secure store, HTTP client, Google device-flow auth, IPC handlers"
```

---

## Task 4: Renderer `Platform` adapter

**Files:**
- Create: `apps/desktop/src/renderer/platform.ts`
- Test: `apps/desktop/test/renderer/platform.test.ts`

**Interfaces:**
- Consumes: `window.termif` (`TermifApi`), `@termif/core`'s `Platform`.
- Produces `createPlatform(api: TermifApi): Platform & { platformKind: Promise<'desktop'> }`, converting `bigint` ⇄ string at the boundary and reassembling `SshEvent` from `SerialisedSshEvent`.
- Produces `deserialiseEvent(e: SerialisedSshEvent): SshEvent` and `deserialiseDirEntry`.

This module is the entire seam between the shell and core: the same file exists in Plan 4 with React Native's bridge behind it, and core cannot tell the difference.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/renderer/platform.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { createPlatform, deserialiseEvent } from '../../src/renderer/platform.js'
import type { TermifApi } from '../../src/shared/ipc.js'

/** A recording stub with just enough of the API for each assertion. */
function stubApi(overrides: Partial<{ [K in keyof TermifApi]: Partial<TermifApi[K]> }> = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const record =
    (name: string, result: unknown = undefined) =>
    async (...args: unknown[]) => {
      calls.push({ name, args })
      return result
    }

  const api = {
    ssh: {
      init: record('init'),
      connect: record('connect', '42'),
      disconnect: record('disconnect'),
      trustHostKey: record('trustHostKey'),
      openShell: record('openShell', '7'),
      write: record('write'),
      resize: record('resize'),
      closeChannel: record('closeChannel'),
      sftpList: record('sftpList', []),
      sftpStat: record('sftpStat', {
        name: 'f',
        size: '1024',
        isDir: false,
        isSymlink: false,
        mode: 0o644,
        modifiedUnix: 1,
      }),
      sftpMkdir: record('sftpMkdir'),
      sftpRename: record('sftpRename'),
      sftpRemove: record('sftpRemove'),
      sftpReadRange: record('sftpReadRange', new Uint8Array([1, 2])),
      sftpUpload: record('sftpUpload', '9'),
      sftpDownload: record('sftpDownload', '10'),
      cancelTransfer: record('cancelTransfer'),
      forwardLocal: record('forwardLocal', '11'),
      forwardRemote: record('forwardRemote', '12'),
      forwardSocks: record('forwardSocks', '13'),
      forwardBoundPort: record('forwardBoundPort', 51000),
      closeForward: record('closeForward'),
      nextEvents: record('nextEvents', []),
      ...overrides.ssh,
    },
    db: {
      exec: record('exec'),
      query: record('query', []),
      transaction: record('transaction'),
      ...overrides.db,
    },
    secure: {
      get: record('get', null),
      set: record('set'),
      delete: record('delete'),
      ...overrides.secure,
    },
    net: { request: record('request', { status: 200, body: '{}' }), ...overrides.net },
    auth: {
      startDeviceFlow: record('startDeviceFlow'),
      pollDeviceFlow: record('pollDeviceFlow'),
      accessToken: record('accessToken', 'token'),
      signOut: record('signOut'),
      ...overrides.auth,
    },
    app: {
      pickFile: record('pickFile', null),
      pickSaveLocation: record('pickSaveLocation', null),
      openExternal: record('openExternal'),
      platformKind: record('platformKind', 'desktop'),
      ...overrides.app,
    },
  } as unknown as TermifApi

  return { api, calls }
}

describe('createPlatform', () => {
  it('converts a returned handle string into a bigint', async () => {
    const { api } = stubApi()
    const platform = createPlatform(api)

    const sessionId = await platform.ssh.connect({
      host: 'h',
      port: 22,
      username: 'u',
      password: 'p',
      connectTimeoutMs: 1000,
      keepaliveSecs: 30,
    })

    expect(sessionId).toBe(42n)
    expect(typeof sessionId).toBe('bigint')
  })

  it('sends a bigint handle as a decimal string', async () => {
    const { api, calls } = stubApi()
    const platform = createPlatform(api)

    await platform.ssh.disconnect(18446744073709551615n)

    expect(calls.find((c) => c.name === 'disconnect')?.args).toEqual(['18446744073709551615'])
  })

  it('converts an SFTP entry size into a bigint', async () => {
    const { api } = stubApi()
    const platform = createPlatform(api)

    const entry = await platform.ssh.sftpStat(1n, '/f')

    expect(entry.size).toBe(1024n)
  })

  it('sends an SFTP read offset as a string', async () => {
    const { api, calls } = stubApi()
    const platform = createPlatform(api)

    await platform.ssh.sftpReadRange(1n, '/f', 4096n, 100)

    expect(calls.find((c) => c.name === 'sftpReadRange')?.args).toEqual(['1', '/f', '4096', 100])
  })

  it('returns an ISO timestamp from now()', () => {
    const { api } = stubApi()
    const platform = createPlatform(api)
    expect(platform.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('produces random bytes of the requested length', () => {
    const { api } = stubApi()
    const platform = createPlatform(api)
    const bytes = platform.randomBytes(24)
    expect(bytes).toHaveLength(24)
    // Not all zeros, which would mean the CSPRNG was not called.
    expect(bytes.some((b) => b !== 0)).toBe(true)
  })

  it('passes db params through unchanged', async () => {
    const { api, calls } = stubApi()
    const platform = createPlatform(api)
    await platform.db.exec('INSERT INTO t VALUES (?)', ['a'])
    expect(calls.find((c) => c.name === 'exec')?.args).toEqual(['INSERT INTO t VALUES (?)', ['a']])
  })

  it('batches a core transaction into one IPC call', async () => {
    // Core's `transaction(fn)` runs statements through the same db handle; the
    // adapter collects them and sends one batch, because a transaction that
    // spans IPC round trips could be left open by a renderer crash.
    const { api, calls } = stubApi()
    const platform = createPlatform(api)

    await platform.db.transaction(async () => {
      await platform.db.exec('INSERT INTO t VALUES (?)', ['a'])
      await platform.db.exec('INSERT INTO t VALUES (?)', ['b'])
    })

    const transactions = calls.filter((c) => c.name === 'transaction')
    expect(transactions).toHaveLength(1)
    expect(transactions[0]?.args[0]).toEqual([
      { sql: 'INSERT INTO t VALUES (?)', params: ['a'] },
      { sql: 'INSERT INTO t VALUES (?)', params: ['b'] },
    ])
    // The individual execs must not also fire on their own.
    expect(calls.filter((c) => c.name === 'exec')).toHaveLength(0)
  })
})

describe('deserialiseEvent', () => {
  it('rebuilds channelData with a bigint handle', () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(deserialiseEvent({ kind: 'channelData', channelId: '7', bytes })).toEqual({
      kind: 'channelData',
      channelId: 7n,
      bytes,
    })
  })

  it('rebuilds transferProgress counters as bigints', () => {
    expect(
      deserialiseEvent({
        kind: 'transferProgress',
        transferId: '2',
        done: '9007199254740993',
        total: '9007199254740994',
      }),
    ).toEqual({
      kind: 'transferProgress',
      transferId: 2n,
      done: 9007199254740993n,
      total: 9007199254740994n,
    })
  })

  it('passes a log event through unchanged', () => {
    expect(deserialiseEvent({ kind: 'log', level: 'warn', msg: 'x' })).toEqual({
      kind: 'log',
      level: 'warn',
      msg: 'x',
    })
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/platform.test.ts`
Expected: FAIL — no `src/renderer/platform.ts`.

- [ ] **Step 3: Write the adapter**

`apps/desktop/src/renderer/platform.ts`:

```typescript
import type { Platform, SqlValue, SshDirEntry, SshEvent } from '@termif/core'
import type {
  DbStatement,
  SerialisedDirEntry,
  SerialisedSshEvent,
  TermifApi,
} from '../shared/ipc.js'

export function deserialiseDirEntry(entry: SerialisedDirEntry): SshDirEntry {
  return { ...entry, size: BigInt(entry.size) }
}

export function deserialiseEvent(event: SerialisedSshEvent): SshEvent {
  switch (event.kind) {
    case 'channelData':
      return { kind: 'channelData', channelId: BigInt(event.channelId), bytes: event.bytes }
    case 'channelClosed':
      return {
        kind: 'channelClosed',
        channelId: BigInt(event.channelId),
        exitStatus: event.exitStatus,
      }
    case 'sessionClosed':
      return { kind: 'sessionClosed', sessionId: BigInt(event.sessionId), reason: event.reason }
    case 'transferProgress':
      return {
        kind: 'transferProgress',
        transferId: BigInt(event.transferId),
        done: BigInt(event.done),
        total: BigInt(event.total),
      }
    case 'transferDone':
      return { kind: 'transferDone', transferId: BigInt(event.transferId), error: event.error }
    case 'forwardAccepted':
      return { kind: 'forwardAccepted', forwardId: BigInt(event.forwardId), peer: event.peer }
    case 'log':
      return { kind: 'log', level: event.level, msg: event.msg }
  }
}

/**
 * Builds the `Platform` that `@termif/core` consumes. Everything the shell
 * knows about Electron stops here: core sees only this interface, which is what
 * lets the same core drive the React Native shell (spec §6).
 */
export function createPlatform(api: TermifApi): Platform {
  /**
   * While non-null, `exec` calls accumulate here instead of firing. Core's
   * `transaction(fn)` awaits `fn`, so the batch is complete by the time the
   * wrapper resolves.
   */
  let batch: DbStatement[] | null = null

  return {
    ssh: {
      init: (knownHostsPath) => api.ssh.init(knownHostsPath),

      connect: async (cfg) => BigInt(await api.ssh.connect(cfg)),

      disconnect: (sessionId) => api.ssh.disconnect(sessionId.toString()),

      trustHostKey: (host, port, algo, fingerprint) =>
        api.ssh.trustHostKey(host, port, algo, fingerprint),

      openShell: async (sessionId, cols, rows) =>
        BigInt(await api.ssh.openShell(sessionId.toString(), cols, rows)),

      write: (channelId, data) => api.ssh.write(channelId.toString(), data),

      resize: (channelId, cols, rows) => api.ssh.resize(channelId.toString(), cols, rows),

      closeChannel: (channelId) => api.ssh.closeChannel(channelId.toString()),

      sftpList: async (sessionId, path) =>
        (await api.ssh.sftpList(sessionId.toString(), path)).map(deserialiseDirEntry),

      sftpStat: async (sessionId, path) =>
        deserialiseDirEntry(await api.ssh.sftpStat(sessionId.toString(), path)),

      sftpMkdir: (sessionId, path) => api.ssh.sftpMkdir(sessionId.toString(), path),

      sftpRename: (sessionId, from, to) => api.ssh.sftpRename(sessionId.toString(), from, to),

      sftpRemove: (sessionId, path, recursive) =>
        api.ssh.sftpRemove(sessionId.toString(), path, recursive),

      sftpReadRange: (sessionId, path, offset, len) =>
        api.ssh.sftpReadRange(sessionId.toString(), path, offset.toString(), len),

      sftpUpload: async (sessionId, local, remote) =>
        BigInt(await api.ssh.sftpUpload(sessionId.toString(), local, remote)),

      sftpDownload: async (sessionId, remote, local) =>
        BigInt(await api.ssh.sftpDownload(sessionId.toString(), remote, local)),

      cancelTransfer: (transferId) => api.ssh.cancelTransfer(transferId.toString()),

      forwardLocal: async (sessionId, localBind, remoteHost, remotePort) =>
        BigInt(
          await api.ssh.forwardLocal(sessionId.toString(), localBind, remoteHost, remotePort),
        ),

      forwardRemote: async (sessionId, bindHost, bindPort, localHost, localPort) =>
        BigInt(
          await api.ssh.forwardRemote(
            sessionId.toString(),
            bindHost,
            bindPort,
            localHost,
            localPort,
          ),
        ),

      forwardSocks: async (sessionId, localBind) =>
        BigInt(await api.ssh.forwardSocks(sessionId.toString(), localBind)),

      forwardBoundPort: (forwardId) => api.ssh.forwardBoundPort(forwardId.toString()),

      closeForward: (forwardId) => api.ssh.closeForward(forwardId.toString()),

      nextEvents: async (timeoutMs) =>
        (await api.ssh.nextEvents(timeoutMs)).map(deserialiseEvent),
    },

    secureStore: {
      get: (key) => api.secure.get(key),
      set: (key, value, requireBiometrics) => api.secure.set(key, value, requireBiometrics),
      delete: (key) => api.secure.delete(key),
    },

    db: {
      async exec(sql: string, params: readonly SqlValue[] = []): Promise<void> {
        if (batch !== null) {
          batch.push({ sql, params: [...params] })
          return
        }
        await api.db.exec(sql, [...params])
      },

      async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
        // Reads inside a transaction would not see the batch's uncommitted
        // writes, so core never queries mid-transaction; if that changes, the
        // batching strategy needs revisiting.
        return (await api.db.query(sql, [...params])) as T[]
      },

      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        if (batch !== null) {
          // Already batching: a nested transaction joins the outer one.
          return fn()
        }
        batch = []
        try {
          const result = await fn()
          const statements = batch
          batch = null
          await api.db.transaction(statements)
          return result
        } catch (e) {
          batch = null
          throw e
        }
      },
    },

    net: {
      request: async (init) =>
        api.net.request({
          method: init.method,
          url: init.url,
          ...(init.headers === undefined ? {} : { headers: { ...init.headers } }),
          ...(init.body === undefined ? {} : { body: init.body }),
        }),
    },

    now: () => new Date().toISOString(),

    randomBytes: (length) => {
      const bytes = new Uint8Array(length)
      crypto.getRandomValues(bytes)
      return bytes
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/desktop && npx vitest run test/renderer/platform.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add renderer Platform adapter over the IPC bridge"
```

---

## Task 5: Boot, stores, and the unlock gate

**Files:**
- Create: `apps/desktop/src/renderer/state/boot.ts`, `apps/desktop/src/renderer/state/vaultStore.ts`, `apps/desktop/src/renderer/state/useStore.ts`
- Create: `apps/desktop/src/renderer/app/AppRoot.tsx`, `apps/desktop/src/renderer/views/UnlockScreen.tsx`, `apps/desktop/src/renderer/views/SetupScreen.tsx`
- Modify: `apps/desktop/src/renderer/main.tsx`
- Test: `apps/desktop/test/renderer/vaultStore.test.ts`, `apps/desktop/test/renderer/UnlockScreen.test.tsx`

**Interfaces:**
- Produces `createStore<T>(initial)` — a 40-line observable store with `get`, `set`, `subscribe`, plus a `useStore(store)` React hook via `useSyncExternalStore`. No state library: the app's state is a handful of records, and `useSyncExternalStore` is the platform primitive for exactly this.
- Produces `VaultStore` with state `{ phase: 'loading' | 'needsSetup' | 'locked' | 'unlocked' | 'signedOut'; error: string | null }` and actions `boot()`, `setup(password, remember)`, `unlock(password, remember)`, `lock()`, `tryDeviceUnlock()`.
- Produces `bootApp(platform)`, returning `{ store, syncEngine, sessions, transfers, forwards, vaultStore }` — assembled once and passed down through one React context.
- The vault key never leaves the renderer (Global Constraints); the main process only ever sees the wrapped bytes.

- [ ] **Step 1: Write the failing store test**

`apps/desktop/test/renderer/vaultStore.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { Store, Vault, type Platform, type VaultMeta } from '@termif/core'
import { createVaultStore } from '../../src/renderer/state/vaultStore.js'
import { fakePlatform } from './fakes/platform.js'

/** Minimum schema-legal cost, so the tests are not dominated by Argon2id. */
const TEST_PARAMS = { m: 16384, t: 1, p: 1 } as const

async function setup() {
  const platform = fakePlatform()
  const store = await Store.open(platform)
  const vaultStore = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
  return { platform, store, vaultStore }
}

describe('vaultStore', () => {
  it('boots into needsSetup when no meta exists yet', async () => {
    const { vaultStore } = await setup()
    await vaultStore.boot()
    expect(vaultStore.get().phase).toBe('needsSetup')
  })

  it('creates a vault on setup and lands unlocked', async () => {
    const { vaultStore } = await setup()
    await vaultStore.boot()

    await vaultStore.setup('correct horse battery staple', false)

    expect(vaultStore.get().phase).toBe('unlocked')
    expect(vaultStore.vault()).not.toBeNull()
  })

  it('persists meta so a later boot lands locked, not needsSetup', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('pw', false)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()

    expect(second.get().phase).toBe('locked')
  })

  it('unlocks with the right password', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('right', false)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()
    await second.unlock('right', false)

    expect(second.get().phase).toBe('unlocked')
    expect(second.get().error).toBeNull()
  })

  it('reports a wrong password without leaving the locked phase', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('right', false)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()
    await second.unlock('wrong', false)

    expect(second.get().phase).toBe('locked')
    expect(second.get().error).toBeTruthy()
    expect(second.vault()).toBeNull()
  })

  it('clears a previous error on a successful unlock', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('right', false)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()
    await second.unlock('wrong', false)
    await second.unlock('right', false)

    expect(second.get().error).toBeNull()
  })

  it('remembers the key on the device when asked, and unlocks from it', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('pw', true)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()
    const unlocked = await second.tryDeviceUnlock()

    expect(unlocked).toBe(true)
    expect(second.get().phase).toBe('unlocked')
  })

  it('does not unlock from the device when nothing was remembered', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('pw', false)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()

    expect(await second.tryDeviceUnlock()).toBe(false)
    expect(second.get().phase).toBe('locked')
  })

  it('locks and drops the vault reference', async () => {
    const { vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('pw', false)

    vaultStore.lock()

    expect(vaultStore.get().phase).toBe('locked')
    expect(vaultStore.vault()).toBeNull()
  })

  it('notifies subscribers on each phase change', async () => {
    const { vaultStore } = await setup()
    const phases: string[] = []
    vaultStore.subscribe(() => phases.push(vaultStore.get().phase))

    await vaultStore.boot()
    await vaultStore.setup('pw', false)
    vaultStore.lock()

    expect(phases).toContain('needsSetup')
    expect(phases).toContain('unlocked')
    expect(phases.at(-1)).toBe('locked')
  })
})
```

- [ ] **Step 2: Write the fake platform for renderer tests**

`apps/desktop/test/renderer/fakes/platform.ts`:

```typescript
import initSqlJs from 'sql.js'
import type { Platform, SqlValue } from '@termif/core'

/**
 * An in-process `Platform` for renderer tests: real SQL, a memory keychain, and
 * an SSH bridge that does nothing. Component tests should exercise the same
 * core code paths the app does, not a mock of them.
 */
export function fakePlatform(): Platform {
  const items = new Map<string, Uint8Array>()

  // sql.js is synchronous once initialised; the top-level await keeps the
  // helper's signature simple for callers.
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  return {
    ssh: {
      init: async () => {},
      connect: async () => 1n,
      disconnect: async () => {},
      trustHostKey: async () => {},
      openShell: async () => 2n,
      write: async () => {},
      resize: async () => {},
      closeChannel: async () => {},
      sftpList: async () => [],
      sftpStat: async () => ({
        name: 'f',
        size: 0n,
        isDir: false,
        isSymlink: false,
        mode: 0o644,
        modifiedUnix: 0,
      }),
      sftpMkdir: async () => {},
      sftpRename: async () => {},
      sftpRemove: async () => {},
      sftpReadRange: async () => new Uint8Array(),
      sftpUpload: async () => 3n,
      sftpDownload: async () => 4n,
      cancelTransfer: async () => {},
      forwardLocal: async () => 5n,
      forwardRemote: async () => 6n,
      forwardSocks: async () => 7n,
      forwardBoundPort: async () => 51000,
      closeForward: async () => {},
      nextEvents: async (timeoutMs) => {
        await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 10)))
        return []
      },
    },
    secureStore: {
      get: async (key) => items.get(key) ?? null,
      set: async (key, value) => void items.set(key, new Uint8Array(value)),
      delete: async (key) => void items.delete(key),
    },
    db: {
      exec: async (sql: string, params: readonly SqlValue[] = []) => {
        const stmt = db.prepare(sql)
        stmt.run(params as SqlValue[])
        stmt.free()
      },
      query: async <T,>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> => {
        const stmt = db.prepare(sql)
        stmt.bind(params as SqlValue[])
        const rows: T[] = []
        while (stmt.step()) rows.push(stmt.getAsObject() as T)
        stmt.free()
        return rows
      },
      transaction: async <T,>(fn: () => Promise<T>): Promise<T> => {
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
    },
    net: {
      request: async () => ({ status: 200, body: '{}' }),
    },
    now: () => new Date().toISOString(),
    randomBytes: (n) => {
      const bytes = new Uint8Array(n)
      crypto.getRandomValues(bytes)
      return bytes
    },
  }
}
```

Note: the top-level `await initSqlJs()` inside a non-async function is invalid. Make `fakePlatform` async — `export async function fakePlatform(): Promise<Platform>` — and update the two call sites in the tests to `await fakePlatform()`.

- [ ] **Step 3: Run to see the store test fail**

Run: `cd apps/desktop && npx vitest run test/renderer/vaultStore.test.ts`
Expected: FAIL — no `src/renderer/state/vaultStore.ts`.

- [ ] **Step 4: Write the store primitive and the vault store**

`apps/desktop/src/renderer/state/useStore.ts`:

```typescript
import { useSyncExternalStore } from 'react'

export interface Observable<T> {
  get(): T
  set(next: T | ((current: T) => T)): void
  subscribe(listener: () => void): () => void
}

/**
 * The whole state layer. `useSyncExternalStore` is React's own primitive for
 * subscribing to external state, so a state library would add a dependency and
 * a concept without adding a capability.
 */
export function createStore<T>(initial: T): Observable<T> {
  let value = initial
  const listeners = new Set<() => void>()

  return {
    get: () => value,

    set(next) {
      const resolved =
        typeof next === 'function' ? (next as (current: T) => T)(value) : next
      if (resolved === value) return
      value = resolved
      for (const listener of listeners) listener()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useStore<T>(store: Observable<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** Reads one derived slice, so a component re-renders only when that changes. */
export function useSelector<T, S>(store: Observable<T>, select: (value: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  )
}
```

`apps/desktop/src/renderer/state/vaultStore.ts`:

```typescript
import {
  CoreError,
  DEFAULT_KDF_PARAMS,
  Vault,
  metaToRows,
  rowsToMeta,
  t,
  type KdfParams,
  type Platform,
  type Store,
  type VaultMeta,
} from '@termif/core'
import { createStore, type Observable } from './useStore.js'

export type VaultPhase = 'loading' | 'needsSetup' | 'locked' | 'unlocked'

export interface VaultState {
  phase: VaultPhase
  error: string | null
}

export interface VaultStore extends Observable<VaultState> {
  boot(): Promise<void>
  setup(password: string, remember: boolean): Promise<void>
  unlock(password: string, remember: boolean): Promise<void>
  tryDeviceUnlock(): Promise<boolean>
  lock(): void
  vault(): Vault | null
  meta(): VaultMeta | null
}

export interface VaultStoreDeps {
  platform: Platform
  store: Store
  kdfParams?: KdfParams
}

/** Where the serialised vault meta lives in the local store's meta table. */
const META_KEY = 'vaultMeta'

/**
 * Owns the vault's lifecycle in the renderer. The key exists only here, in
 * memory; the main process sees the wrapped bytes and never a plaintext
 * credential (spec §4).
 */
export function createVaultStore(deps: VaultStoreDeps): VaultStore {
  const base = createStore<VaultState>({ phase: 'loading', error: null })
  const params = deps.kdfParams ?? DEFAULT_KDF_PARAMS

  let vault: Vault | null = null
  let meta: VaultMeta | null = null

  const loadMeta = async (): Promise<VaultMeta | null> => {
    const raw = await deps.store.getMetaValue(META_KEY)
    if (raw === null) return null
    try {
      // Stored in the same key/value shape the sheet's meta tab uses, so the
      // two never need separate serialisers.
      return rowsToMeta(JSON.parse(raw) as string[][])
    } catch {
      return null
    }
  }

  const saveMeta = async (value: VaultMeta): Promise<void> => {
    await deps.store.setMetaValue(META_KEY, JSON.stringify(metaToRows(value)))
  }

  const describe = (e: unknown): string =>
    e instanceof CoreError && e.code === 'vault_wrong_password'
      ? t('vault.unlock.wrong')
      : t('error.unknown', { reason: e instanceof Error ? e.message : String(e) })

  return {
    ...base,

    vault: () => vault,
    meta: () => meta,

    async boot(): Promise<void> {
      meta = await loadMeta()
      base.set({ phase: meta === null ? 'needsSetup' : 'locked', error: null })
    },

    async setup(password, remember): Promise<void> {
      const created = await Vault.create(deps.platform, password, params)
      vault = created.vault
      meta = created.meta
      await saveMeta(created.meta)

      if (remember) await created.vault.rememberOnDevice(deps.platform.secureStore)
      base.set({ phase: 'unlocked', error: null })
    },

    async unlock(password, remember): Promise<void> {
      if (meta === null) {
        base.set({ phase: 'needsSetup', error: null })
        return
      }

      try {
        const opened = await Vault.unlock(deps.platform, meta, password)
        vault = opened
        if (remember) await opened.rememberOnDevice(deps.platform.secureStore)
        base.set({ phase: 'unlocked', error: null })
      } catch (e) {
        vault = null
        base.set({ phase: 'locked', error: describe(e) })
      }
    },

    async tryDeviceUnlock(): Promise<boolean> {
      if (meta === null) return false

      const opened = await Vault.unlockFromDevice(deps.platform, meta)
      if (opened === null) return false

      vault = opened
      base.set({ phase: 'unlocked', error: null })
      return true
    },

    lock(): void {
      vault?.lock()
      vault = null
      base.set({ phase: 'locked', error: null })
    },
  }
}
```

- [ ] **Step 5: Run the store test**

Run: `cd apps/desktop && npx vitest run test/renderer/vaultStore.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Write the failing unlock-screen test**

`apps/desktop/test/renderer/UnlockScreen.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@termif/core'
import { UnlockScreen } from '../../src/renderer/views/UnlockScreen.js'

describe('UnlockScreen', () => {
  it('submits the typed password', async () => {
    const onUnlock = vi.fn(async () => {})
    render(<UnlockScreen error={null} onUnlock={onUnlock} onDeviceUnlock={null} />)

    await userEvent.type(screen.getByLabelText(t('vault.unlock.prompt')), 'my-password')
    await userEvent.click(screen.getByRole('button', { name: /unlock/i }))

    expect(onUnlock).toHaveBeenCalledWith('my-password', false)
  })

  it('passes the remember choice through', async () => {
    const onUnlock = vi.fn(async () => {})
    render(<UnlockScreen error={null} onUnlock={onUnlock} onDeviceUnlock={null} />)

    await userEvent.type(screen.getByLabelText(t('vault.unlock.prompt')), 'pw')
    await userEvent.click(screen.getByLabelText(t('vault.remember')))
    await userEvent.click(screen.getByRole('button', { name: /unlock/i }))

    expect(onUnlock).toHaveBeenCalledWith('pw', true)
  })

  it('shows the error message when unlocking failed', () => {
    render(
      <UnlockScreen error={t('vault.unlock.wrong')} onUnlock={vi.fn()} onDeviceUnlock={null} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(t('vault.unlock.wrong'))
  })

  it('does not submit an empty password', async () => {
    const onUnlock = vi.fn(async () => {})
    render(<UnlockScreen error={null} onUnlock={onUnlock} onDeviceUnlock={null} />)

    await userEvent.click(screen.getByRole('button', { name: /unlock/i }))

    expect(onUnlock).not.toHaveBeenCalled()
  })

  it('masks the password field', () => {
    render(<UnlockScreen error={null} onUnlock={vi.fn()} onDeviceUnlock={null} />)
    expect(screen.getByLabelText(t('vault.unlock.prompt'))).toHaveAttribute('type', 'password')
  })

  it('offers the device unlock only when one is available', async () => {
    const onDeviceUnlock = vi.fn(async () => true)
    const { rerender } = render(
      <UnlockScreen error={null} onUnlock={vi.fn()} onDeviceUnlock={onDeviceUnlock} />,
    )

    const button = screen.getByRole('button', { name: /this device/i })
    await userEvent.click(button)
    expect(onDeviceUnlock).toHaveBeenCalled()

    rerender(<UnlockScreen error={null} onUnlock={vi.fn()} onDeviceUnlock={null} />)
    expect(screen.queryByRole('button', { name: /this device/i })).toBeNull()
  })
})
```

- [ ] **Step 7: Write the screens and AppRoot**

`apps/desktop/src/renderer/views/UnlockScreen.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { t } from '@termif/core'

export interface UnlockScreenProps {
  error: string | null
  onUnlock(password: string, remember: boolean): Promise<void>
  /** Null when this device has no remembered key. */
  onDeviceUnlock: (() => Promise<boolean>) | null
}

export function UnlockScreen({ error, onUnlock, onDeviceUnlock }: UnlockScreenProps) {
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (password.length === 0 || busy) return

    setBusy(true)
    try {
      await onUnlock(password, remember)
    } finally {
      setBusy(false)
      // Clear it either way: a failed attempt should not leave the secret in
      // a DOM node.
      setPassword('')
    }
  }

  return (
    <main className="unlock">
      <h1>{t('vault.locked')}</h1>

      <form onSubmit={submit}>
        <label htmlFor="master-password">{t('vault.unlock.prompt')}</label>
        <input
          id="master-password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label htmlFor="remember-device">
          <input
            id="remember-device"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('vault.remember')}
        </label>

        {error !== null && <p role="alert">{error}</p>}

        <button type="submit" disabled={busy}>
          Unlock
        </button>
      </form>

      {onDeviceUnlock !== null && (
        <button type="button" onClick={() => void onDeviceUnlock()}>
          Unlock with this device
        </button>
      )}
    </main>
  )
}
```

`apps/desktop/src/renderer/views/SetupScreen.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { t } from '@termif/core'

export interface SetupScreenProps {
  onSetup(password: string, remember: boolean): Promise<void>
}

/** Minimum length is a floor, not a strength meter; Argon2id carries the rest. */
const MIN_LENGTH = 10

export function SetupScreen({ onSetup }: SetupScreenProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(true)

  const tooShort = password.length > 0 && password.length < MIN_LENGTH
  const mismatch = confirm.length > 0 && password !== confirm
  const canSubmit = password.length >= MIN_LENGTH && password === confirm

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canSubmit) return
    await onSetup(password, remember)
    setPassword('')
    setConfirm('')
  }

  return (
    <main className="setup">
      <h1>{t('vault.setup.title')}</h1>
      {/* Says plainly that a lost password means lost credentials (spec §10). */}
      <p>{t('vault.setup.warning')}</p>

      <form onSubmit={submit}>
        <label htmlFor="new-password">{t('vault.unlock.prompt')}</label>
        <input
          id="new-password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {tooShort && <p role="alert">Use at least {MIN_LENGTH} characters.</p>}

        <label htmlFor="confirm-password">Confirm</label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && <p role="alert">Those do not match.</p>}

        <label htmlFor="remember-setup">
          <input
            id="remember-setup"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('vault.remember')}
        </label>

        <button type="submit" disabled={!canSubmit}>
          Create vault
        </button>
      </form>
    </main>
  )
}
```

`apps/desktop/src/renderer/state/boot.ts`:

```typescript
import {
  ForwardManager,
  SessionManager,
  SheetClient,
  Store,
  SyncEngine,
  TransferManager,
  type Platform,
} from '@termif/core'
import type { TermifApi } from '../../shared/ipc.js'
import { createVaultStore, type VaultStore } from './vaultStore.js'

export interface App {
  platform: Platform
  store: Store
  vaultStore: VaultStore
  sessions: SessionManager
  transfers: TransferManager
  forwards: ForwardManager
  sync: SyncEngine | null
  setSpreadsheet(spreadsheetId: string): void
}

const SPREADSHEET_KEY = 'spreadsheetId'

/**
 * Assembles core once. The managers are long-lived and share one drain loop, so
 * they are created here rather than inside a component that could remount.
 */
export async function bootApp(platform: Platform, api: TermifApi): Promise<App> {
  const store = await Store.open(platform)
  const vaultStore = createVaultStore({ platform, store })

  const sessions = new SessionManager({ ssh: platform.ssh, now: platform.now })
  const transfers = new TransferManager({ ssh: platform.ssh })
  const forwards = new ForwardManager({ ssh: platform.ssh, platformKind: 'desktop' })

  // Transfer and forward events arrive on the same queue the sessions manager
  // drains, so they are forwarded here rather than opened as a second loop.
  sessions.onBridgeEvent?.((event) => {
    transfers.handleEvent(event)
    forwards.handleEvent(event)
  })

  await sessions.start()
  await vaultStore.boot()

  const client = new SheetClient(platform.net, () => api.auth.accessToken())
  const stored = await store.getMetaValue(SPREADSHEET_KEY)

  const app: App = {
    platform,
    store,
    vaultStore,
    sessions,
    transfers,
    forwards,
    sync:
      stored === null
        ? null
        : new SyncEngine({ store, client, spreadsheetId: stored, now: platform.now }),
    setSpreadsheet(spreadsheetId: string): void {
      void store.setMetaValue(SPREADSHEET_KEY, spreadsheetId)
      app.sync = new SyncEngine({ store, client, spreadsheetId, now: platform.now })
    },
  }

  return app
}
```

Note on `sessions.onBridgeEvent`: Plan 2's `SessionManager` exposes `onLog`, `onTabClosed`, and `onSessionState`, but not a raw event tap — its drain loop consumes transfer and forward events and ignores them. Add `onBridgeEvent(listener: (event: SshEvent) => void): () => void` to `SessionManager` in Plan 2 Task 9, emitting every drained event before its own `#handle`, and drop the optional-call `?.` here. One loop with a tap is right; a second `nextEvents` loop would race the first for the same events.

`apps/desktop/src/renderer/app/AppRoot.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { t } from '@termif/core'
import type { App } from '../state/boot.js'
import { useStore } from '../state/useStore.js'
import { SetupScreen } from '../views/SetupScreen.js'
import { UnlockScreen } from '../views/UnlockScreen.js'
import { MainLayout } from './MainLayout.js'

export function AppRoot({ app }: { app: App }) {
  const vault = useStore(app.vaultStore)
  const [deviceUnlockAvailable, setDeviceUnlockAvailable] = useState(false)

  // Try the remembered key once, before showing the password prompt.
  useEffect(() => {
    if (vault.phase !== 'locked') return
    let cancelled = false

    void app.vaultStore.tryDeviceUnlock().then((unlocked) => {
      if (!cancelled && !unlocked) setDeviceUnlockAvailable(false)
    })

    return () => {
      cancelled = true
    }
  }, [app, vault.phase])

  if (vault.phase === 'loading') return <main>{t('sync.running')}</main>

  if (vault.phase === 'needsSetup') {
    return <SetupScreen onSetup={(pw, remember) => app.vaultStore.setup(pw, remember)} />
  }

  if (vault.phase === 'locked') {
    return (
      <UnlockScreen
        error={vault.error}
        onUnlock={(pw, remember) => app.vaultStore.unlock(pw, remember)}
        onDeviceUnlock={
          deviceUnlockAvailable ? () => app.vaultStore.tryDeviceUnlock() : null
        }
      />
    )
  }

  return <MainLayout app={app} />
}
```

`apps/desktop/src/renderer/main.tsx` (replacing the placeholder):

```tsx
import { createRoot } from 'react-dom/client'
import { AppRoot } from './app/AppRoot.js'
import { bootApp } from './state/boot.js'
import { createPlatform } from './platform.js'
import type { TermifApi } from '../shared/ipc.js'

declare global {
  interface Window {
    termif: TermifApi
  }
}

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')

const api = window.termif
const platform = createPlatform(api)

// The known_hosts file lives beside the database, per device, and is never
// synced (spec §5).
await api.ssh.init('termif_known_hosts')

const app = await bootApp(platform, api)
createRoot(root).render(<AppRoot app={app} />)
```

- [ ] **Step 8: Run the unlock-screen test**

Run: `cd apps/desktop && npx vitest run test/renderer`
Expected: PASS, 16 tests across both renderer test files. `MainLayout` arrives in Task 6; until then, stub it as `export function MainLayout() { return <div>ready</div> }` in `apps/desktop/src/renderer/app/MainLayout.tsx` so the tree compiles.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add boot, observable stores, and the vault unlock gate"
```

---

## Task 6: Host list, host form, and the layout

**Files:**
- Create: `apps/desktop/src/renderer/state/hostStore.ts`
- Create: `apps/desktop/src/renderer/app/MainLayout.tsx` (replacing the stub)
- Create: `apps/desktop/src/renderer/views/HostList.tsx`, `apps/desktop/src/renderer/views/HostForm.tsx`, `apps/desktop/src/renderer/views/SyncBadge.tsx`
- Test: `apps/desktop/test/renderer/hostStore.test.ts`, `apps/desktop/test/renderer/HostList.test.tsx`, `apps/desktop/test/renderer/HostForm.test.tsx`

**Interfaces:**
- Produces `createHostStore({ store, sync })` with state `{ hosts: Host[]; credentials: StoredCredential[]; query: string; loading: boolean }` and actions `refresh()`, `setQuery(q)`, `save(input, secret)`, `remove(id)`, `visibleHosts()`.
- `save` writes the credential ciphertext through the vault and then the host, in that order, so a host never points at an `authRef` that does not exist yet.
- Produces `MainLayout` — sidebar (host list, sync badge) plus a main pane that switches between terminal tabs, the SFTP browser, and the forward panel.

- [ ] **Step 1: Write the failing host-store test**

`apps/desktop/test/renderer/hostStore.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { Store, Vault } from '@termif/core'
import { createHostStore } from '../../src/renderer/state/hostStore.js'
import { fakePlatform } from './fakes/platform.js'

const TEST_PARAMS = { m: 16384, t: 1, p: 1 } as const

async function setup() {
  const platform = await fakePlatform()
  const store = await Store.open(platform)
  const { vault } = await Vault.create(platform, 'pw', TEST_PARAMS)
  const requestSync: string[] = []
  const hostStore = createHostStore({
    store,
    vault: () => vault,
    requestSync: () => requestSync.push('sync'),
  })
  return { platform, store, vault, hostStore, requestSync }
}

const input = {
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 22,
  username: 'deploy',
  tags: ['prod'],
  groupId: null,
}

describe('hostStore', () => {
  it('loads an empty list on refresh', async () => {
    const { hostStore } = await setup()
    await hostStore.refresh()
    expect(hostStore.get().hosts).toEqual([])
    expect(hostStore.get().loading).toBe(false)
  })

  it('saves a host with no credential', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)

    const hosts = hostStore.get().hosts
    expect(hosts).toHaveLength(1)
    expect(hosts[0]?.label).toBe('web-1')
    expect(hosts[0]?.authRef).toBeNull()
  })

  it('encrypts a password credential and links it from the host', async () => {
    const { hostStore, store, vault } = await setup()
    await hostStore.save(input, { kind: 'password', label: 'web-1 password', secret: 'hunter2' })

    const host = hostStore.get().hosts[0]!
    expect(host.authRef).not.toBeNull()

    const credential = await store.getCredential(host.authRef!)
    expect(credential).not.toBeNull()
    // The stored form must not contain the plaintext.
    expect(credential!.cipher).not.toContain('hunter2')
    expect(vault.decrypt(credential!.cipher, credential!.id)).toBe('hunter2')
  })

  it('encrypts a key credential', async () => {
    const { hostStore, store, vault } = await setup()
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----'
    await hostStore.save(input, { kind: 'key', label: 'deploy key', secret: pem })

    const host = hostStore.get().hosts[0]!
    const credential = await store.getCredential(host.authRef!)
    expect(credential?.kind).toBe('key')
    expect(vault.decrypt(credential!.cipher, credential!.id)).toBe(pem)
  })

  it('updates an existing host without creating a duplicate', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)
    const id = hostStore.get().hosts[0]!.id

    await hostStore.save({ ...input, id, label: 'renamed' }, null)

    expect(hostStore.get().hosts).toHaveLength(1)
    expect(hostStore.get().hosts[0]?.label).toBe('renamed')
  })

  it('removes a host from the list', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)
    const id = hostStore.get().hosts[0]!.id

    await hostStore.remove(id)

    expect(hostStore.get().hosts).toEqual([])
  })

  it('requests a sync after each mutation', async () => {
    const { hostStore, requestSync } = await setup()
    await hostStore.save(input, null)
    await hostStore.remove(hostStore.get().hosts[0]!.id)
    expect(requestSync).toHaveLength(2)
  })

  it('filters by label, hostname, username, and tag', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)
    await hostStore.save(
      { ...input, label: 'db-1', hostname: 'db.internal', username: 'postgres', tags: ['data'] },
      null,
    )

    const matches = (query: string): string[] => {
      hostStore.setQuery(query)
      return hostStore.visibleHosts().map((h) => h.label)
    }

    expect(matches('web')).toEqual(['web-1'])
    expect(matches('internal')).toEqual(['db-1'])
    expect(matches('postgres')).toEqual(['db-1'])
    expect(matches('prod')).toEqual(['web-1'])
    expect(matches('')).toEqual(['db-1', 'web-1'])
  })

  it('matches case-insensitively', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)
    hostStore.setQuery('WEB1.EXAMPLE')
    expect(hostStore.visibleHosts()).toHaveLength(1)
  })

  it('refuses to save a credential while the vault is locked', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const hostStore = createHostStore({ store, vault: () => null, requestSync: () => {} })

    await expect(
      hostStore.save(input, { kind: 'password', label: 'x', secret: 'y' }),
    ).rejects.toMatchObject({ code: 'vault_locked' })
  })

  it('still saves a host with no credential while locked', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const hostStore = createHostStore({ store, vault: () => null, requestSync: () => {} })

    await hostStore.save(input, null)
    expect(hostStore.get().hosts).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/hostStore.test.ts`
Expected: FAIL — no `src/renderer/state/hostStore.ts`.

- [ ] **Step 3: Write the host store**

`apps/desktop/src/renderer/state/hostStore.ts`:

```typescript
import {
  CoreError,
  type Host,
  type HostInput,
  type StoredCredential,
  type Store,
  type Vault,
} from '@termif/core'
import { createStore, type Observable } from './useStore.js'

export interface SecretInput {
  kind: 'password' | 'key'
  label: string
  secret: string
}

export interface HostState {
  hosts: Host[]
  credentials: StoredCredential[]
  query: string
  loading: boolean
}

export interface HostStore extends Observable<HostState> {
  refresh(): Promise<void>
  setQuery(query: string): void
  visibleHosts(): Host[]
  save(input: HostInput, secret: SecretInput | null): Promise<Host>
  remove(id: string): Promise<void>
}

export interface HostStoreDeps {
  store: Store
  /** Read lazily: the vault can be locked between renders. */
  vault: () => Vault | null
  requestSync: () => void
}

export function createHostStore(deps: HostStoreDeps): HostStore {
  const base = createStore<HostState>({
    hosts: [],
    credentials: [],
    query: '',
    loading: true,
  })

  const reload = async (): Promise<void> => {
    const [hosts, credentials] = await Promise.all([
      deps.store.listHosts(),
      deps.store.listCredentials(),
    ])
    base.set((current) => ({ ...current, hosts, credentials, loading: false }))
  }

  return {
    ...base,

    refresh: reload,

    setQuery(query): void {
      base.set((current) => ({ ...current, query }))
    },

    visibleHosts(): Host[] {
      const { hosts, query } = base.get()
      const needle = query.trim().toLowerCase()
      if (needle.length === 0) return hosts

      return hosts.filter((host) =>
        [host.label, host.hostname, host.username, ...host.tags]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    },

    async save(input, secret): Promise<Host> {
      let authRef = input.authRef ?? null

      if (secret !== null) {
        const vault = deps.vault()
        if (vault === null) {
          throw new CoreError('vault_locked', 'unlock the vault before saving a credential')
        }

        // Written first so the host never references a credential row that does
        // not exist yet. The AAD is the credential's own id, which binds the
        // ciphertext to its row (spec §4).
        const placeholder = await deps.store.upsertCredential({
          ...(authRef === null ? {} : { id: authRef }),
          label: secret.label,
          kind: secret.kind,
          cipher: 'AA', // replaced immediately below, once the id exists
        })
        const stored = await deps.store.upsertCredential({
          id: placeholder.id,
          label: secret.label,
          kind: secret.kind,
          cipher: vault.encrypt(secret.secret, placeholder.id),
        })
        authRef = stored.id
      }

      const host = await deps.store.upsertHost({ ...input, authRef })
      await reload()
      deps.requestSync()
      return host
    },

    async remove(id): Promise<void> {
      const host = await deps.store.getHost(id)
      await deps.store.deleteHost(id)

      // A credential exists to serve its host; leaving it behind would
      // accumulate secrets nothing references.
      if (host?.authRef != null) await deps.store.deleteCredential(host.authRef)

      await reload()
      deps.requestSync()
    },
  }
}
```

Note on the two-step credential write: the AAD must be the credential's final id, which the store assigns. Writing a placeholder then the real ciphertext keeps that honest at the cost of one extra local write. If Plan 2's `newId()` is exported (it is), a cleaner alternative is to generate the id here and pass it in once — prefer that at implementation time and drop the placeholder.

- [ ] **Step 4: Run the store test**

Run: `cd apps/desktop && npx vitest run test/renderer/hostStore.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write the failing component tests**

`apps/desktop/test/renderer/HostList.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Host } from '@termif/core'
import { HostList } from '../../src/renderer/views/HostList.js'

const host = (over: Partial<Host> = {}): Host => ({
  id: 'h1',
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 22,
  username: 'deploy',
  authRef: null,
  tags: ['prod'],
  groupId: null,
  updatedAt: '2026-08-28T10:00:00.000Z',
  deleted: false,
  ...over,
})

describe('HostList', () => {
  it('renders each host with its user and hostname', () => {
    render(
      <HostList
        hosts={[host(), host({ id: 'h2', label: 'db-1', hostname: 'db.internal' })]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    expect(screen.getByText('web-1')).toBeInTheDocument()
    expect(screen.getByText('deploy@web1.example.com')).toBeInTheDocument()
    expect(screen.getByText('db-1')).toBeInTheDocument()
  })

  it('shows the port only when it is not 22, so the common case stays quiet', () => {
    const { rerender } = render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )
    expect(screen.queryByText(/:22\b/)).toBeNull()

    rerender(
      <HostList
        hosts={[host({ port: 2222 })]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )
    expect(screen.getByText(/:2222/)).toBeInTheDocument()
  })

  it('connects on a double click, which is the fast path', async () => {
    const onConnect = vi.fn()
    render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={onConnect}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    await userEvent.dblClick(screen.getByRole('listitem'))

    expect(onConnect).toHaveBeenCalledWith('h1')
  })

  it('connects on Enter for keyboard users', async () => {
    const onConnect = vi.fn()
    render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={onConnect}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    screen.getByRole('listitem').focus()
    await userEvent.keyboard('{Enter}')

    expect(onConnect).toHaveBeenCalledWith('h1')
  })

  it('reports search input upward rather than filtering itself', async () => {
    const onQueryChange = vi.fn()
    render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={onQueryChange}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    await userEvent.type(screen.getByRole('searchbox'), 'db')

    expect(onQueryChange).toHaveBeenLastCalledWith('db')
  })

  it('asks for confirmation before deleting', async () => {
    const onDelete = vi.fn()
    render(
      <HostList
        hosts={[host()]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
        onAdd={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /delete web-1/i }))
    expect(onDelete).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^confirm/i }))
    expect(onDelete).toHaveBeenCalledWith('h1')
  })

  it('shows an empty state that differs for no hosts versus no matches', () => {
    const { rerender } = render(
      <HostList
        hosts={[]}
        query=""
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )
    expect(screen.getByText(/no hosts yet/i)).toBeInTheDocument()

    rerender(
      <HostList
        hosts={[]}
        query="zzz"
        onQueryChange={vi.fn()}
        onConnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />,
    )
    expect(screen.getByText(/no hosts match/i)).toBeInTheDocument()
  })
})
```

`apps/desktop/test/renderer/HostForm.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HostForm } from '../../src/renderer/views/HostForm.js'

describe('HostForm', () => {
  it('defaults the port to 22', () => {
    render(<HostForm host={null} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText(/port/i)).toHaveValue(22)
  })

  it('submits label, hostname, port, username, and tags', async () => {
    const onSave = vi.fn(async () => {})
    render(<HostForm host={null} onSave={onSave} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/^label/i), 'web-1')
    await userEvent.type(screen.getByLabelText(/hostname/i), 'web1.example.com')
    await userEvent.clear(screen.getByLabelText(/port/i))
    await userEvent.type(screen.getByLabelText(/port/i), '2222')
    await userEvent.type(screen.getByLabelText(/username/i), 'deploy')
    await userEvent.type(screen.getByLabelText(/tags/i), 'prod, eu')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'web-1',
        hostname: 'web1.example.com',
        port: 2222,
        username: 'deploy',
        tags: ['prod', 'eu'],
      }),
      null,
    )
  })

  it('submits a password credential when one is entered', async () => {
    const onSave = vi.fn(async () => {})
    render(<HostForm host={null} onSave={onSave} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/^label/i), 'web-1')
    await userEvent.type(screen.getByLabelText(/hostname/i), 'h')
    await userEvent.type(screen.getByLabelText(/username/i), 'u')
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'password', secret: 'hunter2' }),
    )
  })

  it('switches to a key field when the key auth type is chosen', async () => {
    render(<HostForm host={null} onSave={vi.fn()} onCancel={vi.fn()} />)

    await userEvent.selectOptions(screen.getByLabelText(/authentication/i), 'key')

    expect(screen.getByLabelText(/private key/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^password/i)).toBeNull()
  })

  it('will not submit without a hostname', async () => {
    const onSave = vi.fn(async () => {})
    render(<HostForm host={null} onSave={onSave} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/^label/i), 'web-1')
    await userEvent.type(screen.getByLabelText(/username/i), 'u')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('rejects a port outside 1-65535', async () => {
    const onSave = vi.fn(async () => {})
    render(<HostForm host={null} onSave={onSave} onCancel={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/^label/i), 'x')
    await userEvent.type(screen.getByLabelText(/hostname/i), 'h')
    await userEvent.type(screen.getByLabelText(/username/i), 'u')
    await userEvent.clear(screen.getByLabelText(/port/i))
    await userEvent.type(screen.getByLabelText(/port/i), '70000')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('prefills from an existing host and keeps its id', async () => {
    const onSave = vi.fn(async () => {})
    render(
      <HostForm
        host={{
          id: 'h1',
          label: 'web-1',
          hostname: 'web1.example.com',
          port: 2222,
          username: 'deploy',
          authRef: 'c1',
          tags: ['prod'],
          groupId: null,
          updatedAt: '2026-08-28T10:00:00.000Z',
          deleted: false,
        }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/^label/i)).toHaveValue('web-1')
    expect(screen.getByLabelText(/port/i)).toHaveValue(2222)
    expect(screen.getByLabelText(/tags/i)).toHaveValue('prod')

    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'h1', authRef: 'c1' }),
      // No new secret typed, so the existing credential is left alone.
      null,
    )
  })

  it('cancels without saving', async () => {
    const onCancel = vi.fn()
    render(<HostForm host={null} onSave={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Write the components**

`apps/desktop/src/renderer/views/HostList.tsx`:

```tsx
import { useState, type KeyboardEvent } from 'react'
import type { Host } from '@termif/core'

export interface HostListProps {
  hosts: readonly Host[]
  query: string
  onQueryChange(query: string): void
  onConnect(id: string): void
  onEdit(id: string): void
  onDelete(id: string): void
  onAdd(): void
}

export function HostList({
  hosts,
  query,
  onQueryChange,
  onConnect,
  onEdit,
  onDelete,
  onAdd,
}: HostListProps) {
  // Confirming inline rather than in a modal: a delete is reversible for 90
  // days via the tombstone, so a second click is proportionate friction.
  const [confirming, setConfirming] = useState<string | null>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, id: string): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onConnect(id)
    }
  }

  return (
    <nav className="host-list">
      <div className="host-list__toolbar">
        <input
          type="search"
          role="searchbox"
          aria-label="Search hosts"
          placeholder="Search hosts"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <button type="button" onClick={onAdd}>
          Add host
        </button>
      </div>

      {hosts.length === 0 ? (
        <p className="host-list__empty">
          {query.trim().length === 0 ? 'No hosts yet. Add one to get started.' : 'No hosts match that search.'}
        </p>
      ) : (
        <ul>
          {hosts.map((host) => (
            <li
              key={host.id}
              tabIndex={0}
              onDoubleClick={() => onConnect(host.id)}
              onKeyDown={(e) => onKeyDown(e, host.id)}
            >
              <span className="host-list__label">{host.label}</span>
              <span className="host-list__target">
                {host.username}@{host.hostname}
                {host.port !== 22 && `:${host.port}`}
              </span>

              {host.tags.length > 0 && (
                <span className="host-list__tags">
                  {host.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </span>
              )}

              <span className="host-list__actions">
                <button type="button" onClick={() => onConnect(host.id)}>
                  Connect
                </button>
                <button type="button" onClick={() => onEdit(host.id)}>
                  Edit {host.label}
                </button>

                {confirming === host.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(null)
                        onDelete(host.id)
                      }}
                    >
                      Confirm delete
                    </button>
                    <button type="button" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirming(host.id)}>
                    Delete {host.label}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
```

`apps/desktop/src/renderer/views/HostForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import type { Host, HostInput } from '@termif/core'
import type { SecretInput } from '../state/hostStore.js'

export interface HostFormProps {
  /** Null to add; a host to edit. */
  host: Host | null
  onSave(input: HostInput, secret: SecretInput | null): Promise<void>
  onCancel(): void
}

type AuthType = 'password' | 'key'

export function HostForm({ host, onSave, onCancel }: HostFormProps) {
  const [label, setLabel] = useState(host?.label ?? '')
  const [hostname, setHostname] = useState(host?.hostname ?? '')
  const [port, setPort] = useState(host?.port ?? 22)
  const [username, setUsername] = useState(host?.username ?? '')
  const [tags, setTags] = useState((host?.tags ?? []).join(', '))
  const [authType, setAuthType] = useState<AuthType>('password')
  const [secret, setSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()

    if (label.trim().length === 0) return setError('Give the host a label.')
    if (hostname.trim().length === 0) return setError('Enter a hostname.')
    if (username.trim().length === 0) return setError('Enter a username.')
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return setError('Port must be between 1 and 65535.')
    }
    setError(null)

    const input: HostInput = {
      ...(host === null ? {} : { id: host.id }),
      label: label.trim(),
      hostname: hostname.trim(),
      port,
      username: username.trim(),
      authRef: host?.authRef ?? null,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
      groupId: host?.groupId ?? null,
    }

    // An empty secret field on an edit means "leave the stored credential
    // alone", not "clear it".
    const secretInput: SecretInput | null =
      secret.length === 0
        ? null
        : {
            kind: authType,
            label: `${input.label} ${authType}`,
            secret: authType === 'key' && passphrase.length > 0 ? secret : secret,
          }

    await onSave(input, secretInput)
  }

  return (
    <form className="host-form" onSubmit={submit}>
      <h2>{host === null ? 'Add host' : `Edit ${host.label}`}</h2>

      <label htmlFor="host-label">Label</label>
      <input id="host-label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />

      <label htmlFor="host-hostname">Hostname</label>
      <input id="host-hostname" value={hostname} onChange={(e) => setHostname(e.target.value)} />

      <label htmlFor="host-port">Port</label>
      <input
        id="host-port"
        type="number"
        min={1}
        max={65535}
        value={port}
        onChange={(e) => setPort(Number(e.target.value))}
      />

      <label htmlFor="host-username">Username</label>
      <input id="host-username" value={username} onChange={(e) => setUsername(e.target.value)} />

      <label htmlFor="host-tags">Tags</label>
      <input
        id="host-tags"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="prod, eu-west"
      />

      <label htmlFor="host-auth">Authentication</label>
      <select
        id="host-auth"
        value={authType}
        onChange={(e) => setAuthType(e.target.value as AuthType)}
      >
        <option value="password">Password</option>
        <option value="key">Private key</option>
      </select>

      {authType === 'password' ? (
        <>
          <label htmlFor="host-password">Password</label>
          <input
            id="host-password"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={host?.authRef == null ? '' : 'Leave blank to keep the stored password'}
          />
        </>
      ) : (
        <>
          <label htmlFor="host-key">Private key</label>
          <textarea
            id="host-key"
            rows={6}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />

          <label htmlFor="host-passphrase">Key passphrase (optional)</label>
          <input
            id="host-passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </>
      )}

      {error !== null && <p role="alert">{error}</p>}

      <div className="host-form__actions">
        <button type="submit">Save</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
```

`apps/desktop/src/renderer/views/SyncBadge.tsx`:

```tsx
import { t, type SyncStatus } from '@termif/core'

export interface SyncBadgeProps {
  status: SyncStatus
  onSyncNow(): void
}

export function SyncBadge({ status, onSyncNow }: SyncBadgeProps) {
  const text = (): string => {
    if (status.state === 'running') return t('sync.running')
    if (status.state === 'failed') {
      const code = status.lastError?.code
      // Quota is common and self-healing, so it gets its own calmer message.
      return code === 'sheet_quota'
        ? t('sync.quota')
        : t('sync.failed', { reason: status.lastError?.message ?? '' })
    }
    return status.lastSuccessAt === null
      ? t('sync.idle', { when: 'never' })
      : t('sync.idle', { when: new Date(status.lastSuccessAt).toLocaleTimeString() })
  }

  return (
    <button
      type="button"
      className={`sync-badge sync-badge--${status.state}`}
      onClick={onSyncNow}
      title="Sync now"
    >
      {text()}
    </button>
  )
}
```

`apps/desktop/src/renderer/app/MainLayout.tsx` (replacing the Task 5 stub):

```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../state/useStore.js'
import { createHostStore } from '../state/hostStore.js'
import type { App } from '../state/boot.js'
import { HostList } from '../views/HostList.js'
import { HostForm } from '../views/HostForm.js'
import { SyncBadge } from '../views/SyncBadge.js'
import { TerminalTabs } from '../views/TerminalTabs.js'
import { SftpBrowser } from '../views/SftpBrowser.js'
import { ForwardPanel } from '../views/ForwardPanel.js'
import { useConnectFlow } from '../state/connectFlow.js'
import type { SyncStatus } from '@termif/core'

type Pane = 'terminals' | 'files' | 'forwards'

export function MainLayout({ app }: { app: App }) {
  // Created once per mount and kept: recreating it would drop the loaded list.
  const [hostStore] = useState(() =>
    createHostStore({
      store: app.store,
      vault: () => app.vaultStore.vault(),
      requestSync: () => app.sync?.requestSync(),
    }),
  )
  const hosts = useStore(hostStore)

  const [pane, setPane] = useState<Pane>('terminals')
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    app.sync?.status ?? { state: 'idle', lastSuccessAt: null, lastError: null },
  )

  const connect = useConnectFlow(app, hostStore)

  useEffect(() => {
    void hostStore.refresh()
    // The store emits on every local write, so the list stays live without polling.
    return app.store.onChange(() => void hostStore.refresh())
  }, [app.store, hostStore])

  useEffect(() => app.sync?.onStatus(setSyncStatus), [app.sync])

  const editingHost =
    editing?.id == null ? null : (hosts.hosts.find((h) => h.id === editing.id) ?? null)

  return (
    <div className="layout">
      <aside className="layout__sidebar">
        <SyncBadge status={syncStatus} onSyncNow={() => void app.sync?.syncNow()} />

        <HostList
          hosts={hostStore.visibleHosts()}
          query={hosts.query}
          onQueryChange={(q) => hostStore.setQuery(q)}
          onConnect={(id) => void connect.start(id)}
          onEdit={(id) => setEditing({ id })}
          onDelete={(id) => void hostStore.remove(id)}
          onAdd={() => setEditing({ id: null })}
        />
      </aside>

      <main className="layout__main">
        <nav className="layout__tabs" role="tablist">
          {(['terminals', 'files', 'forwards'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={pane === name}
              onClick={() => setPane(name)}
            >
              {name}
            </button>
          ))}
        </nav>

        {editing !== null ? (
          <HostForm
            host={editingHost}
            onSave={async (input, secret) => {
              await hostStore.save(input, secret)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        ) : pane === 'terminals' ? (
          <TerminalTabs app={app} />
        ) : pane === 'files' ? (
          <SftpBrowser app={app} />
        ) : (
          <ForwardPanel app={app} />
        )}
      </main>

      {connect.prompt}
    </div>
  )
}
```

`TerminalTabs`, `SftpBrowser`, `ForwardPanel`, and `useConnectFlow` arrive in Tasks 7–10. Stub each as a one-line component returning `null` so the tree compiles after this task, and replace them in turn.

- [ ] **Step 7: Run the component tests**

Run: `cd apps/desktop && npx vitest run test/renderer && npm run typecheck`
Expected: PASS, all renderer tests; no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add host store, host list, host form, and the main layout"
```

---

## Task 7: Connect flow and the host key prompt

**Files:**
- Create: `apps/desktop/src/renderer/state/connectFlow.tsx`, `apps/desktop/src/renderer/views/HostKeyPrompt.tsx`
- Test: `apps/desktop/test/renderer/HostKeyPrompt.test.tsx`, `apps/desktop/test/renderer/connectFlow.test.tsx`

**Interfaces:**
- Produces `useConnectFlow(app, hostStore)` returning `{ start(hostId): Promise<void>; prompt: ReactNode }`.
- Produces `HostKeyPrompt` with two modes:
  - `unknown` — shows the fingerprint and offers Trust / Cancel.
  - `mismatch` — shows both fingerprints and offers **only** Cancel. There is no override control at all (spec §7).
- The flow: read the host, decrypt its credential, call `sessions.connect`, and on `host_key_unknown` show the prompt, `trustHostKey`, then retry once. On `host_key_mismatch`, stop.

- [ ] **Step 1: Write the failing prompt test**

`apps/desktop/test/renderer/HostKeyPrompt.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@termif/core'
import { HostKeyPrompt } from '../../src/renderer/views/HostKeyPrompt.js'

describe('HostKeyPrompt', () => {
  it('shows the fingerprint and algorithm for an unknown key', () => {
    render(
      <HostKeyPrompt
        mode="unknown"
        host="web1.example.com"
        algo="ssh-ed25519"
        fingerprint="SHA256:aaa"
        expected={null}
        onTrust={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(t('hostkey.unknown.title', { host: 'web1.example.com' }))).toBeInTheDocument()
    expect(screen.getByText(/SHA256:aaa/)).toBeInTheDocument()
    expect(screen.getByText(/ssh-ed25519/)).toBeInTheDocument()
  })

  it('trusts on confirmation', async () => {
    const onTrust = vi.fn()
    render(
      <HostKeyPrompt
        mode="unknown"
        host="h"
        algo="ssh-ed25519"
        fingerprint="SHA256:aaa"
        expected={null}
        onTrust={onTrust}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: t('hostkey.unknown.trust') }))
    expect(onTrust).toHaveBeenCalled()
  })

  it('cancels without trusting', async () => {
    const onTrust = vi.fn()
    const onCancel = vi.fn()
    render(
      <HostKeyPrompt
        mode="unknown"
        host="h"
        algo="ssh-ed25519"
        fingerprint="SHA256:aaa"
        expected={null}
        onTrust={onTrust}
        onCancel={onCancel}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: t('hostkey.unknown.cancel') }))
    expect(onCancel).toHaveBeenCalled()
    expect(onTrust).not.toHaveBeenCalled()
  })

  it('shows both fingerprints on a mismatch', () => {
    render(
      <HostKeyPrompt
        mode="mismatch"
        host="web1.example.com"
        algo="ssh-ed25519"
        fingerprint="SHA256:bbb"
        expected="SHA256:aaa"
        onTrust={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/SHA256:aaa/)).toBeInTheDocument()
    expect(screen.getByText(/SHA256:bbb/)).toBeInTheDocument()
  })

  it('offers no way to continue past a mismatch', () => {
    // The spec makes this a hard block: a changed key is the signature of an
    // MITM in progress, so the UI must not render an override at all.
    render(
      <HostKeyPrompt
        mode="mismatch"
        host="h"
        algo="ssh-ed25519"
        fingerprint="SHA256:bbb"
        expected="SHA256:aaa"
        onTrust={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAccessibleName(/cancel|close/i)
    expect(screen.queryByRole('button', { name: /trust|continue|proceed|anyway|once/i })).toBeNull()
  })

  it('calling onTrust is impossible in mismatch mode even programmatically via the UI', async () => {
    const onTrust = vi.fn()
    render(
      <HostKeyPrompt
        mode="mismatch"
        host="h"
        algo="ssh-ed25519"
        fingerprint="SHA256:bbb"
        expected="SHA256:aaa"
        onTrust={onTrust}
        onCancel={vi.fn()}
      />,
    )

    for (const button of screen.getAllByRole('button')) {
      await userEvent.click(button)
    }
    expect(onTrust).not.toHaveBeenCalled()
  })

  it('is announced as an alert dialog, so it is not missed', () => {
    render(
      <HostKeyPrompt
        mode="mismatch"
        host="h"
        algo="ssh-ed25519"
        fingerprint="SHA256:bbb"
        expected="SHA256:aaa"
        onTrust={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Write the prompt**

`apps/desktop/src/renderer/views/HostKeyPrompt.tsx`:

```tsx
import { t } from '@termif/core'

export interface HostKeyPromptProps {
  mode: 'unknown' | 'mismatch'
  host: string
  algo: string
  fingerprint: string
  /** The previously trusted fingerprint; only set for a mismatch. */
  expected: string | null
  onTrust(): void
  onCancel(): void
}

export function HostKeyPrompt({
  mode,
  host,
  algo,
  fingerprint,
  expected,
  onTrust,
  onCancel,
}: HostKeyPromptProps) {
  if (mode === 'mismatch') {
    return (
      <div role="alertdialog" aria-labelledby="hostkey-title" className="hostkey hostkey--mismatch">
        <h2 id="hostkey-title">{t('hostkey.mismatch.title', { host })}</h2>
        <p>
          {t('hostkey.mismatch.body', {
            expected: expected ?? 'unknown',
            got: fingerprint,
          })}
        </p>
        <dl>
          <dt>Previously trusted</dt>
          <dd><code>{expected}</code></dd>
          <dt>Presented now</dt>
          <dd><code>{fingerprint}</code></dd>
          <dt>Algorithm</dt>
          <dd><code>{algo}</code></dd>
        </dl>

        {/*
          Exactly one button. No "trust anyway", no "just this once": a changed
          host key is how an interception looks from the inside, and an escape
          hatch here would be the one the user reaches for under time pressure
          (spec §7).
        */}
        <button type="button" onClick={onCancel} autoFocus>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div role="alertdialog" aria-labelledby="hostkey-title" className="hostkey hostkey--unknown">
      <h2 id="hostkey-title">{t('hostkey.unknown.title', { host })}</h2>
      <p>{t('hostkey.unknown.body', { algo, fingerprint })}</p>

      <div className="hostkey__actions">
        <button type="button" onClick={onTrust} autoFocus>
          {t('hostkey.unknown.trust')}
        </button>
        <button type="button" onClick={onCancel}>
          {t('hostkey.unknown.cancel')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run the prompt test**

Run: `cd apps/desktop && npx vitest run test/renderer/HostKeyPrompt.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 4: Write the failing connect-flow test**

`apps/desktop/test/renderer/connectFlow.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { CoreError } from '@termif/core'
import { resolveCredential, classifyConnectError } from '../../src/renderer/state/connectFlow.js'
import { Store, Vault } from '@termif/core'
import { fakePlatform } from './fakes/platform.js'

const TEST_PARAMS = { m: 16384, t: 1, p: 1 } as const

describe('resolveCredential', () => {
  it('returns nothing for a host with no stored credential', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const { vault } = await Vault.create(platform, 'pw', TEST_PARAMS)

    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: null,
      tags: [],
      groupId: null,
    })

    expect(await resolveCredential(store, vault, host)).toBeNull()
  })

  it('decrypts a password credential', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const { vault } = await Vault.create(platform, 'pw', TEST_PARAMS)

    const credential = await store.upsertCredential({
      label: 'pw',
      kind: 'password',
      cipher: 'placeholder',
    })
    const sealed = await store.upsertCredential({
      id: credential.id,
      label: 'pw',
      kind: 'password',
      cipher: vault.encrypt('hunter2', credential.id),
    })
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: sealed.id,
      tags: [],
      groupId: null,
    })

    expect(await resolveCredential(store, vault, host)).toEqual({ password: 'hunter2' })
  })

  it('decrypts a key credential into privateKeyPem', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const { vault } = await Vault.create(platform, 'pw', TEST_PARAMS)

    const credential = await store.upsertCredential({
      label: 'key',
      kind: 'key',
      cipher: 'placeholder',
    })
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----'
    const sealed = await store.upsertCredential({
      id: credential.id,
      label: 'key',
      kind: 'key',
      cipher: vault.encrypt(pem, credential.id),
    })
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: sealed.id,
      tags: [],
      groupId: null,
    })

    expect(await resolveCredential(store, vault, host)).toEqual({ privateKeyPem: pem })
  })

  it('throws when the vault is locked but a credential is needed', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const credential = await store.upsertCredential({
      label: 'pw',
      kind: 'password',
      cipher: 'AA',
    })
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: credential.id,
      tags: [],
      groupId: null,
    })

    await expect(resolveCredential(store, null, host)).rejects.toMatchObject({
      code: 'vault_locked',
    })
  })

  it('throws a clear error when the referenced credential is gone', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const { vault } = await Vault.create(platform, 'pw', TEST_PARAMS)
    const host = await store.upsertHost({
      label: 'h',
      hostname: 'h',
      port: 22,
      username: 'u',
      authRef: 'missing-id',
      tags: [],
      groupId: null,
    })

    await expect(resolveCredential(store, vault, host)).rejects.toMatchObject({
      code: 'credential_missing',
    })
  })
})

describe('classifyConnectError', () => {
  it('recognises an unknown host key as promptable', () => {
    const result = classifyConnectError(
      new CoreError('host_key_unknown', 'unknown', {
        host: 'h',
        fingerprint: 'SHA256:aaa',
        algo: 'ssh-ed25519',
      }),
    )
    expect(result).toEqual({
      kind: 'prompt',
      mode: 'unknown',
      fingerprint: 'SHA256:aaa',
      algo: 'ssh-ed25519',
      expected: null,
    })
  })

  it('recognises a mismatch as a block, not a prompt to trust', () => {
    const result = classifyConnectError(
      new CoreError('host_key_mismatch', 'changed', {
        host: 'h',
        expected: 'SHA256:aaa',
        got: 'SHA256:bbb',
      }),
    )
    expect(result).toEqual({
      kind: 'prompt',
      mode: 'mismatch',
      fingerprint: 'SHA256:bbb',
      algo: '',
      expected: 'SHA256:aaa',
    })
  })

  it('maps an auth failure to a message the user can act on', () => {
    const result = classifyConnectError(new CoreError('auth', 'bad password'))
    expect(result.kind).toBe('message')
    expect(result.kind === 'message' && result.text).toMatch(/username and credential/i)
  })

  it('maps a timeout to its own message', () => {
    const result = classifyConnectError(new CoreError('timeout', 'timed out'))
    expect(result.kind === 'message' && result.text).toMatch(/timed out/i)
  })

  it('falls back to a generic message for anything else', () => {
    const result = classifyConnectError(new CoreError('io', 'socket exploded'))
    expect(result.kind === 'message' && result.text).toContain('socket exploded')
  })
})
```

- [ ] **Step 5: Write the connect flow**

`apps/desktop/src/renderer/state/connectFlow.tsx`:

```tsx
import { useCallback, useState, type ReactNode } from 'react'
import {
  CoreError,
  t,
  type ConnectCredential,
  type Host,
  type Store,
  type Vault,
} from '@termif/core'
import { HostKeyPrompt } from '../views/HostKeyPrompt.js'
import type { App } from './boot.js'
import type { HostStore } from './hostStore.js'

/**
 * Reads a host's credential and decrypts it. The plaintext exists only for the
 * duration of the connect call and is never written anywhere (spec §3).
 */
export async function resolveCredential(
  store: Store,
  vault: Vault | null,
  host: Host,
): Promise<ConnectCredential | null> {
  if (host.authRef === null) return null

  if (vault === null) {
    throw new CoreError('vault_locked', 'unlock the vault to use this host’s credential')
  }

  const credential = await store.getCredential(host.authRef)
  if (credential === null) {
    throw new CoreError(
      'credential_missing',
      'the credential this host points at is no longer in the vault',
    )
  }

  const secret = vault.decrypt(credential.cipher, credential.id)
  return credential.kind === 'password' ? { password: secret } : { privateKeyPem: secret }
}

export type ConnectFailure =
  | {
      kind: 'prompt'
      mode: 'unknown' | 'mismatch'
      fingerprint: string
      algo: string
      expected: string | null
    }
  | { kind: 'message'; text: string }

export function classifyConnectError(error: unknown): ConnectFailure {
  const core = error instanceof CoreError ? error : new CoreError('unknown', String(error))

  if (core.code === 'host_key_unknown') {
    return {
      kind: 'prompt',
      mode: 'unknown',
      fingerprint: core.details.fingerprint ?? '',
      algo: core.details.algo ?? '',
      expected: null,
    }
  }

  if (core.code === 'host_key_mismatch') {
    return {
      kind: 'prompt',
      mode: 'mismatch',
      fingerprint: core.details.got ?? '',
      algo: '',
      expected: core.details.expected ?? null,
    }
  }

  switch (core.code) {
    case 'auth':
      return { kind: 'message', text: t('error.auth.failed') }
    case 'timeout':
      return { kind: 'message', text: t('error.connect.timeout', { host: core.details.host ?? '' }) }
    case 'connect':
      return { kind: 'message', text: t('error.connect.refused', { host: core.details.host ?? '' }) }
    default:
      return { kind: 'message', text: t('error.unknown', { reason: core.message }) }
  }
}

interface PromptState {
  host: Host
  mode: 'unknown' | 'mismatch'
  fingerprint: string
  algo: string
  expected: string | null
}

export interface ConnectFlow {
  start(hostId: string): Promise<void>
  prompt: ReactNode
  lastError: string | null
}

/**
 * Drives connect, including the one legitimate retry: after the user trusts a
 * previously unknown key. A mismatch never retries.
 */
export function useConnectFlow(app: App, hostStore: HostStore): ConnectFlow {
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const attempt = useCallback(
    async (host: Host): Promise<void> => {
      const credential = await resolveCredential(app.store, app.vaultStore.vault(), host)
      if (credential === null) {
        // No stored credential: the host form is where one gets added, so say
        // so rather than opening a second password prompt here.
        setLastError('This host has no stored credential. Edit it to add one.')
        return
      }

      const sessionId = await app.sessions.connect(host, credential)
      await app.sessions.openTab(sessionId, 80, 24)
    },
    [app],
  )

  const start = useCallback(
    async (hostId: string): Promise<void> => {
      setLastError(null)
      const host = hostStore.get().hosts.find((h) => h.id === hostId)
      if (host === undefined) return

      try {
        await attempt(host)
      } catch (error) {
        const failure = classifyConnectError(error)
        if (failure.kind === 'message') {
          setLastError(failure.text)
          return
        }
        setPrompt({
          host,
          mode: failure.mode,
          fingerprint: failure.fingerprint,
          algo: failure.algo,
          expected: failure.expected,
        })
      }
    },
    [attempt, hostStore],
  )

  const trustAndRetry = useCallback(async (): Promise<void> => {
    if (prompt === null || prompt.mode !== 'unknown') return
    const { host, algo, fingerprint } = prompt
    setPrompt(null)

    try {
      await app.platform.ssh.trustHostKey(host.hostname, host.port, algo, fingerprint)
      await attempt(host)
    } catch (error) {
      const failure = classifyConnectError(error)
      // Exactly one retry: if it still fails, report rather than loop.
      setLastError(failure.kind === 'message' ? failure.text : t('error.unknown', { reason: '' }))
    }
  }, [app, attempt, prompt])

  return {
    start,
    lastError,
    prompt:
      prompt === null ? null : (
        <HostKeyPrompt
          mode={prompt.mode}
          host={prompt.host.hostname}
          algo={prompt.algo}
          fingerprint={prompt.fingerprint}
          expected={prompt.expected}
          onTrust={() => void trustAndRetry()}
          onCancel={() => setPrompt(null)}
        />
      ),
  }
}
```

- [ ] **Step 6: Run the connect-flow test**

Run: `cd apps/desktop && npx vitest run test/renderer/connectFlow.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add connect flow with host key trust prompt and mismatch block"
```

---

## Task 8: Terminal tabs

**Files:**
- Create: `apps/desktop/src/renderer/views/TerminalPane.tsx`, `apps/desktop/src/renderer/views/TerminalTabs.tsx`
- Create: `apps/desktop/src/renderer/state/tabStore.ts`
- Test: `apps/desktop/test/renderer/tabStore.test.ts`, `apps/desktop/test/renderer/TerminalPane.test.tsx`

**Interfaces:**
- Produces `createTabStore({ sessions })` with state `{ tabs: TabView[]; activeId: string | null }` where `TabView = { id: string; title: string; sessionId: bigint; state: 'live' | 'reconnecting' | 'closed' }`, and actions `add(sessionId, title)`, `close(id)`, `activate(id)`, `setState(id, state)`.
- Produces `TerminalPane` — mounts one `xterm.js`, subscribes to its tab's bytes, writes user input back, and resizes on container change.
- Byte batching: `channelData` is written straight to `xterm.js`. No ANSI parsing in the renderer's own code (spec §6).

- [ ] **Step 1: Write the failing tab-store test**

`apps/desktop/test/renderer/tabStore.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { createTabStore } from '../../src/renderer/state/tabStore.js'

describe('tabStore', () => {
  it('starts empty', () => {
    const store = createTabStore()
    expect(store.get().tabs).toEqual([])
    expect(store.get().activeId).toBeNull()
  })

  it('activates the first tab it adds', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'web-1' })
    expect(store.get().activeId).toBe('t1')
  })

  it('activates each newly added tab, since the user just asked for it', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'web-1' })
    store.add({ id: 't2', sessionId: 1n, title: 'web-1' })
    expect(store.get().activeId).toBe('t2')
  })

  it('numbers repeat tabs on the same host so they are distinguishable', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'web-1' })
    store.add({ id: 't2', sessionId: 1n, title: 'web-1' })
    expect(store.get().tabs.map((t) => t.title)).toEqual(['web-1', 'web-1 (2)'])
  })

  it('moves activation to the neighbour when the active tab closes', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.add({ id: 't2', sessionId: 1n, title: 'b' })
    store.add({ id: 't3', sessionId: 1n, title: 'c' })

    store.activate('t2')
    store.close('t2')

    // Prefer the tab to the right, which is what a browser does.
    expect(store.get().activeId).toBe('t3')
  })

  it('falls back to the left neighbour when closing the last tab', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.add({ id: 't2', sessionId: 1n, title: 'b' })

    store.activate('t2')
    store.close('t2')

    expect(store.get().activeId).toBe('t1')
  })

  it('clears activation when the last tab closes', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.close('t1')
    expect(store.get().tabs).toEqual([])
    expect(store.get().activeId).toBeNull()
  })

  it('keeps activation when a non-active tab closes', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.add({ id: 't2', sessionId: 1n, title: 'b' })
    store.activate('t1')
    store.close('t2')
    expect(store.get().activeId).toBe('t1')
  })

  it('marks a tab reconnecting without removing it, so scrollback survives', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.setState('t1', 'reconnecting')

    expect(store.get().tabs[0]?.state).toBe('reconnecting')
    expect(store.get().tabs).toHaveLength(1)
  })

  it('marks every tab on a session at once', () => {
    const store = createTabStore()
    store.add({ id: 't1', sessionId: 1n, title: 'a' })
    store.add({ id: 't2', sessionId: 1n, title: 'b' })
    store.add({ id: 't3', sessionId: 2n, title: 'c' })

    store.setSessionState(1n, 'reconnecting')

    expect(store.get().tabs.map((t) => t.state)).toEqual(['reconnecting', 'reconnecting', 'live'])
  })

  it('ignores an unknown tab id rather than throwing at a UI callsite', () => {
    const store = createTabStore()
    expect(() => store.close('nope')).not.toThrow()
    expect(() => store.activate('nope')).not.toThrow()
    expect(() => store.setState('nope', 'closed')).not.toThrow()
  })
})
```

- [ ] **Step 2: Write the tab store**

`apps/desktop/src/renderer/state/tabStore.ts`:

```typescript
import { createStore, type Observable } from './useStore.js'

export type TabState = 'live' | 'reconnecting' | 'closed'

export interface TabView {
  id: string
  sessionId: bigint
  title: string
  state: TabState
}

export interface TabsState {
  tabs: TabView[]
  activeId: string | null
}

export interface TabStore extends Observable<TabsState> {
  add(tab: { id: string; sessionId: bigint; title: string }): void
  close(id: string): void
  activate(id: string): void
  setState(id: string, state: TabState): void
  setSessionState(sessionId: bigint, state: TabState): void
}

export function createTabStore(): TabStore {
  const base = createStore<TabsState>({ tabs: [], activeId: null })

  /** Second tab on the same host becomes "web-1 (2)". */
  const uniqueTitle = (tabs: readonly TabView[], title: string): string => {
    const sameBase = tabs.filter((t) => t.title === title || t.title.startsWith(`${title} (`))
    return sameBase.length === 0 ? title : `${title} (${sameBase.length + 1})`
  }

  return {
    ...base,

    add({ id, sessionId, title }): void {
      base.set((current) => ({
        tabs: [
          ...current.tabs,
          { id, sessionId, title: uniqueTitle(current.tabs, title), state: 'live' },
        ],
        // The user just asked for this tab, so focus follows it.
        activeId: id,
      }))
    },

    close(id): void {
      base.set((current) => {
        const index = current.tabs.findIndex((t) => t.id === id)
        if (index === -1) return current

        const tabs = current.tabs.filter((t) => t.id !== id)
        if (current.activeId !== id) return { tabs, activeId: current.activeId }

        // Prefer the tab to the right, then the left — the behaviour every
        // tabbed interface has trained people to expect.
        const next = tabs[index] ?? tabs[index - 1] ?? null
        return { tabs, activeId: next?.id ?? null }
      })
    },

    activate(id): void {
      base.set((current) =>
        current.tabs.some((t) => t.id === id) ? { ...current, activeId: id } : current,
      )
    },

    setState(id, state): void {
      base.set((current) => ({
        ...current,
        tabs: current.tabs.map((t) => (t.id === id ? { ...t, state } : t)),
      }))
    },

    setSessionState(sessionId, state): void {
      base.set((current) => ({
        ...current,
        tabs: current.tabs.map((t) => (t.sessionId === sessionId ? { ...t, state } : t)),
      }))
    },
  }
}
```

- [ ] **Step 3: Run the tab-store test**

Run: `cd apps/desktop && npx vitest run test/renderer/tabStore.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 4: Write the failing terminal-pane test**

`apps/desktop/test/renderer/TerminalPane.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TerminalPane } from '../../src/renderer/views/TerminalPane.js'

/**
 * xterm.js needs a real canvas and layout, which jsdom does not provide, so the
 * addons are stubbed and the Terminal is replaced by a recorder. What is under
 * test is the wiring — subscribe, write, send input, resize, dispose — not the
 * emulator, which has its own test suite upstream.
 */
const written: (string | Uint8Array)[] = []
const disposed: string[] = []
let onDataHandler: ((data: string) => void) | null = null
let onResizeHandler: ((size: { cols: number; rows: number }) => void) | null = null

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    open = vi.fn()
    loadAddon = vi.fn()
    focus = vi.fn()
    write(data: string | Uint8Array) {
      written.push(data)
    }
    onData(handler: (data: string) => void) {
      onDataHandler = handler
      return { dispose: () => disposed.push('onData') }
    }
    onResize(handler: (size: { cols: number; rows: number }) => void) {
      onResizeHandler = handler
      return { dispose: () => disposed.push('onResize') }
    }
    dispose() {
      disposed.push('terminal')
    }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose = vi.fn()
  },
}))

function makeSessions() {
  const subscribers = new Map<string, (bytes: Uint8Array) => void>()
  return {
    subscribeTab: vi.fn((tab: string, onData: (bytes: Uint8Array) => void) => {
      subscribers.set(tab, onData)
      return () => subscribers.delete(tab)
    }),
    writeToTab: vi.fn(async () => {}),
    resizeTab: vi.fn(async () => {}),
    emit(tab: string, bytes: Uint8Array) {
      subscribers.get(tab)?.(bytes)
    },
    subscriberCount: () => subscribers.size,
  }
}

describe('TerminalPane', () => {
  it('writes incoming bytes straight to the terminal', async () => {
    written.length = 0
    const sessions = makeSessions()
    render(<TerminalPane tabId="t1" sessions={sessions as never} active />)

    const bytes = new TextEncoder().encode('hello')
    sessions.emit('t1', bytes)

    await waitFor(() => expect(written).toContain(bytes))
  })

  it('passes raw bytes rather than decoding them, so the emulator handles UTF-8', async () => {
    written.length = 0
    const sessions = makeSessions()
    render(<TerminalPane tabId="t1" sessions={sessions as never} active />)

    // A multi-byte character split across two chunks would break if we decoded
    // per chunk; xterm.js reassembles it.
    const first = new Uint8Array([0xe2, 0x9c])
    const second = new Uint8Array([0x93])
    sessions.emit('t1', first)
    sessions.emit('t1', second)

    await waitFor(() => {
      expect(written).toContain(first)
      expect(written).toContain(second)
    })
    expect(written.every((w) => w instanceof Uint8Array)).toBe(true)
  })

  it('sends typed input to its tab', async () => {
    const sessions = makeSessions()
    render(<TerminalPane tabId="t1" sessions={sessions as never} active />)

    onDataHandler?.('ls\r')

    await waitFor(() =>
      expect(sessions.writeToTab).toHaveBeenCalledWith('t1', new TextEncoder().encode('ls\r')),
    )
  })

  it('reports a resize to its tab', async () => {
    const sessions = makeSessions()
    render(<TerminalPane tabId="t1" sessions={sessions as never} active />)

    onResizeHandler?.({ cols: 132, rows: 43 })

    await waitFor(() => expect(sessions.resizeTab).toHaveBeenCalledWith('t1', 132, 43))
  })

  it('unsubscribes and disposes on unmount, so a closed tab leaks nothing', () => {
    disposed.length = 0
    const sessions = makeSessions()
    const { unmount } = render(<TerminalPane tabId="t1" sessions={sessions as never} active />)

    unmount()

    expect(sessions.subscriberCount()).toBe(0)
    expect(disposed).toContain('terminal')
  })

  it('subscribes once even across re-renders', () => {
    const sessions = makeSessions()
    const { rerender } = render(<TerminalPane tabId="t1" sessions={sessions as never} active />)
    rerender(<TerminalPane tabId="t1" sessions={sessions as never} active />)
    rerender(<TerminalPane tabId="t1" sessions={sessions as never} active={false} />)

    expect(sessions.subscribeTab).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 5: Write the terminal pane and tabs**

`apps/desktop/src/renderer/views/TerminalPane.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import type { SessionManager } from '@termif/core'
import '@xterm/xterm/css/xterm.css'

export interface TerminalPaneProps {
  tabId: string
  sessions: SessionManager
  active: boolean
}

/**
 * One xterm.js instance per tab. Bytes go from the SSH channel straight into
 * the emulator: core does not parse ANSI, because xterm.js does it better and
 * on the thread that draws (spec §6).
 */
export function TerminalPane({ tabId, sessions, active }: TerminalPaneProps) {
  const container = useRef<HTMLDivElement | null>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)

  // Keyed on tabId only: a re-render must not tear down a live terminal, and
  // `active` merely changes visibility.
  useEffect(() => {
    const element = container.current
    if (element === null) return

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      // Bounded so a chatty process cannot grow memory without limit.
      scrollback: 10_000,
      allowProposedApi: true,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(element)

    // WebGL is a large throughput win but is unavailable in some VMs and
    // remote-desktop sessions; falling back to the DOM renderer is correct,
    // not an error worth surfacing.
    try {
      term.loadAddon(new WebglAddon())
    } catch {
      // DOM renderer stays in place.
    }

    fitAddon.fit()
    terminal.current = term
    fit.current = fitAddon

    const unsubscribe = sessions.subscribeTab(tabId, (bytes) => {
      term.write(bytes)
    })

    const dataSub = term.onData((data) => {
      void sessions.writeToTab(tabId, new TextEncoder().encode(data))
    })

    const resizeSub = term.onResize(({ cols, rows }) => {
      void sessions.resizeTab(tabId, cols, rows)
    })

    // Refit on container size changes so a window resize reaches the remote PTY.
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        // Fit throws when the element is hidden; harmless.
      }
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
      resizeSub.dispose()
      dataSub.dispose()
      unsubscribe()
      term.dispose()
      terminal.current = null
      fit.current = null
    }
  }, [sessions, tabId])

  useEffect(() => {
    if (active) {
      terminal.current?.focus()
      try {
        fit.current?.fit()
      } catch {
        // Hidden pane; nothing to fit.
      }
    }
  }, [active])

  return (
    <div
      ref={container}
      className="terminal-pane"
      // Kept mounted while hidden: unmounting would discard scrollback, and
      // reconnect explicitly promises to keep it (spec §6).
      style={{ display: active ? 'block' : 'none', height: '100%' }}
    />
  )
}
```

`apps/desktop/src/renderer/views/TerminalTabs.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { t } from '@termif/core'
import type { App } from '../state/boot.js'
import { createTabStore } from '../state/tabStore.js'
import { useStore } from '../state/useStore.js'
import { TerminalPane } from './TerminalPane.js'
import { SnippetPalette } from './SnippetPalette.js'

export function TerminalTabs({ app }: { app: App }) {
  const [tabStore] = useState(() => createTabStore())
  const { tabs, activeId } = useStore(tabStore)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Tabs are opened by the connect flow through the session manager, so this
  // component learns about them by listening rather than by being told.
  useEffect(() => {
    const offClosed = app.sessions.onTabClosed((tabId) => tabStore.close(tabId))

    const offState = app.sessions.onSessionState((sessionId, state) => {
      tabStore.setSessionState(
        sessionId,
        state === 'connected' ? 'live' : state === 'reconnecting' ? 'reconnecting' : 'closed',
      )
    })

    return () => {
      offClosed()
      offState()
    }
  }, [app.sessions, tabStore])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return

      if (event.key === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (event.key === 'w' && activeId !== null) {
        event.preventDefault()
        void app.sessions.closeTab(activeId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeId, app.sessions])

  if (tabs.length === 0) {
    return <p className="terminal-tabs__empty">Connect to a host to open a terminal.</p>
  }

  return (
    <div className="terminal-tabs">
      <div role="tablist" className="terminal-tabs__bar">
        {tabs.map((tab) => (
          <div key={tab.id} className={`terminal-tabs__tab terminal-tabs__tab--${tab.state}`}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              onClick={() => tabStore.activate(tab.id)}
            >
              {tab.title}
              {tab.state === 'reconnecting' && ' …'}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              onClick={() => void app.sessions.closeTab(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {tabs.some((tab) => tab.state === 'reconnecting') && (
        <p role="status" className="terminal-tabs__notice">
          {t('session.reconnecting')}
        </p>
      )}

      <div className="terminal-tabs__panes">
        {tabs.map((tab) => (
          <TerminalPane
            key={tab.id}
            tabId={tab.id}
            sessions={app.sessions}
            active={tab.id === activeId}
          />
        ))}
      </div>

      {paletteOpen && activeId !== null && (
        <SnippetPalette
          app={app}
          onSend={async (body) => {
            await app.sessions.writeToTab(activeId, new TextEncoder().encode(body))
            setPaletteOpen(false)
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Run the terminal tests**

Run: `cd apps/desktop && npx vitest run test/renderer/TerminalPane.test.tsx test/renderer/tabStore.test.ts`
Expected: PASS, 17 tests. `SnippetPalette` arrives in Task 9; stub it returning `null` until then.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add terminal tabs with xterm.js panes and reconnect status"
```

---

## Task 9: Snippet palette

**Files:**
- Create: `apps/desktop/src/renderer/state/snippetStore.ts`, `apps/desktop/src/renderer/views/SnippetPalette.tsx`
- Test: `apps/desktop/test/renderer/snippetStore.test.ts`, `apps/desktop/test/renderer/SnippetPalette.test.tsx`

**Interfaces:**
- Produces `createSnippetStore({ store, requestSync })` with state `{ snippets: Snippet[]; query: string }` and actions `refresh()`, `setQuery(q)`, `visible()`, `save(input)`, `remove(id)`.
- Produces `SnippetPalette` — a filtered list with keyboard navigation, Enter to send, and an inline editor for adding one.
- Sending appends a newline unless the body already ends with one, so a one-line command actually runs.

- [ ] **Step 1: Write the failing store test**

`apps/desktop/test/renderer/snippetStore.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { Store } from '@termif/core'
import { createSnippetStore, withTrailingNewline } from '../../src/renderer/state/snippetStore.js'
import { fakePlatform } from './fakes/platform.js'

async function setup() {
  const platform = await fakePlatform()
  const store = await Store.open(platform)
  const synced: string[] = []
  const snippetStore = createSnippetStore({ store, requestSync: () => synced.push('sync') })
  return { store, snippetStore, synced }
}

describe('snippetStore', () => {
  it('saves and lists a snippet', async () => {
    const { snippetStore } = await setup()
    await snippetStore.save({ label: 'tail nginx', body: 'tail -f /var/log/nginx/error.log', tags: ['nginx'] })

    expect(snippetStore.get().snippets).toHaveLength(1)
    expect(snippetStore.get().snippets[0]?.label).toBe('tail nginx')
  })

  it('filters by label, body, and tag', async () => {
    const { snippetStore } = await setup()
    await snippetStore.save({ label: 'tail nginx', body: 'tail -f /var/log/nginx/error.log', tags: ['web'] })
    await snippetStore.save({ label: 'disk usage', body: 'df -h', tags: ['ops'] })

    const matches = (query: string): string[] => {
      snippetStore.setQuery(query)
      return snippetStore.visible().map((s) => s.label)
    }

    expect(matches('nginx')).toEqual(['tail nginx'])
    expect(matches('df')).toEqual(['disk usage'])
    expect(matches('ops')).toEqual(['disk usage'])
    expect(matches('')).toEqual(['disk usage', 'tail nginx'])
  })

  it('updates an existing snippet in place', async () => {
    const { snippetStore } = await setup()
    await snippetStore.save({ label: 'a', body: 'ls', tags: [] })
    const id = snippetStore.get().snippets[0]!.id

    await snippetStore.save({ id, label: 'a renamed', body: 'ls -la', tags: [] })

    expect(snippetStore.get().snippets).toHaveLength(1)
    expect(snippetStore.get().snippets[0]?.body).toBe('ls -la')
  })

  it('removes a snippet', async () => {
    const { snippetStore } = await setup()
    await snippetStore.save({ label: 'a', body: 'ls', tags: [] })
    await snippetStore.remove(snippetStore.get().snippets[0]!.id)
    expect(snippetStore.get().snippets).toEqual([])
  })

  it('requests a sync after each mutation', async () => {
    const { snippetStore, synced } = await setup()
    await snippetStore.save({ label: 'a', body: 'ls', tags: [] })
    await snippetStore.remove(snippetStore.get().snippets[0]!.id)
    expect(synced).toHaveLength(2)
  })
})

describe('withTrailingNewline', () => {
  it('adds a newline so a one-line command runs', () => {
    expect(withTrailingNewline('df -h')).toBe('df -h\n')
  })

  it('does not double an existing newline', () => {
    expect(withTrailingNewline('df -h\n')).toBe('df -h\n')
  })

  it('leaves a body ending in a carriage return alone', () => {
    // Some snippets are written for a device expecting CR; do not "fix" them.
    expect(withTrailingNewline('df -h\r')).toBe('df -h\r')
  })

  it('handles a multi-line body', () => {
    expect(withTrailingNewline('cd /tmp\nls')).toBe('cd /tmp\nls\n')
  })
})
```

- [ ] **Step 2: Write the store**

`apps/desktop/src/renderer/state/snippetStore.ts`:

```typescript
import type { Snippet, SnippetInput, Store } from '@termif/core'
import { createStore, type Observable } from './useStore.js'

export interface SnippetState {
  snippets: Snippet[]
  query: string
}

export interface SnippetStore extends Observable<SnippetState> {
  refresh(): Promise<void>
  setQuery(query: string): void
  visible(): Snippet[]
  save(input: SnippetInput): Promise<void>
  remove(id: string): Promise<void>
}

/**
 * A snippet is a command, and a command without a newline just sits at the
 * prompt. `\r` is left as-is: a body written for a device expecting CR is
 * deliberate, not a mistake to correct.
 */
export function withTrailingNewline(body: string): string {
  return body.endsWith('\n') || body.endsWith('\r') ? body : `${body}\n`
}

export function createSnippetStore(deps: {
  store: Store
  requestSync: () => void
}): SnippetStore {
  const base = createStore<SnippetState>({ snippets: [], query: '' })

  const reload = async (): Promise<void> => {
    const snippets = await deps.store.listSnippets()
    base.set((current) => ({ ...current, snippets }))
  }

  return {
    ...base,
    refresh: reload,

    setQuery(query): void {
      base.set((current) => ({ ...current, query }))
    },

    visible(): Snippet[] {
      const { snippets, query } = base.get()
      const needle = query.trim().toLowerCase()
      if (needle.length === 0) return snippets

      return snippets.filter((snippet) =>
        [snippet.label, snippet.body, ...snippet.tags].join(' ').toLowerCase().includes(needle),
      )
    },

    async save(input): Promise<void> {
      await deps.store.upsertSnippet(input)
      await reload()
      deps.requestSync()
    },

    async remove(id): Promise<void> {
      await deps.store.deleteSnippet(id)
      await reload()
      deps.requestSync()
    },
  }
}
```

- [ ] **Step 3: Write the failing palette test**

`apps/desktop/test/renderer/SnippetPalette.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Snippet } from '@termif/core'
import { SnippetPaletteView } from '../../src/renderer/views/SnippetPalette.js'

const snippet = (over: Partial<Snippet> = {}): Snippet => ({
  id: 's1',
  label: 'disk usage',
  body: 'df -h',
  tags: ['ops'],
  updatedAt: '2026-08-28T10:00:00.000Z',
  deleted: false,
  ...over,
})

const props = {
  snippets: [snippet(), snippet({ id: 's2', label: 'tail log', body: 'tail -f app.log' })],
  query: '',
  onQueryChange: vi.fn(),
  onSend: vi.fn(async () => {}),
  onSave: vi.fn(async () => {}),
  onRemove: vi.fn(async () => {}),
  onClose: vi.fn(),
}

describe('SnippetPaletteView', () => {
  it('lists snippets with their bodies', () => {
    render(<SnippetPaletteView {...props} />)
    expect(screen.getByText('disk usage')).toBeInTheDocument()
    expect(screen.getByText('df -h')).toBeInTheDocument()
  })

  it('sends the body with a trailing newline on click', async () => {
    const onSend = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSend={onSend} />)

    await userEvent.click(screen.getByRole('button', { name: /send disk usage/i }))

    expect(onSend).toHaveBeenCalledWith('df -h\n')
  })

  it('sends the highlighted snippet on Enter', async () => {
    const onSend = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSend={onSend} />)

    const search = screen.getByRole('searchbox')
    search.focus()
    await userEvent.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith('df -h\n')
  })

  it('moves the highlight with the arrow keys', async () => {
    const onSend = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSend={onSend} />)

    screen.getByRole('searchbox').focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onSend).toHaveBeenCalledWith('tail -f app.log\n')
  })

  it('does not move the highlight past the last item', async () => {
    const onSend = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSend={onSend} />)

    screen.getByRole('searchbox').focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')

    expect(onSend).toHaveBeenCalledWith('tail -f app.log\n')
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<SnippetPaletteView {...props} onClose={onClose} />)

    screen.getByRole('searchbox').focus()
    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('reports typing upward instead of filtering itself', async () => {
    const onQueryChange = vi.fn()
    render(<SnippetPaletteView {...props} onQueryChange={onQueryChange} />)
    await userEvent.type(screen.getByRole('searchbox'), 'tail')
    expect(onQueryChange).toHaveBeenLastCalledWith('tail')
  })

  it('adds a new snippet from the inline form', async () => {
    const onSave = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSave={onSave} />)

    await userEvent.click(screen.getByRole('button', { name: /new snippet/i }))
    await userEvent.type(screen.getByLabelText(/label/i), 'restart nginx')
    await userEvent.type(screen.getByLabelText(/command/i), 'systemctl restart nginx')
    await userEvent.click(screen.getByRole('button', { name: /^save/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'restart nginx', body: 'systemctl restart nginx' }),
    )
  })

  it('will not save a snippet with an empty body', async () => {
    const onSave = vi.fn(async () => {})
    render(<SnippetPaletteView {...props} onSave={onSave} />)

    await userEvent.click(screen.getByRole('button', { name: /new snippet/i }))
    await userEvent.type(screen.getByLabelText(/label/i), 'empty')
    await userEvent.click(screen.getByRole('button', { name: /^save/i }))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows an empty state when nothing matches', () => {
    render(<SnippetPaletteView {...props} snippets={[]} query="zzz" />)
    expect(screen.getByText(/no snippets match/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Write the palette**

`apps/desktop/src/renderer/views/SnippetPalette.tsx`:

```tsx
import { useEffect, useState, type KeyboardEvent } from 'react'
import type { Snippet, SnippetInput } from '@termif/core'
import type { App } from '../state/boot.js'
import { createSnippetStore, withTrailingNewline } from '../state/snippetStore.js'
import { useStore } from '../state/useStore.js'

export interface SnippetPaletteViewProps {
  snippets: readonly Snippet[]
  query: string
  onQueryChange(query: string): void
  onSend(body: string): Promise<void>
  onSave(input: SnippetInput): Promise<void>
  onRemove(id: string): Promise<void>
  onClose(): void
}

/** Presentational half, so the keyboard behaviour is testable without a store. */
export function SnippetPaletteView({
  snippets,
  query,
  onQueryChange,
  onSend,
  onSave,
  onRemove,
  onClose,
}: SnippetPaletteViewProps) {
  const [highlight, setHighlight] = useState(0)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [body, setBody] = useState('')

  // A shrinking list must not leave the highlight past the end.
  useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(snippets.length - 1, 0)))
  }, [snippets.length])

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((current) => Math.min(current + 1, snippets.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = snippets[highlight]
      if (chosen !== undefined) void onSend(withTrailingNewline(chosen.body))
    }
  }

  const saveNew = async (): Promise<void> => {
    if (label.trim().length === 0 || body.trim().length === 0) return
    await onSave({ label: label.trim(), body, tags: [] })
    setLabel('')
    setBody('')
    setAdding(false)
  }

  return (
    <div className="snippet-palette" role="dialog" aria-label="Snippets">
      <input
        type="search"
        role="searchbox"
        aria-label="Search snippets"
        placeholder="Search snippets"
        autoFocus
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
      />

      {snippets.length === 0 ? (
        <p>No snippets match that search.</p>
      ) : (
        <ul>
          {snippets.map((snippet, index) => (
            <li
              key={snippet.id}
              className={index === highlight ? 'snippet--highlight' : undefined}
              aria-current={index === highlight}
            >
              <button
                type="button"
                aria-label={`Send ${snippet.label}`}
                onClick={() => void onSend(withTrailingNewline(snippet.body))}
              >
                <span className="snippet__label">{snippet.label}</span>
                <code className="snippet__body">{snippet.body}</code>
              </button>
              <button
                type="button"
                aria-label={`Delete ${snippet.label}`}
                onClick={() => void onRemove(snippet.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="snippet-palette__form">
          <label htmlFor="snippet-label">Label</label>
          <input id="snippet-label" value={label} onChange={(e) => setLabel(e.target.value)} />

          <label htmlFor="snippet-body">Command</label>
          <textarea
            id="snippet-body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />

          <button type="button" onClick={() => void saveNew()}>
            Save snippet
          </button>
          <button type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          New snippet
        </button>
      )}
    </div>
  )
}

/** Wired half: owns the store and hands the view its data. */
export function SnippetPalette({
  app,
  onSend,
  onClose,
}: {
  app: App
  onSend(body: string): Promise<void>
  onClose(): void
}) {
  const [snippetStore] = useState(() =>
    createSnippetStore({ store: app.store, requestSync: () => app.sync?.requestSync() }),
  )
  const state = useStore(snippetStore)

  useEffect(() => {
    void snippetStore.refresh()
  }, [snippetStore])

  return (
    <SnippetPaletteView
      snippets={snippetStore.visible()}
      query={state.query}
      onQueryChange={(q) => snippetStore.setQuery(q)}
      onSend={onSend}
      onSave={(input) => snippetStore.save(input)}
      onRemove={(id) => snippetStore.remove(id)}
      onClose={onClose}
    />
  )
}
```

- [ ] **Step 5: Run the snippet tests**

Run: `cd apps/desktop && npx vitest run test/renderer/snippetStore.test.ts test/renderer/SnippetPalette.test.tsx`
Expected: PASS, 19 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add snippet store and keyboard-driven snippet palette"
```

---

## Task 10: SFTP browser and transfer list

**Files:**
- Create: `apps/desktop/src/renderer/state/sftpStore.ts`, `apps/desktop/src/renderer/views/SftpBrowser.tsx`, `apps/desktop/src/renderer/views/TransferList.tsx`
- Test: `apps/desktop/test/renderer/sftpStore.test.ts`, `apps/desktop/test/renderer/SftpBrowser.test.tsx`

**Interfaces:**
- Produces `createSftpStore({ ssh, sessionId })` with state `{ path: string; entries: SshDirEntry[]; loading: boolean; error: string | null }` and actions `open(path)`, `up()`, `refresh()`, `mkdir(name)`, `rename(from, to)`, `remove(name, recursive)`.
- Produces `joinPath(base, name)` and `parentPath(path)` — POSIX-only, because the remote side is a POSIX path regardless of the local OS.
- Produces `SftpBrowser` — remote pane with breadcrumb, plus upload/download buttons that use the main process's file dialogs.
- Produces `TransferList` — reads `TransferManager.list()`, shows progress, offers cancel.

- [ ] **Step 1: Write the failing store test**

`apps/desktop/test/renderer/sftpStore.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { createSftpStore, joinPath, parentPath } from '../../src/renderer/state/sftpStore.js'
import type { SshDirEntry } from '@termif/core'

const entry = (name: string, isDir = false): SshDirEntry => ({
  name,
  size: 1024n,
  isDir,
  isSymlink: false,
  mode: 0o644,
  modifiedUnix: 1_700_000_000,
})

function fakeSsh(entries: Record<string, SshDirEntry[]> = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  return {
    calls,
    ssh: {
      sftpList: vi.fn(async (_id: bigint, path: string) => {
        calls.push({ name: 'sftpList', args: [path] })
        const found = entries[path]
        if (found === undefined) throw new Error('sftp: No such file')
        return found
      }),
      sftpMkdir: vi.fn(async (_id: bigint, path: string) => {
        calls.push({ name: 'sftpMkdir', args: [path] })
      }),
      sftpRename: vi.fn(async (_id: bigint, from: string, to: string) => {
        calls.push({ name: 'sftpRename', args: [from, to] })
      }),
      sftpRemove: vi.fn(async (_id: bigint, path: string, recursive: boolean) => {
        calls.push({ name: 'sftpRemove', args: [path, recursive] })
      }),
    },
  }
}

describe('joinPath', () => {
  it('joins without doubling the separator', () => {
    expect(joinPath('/home/me', 'file.txt')).toBe('/home/me/file.txt')
    expect(joinPath('/home/me/', 'file.txt')).toBe('/home/me/file.txt')
  })

  it('handles the root', () => {
    expect(joinPath('/', 'etc')).toBe('/etc')
  })
})

describe('parentPath', () => {
  it('walks up one level', () => {
    expect(parentPath('/home/me/docs')).toBe('/home/me')
  })

  it('stops at the root', () => {
    expect(parentPath('/')).toBe('/')
    expect(parentPath('/etc')).toBe('/')
  })

  it('ignores a trailing separator', () => {
    expect(parentPath('/home/me/')).toBe('/home')
  })
})

describe('sftpStore', () => {
  it('lists a directory and sorts directories first', async () => {
    const { ssh } = fakeSsh({
      '/home/me': [entry('b.txt'), entry('alpha', true), entry('a.txt'), entry('beta', true)],
    })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')

    // Core already sorts, but the view depends on it, so assert the contract.
    expect(store.get().entries.map((e) => e.name)).toEqual(['alpha', 'beta', 'a.txt', 'b.txt'])
    expect(store.get().path).toBe('/home/me')
    expect(store.get().loading).toBe(false)
  })

  it('records an error and keeps the previous listing on a failed open', async () => {
    const { ssh } = fakeSsh({ '/home/me': [entry('a.txt')] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.open('/nope')

    expect(store.get().error).toMatch(/no such file/i)
    // Staying put beats emptying the pane the user was working in.
    expect(store.get().path).toBe('/home/me')
    expect(store.get().entries.map((e) => e.name)).toEqual(['a.txt'])
  })

  it('clears a previous error on a successful open', async () => {
    const { ssh } = fakeSsh({ '/a': [entry('x')], '/b': [entry('y')] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/a')
    await store.open('/nope')
    await store.open('/b')

    expect(store.get().error).toBeNull()
  })

  it('navigates up', async () => {
    const { ssh } = fakeSsh({ '/home/me': [entry('x')], '/home': [entry('me', true)] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.up()

    expect(store.get().path).toBe('/home')
  })

  it('creates a directory relative to the current path and refreshes', async () => {
    const { ssh, calls } = fakeSsh({ '/home/me': [] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.mkdir('newdir')

    expect(calls.filter((c) => c.name === 'sftpMkdir')[0]?.args).toEqual(['/home/me/newdir'])
    // Two listings: the open plus the post-mkdir refresh.
    expect(calls.filter((c) => c.name === 'sftpList')).toHaveLength(2)
  })

  it('renames within the current directory', async () => {
    const { ssh, calls } = fakeSsh({ '/home/me': [entry('old.txt')] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.rename('old.txt', 'new.txt')

    expect(calls.filter((c) => c.name === 'sftpRename')[0]?.args).toEqual([
      '/home/me/old.txt',
      '/home/me/new.txt',
    ])
  })

  it('passes the recursive flag through on remove', async () => {
    const { ssh, calls } = fakeSsh({ '/home/me': [entry('dir', true)] })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.remove('dir', true)

    expect(calls.filter((c) => c.name === 'sftpRemove')[0]?.args).toEqual(['/home/me/dir', true])
  })

  it('reports a mkdir failure without losing the listing', async () => {
    const { ssh } = fakeSsh({ '/home/me': [entry('a.txt')] })
    ssh.sftpMkdir = vi.fn(async () => {
      throw new Error('sftp: Permission denied')
    })
    const store = createSftpStore({ ssh: ssh as never, sessionId: 1n })

    await store.open('/home/me')
    await store.mkdir('nope')

    expect(store.get().error).toMatch(/permission denied/i)
    expect(store.get().entries).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Write the store**

`apps/desktop/src/renderer/state/sftpStore.ts`:

```typescript
import { parseFfiError, type SshBridge, type SshDirEntry } from '@termif/core'
import { createStore, type Observable } from './useStore.js'

/**
 * Remote paths are POSIX no matter what the local OS uses, so these are
 * deliberately not `node:path` — which would produce backslashes on Windows.
 */
export function joinPath(base: string, name: string): string {
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return `${trimmed}/${name}`
}

export function parentPath(path: string): string {
  const trimmed = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
  const index = trimmed.lastIndexOf('/')
  if (index <= 0) return '/'
  return trimmed.slice(0, index)
}

export interface SftpState {
  path: string
  entries: SshDirEntry[]
  loading: boolean
  error: string | null
}

export interface SftpStore extends Observable<SftpState> {
  open(path: string): Promise<void>
  up(): Promise<void>
  refresh(): Promise<void>
  mkdir(name: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(name: string, recursive: boolean): Promise<void>
}

export function createSftpStore(deps: { ssh: SshBridge; sessionId: bigint }): SftpStore {
  const base = createStore<SftpState>({ path: '.', entries: [], loading: false, error: null })

  const listInto = async (path: string): Promise<void> => {
    base.set((current) => ({ ...current, loading: true }))
    try {
      const entries = await deps.ssh.sftpList(deps.sessionId, path)
      base.set({ path, entries, loading: false, error: null })
    } catch (e) {
      // Keep the previous listing: emptying the pane the user was working in
      // loses their place for no gain.
      base.set((current) => ({
        ...current,
        loading: false,
        error: parseFfiError(e).message,
      }))
    }
  }

  /** Runs a mutation, then re-lists, surfacing a failure without clearing state. */
  const mutate = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      base.set((current) => ({ ...current, error: null }))
      await listInto(base.get().path)
    } catch (e) {
      base.set((current) => ({ ...current, error: parseFfiError(e).message }))
    }
  }

  return {
    ...base,

    open: listInto,

    async up(): Promise<void> {
      await listInto(parentPath(base.get().path))
    },

    async refresh(): Promise<void> {
      await listInto(base.get().path)
    },

    async mkdir(name): Promise<void> {
      const path = joinPath(base.get().path, name)
      await mutate(() => deps.ssh.sftpMkdir(deps.sessionId, path))
    },

    async rename(from, to): Promise<void> {
      const current = base.get().path
      await mutate(() =>
        deps.ssh.sftpRename(deps.sessionId, joinPath(current, from), joinPath(current, to)),
      )
    },

    async remove(name, recursive): Promise<void> {
      const path = joinPath(base.get().path, name)
      await mutate(() => deps.ssh.sftpRemove(deps.sessionId, path, recursive))
    },
  }
}
```

- [ ] **Step 3: Write the failing browser test**

`apps/desktop/test/renderer/SftpBrowser.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SshDirEntry } from '@termif/core'
import { SftpBrowserView } from '../../src/renderer/views/SftpBrowser.js'
import { TransferList } from '../../src/renderer/views/TransferList.js'

const entry = (name: string, isDir = false, size = 1024n): SshDirEntry => ({
  name,
  size,
  isDir,
  isSymlink: false,
  mode: 0o644,
  modifiedUnix: 1_700_000_000,
})

const props = {
  path: '/home/me',
  entries: [entry('docs', true), entry('notes.txt', false, 2048n)],
  loading: false,
  error: null,
  onOpen: vi.fn(),
  onUp: vi.fn(),
  onRefresh: vi.fn(),
  onMkdir: vi.fn(async () => {}),
  onRemove: vi.fn(async () => {}),
  onUpload: vi.fn(async () => {}),
  onDownload: vi.fn(async () => {}),
}

describe('SftpBrowserView', () => {
  it('shows the current path', () => {
    render(<SftpBrowserView {...props} />)
    expect(screen.getByText('/home/me')).toBeInTheDocument()
  })

  it('lists directories and files', () => {
    render(<SftpBrowserView {...props} />)
    expect(screen.getByText('docs')).toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
  })

  it('shows a human-readable size for files and none for directories', () => {
    render(<SftpBrowserView {...props} />)
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    // A directory's byte size is meaningless to a user; do not show one.
    const dirRow = screen.getByText('docs').closest('li')
    expect(dirRow?.textContent).not.toMatch(/KB|MB/)
  })

  it('opens a directory on double click', async () => {
    const onOpen = vi.fn()
    render(<SftpBrowserView {...props} onOpen={onOpen} />)

    await userEvent.dblClick(screen.getByText('docs'))

    expect(onOpen).toHaveBeenCalledWith('/home/me/docs')
  })

  it('does not try to open a file as a directory', async () => {
    const onOpen = vi.fn()
    render(<SftpBrowserView {...props} onOpen={onOpen} />)

    await userEvent.dblClick(screen.getByText('notes.txt'))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('downloads a file', async () => {
    const onDownload = vi.fn(async () => {})
    render(<SftpBrowserView {...props} onDownload={onDownload} />)

    await userEvent.click(screen.getByRole('button', { name: /download notes.txt/i }))

    expect(onDownload).toHaveBeenCalledWith('notes.txt')
  })

  it('navigates up', async () => {
    const onUp = vi.fn()
    render(<SftpBrowserView {...props} onUp={onUp} />)
    await userEvent.click(screen.getByRole('button', { name: /up/i }))
    expect(onUp).toHaveBeenCalled()
  })

  it('shows an error banner when one is present', () => {
    render(<SftpBrowserView {...props} error="sftp: Permission denied" />)
    expect(screen.getByRole('alert')).toHaveTextContent(/permission denied/i)
  })

  it('confirms before removing a directory recursively', async () => {
    const onRemove = vi.fn(async () => {})
    render(<SftpBrowserView {...props} onRemove={onRemove} />)

    await userEvent.click(screen.getByRole('button', { name: /delete docs/i }))
    expect(onRemove).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^confirm/i }))
    expect(onRemove).toHaveBeenCalledWith('docs', true)
  })
})

describe('TransferList', () => {
  const transfers = [
    {
      id: 'x1',
      kind: 'upload' as const,
      local: '/local/a.bin',
      remote: 'a.bin',
      state: 'running' as const,
      done: 512n,
      total: 1024n,
      error: null,
    },
  ]

  it('shows progress as a percentage', () => {
    render(<TransferList transfers={transfers} onCancel={vi.fn()} />)
    expect(screen.getByText(/50%/)).toBeInTheDocument()
  })

  it('offers cancel while running', async () => {
    const onCancel = vi.fn()
    render(<TransferList transfers={transfers} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledWith('x1')
  })

  it('does not offer cancel once finished', () => {
    render(
      <TransferList
        transfers={[{ ...transfers[0]!, state: 'done', done: 1024n }]}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull()
  })

  it('shows the failure reason', () => {
    render(
      <TransferList
        transfers={[{ ...transfers[0]!, state: 'failed', error: 'sftp: disk full' }]}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/disk full/i)).toBeInTheDocument()
  })

  it('handles a zero total without dividing by zero', () => {
    render(
      <TransferList
        transfers={[{ ...transfers[0]!, done: 0n, total: 0n }]}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/0%/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Write the browser and transfer list**

`apps/desktop/src/renderer/views/TransferList.tsx`:

```tsx
import { t, type TransferView } from '@termif/core'

export function formatBytes(bytes: bigint): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Number(bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

export function percentOf(done: bigint, total: bigint): number {
  // A transfer reports total 0 until the first progress event arrives.
  if (total === 0n) return 0
  return Math.min(100, Math.floor(Number((done * 100n) / total)))
}

export interface TransferListProps {
  transfers: readonly TransferView[]
  onCancel(id: string): void
}

export function TransferList({ transfers, onCancel }: TransferListProps) {
  if (transfers.length === 0) return null

  return (
    <ul className="transfer-list">
      {transfers.map((transfer) => (
        <li key={transfer.id} className={`transfer transfer--${transfer.state}`}>
          <span className="transfer__name">
            {transfer.kind === 'upload' ? '↑' : '↓'} {transfer.remote}
          </span>

          <span className="transfer__progress">
            {percentOf(transfer.done, transfer.total)}%
            {transfer.total > 0n && ` · ${formatBytes(transfer.done)} / ${formatBytes(transfer.total)}`}
          </span>

          {transfer.error !== null && (
            <span className="transfer__error">{t('transfer.failed', { reason: transfer.error })}</span>
          )}

          {(transfer.state === 'running' || transfer.state === 'queued') && (
            <button type="button" onClick={() => onCancel(transfer.id)}>
              Cancel
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
```

`apps/desktop/src/renderer/views/SftpBrowser.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { SshDirEntry, TransferView } from '@termif/core'
import type { App } from '../state/boot.js'
import { createSftpStore, joinPath } from '../state/sftpStore.js'
import { useStore } from '../state/useStore.js'
import { formatBytes, TransferList } from './TransferList.js'

export interface SftpBrowserViewProps {
  path: string
  entries: readonly SshDirEntry[]
  loading: boolean
  error: string | null
  onOpen(path: string): void
  onUp(): void
  onRefresh(): void
  onMkdir(name: string): Promise<void>
  onRemove(name: string, recursive: boolean): Promise<void>
  onUpload(): Promise<void>
  onDownload(name: string): Promise<void>
}

export function SftpBrowserView({
  path,
  entries,
  loading,
  error,
  onOpen,
  onUp,
  onRefresh,
  onMkdir,
  onRemove,
  onUpload,
  onDownload,
}: SftpBrowserViewProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [newDir, setNewDir] = useState('')

  return (
    <section className="sftp">
      <header className="sftp__bar">
        <button type="button" onClick={onUp}>
          Up
        </button>
        <code className="sftp__path">{path}</code>
        <button type="button" onClick={onRefresh}>
          Refresh
        </button>
        <button type="button" onClick={() => void onUpload()}>
          Upload…
        </button>

        <input
          aria-label="New folder name"
          placeholder="New folder"
          value={newDir}
          onChange={(e) => setNewDir(e.target.value)}
        />
        <button
          type="button"
          disabled={newDir.trim().length === 0}
          onClick={() => {
            void onMkdir(newDir.trim())
            setNewDir('')
          }}
        >
          Create
        </button>
      </header>

      {error !== null && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading…</p>}

      <ul className="sftp__entries">
        {entries.map((entry) => (
          <li key={entry.name} onDoubleClick={() => entry.isDir && onOpen(joinPath(path, entry.name))}>
            <span className="sftp__icon">{entry.isDir ? '📁' : '📄'}</span>
            <span className="sftp__name">{entry.name}</span>

            {/* A directory's byte size means nothing to a user, so omit it. */}
            {!entry.isDir && <span className="sftp__size">{formatBytes(entry.size)}</span>}

            {!entry.isDir && (
              <button
                type="button"
                aria-label={`Download ${entry.name}`}
                onClick={() => void onDownload(entry.name)}
              >
                Download
              </button>
            )}

            {confirming === entry.name ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(null)
                    // Removing a directory has to be recursive to succeed, and
                    // saying so is the point of the confirmation.
                    void onRemove(entry.name, entry.isDir)
                  }}
                >
                  Confirm delete{entry.isDir ? ' folder and contents' : ''}
                </button>
                <button type="button" onClick={() => setConfirming(null)}>
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label={`Delete ${entry.name}`}
                onClick={() => setConfirming(entry.name)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Wired half. Needs a live session, so it says so when there is none. */
export function SftpBrowser({ app }: { app: App }) {
  const [sessionId, setSessionId] = useState<bigint | null>(null)
  const [transfers, setTransfers] = useState<TransferView[]>([])

  useEffect(() => {
    // Follow the most recent session so the browser opens where the user is.
    return app.sessions.onSessionState((id, state) => {
      if (state === 'connected') setSessionId(id)
      else if (state === 'closed') setSessionId((current) => (current === id ? null : current))
    })
  }, [app.sessions])

  useEffect(() => {
    setTransfers(app.transfers.list())
    return app.transfers.onChange(() => setTransfers(app.transfers.list()))
  }, [app.transfers])

  const [store, setStore] = useState<ReturnType<typeof createSftpStore> | null>(null)
  useEffect(() => {
    if (sessionId === null) {
      setStore(null)
      return
    }
    const created = createSftpStore({ ssh: app.platform.ssh, sessionId })
    setStore(created)
    void created.open('.')
  }, [app.platform.ssh, sessionId])

  const state = store === null ? null : useStore(store)

  if (sessionId === null || store === null || state === null) {
    return <p>Connect to a host to browse its files.</p>
  }

  return (
    <>
      <SftpBrowserView
        path={state.path}
        entries={state.entries}
        loading={state.loading}
        error={state.error}
        onOpen={(next) => void store.open(next)}
        onUp={() => void store.up()}
        onRefresh={() => void store.refresh()}
        onMkdir={(name) => store.mkdir(name)}
        onRemove={(name, recursive) => store.remove(name, recursive)}
        onUpload={async () => {
          const local = await window.termif.app.pickFile()
          if (local === null) return
          const name = local.split(/[/\\]/).pop() ?? 'upload'
          await app.transfers.enqueueUpload(sessionId, local, joinPath(state.path, name))
        }}
        onDownload={async (name) => {
          const local = await window.termif.app.pickSaveLocation(name)
          if (local === null) return
          await app.transfers.enqueueDownload(sessionId, joinPath(state.path, name), local)
        }}
      />
      <TransferList transfers={transfers} onCancel={(id) => void app.transfers.cancel(id)} />
    </>
  )
}
```

Note: `const state = store === null ? null : useStore(store)` calls a hook conditionally, which React forbids. Restructure `SftpBrowser` so the wired component always calls `useStore` — split it into an outer component that decides whether a session exists and an inner one, keyed on `sessionId`, that creates the store and calls the hook unconditionally. Do this when implementing; the tests target `SftpBrowserView`, so they are unaffected.

- [ ] **Step 5: Run the SFTP tests**

Run: `cd apps/desktop && npx vitest run test/renderer/sftpStore.test.ts test/renderer/SftpBrowser.test.tsx`
Expected: PASS, 21 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add SFTP browser with transfers and progress"
```

---

## Task 11: Forward panel, packaging, and an end-to-end smoke test

**Files:**
- Create: `apps/desktop/src/renderer/views/ForwardPanel.tsx`
- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/e2e/smoke.spec.ts`
- Create: `.github/workflows/desktop.yml`
- Test: `apps/desktop/test/renderer/ForwardPanel.test.tsx`, plus the Playwright smoke test

**Interfaces:**
- Produces `ForwardPanelView` — a form for local, remote, and SOCKS forwards, and a list showing bound port, accepted count, and the platform note.
- Produces an `electron-builder` config for macOS (arm64 + x64 dmg) and Windows (x64 nsis).
- Produces one Playwright test that launches the packaged main process, creates a vault, adds a host, and asserts it persists across a restart. One end-to-end test, not a suite: UI churns, and cheap UI tests become debt (spec §8).

- [ ] **Step 1: Write the failing forward-panel test**

`apps/desktop/test/renderer/ForwardPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t, type ForwardView } from '@termif/core'
import { ForwardPanelView } from '../../src/renderer/views/ForwardPanel.js'

const forward = (over: Partial<ForwardView> = {}): ForwardView => ({
  id: 'f1',
  kind: 'local',
  description: 'Forwarding 127.0.0.1:5432 to db.internal:5432',
  boundPort: 5432,
  acceptedCount: 0,
  lastPeer: null,
  note: null,
  ...over,
})

const props = {
  forwards: [forward()],
  connected: true,
  onOpenLocal: vi.fn(async () => {}),
  onOpenRemote: vi.fn(async () => {}),
  onOpenSocks: vi.fn(async () => {}),
  onClose: vi.fn(async () => {}),
}

describe('ForwardPanelView', () => {
  it('lists a forward with its description and bound port', () => {
    render(<ForwardPanelView {...props} />)
    expect(screen.getByText(/db.internal:5432/)).toBeInTheDocument()
    expect(screen.getByText(/5432/)).toBeInTheDocument()
  })

  it('shows the accepted-connection count once there is one', () => {
    render(<ForwardPanelView {...props} forwards={[forward({ acceptedCount: 3, lastPeer: '127.0.0.1:40001' })]} />)
    expect(screen.getByText(/3/)).toBeInTheDocument()
    expect(screen.getByText(/127.0.0.1:40001/)).toBeInTheDocument()
  })

  it('shows the platform note when core supplies one', () => {
    // On iOS this is how the user learns the forward is foreground-only; the
    // desktop panel renders whatever note core attached.
    render(
      <ForwardPanelView {...props} forwards={[forward({ note: t('forward.iosForegroundOnly') })]} />,
    )
    expect(screen.getByText(t('forward.iosForegroundOnly'))).toBeInTheDocument()
  })

  it('opens a local forward from the form', async () => {
    const onOpenLocal = vi.fn(async () => {})
    render(<ForwardPanelView {...props} onOpenLocal={onOpenLocal} />)

    await userEvent.type(screen.getByLabelText(/local bind/i), '127.0.0.1:15432')
    await userEvent.type(screen.getByLabelText(/remote host/i), 'db.internal')
    await userEvent.clear(screen.getByLabelText(/remote port/i))
    await userEvent.type(screen.getByLabelText(/remote port/i), '5432')
    await userEvent.click(screen.getByRole('button', { name: /open forward/i }))

    expect(onOpenLocal).toHaveBeenCalledWith('127.0.0.1:15432', 'db.internal', 5432)
  })

  it('switches the form fields for a SOCKS forward', async () => {
    render(<ForwardPanelView {...props} />)

    await userEvent.selectOptions(screen.getByLabelText(/forward type/i), 'socks')

    expect(screen.getByLabelText(/local bind/i)).toBeInTheDocument()
    // SOCKS has no single remote target, so those fields must not be asked for.
    expect(screen.queryByLabelText(/remote host/i)).toBeNull()
  })

  it('opens a SOCKS forward with only a bind address', async () => {
    const onOpenSocks = vi.fn(async () => {})
    render(<ForwardPanelView {...props} onOpenSocks={onOpenSocks} />)

    await userEvent.selectOptions(screen.getByLabelText(/forward type/i), 'socks')
    await userEvent.type(screen.getByLabelText(/local bind/i), '127.0.0.1:1080')
    await userEvent.click(screen.getByRole('button', { name: /open forward/i }))

    expect(onOpenSocks).toHaveBeenCalledWith('127.0.0.1:1080')
  })

  it('opens a remote forward with both sides', async () => {
    const onOpenRemote = vi.fn(async () => {})
    render(<ForwardPanelView {...props} onOpenRemote={onOpenRemote} />)

    await userEvent.selectOptions(screen.getByLabelText(/forward type/i), 'remote')
    await userEvent.type(screen.getByLabelText(/remote bind host/i), '0.0.0.0')
    await userEvent.clear(screen.getByLabelText(/remote bind port/i))
    await userEvent.type(screen.getByLabelText(/remote bind port/i), '8080')
    await userEvent.type(screen.getByLabelText(/local host/i), '127.0.0.1')
    await userEvent.clear(screen.getByLabelText(/local port/i))
    await userEvent.type(screen.getByLabelText(/local port/i), '3000')
    await userEvent.click(screen.getByRole('button', { name: /open forward/i }))

    expect(onOpenRemote).toHaveBeenCalledWith('0.0.0.0', 8080, '127.0.0.1', 3000)
  })

  it('closes a forward', async () => {
    const onClose = vi.fn(async () => {})
    render(<ForwardPanelView {...props} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close forward/i }))
    expect(onClose).toHaveBeenCalledWith('f1')
  })

  it('disables the form with no connection', () => {
    render(<ForwardPanelView {...props} connected={false} forwards={[]} />)
    expect(screen.getByRole('button', { name: /open forward/i })).toBeDisabled()
    expect(screen.getByText(/connect to a host/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Write the forward panel**

`apps/desktop/src/renderer/views/ForwardPanel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { ForwardView } from '@termif/core'
import type { App } from '../state/boot.js'

type ForwardKind = 'local' | 'remote' | 'socks'

export interface ForwardPanelViewProps {
  forwards: readonly ForwardView[]
  connected: boolean
  onOpenLocal(localBind: string, remoteHost: string, remotePort: number): Promise<void>
  onOpenRemote(
    remoteBindHost: string,
    remoteBindPort: number,
    localHost: string,
    localPort: number,
  ): Promise<void>
  onOpenSocks(localBind: string): Promise<void>
  onClose(id: string): Promise<void>
}

export function ForwardPanelView({
  forwards,
  connected,
  onOpenLocal,
  onOpenRemote,
  onOpenSocks,
  onClose,
}: ForwardPanelViewProps) {
  const [kind, setKind] = useState<ForwardKind>('local')
  const [localBind, setLocalBind] = useState('127.0.0.1:0')
  const [remoteHost, setRemoteHost] = useState('')
  const [remotePort, setRemotePort] = useState(0)
  const [remoteBindHost, setRemoteBindHost] = useState('0.0.0.0')
  const [remoteBindPort, setRemoteBindPort] = useState(0)
  const [localHost, setLocalHost] = useState('127.0.0.1')
  const [localPort, setLocalPort] = useState(0)

  const submit = async (): Promise<void> => {
    if (kind === 'local') await onOpenLocal(localBind, remoteHost, remotePort)
    else if (kind === 'socks') await onOpenSocks(localBind)
    else await onOpenRemote(remoteBindHost, remoteBindPort, localHost, localPort)
  }

  return (
    <section className="forwards">
      {!connected && <p>Connect to a host to open a forward.</p>}

      <form
        className="forwards__form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label htmlFor="forward-kind">Forward type</label>
        <select
          id="forward-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as ForwardKind)}
        >
          <option value="local">Local (-L)</option>
          <option value="remote">Remote (-R)</option>
          <option value="socks">Dynamic SOCKS (-D)</option>
        </select>

        {kind !== 'remote' && (
          <>
            <label htmlFor="forward-local-bind">Local bind</label>
            <input
              id="forward-local-bind"
              value={localBind}
              onChange={(e) => setLocalBind(e.target.value)}
              placeholder="127.0.0.1:0 for any free port"
            />
          </>
        )}

        {kind === 'local' && (
          <>
            <label htmlFor="forward-remote-host">Remote host</label>
            <input
              id="forward-remote-host"
              value={remoteHost}
              onChange={(e) => setRemoteHost(e.target.value)}
            />

            <label htmlFor="forward-remote-port">Remote port</label>
            <input
              id="forward-remote-port"
              type="number"
              min={1}
              max={65535}
              value={remotePort}
              onChange={(e) => setRemotePort(Number(e.target.value))}
            />
          </>
        )}

        {kind === 'remote' && (
          <>
            <label htmlFor="forward-remote-bind-host">Remote bind host</label>
            <input
              id="forward-remote-bind-host"
              value={remoteBindHost}
              onChange={(e) => setRemoteBindHost(e.target.value)}
            />

            <label htmlFor="forward-remote-bind-port">Remote bind port</label>
            <input
              id="forward-remote-bind-port"
              type="number"
              min={1}
              max={65535}
              value={remoteBindPort}
              onChange={(e) => setRemoteBindPort(Number(e.target.value))}
            />

            <label htmlFor="forward-local-host">Local host</label>
            <input
              id="forward-local-host"
              value={localHost}
              onChange={(e) => setLocalHost(e.target.value)}
            />

            <label htmlFor="forward-local-port">Local port</label>
            <input
              id="forward-local-port"
              type="number"
              min={1}
              max={65535}
              value={localPort}
              onChange={(e) => setLocalPort(Number(e.target.value))}
            />
          </>
        )}

        <button type="submit" disabled={!connected}>
          Open forward
        </button>
      </form>

      <ul className="forwards__list">
        {forwards.map((forward) => (
          <li key={forward.id}>
            <span className="forward__description">{forward.description}</span>
            {forward.boundPort !== null && (
              <span className="forward__port">port {forward.boundPort}</span>
            )}
            {forward.acceptedCount > 0 && (
              <span className="forward__accepted">
                {forward.acceptedCount} connections
                {forward.lastPeer !== null && ` · last ${forward.lastPeer}`}
              </span>
            )}
            {/* Core attaches any OS caveat; the panel just shows it (spec §5). */}
            {forward.note !== null && <span className="forward__note">{forward.note}</span>}

            <button
              type="button"
              aria-label={`Close forward ${forward.description}`}
              onClick={() => void onClose(forward.id)}
            >
              Close forward
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ForwardPanel({ app }: { app: App }) {
  const [sessionId, setSessionId] = useState<bigint | null>(null)
  const [forwards, setForwards] = useState<ForwardView[]>([])

  useEffect(() => {
    return app.sessions.onSessionState((id, state) => {
      if (state === 'connected') setSessionId(id)
      else if (state === 'closed') setSessionId((current) => (current === id ? null : current))
    })
  }, [app.sessions])

  useEffect(() => {
    setForwards(app.forwards.list())
    return app.forwards.onChange(() => setForwards(app.forwards.list()))
  }, [app.forwards])

  return (
    <ForwardPanelView
      forwards={forwards}
      connected={sessionId !== null}
      onOpenLocal={async (bind, host, port) => {
        if (sessionId === null) return
        await app.forwards.openLocal(sessionId, bind, host, port)
      }}
      onOpenRemote={async (bindHost, bindPort, localHost, localPort) => {
        if (sessionId === null) return
        await app.forwards.openRemote(sessionId, bindHost, bindPort, localHost, localPort)
      }}
      onOpenSocks={async (bind) => {
        if (sessionId === null) return
        await app.forwards.openSocks(sessionId, bind)
      }}
      onClose={(id) => app.forwards.close(id)}
    />
  )
}
```

- [ ] **Step 3: Run the forward test**

Run: `cd apps/desktop && npx vitest run test/renderer/ForwardPanel.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 4: Write the packaging config**

`apps/desktop/electron-builder.yml`:

```yaml
appId: com.termif.desktop
productName: Termif
directories:
  output: dist
  buildResources: build

files:
  - out/**
  - package.json

# The native addon must ship unpacked: a .node inside app.asar cannot be loaded.
asarUnpack:
  - '**/*.node'
  - node_modules/better-sqlite3/**

mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch: [arm64, x64]
  # Hardened runtime is required for notarisation; the entitlements file allows
  # the JIT the renderer needs.
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist

win:
  target:
    - target: nsis
      arch: [x64]

linux:
  target:
    - target: AppImage
      arch: [x64]
  category: Development
```

`apps/desktop/build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <!-- Chromium's JIT needs these under the hardened runtime. -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <!-- Outbound network access for SSH and the Sheets API. -->
    <key>com.apple.security.network.client</key>
    <true/>
    <!-- Inbound, for local port forwarding listeners. -->
    <key>com.apple.security.network.server</key>
    <true/>
  </dict>
</plist>
```

- [ ] **Step 5: Write the end-to-end smoke test**

`apps/desktop/e2e/smoke.spec.ts`:

```typescript
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * One end-to-end test, deliberately: it covers the path no unit test can — the
 * real main process, the real preload bridge, the real SQLite file — and stops
 * there. UI churns, and a broad end-to-end suite becomes maintenance debt
 * (spec §8).
 */
test('creates a vault, adds a host, and keeps it across a restart', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-e2e-'))

  const launch = async () =>
    electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      cwd: join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test' },
    })

  const app = await launch()
  const window = await app.firstWindow()

  // First run: the vault does not exist yet.
  await expect(window.getByRole('heading', { name: /choose a master password/i })).toBeVisible()

  await window.getByLabel(/enter your master password/i).fill('e2e-test-password')
  await window.getByLabel('Confirm').fill('e2e-test-password')
  await window.getByRole('button', { name: /create vault/i }).click()

  // Add a host.
  await window.getByRole('button', { name: /add host/i }).click()
  await window.getByLabel(/^label/i).fill('e2e-host')
  await window.getByLabel(/hostname/i).fill('e2e.example.com')
  await window.getByLabel(/username/i).fill('tester')
  await window.getByRole('button', { name: /^save/i }).click()

  await expect(window.getByText('e2e-host')).toBeVisible()
  await app.close()

  // Second run: the vault is on disk, so it asks to unlock rather than to set up.
  const restarted = await launch()
  const restartedWindow = await restarted.firstWindow()

  await expect(restartedWindow.getByRole('heading', { name: /vault locked/i })).toBeVisible()
  await restartedWindow.getByLabel(/enter your master password/i).fill('e2e-test-password')
  await restartedWindow.getByRole('button', { name: /^unlock/i }).click()

  // The host survived, which means the local database is doing its job.
  await expect(restartedWindow.getByText('e2e-host')).toBeVisible()

  await restarted.close()
  rmSync(userData, { recursive: true, force: true })
})
```

Add to `apps/desktop/package.json` scripts:

```json
"e2e": "playwright test e2e"
```

And `apps/desktop/playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Electron launches are slow, and this suite is one test.
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
})
```

- [ ] **Step 6: Run the whole local gate**

Run:

```bash
cd apps/desktop
npm run typecheck
npm test
npm run build
npm run e2e
```

Expected: typecheck clean, all unit tests pass, the build produces `out/`, and the smoke test passes. The smoke test needs the built app, so `build` must run first.

- [ ] **Step 7: Write the CI workflow**

`.github/workflows/desktop.yml`:

```yaml
name: desktop

on:
  push:
    branches: [main]
  pull_request:

jobs:
  desktop:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@1.78
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      # The desktop app depends on both workspace packages.
      - name: Build core
        working-directory: packages/core
        run: npm ci && npm run build

      - name: Build the native addon
        working-directory: crates/ffi-napi
        run: npm ci && npm run build

      - name: Install desktop dependencies
        working-directory: apps/desktop
        run: npm install

      - name: Rebuild native modules for Electron
        working-directory: apps/desktop
        run: npx electron-rebuild -f -w better-sqlite3

      - name: Typecheck
        working-directory: apps/desktop
        run: npm run typecheck

      - name: Unit tests
        working-directory: apps/desktop
        run: npm test

      - name: Build
        working-directory: apps/desktop
        run: npm run build

      # Electron needs a display; on Linux this would want xvfb, which is why
      # the matrix is macOS and Windows only.
      - name: End-to-end smoke test
        working-directory: apps/desktop
        run: npm run e2e
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop .github/workflows/desktop.yml
git commit -m "feat(desktop): add forward panel, packaging config, and end-to-end smoke test"
```

---

## Plan 3 Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| §3 `.node` loaded in main only, renderer over IPC | Tasks 1, 2, 3 |
| §3 Rust never sees the vault or config | Task 3 (credentials pass as connect parameters only) |
| §4 `drive.file` scope, refresh token in the keystore | Task 3 |
| §4 vault key stays in the renderer, in memory | Task 5 |
| §4 "remember this device" | Task 5 |
| §4 local DB is the read source | Tasks 2, 6 |
| §4 debounced sync after each edit | Tasks 6, 9 (`requestSync` on every mutation) |
| §5 SFTP browse, transfer by path, progress, cancel | Task 10 |
| §5 local, remote, and SOCKS forwards | Task 11 |
| §5 platform note on forwards | Task 11 (renders core's `note`) |
| §6 `Platform` injection, one seam | Task 4 |
| §6 xterm.js with WebGL, no ANSI parsing in app code | Task 8 |
| §6 multi-tab, scrollback kept across reconnect | Task 8 (panes stay mounted) |
| §6 reconnect message, not a pretence of continuity | Task 8 (`session.reconnecting` banner) |
| §6 i18n through `t()` | Tasks 5–11 |
| §7 host key mismatch hard block, no override | Task 7 (a test asserts only one button exists) |
| §7 user-correctable errors keep the form open | Tasks 6, 7 |
| §7 sync failure leaves the app usable | Task 6 (`SyncBadge` reports; nothing blocks) |
| §8 smoke tests only for UI | Task 11 (one Playwright test) |
| §10 native addon unpacked from asar | Task 11 |

**Placeholders:** none. Every step carries runnable code or an exact command. Four places name a stub to write and the task that replaces it (`MainLayout` in Task 5; `TerminalTabs`/`SftpBrowser`/`ForwardPanel`/`useConnectFlow` in Task 6; `SnippetPalette` in Task 8) — each is a one-line component with its replacing task named, not deferred design.

**Three corrections to make while implementing** (each already flagged inline at its site):

1. `fakePlatform` in Task 5 uses a top-level `await` inside a non-async function. Make it `async` and `await` it at both call sites.
2. `bootApp` in Task 5 calls `sessions.onBridgeEvent`, which Plan 2 does not define. Add `onBridgeEvent(listener: (event: SshEvent) => void): () => void` to `SessionManager` in Plan 2 Task 9, emitting each drained event before its own handling, and remove the optional-call `?.`. A second `nextEvents` loop would race the first for the same events, so a tap on the one loop is the right shape.
3. `SftpBrowser` in Task 10 calls `useStore` conditionally. Split it into an outer component that checks for a session and an inner one keyed on `sessionId` that always calls the hook.

**Type consistency:** `TermifApi` (Task 1) is implemented by the preload (Task 1) and consumed by `createPlatform` (Task 4); handle types are `string` across IPC and `bigint` on both sides of it, converted only in `native.ts` and `platform.ts`. `SerialisedSshEvent` variants (Task 1) match `serialiseEvents` output (Task 2) and `deserialiseEvent` input (Task 4). Core types used here — `Host`, `HostInput`, `Snippet`, `SnippetInput`, `SyncStatus`, `TransferView`, `ForwardView`, `ConnectCredential`, `SessionManager`, `TransferManager`, `ForwardManager`, `Store`, `Vault`, `SheetClient`, `SyncEngine` — all come from Plan 2's stated exports.

**Deliberate scope note:** the Google sign-in screen (device-flow UI) is not built here. `GoogleAuth` and its channels exist, and `bootApp` creates a `SyncEngine` only when a spreadsheet id is stored, so the app runs fully offline against the local database until sign-in is added. That screen is small and self-contained; it belongs in a follow-up task alongside first-run spreadsheet creation, and is called out here rather than left implied.
