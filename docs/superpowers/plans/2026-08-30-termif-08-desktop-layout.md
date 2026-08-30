# Desktop Layout and Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the desktop shell's layout so the terminal is never destroyed by another view, nothing overflows at any window size, and the arrangement reads as a native macOS tool.

**Architecture:** A three-column CSS grid — sidebar, main, inspector — with the main column carrying an always-visible terminal and a bottom drawer for Files and Forwards. All UI preferences live in one JSON blob in the `meta` table. Layout correctness is enforced by a Playwright tier that measures real geometry, because jsdom cannot lay out.

**Tech Stack:** React 18, CSS Grid, Vitest + jsdom (logic), Playwright + Electron (layout), `@xterm/addon-fit`, `better-sqlite3` via the existing `Store`.

**Spec:** [`docs/superpowers/specs/2026-08-30-termif-desktop-layout-design.md`](../specs/2026-08-30-termif-desktop-layout-design.md) — read it before starting. Every task argues from it.

## Global Constraints

- **There is no root `package.json`.** This is not an npm workspace. Run every command from inside `apps/desktop` or `packages/core`. `npm test -w <pkg>` fails with ENOENT.
- **Plan 6 must be finished first.** It is at 45/88 steps as of 2026-08-30. Tasks 9–12 of that plan (credential read path, known-hosts wiring, portability, records) still touch `hostStore.ts`, `connectFlow.tsx`, `main/index.ts`, and `e2e/smoke.spec.ts` — all of which this plan also edits. Do not run the two in parallel.
- **No Electron, Node, or `ipcRenderer` import inside `packages/core`.** Enforced by the purity check in Plan 2 Task 12.
- **No secret in a log line, an error message, or a thrown string.** Credentials are plaintext at rest after Plan 6; that does not license them on stdout.
- **Dark theme only.** Light theme and theme switching remain non-goals.
- **Window minimum stays 900×600** (`apps/desktop/src/main/index.ts`).
- **Breakpoints, exact values:** sidebar collapses below **1000px**; inspector overlays below **1100px**. They are different numbers on purpose.
- **Named z-index tokens only.** `--z-drawer: 1`, `--z-inspector: 5`, `--z-sheet: 10`, `--z-palette: 20`. No bare numbers in component CSS.
- **Every grid or flex cell containing text carries `min-width: 0`.** Every scroll region carries `min-height: 0`.
- Commit after every task. Each task ends with `npm test` green in `apps/desktop`.

## Deviation from the spec, recorded here

The spec names individual `meta` keys (`sidebar.width`, `sidebar.collapsedGroups`, `drawer.height`, `sftp.showHidden`). This plan stores all of them in **one** JSON blob under the single key `ui.prefs`. One row, one write, one parse, one test. The spec's intent — preferences persist in the database and travel with it — is unchanged.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/renderer/state/prefs.ts` | UI preference store: load, mutate, debounced persist to `meta` |
| `src/renderer/state/grouping.ts` | Pure: group hosts by `groupId`, sort, "Other" last |
| `src/renderer/state/privateKey.ts` | Pure: validate a private key, detect type, compute fingerprint |
| `src/renderer/views/Menu.tsx` | One popup menu component, used by SFTP rows and sidebar rows |
| `src/renderer/views/Sheet.tsx` | One document-modal sheet: backdrop, focus trap, Esc |
| `src/renderer/views/Inspector.tsx` | Host property column, save-as-you-type |
| `src/renderer/views/Drawer.tsx` | Bottom drawer shell: resize handle, tab body |
| `src/renderer/styles/tokens-macos.css` | macOS overrides |
| `src/renderer/styles/tokens-windows.css` | Windows overrides |
| `e2e/fixtures/hostile.ts` | The hostile seed database |
| `e2e/layout.spec.ts` | Layout invariants at six widths, both token sets |

**Modified:**

| Path | Change |
|---|---|
| `src/renderer/styles/tokens.css` | shared tokens only; add `--z-*`, `--space-0`, width vars |
| `src/renderer/styles/base.css` | the four invariants |
| `src/renderer/styles/app.css` | rewritten per block as tasks land |
| `src/renderer/styles/palette.ts` | two palettes from one module |
| `src/renderer/app/MainLayout.tsx` | three-column grid, drawer, inspector |
| `src/renderer/views/Titlebar.tsx` | two-button segmented control + ⓘ |
| `src/renderer/views/HostList.tsx` | groups, two-line rows, rail mode |
| `src/renderer/views/TerminalTabs.tsx` | overflow `+N` menu |
| `src/renderer/views/TerminalPane.tsx` | ResizeObserver refit |
| `src/renderer/views/SftpBrowser.tsx` | drop target, context menu, hidden filter |
| `src/renderer/state/hostStore.ts` | `SecretInput.passphrase` |
| `src/renderer/state/connectFlow.tsx` | pass the passphrase through |
| `src/renderer/platform.ts` | expose `pathForDroppedFile` |
| `src/preload/index.ts` | `webUtils.getPathForFile` bridge |
| `packages/core/src/store.ts` | `credentials.passphrase`, schema version 3 |
| `packages/core/src/model.ts` | `storedCredentialSchema.passphrase` |
| `packages/core/src/sessions.ts` | pass `passphrase` on connect |

---

### Task 1: Layout primitives and the four invariants

Pure CSS plus token plumbing. No component changes yet, so the app still renders as it does today — only the rules underneath change.

**Files:**
- Modify: `apps/desktop/src/renderer/styles/tokens.css`
- Modify: `apps/desktop/src/renderer/styles/base.css`
- Modify: `apps/desktop/src/renderer/styles/app.css:44-52` (`.layout`), `:398-403` (`.transfer-list`)
- Test: `apps/desktop/test/renderer/tokens.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--sidebar-w`, `--inspector-w`, `--z-drawer`, `--z-inspector`, `--z-sheet`, `--z-palette`, `--space-0`. Later tasks read these by name.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/renderer/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tokens = readFileSync(
  join(__dirname, '../../src/renderer/styles/tokens.css'),
  'utf8',
)
const app = readFileSync(join(__dirname, '../../src/renderer/styles/app.css'), 'utf8')

describe('tokens.css', () => {
  for (const name of [
    '--sidebar-w',
    '--inspector-w',
    '--z-drawer',
    '--z-inspector',
    '--z-sheet',
    '--z-palette',
    '--space-0',
  ]) {
    it(`defines ${name}`, () => {
      expect(tokens).toContain(`${name}:`)
    })
  }
})

describe('app.css layout rules', () => {
  it('gives the main column an explicit zero minimum', () => {
    // A bare `1fr` is `minmax(auto, 1fr)`: the column can never be narrower
    // than its content, which is what breaks the layout on resize.
    expect(app).toContain('minmax(0, 1fr)')
  })

  it('uses no bare z-index values', () => {
    const bare = app.match(/z-index:\s*\d+/g) ?? []
    expect(bare).toEqual([])
  })

  it('does not size the transfer list as a percentage of a flex item', () => {
    expect(app).not.toContain('max-height: 30%')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/tokens.test.ts`
Expected: FAIL — `--sidebar-w` missing, `minmax(0, 1fr)` absent, one bare `z-index: 10` found, `max-height: 30%` present.

- [ ] **Step 3: Add the tokens**

In `tokens.css`, replace the `--sidebar-width: 260px;` line with:

```css
  --space-0: 2px;

  --titlebar-h: 38px;
  --sidebar-w: 260px;
  --sidebar-rail-w: 48px;
  --inspector-w: 240px;

  --z-drawer: 1;
  --z-inspector: 5;
  --z-sheet: 10;
  --z-palette: 20;
```

Keep `--titlebar-height` and `--sidebar-width` as aliases for one commit so nothing breaks mid-task:

```css
  --titlebar-height: var(--titlebar-h);
  --sidebar-width: var(--sidebar-w);
```

- [ ] **Step 4: Write the invariants into `base.css`**

Append:

```css
/* --- Layout invariants -------------------------------------------------- */
/* A grid or flex child defaults to `min-width: auto`, which means it can never
   be narrower than its content. One long hostname then widens the whole row
   instead of being clipped. Every text-bearing cell opts out. */
.u-clip {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A scroll region inside a flex column needs an explicit zero minimum too, or
   it grows to fit its content and the scrollbar never appears. */
.u-scroll {
  min-height: 0;
  overflow-y: auto;
}
```

- [ ] **Step 5: Fix the two offending rules in `app.css`**

`.layout` becomes:

```css
.layout {
  display: grid;
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
```

`.transfer-list` loses the percentage:

```css
.transfer-list {
  border-top: 1px solid var(--border);
  padding: var(--space-2);
  max-height: 160px;
  min-height: 0;
  overflow-y: auto;
}
```

Replace the overlay block's `z-index: 10` with `z-index: var(--z-sheet)`.

- [ ] **Step 6: Run the test**

Run: `cd apps/desktop && npx vitest run test/renderer/tokens.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite**

Run: `cd apps/desktop && npm test`
Expected: all green. Nothing rendered differently; only the rules changed.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/styles apps/desktop/test/renderer/tokens.test.ts
git commit -m "feat(desktop): add layout tokens and the anti-overflow invariants"
```

---

### Task 2: The UI preference store

Everything later in this plan persists something: sidebar width, collapsed groups, drawer height, drawer tab, hidden files, inspector open. Build the store once.

**Files:**
- Create: `apps/desktop/src/renderer/state/prefs.ts`
- Test: `apps/desktop/test/renderer/prefs.test.ts`

**Interfaces:**
- Consumes: `Store` from `@termif/core` (`getMetaValue`, `setMetaValue`), `createStore` from `./useStore.js`.
- Produces:

```ts
export interface UiPrefs {
  sidebarWidth: number
  collapsedGroups: string[]
  drawerHeight: number
  drawerTab: 'files' | 'forwards' | null   // null means the drawer is closed
  showHidden: boolean
  inspectorOpen: boolean
}
export const PREFS_KEY = 'ui.prefs'
export const DEFAULT_PREFS: UiPrefs
export interface PrefsStore extends Observable<UiPrefs> {
  load(): Promise<void>
  set<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void
  flush(): Promise<void>
}
export function createPrefsStore(deps: {
  store: Store
  writeDelayMs?: number
}): PrefsStore
```

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/renderer/prefs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Store } from '@termif/core'
import { createPrefsStore, DEFAULT_PREFS, PREFS_KEY } from '../../src/renderer/state/prefs.js'
import { fakePlatform } from './fakes/platform.js'

async function setup() {
  const platform = await fakePlatform()
  const store = await Store.open(platform)
  // Zero delay: the debounce is exercised in its own test below.
  const prefs = createPrefsStore({ store, writeDelayMs: 0 })
  return { store, prefs }
}

describe('prefsStore', () => {
  it('starts from the defaults when nothing is stored', async () => {
    const { prefs } = await setup()
    await prefs.load()
    expect(prefs.get()).toEqual(DEFAULT_PREFS)
  })

  it('persists a change and reads it back through a new store', async () => {
    const { store, prefs } = await setup()
    await prefs.load()
    prefs.set('sidebarWidth', 320)
    await prefs.flush()

    const second = createPrefsStore({ store, writeDelayMs: 0 })
    await second.load()
    expect(second.get().sidebarWidth).toBe(320)
  })

  it('updates observers before the write lands', async () => {
    const { prefs } = await setup()
    await prefs.load()
    prefs.set('drawerTab', 'files')
    // Optimistic: no await. A resize handle that waited on SQLite would stutter.
    expect(prefs.get().drawerTab).toBe('files')
  })

  it('falls back to the defaults when the stored blob is corrupt', async () => {
    const { store, prefs } = await setup()
    await store.setMetaValue(PREFS_KEY, '{not json')
    await prefs.load()
    expect(prefs.get()).toEqual(DEFAULT_PREFS)
  })

  it('ignores unknown keys and fills missing ones from the defaults', async () => {
    const { store, prefs } = await setup()
    await store.setMetaValue(PREFS_KEY, JSON.stringify({ sidebarWidth: 300, bogus: 1 }))
    await prefs.load()
    expect(prefs.get().sidebarWidth).toBe(300)
    expect(prefs.get().showHidden).toBe(DEFAULT_PREFS.showHidden)
    expect((prefs.get() as Record<string, unknown>).bogus).toBeUndefined()
  })

  it('clamps a sidebar width outside the allowed range', async () => {
    const { store, prefs } = await setup()
    await store.setMetaValue(PREFS_KEY, JSON.stringify({ sidebarWidth: 9000 }))
    await prefs.load()
    expect(prefs.get().sidebarWidth).toBe(400)
  })

  it('coalesces rapid writes into one', async () => {
    const { store, prefs } = await setup()
    const slow = createPrefsStore({ store, writeDelayMs: 20 })
    await slow.load()
    let writes = 0
    const original = store.setMetaValue.bind(store)
    store.setMetaValue = async (k, v) => {
      writes += 1
      return original(k, v)
    }
    for (let w = 200; w <= 260; w += 10) slow.set('sidebarWidth', w)
    await slow.flush()
    expect(writes).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/prefs.test.ts`
Expected: FAIL — `Cannot find module '../../src/renderer/state/prefs.js'`.

- [ ] **Step 3: Implement**

`apps/desktop/src/renderer/state/prefs.ts`:

```ts
import type { Store } from '@termif/core'
import { createStore, type Observable } from './useStore.js'

export interface UiPrefs {
  sidebarWidth: number
  collapsedGroups: string[]
  drawerHeight: number
  drawerTab: 'files' | 'forwards' | null
  showHidden: boolean
  inspectorOpen: boolean
}

export const PREFS_KEY = 'ui.prefs'

export const DEFAULT_PREFS: UiPrefs = {
  sidebarWidth: 260,
  collapsedGroups: [],
  drawerHeight: 220,
  drawerTab: null,
  showHidden: false,
  inspectorOpen: false,
}

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 400

export interface PrefsStore extends Observable<UiPrefs> {
  load(): Promise<void>
  set<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void
  flush(): Promise<void>
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value))

/**
 * Unknown keys are dropped and missing ones filled: a preferences blob written
 * by a newer build must not put the UI into a state this build cannot render.
 */
function sanitise(raw: unknown): UiPrefs {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PREFS }
  const source = raw as Partial<Record<keyof UiPrefs, unknown>>

  return {
    sidebarWidth:
      typeof source.sidebarWidth === 'number'
        ? clamp(source.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX)
        : DEFAULT_PREFS.sidebarWidth,
    collapsedGroups: Array.isArray(source.collapsedGroups)
      ? source.collapsedGroups.filter((g): g is string => typeof g === 'string')
      : [],
    drawerHeight:
      typeof source.drawerHeight === 'number'
        ? clamp(source.drawerHeight, 120, 2000)
        : DEFAULT_PREFS.drawerHeight,
    drawerTab:
      source.drawerTab === 'files' || source.drawerTab === 'forwards'
        ? source.drawerTab
        : null,
    showHidden: source.showHidden === true,
    inspectorOpen: source.inspectorOpen === true,
  }
}

export function createPrefsStore(deps: {
  store: Store
  writeDelayMs?: number
}): PrefsStore {
  const delay = deps.writeDelayMs ?? 250
  const state = createStore<UiPrefs>({ ...DEFAULT_PREFS })

  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Promise<void> | null = null

  const write = async (): Promise<void> => {
    await deps.store.setMetaValue(PREFS_KEY, JSON.stringify(state.get()))
  }

  return {
    ...state,

    async load(): Promise<void> {
      const raw = await deps.store.getMetaValue(PREFS_KEY)
      if (raw === null) return state.set({ ...DEFAULT_PREFS })
      try {
        state.set(sanitise(JSON.parse(raw)))
      } catch {
        // A corrupt blob must not brick the window; the user re-sets a width.
        state.set({ ...DEFAULT_PREFS })
      }
    },

    set(key, value): void {
      // Optimistic: observers see it now, SQLite catches up. A drag handle that
      // awaited a write per frame would stutter.
      state.set({ ...state.get(), [key]: value })
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        pending = write()
      }, delay)
    },

    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
        pending = write()
      }
      await pending
      pending = null
    },
  }
}
```

- [ ] **Step 4: Run the test**

Run: `cd apps/desktop && npx vitest run test/renderer/prefs.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire it into boot**

In `src/renderer/state/boot.ts`, add `prefs` to `App`:

```ts
import { createPrefsStore, type PrefsStore } from './prefs.js'

export interface App {
  platform: Platform
  store: Store
  prefs: PrefsStore
  sessions: SessionManager
  tabs: TabStore
  transfers: TransferManager
  forwards: ForwardManager
}
```

and in `bootApp`, after `const store = await Store.open(platform)`:

```ts
  const prefs = createPrefsStore({ store })
  await prefs.load()
```

returning `{ platform, store, prefs, sessions, tabs, transfers, forwards }`.

- [ ] **Step 6: Run the suite and commit**

Run: `cd apps/desktop && npm test`

```bash
git add apps/desktop/src/renderer/state/prefs.ts apps/desktop/src/renderer/state/boot.ts apps/desktop/test/renderer/prefs.test.ts
git commit -m "feat(desktop): persist UI preferences in the database"
```

---

### Task 3: Group hosts in the sidebar

**Files:**
- Create: `apps/desktop/src/renderer/state/grouping.ts`
- Modify: `apps/desktop/src/renderer/views/HostList.tsx`
- Modify: `apps/desktop/src/renderer/styles/app.css` (`.host-list` block)
- Test: `apps/desktop/test/renderer/grouping.test.ts`, `apps/desktop/test/renderer/hostList.test.tsx`

**Interfaces:**
- Consumes: `Host` from `@termif/core`; `PrefsStore` from Task 2.
- Produces:

```ts
export const OTHER_GROUP = 'Other'
export interface HostGroup { name: string; hosts: Host[] }
export function groupHosts(hosts: readonly Host[]): HostGroup[]
```

- [ ] **Step 1: Write the failing test for the pure function**

`apps/desktop/test/renderer/grouping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Host } from '@termif/core'
import { groupHosts, OTHER_GROUP } from '../../src/renderer/state/grouping.js'

const host = (label: string, groupId: string | null): Host => ({
  id: label,
  label,
  hostname: `${label}.example.com`,
  port: 22,
  username: 'deploy',
  authRef: null,
  tags: [],
  groupId,
  updatedAt: '2026-08-30T00:00:00.000Z',
  deleted: false,
})

describe('groupHosts', () => {
  it('returns an empty array for no hosts', () => {
    expect(groupHosts([])).toEqual([])
  })

  it('sorts groups by name', () => {
    const groups = groupHosts([host('a', 'Staging'), host('b', 'Production')])
    expect(groups.map((g) => g.name)).toEqual(['Production', 'Staging'])
  })

  it('pins the ungrouped bucket last even though O sorts before S', () => {
    const groups = groupHosts([host('a', null), host('b', 'Staging')])
    expect(groups.map((g) => g.name)).toEqual(['Staging', OTHER_GROUP])
  })

  it('omits the ungrouped bucket when every host has a group', () => {
    const groups = groupHosts([host('a', 'Production')])
    expect(groups.map((g) => g.name)).toEqual(['Production'])
  })

  it('sorts hosts inside a group case-insensitively', () => {
    const groups = groupHosts([host('beta', 'P'), host('Alpha', 'P')])
    expect(groups[0]?.hosts.map((h) => h.label)).toEqual(['Alpha', 'beta'])
  })

  it('treats an empty-string group as ungrouped', () => {
    // The inspector writes a free-text group; a cleared field arrives as ''.
    expect(groupHosts([host('a', '')])[0]?.name).toBe(OTHER_GROUP)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/grouping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/desktop/src/renderer/state/grouping.ts`:

```ts
import type { Host } from '@termif/core'

export const OTHER_GROUP = 'Other'

export interface HostGroup {
  name: string
  hosts: Host[]
}

const byLabel = (a: Host, b: Host): number =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })

/**
 * `groupId` is the group's name, not a foreign key: there is no groups table
 * and none is wanted (spec §4). A group exists exactly as long as a host names
 * it.
 */
export function groupHosts(hosts: readonly Host[]): HostGroup[] {
  const buckets = new Map<string, Host[]>()

  for (const host of hosts) {
    const name = host.groupId === null || host.groupId === '' ? OTHER_GROUP : host.groupId
    const bucket = buckets.get(name)
    if (bucket === undefined) buckets.set(name, [host])
    else bucket.push(host)
  }

  const named = [...buckets.entries()]
    .filter(([name]) => name !== OTHER_GROUP)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([name, list]) => ({ name, hosts: [...list].sort(byLabel) }))

  const other = buckets.get(OTHER_GROUP)
  // Ungrouped is always last, whatever it would sort to alphabetically.
  return other === undefined ? named : [...named, { name: OTHER_GROUP, hosts: [...other].sort(byLabel) }]
}
```

- [ ] **Step 4: Run it**

Run: `cd apps/desktop && npx vitest run test/renderer/grouping.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing component test**

`apps/desktop/test/renderer/hostList.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Host } from '@termif/core'
import { HostList } from '../../src/renderer/views/HostList.js'

const host = (label: string, groupId: string | null, extra: Partial<Host> = {}): Host => ({
  id: label,
  label,
  hostname: `${label}.example.com`,
  port: 22,
  username: 'deploy',
  authRef: null,
  tags: [],
  groupId,
  updatedAt: '2026-08-30T00:00:00.000Z',
  deleted: false,
  ...extra,
})

const props = {
  query: '',
  collapsedGroups: [] as string[],
  connectedIds: [] as string[],
  onQueryChange: vi.fn(),
  onToggleGroup: vi.fn(),
  onConnect: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onAdd: vi.fn(),
}

describe('HostList', () => {
  it('renders a heading per group', () => {
    render(<HostList {...props} hosts={[host('a', 'Production'), host('b', 'Staging')]} />)
    expect(screen.getByRole('button', { name: /production/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /staging/i })).toBeInTheDocument()
  })

  it('hides the hosts of a collapsed group', () => {
    render(
      <HostList
        {...props}
        hosts={[host('a', 'Production'), host('b', 'Staging')]}
        collapsedGroups={['Production']}
      />,
    )
    expect(screen.queryByText('a')).not.toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('shows the target line as user@hostname', () => {
    render(<HostList {...props} hosts={[host('a', null)]} />)
    expect(screen.getByText('deploy@a.example.com')).toBeInTheDocument()
  })

  it('appends the port only when it is not 22', () => {
    render(<HostList {...props} hosts={[host('a', null, { port: 2222 })]} />)
    expect(screen.getByText('deploy@a.example.com:2222')).toBeInTheDocument()
  })

  it('flattens groups while a search is active', () => {
    // A collapsed group hiding a search hit is a bug, not a feature.
    render(
      <HostList
        {...props}
        hosts={[host('alpha', 'Production')]}
        collapsedGroups={['Production']}
        query="alp"
      />,
    )
    expect(screen.queryByRole('button', { name: /production/i })).not.toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
  })

  it('marks a connected host', () => {
    render(<HostList {...props} hosts={[host('a', null)]} connectedIds={['a']} />)
    expect(screen.getByRole('listitem')).toHaveAttribute('data-state', 'connected')
  })

  it('toggles a group when its heading is clicked', async () => {
    const onToggleGroup = vi.fn()
    render(
      <HostList {...props} onToggleGroup={onToggleGroup} hosts={[host('a', 'Production')]} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /production/i }))
    expect(onToggleGroup).toHaveBeenCalledWith('Production')
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/hostList.test.tsx`
Expected: FAIL — `HostList` does not accept `collapsedGroups`, renders no group headings.

- [ ] **Step 7: Rewrite `HostList.tsx`**

Keep the existing search box, the inline delete confirmation, and the `onKeyDown` Enter-to-connect behaviour exactly as they are. Replace the flat `<ul>` with grouped sections:

```tsx
import { groupHosts, type HostGroup } from '../state/grouping.js'

export interface HostListProps {
  hosts: readonly Host[]
  query: string
  collapsedGroups: readonly string[]
  connectedIds: readonly string[]
  onQueryChange(query: string): void
  onToggleGroup(name: string): void
  onConnect(id: string): void
  onEdit(id: string): void
  onDelete(id: string): void
  onAdd(): void
}
```

Inside the component, above the return:

```tsx
  const searching = query.trim().length > 0
  // While searching, groups are ignored entirely: a collapsed group must never
  // hide a match.
  const groups: HostGroup[] = searching
    ? [{ name: '', hosts: [...hosts] }]
    : groupHosts(hosts)

  const target = (host: Host): string =>
    `${host.username}@${host.hostname}${host.port === 22 ? '' : `:${host.port}`}`
```

and the list body:

```tsx
      <div className="host-list__scroll u-scroll">
        {groups.map((group) => {
          const collapsed = !searching && collapsedGroups.includes(group.name)
          return (
            <section key={group.name} className="host-list__group">
              {group.name !== '' && (
                <button
                  type="button"
                  className="host-list__grouphead"
                  aria-expanded={!collapsed}
                  onClick={() => onToggleGroup(group.name)}
                >
                  <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                  <span className="u-clip">{group.name}</span>
                  <span className="host-list__count">{group.hosts.length}</span>
                </button>
              )}
              {!collapsed && (
                <ul>
                  {group.hosts.map((host) => (
                    <li
                      key={host.id}
                      tabIndex={0}
                      data-state={connectedIds.includes(host.id) ? 'connected' : 'closed'}
                      onKeyDown={(event) => onKeyDown(event, host.id)}
                      onDoubleClick={() => onConnect(host.id)}
                    >
                      <span className="host-list__dot" aria-hidden="true" />
                      <span className="host-list__label u-clip">{host.label}</span>
                      <span className="host-list__target u-clip">{target(host)}</span>
                      <span className="host-list__actions">{/* unchanged buttons */}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
```

- [ ] **Step 8: Style the two-line row**

Replace the `.host-list li` block in `app.css`:

```css
.host-list__grouphead {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-3) var(--space-3) var(--space-1);
  color: var(--fg-subtle);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: none;
  border: none;
}
.host-list__count {
  margin-inline-start: auto;
  font-variant-numeric: tabular-nums;
}

.host-list li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'dot label actions'
    'dot target actions';
  align-items: center;
  gap: 0 var(--space-2);
  height: 40px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  transition: background-color var(--motion-fast);
}
.host-list__dot {
  grid-area: dot;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-subtle);
}
li[data-state='connected'] .host-list__dot { background: var(--ok); }
li[data-state='reconnecting'] .host-list__dot { background: var(--warn); }
.host-list__label { grid-area: label; color: var(--fg); font-weight: 500; }
.host-list__target {
  grid-area: target;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}
```

- [ ] **Step 9: Wire `MainLayout` to prefs**

```tsx
  const prefs = useStore(app.prefs)
  ...
    <HostList
      hosts={hostStore.visibleHosts()}
      query={hosts.query}
      collapsedGroups={prefs.collapsedGroups}
      connectedIds={app.sessions.connectedHostIds()}
      onToggleGroup={(name) =>
        app.prefs.set(
          'collapsedGroups',
          prefs.collapsedGroups.includes(name)
            ? prefs.collapsedGroups.filter((g) => g !== name)
            : [...prefs.collapsedGroups, name],
        )
      }
      ...
    />
```

If `SessionManager` has no `connectedHostIds()`, add it — it is a one-line read over the session map, and the sidebar dot has no other source of truth.

- [ ] **Step 10: Run everything and commit**

Run: `cd apps/desktop && npm test`

```bash
git add apps/desktop/src/renderer apps/desktop/test/renderer
git commit -m "feat(desktop): group hosts in the sidebar with two-line rows"
```

---

### Task 4: Resizable sidebar and the 48px rail

**Files:**
- Modify: `apps/desktop/src/renderer/app/MainLayout.tsx`
- Modify: `apps/desktop/src/renderer/views/HostList.tsx`
- Modify: `apps/desktop/src/renderer/styles/app.css`
- Test: `apps/desktop/test/renderer/sidebarResize.test.tsx`

**Interfaces:**
- Consumes: `PrefsStore.set('sidebarWidth')`, `SIDEBAR_MIN`, `SIDEBAR_MAX` from Task 2.
- Produces: `HostList` gains `rail?: boolean`; `MainLayout` sets `--sidebar-w` inline.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/renderer/sidebarResize.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SidebarResizer } from '../../src/renderer/views/SidebarResizer.js'

describe('SidebarResizer', () => {
  it('reports the dragged width', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={260} onWidth={onWidth} />)
    const handle = screen.getByRole('separator')

    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, bubbles: true }))
    expect(onWidth).toHaveBeenCalledWith(300)
  })

  it('clamps below the minimum', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={260} onWidth={onWidth} />)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, bubbles: true }))
    expect(onWidth).toHaveBeenCalledWith(200)
  })

  it('clamps above the maximum', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={260} onWidth={onWidth} />)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900, bubbles: true }))
    expect(onWidth).toHaveBeenCalledWith(400)
  })

  it('stops reporting after mouseup', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={260} onWidth={onWidth} />)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 260, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    onWidth.mockClear()
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 320, bubbles: true }))
    expect(onWidth).not.toHaveBeenCalled()
  })

  it('restores the default width on double click', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={330} onWidth={onWidth} />)
    screen.getByRole('separator').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    )
    expect(onWidth).toHaveBeenCalledWith(260)
  })

  it('moves by keyboard for people who cannot drag', () => {
    const onWidth = vi.fn()
    render(<SidebarResizer width={260} onWidth={onWidth} />)
    const handle = screen.getByRole('separator')
    handle.focus()
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(onWidth).toHaveBeenCalledWith(270)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/sidebarResize.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resizer**

`apps/desktop/src/renderer/views/SidebarResizer.tsx`:

```tsx
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { DEFAULT_PREFS, SIDEBAR_MAX, SIDEBAR_MIN } from '../state/prefs.js'

const clamp = (n: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n))

export function SidebarResizer({
  width,
  onWidth,
}: {
  width: number
  onWidth(width: number): void
}) {
  const dragging = useRef(false)

  useEffect(() => {
    const move = (event: MouseEvent): void => {
      if (!dragging.current) return
      // The handle sits on the sidebar's right edge, so the pointer's x IS the
      // new width — no offset bookkeeping, and no drift over a long drag.
      onWidth(clamp(event.clientX))
    }
    const up = (): void => {
      dragging.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [onWidth])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') onWidth(clamp(width - 10))
    if (event.key === 'ArrowRight') onWidth(clamp(width + 10))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      className="sidebar-resizer"
      onMouseDown={() => {
        dragging.current = true
      }}
      onDoubleClick={() => onWidth(DEFAULT_PREFS.sidebarWidth)}
      onKeyDown={onKeyDown}
    />
  )
}
```

- [ ] **Step 4: Run it**

Run: `cd apps/desktop && npx vitest run test/renderer/sidebarResize.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the rail at the CSS layer**

The collapse threshold is a container query on the shell, not JavaScript — no resize listener, no state, and it cannot get out of sync with the window:

```css
.shell { container-type: inline-size; }

.layout {
  display: grid;
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
}

@container (max-width: 999px) {
  .layout { grid-template-columns: var(--sidebar-rail-w) minmax(0, 1fr); }
  /* The rail shows connected hosts only; 40 icons help nobody. */
  .host-list__toolbar,
  .host-list__grouphead,
  .host-list__label,
  .host-list__target,
  .host-list__actions { display: none; }
  .host-list li[data-state='closed'] { display: none; }
  .host-list li { grid-template-columns: 1fr; justify-items: center; padding: 0; }
  .sidebar-resizer { display: none; }
}

.sidebar-resizer {
  position: absolute;
  inset-block: 0;
  inset-inline-end: -2px;
  width: 4px;
  cursor: col-resize;
  z-index: var(--z-drawer);
}
.sidebar-resizer:hover,
.sidebar-resizer:focus-visible { background: var(--accent); }
```

`.layout__sidebar` gains `position: relative` so the handle can anchor to it.

- [ ] **Step 6: Wire it into `MainLayout`**

```tsx
    <div className="layout" style={{ ['--sidebar-w' as string]: `${prefs.sidebarWidth}px` }}>
      <aside className="layout__sidebar">
        <HostList ... />
        <SidebarResizer
          width={prefs.sidebarWidth}
          onWidth={(w) => app.prefs.set('sidebarWidth', w)}
        />
      </aside>
```

- [ ] **Step 7: Run the suite and commit**

Run: `cd apps/desktop && npm test`

```bash
git add apps/desktop/src/renderer apps/desktop/test/renderer/sidebarResize.test.tsx
git commit -m "feat(desktop): make the sidebar resizable and collapse it below 1000px"
```

---

### Task 5: The drawer

Files and Forwards stop replacing the terminal.

**Files:**
- Create: `apps/desktop/src/renderer/views/Drawer.tsx`
- Modify: `apps/desktop/src/renderer/views/Titlebar.tsx`
- Modify: `apps/desktop/src/renderer/app/MainLayout.tsx`
- Modify: `apps/desktop/src/renderer/styles/app.css`
- Test: `apps/desktop/test/renderer/drawer.test.tsx`, `apps/desktop/test/renderer/titlebar.test.tsx`

**Interfaces:**
- Consumes: `UiPrefs.drawerTab`, `UiPrefs.drawerHeight`.
- Produces:

```tsx
export function Drawer(props: {
  tab: 'files' | 'forwards'
  height: number
  onHeight(px: number): void
  onClose(): void
  children: React.ReactNode
}): JSX.Element

export type DrawerTab = 'files' | 'forwards'
export function Titlebar(props: {
  drawerTab: DrawerTab | null
  onDrawerTab(tab: DrawerTab | null): void
  inspectorOpen: boolean
  onInspector(open: boolean): void
}): JSX.Element
```

- [ ] **Step 1: Write the failing titlebar test**

`apps/desktop/test/renderer/titlebar.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Titlebar } from '../../src/renderer/views/Titlebar.js'

const base = {
  drawerTab: null,
  onDrawerTab: vi.fn(),
  inspectorOpen: false,
  onInspector: vi.fn(),
}

describe('Titlebar', () => {
  it('offers two drawer buttons, not three panes', () => {
    // Terminals is no longer a choice: the terminal is always visible.
    render(<Titlebar {...base} />)
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.queryByRole('tab', { name: /terminal/i })).not.toBeInTheDocument()
  })

  it('opens the drawer on the pressed tab when it is closed', async () => {
    const onDrawerTab = vi.fn()
    render(<Titlebar {...base} onDrawerTab={onDrawerTab} />)
    await userEvent.click(screen.getByRole('tab', { name: /files/i }))
    expect(onDrawerTab).toHaveBeenCalledWith('files')
  })

  it('closes the drawer when the already-open tab is pressed again', async () => {
    const onDrawerTab = vi.fn()
    render(<Titlebar {...base} drawerTab="files" onDrawerTab={onDrawerTab} />)
    await userEvent.click(screen.getByRole('tab', { name: /files/i }))
    expect(onDrawerTab).toHaveBeenCalledWith(null)
  })

  it('switches tabs without closing when a different tab is pressed', async () => {
    const onDrawerTab = vi.fn()
    render(<Titlebar {...base} drawerTab="files" onDrawerTab={onDrawerTab} />)
    await userEvent.click(screen.getByRole('tab', { name: /forward/i }))
    expect(onDrawerTab).toHaveBeenCalledWith('forwards')
  })

  it('toggles the inspector', async () => {
    const onInspector = vi.fn()
    render(<Titlebar {...base} onInspector={onInspector} />)
    await userEvent.click(screen.getByRole('button', { name: /inspector/i }))
    expect(onInspector).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 2: Write the failing drawer test**

`apps/desktop/test/renderer/drawer.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Drawer } from '../../src/renderer/views/Drawer.js'

const base = { tab: 'files' as const, height: 220, onHeight: vi.fn(), onClose: vi.fn() }

describe('Drawer', () => {
  it('applies its height as a custom property', () => {
    render(<Drawer {...base}>body</Drawer>)
    expect(screen.getByRole('region')).toHaveStyle({ '--drawer-h': '220px' })
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Drawer {...base} onClose={onClose}>body</Drawer>)
    screen.getByRole('region').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('reports a dragged height measured upward from the bottom', () => {
    const onHeight = vi.fn()
    render(<Drawer {...base} onHeight={onHeight}>body</Drawer>)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientY: 500, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: 400, bubbles: true }))
    // Dragging up by 100 makes the drawer 100 taller.
    expect(onHeight).toHaveBeenCalledWith(320)
  })

  it('clamps to the 120px minimum', () => {
    const onHeight = vi.fn()
    render(<Drawer {...base} onHeight={onHeight}>body</Drawer>)
    const handle = screen.getByRole('separator')
    handle.dispatchEvent(new MouseEvent('mousedown', { clientY: 500, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: 900, bubbles: true }))
    expect(onHeight).toHaveBeenCalledWith(120)
  })
})
```

- [ ] **Step 3: Run both and watch them fail**

Run: `cd apps/desktop && npx vitest run test/renderer/titlebar.test.tsx test/renderer/drawer.test.tsx`
Expected: FAIL — `Drawer` missing; `Titlebar` still renders three tabs.

- [ ] **Step 4: Implement `Drawer.tsx`**

```tsx
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

const MIN_H = 120

export function Drawer({
  tab,
  height,
  onHeight,
  onClose,
  children,
}: {
  tab: 'files' | 'forwards'
  height: number
  onHeight(px: number): void
  onClose(): void
  children: ReactNode
}) {
  const drag = useRef<{ y: number; h: number } | null>(null)

  useEffect(() => {
    const move = (event: MouseEvent): void => {
      const start = drag.current
      if (start === null) return
      // The drawer grows upward, so a smaller clientY is a taller drawer.
      const next = start.h + (start.y - event.clientY)
      onHeight(Math.max(MIN_H, next))
    }
    const up = (): void => {
      drag.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [onHeight])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') onClose()
  }

  return (
    <section
      role="region"
      aria-label={tab}
      className="drawer"
      style={{ ['--drawer-h' as string]: `${height}px` }}
      onKeyDown={onKeyDown}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize panel"
        className="drawer__handle"
        onMouseDown={(event) => {
          drag.current = { y: event.clientY, h: height }
        }}
      />
      <div className="drawer__body u-scroll">{children}</div>
    </section>
  )
}
```

- [ ] **Step 5: Rewrite `Titlebar.tsx`**

```tsx
import { t } from '@termif/core'

export type DrawerTab = 'files' | 'forwards'

export interface TitlebarProps {
  drawerTab: DrawerTab | null
  onDrawerTab(tab: DrawerTab | null): void
  inspectorOpen: boolean
  onInspector(open: boolean): void
}

export function Titlebar({
  drawerTab,
  onDrawerTab,
  inspectorOpen,
  onInspector,
}: TitlebarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar__panes" role="tablist">
        {(['files', 'forwards'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={drawerTab === name}
            // Pressing the open tab closes the drawer; pressing another switches
            // to it without closing.
            onClick={() => onDrawerTab(drawerTab === name ? null : name)}
          >
            {t(`layout.tab.${name}`)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="titlebar__inspector"
        aria-pressed={inspectorOpen}
        aria-label={t('layout.inspector')}
        onClick={() => onInspector(!inspectorOpen)}
      >
        ⓘ
      </button>
    </header>
  )
}
```

Remove the `layout.tab.terminals` key from `packages/core/src/i18n/en.ts` and add `layout.inspector`.

- [ ] **Step 6: Style it**

```css
.titlebar { justify-content: flex-start; gap: var(--space-3); }
.titlebar__panes { margin-inline: auto; }
.titlebar__inspector { -webkit-app-region: no-drag; }

.layout__main { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }

.drawer {
  display: flex;
  flex-direction: column;
  height: min(var(--drawer-h), 70%);
  min-height: 0;
  border-top: 1px solid var(--border-strong);
  background: var(--bg-surface);
  z-index: var(--z-drawer);
}
.drawer__handle { height: 5px; margin-top: -3px; cursor: row-resize; }
.drawer__handle:hover { background: var(--accent); }
.drawer__body { flex: 1; min-height: 0; }
```

- [ ] **Step 7: Rewire `MainLayout`**

The terminal is now always mounted; the drawer renders below it:

```tsx
        <main className="layout__main">
          <TerminalTabs app={app} />
          {prefs.drawerTab !== null && (
            <Drawer
              tab={prefs.drawerTab}
              height={prefs.drawerHeight}
              onHeight={(px) => app.prefs.set('drawerHeight', px)}
              onClose={() => app.prefs.set('drawerTab', null)}
            >
              {prefs.drawerTab === 'files' ? (
                <SftpBrowser app={app} />
              ) : (
                <ForwardPanel app={app} />
              )}
            </Drawer>
          )}
        </main>
```

- [ ] **Step 8: Keep drawer state per session (spec §5)**

Switching terminal tabs must switch what the drawer shows, and coming back must
return to the directory you left — not to `/`. Without this the drawer is a
single global view wearing a per-session costume.

Write the failing test first, in `test/renderer/sftpStore.test.ts`:

```ts
it('keeps a separate directory per session', async () => {
  const stores = createSftpStores({ ssh })
  await stores.for('sess-1').open('/var/log')
  await stores.for('sess-2').open('/etc')
  expect(stores.for('sess-1').get().path).toBe('/var/log')
})

it('returns the same store for the same session', () => {
  const stores = createSftpStores({ ssh })
  expect(stores.for('sess-1')).toBe(stores.for('sess-1'))
})

it('drops a session's store when the session closes', () => {
  const stores = createSftpStores({ ssh })
  stores.for('sess-1')
  stores.forget('sess-1')
  expect(stores.size()).toBe(0)
})
```

Then implement a thin registry in `sftpStore.ts` — a `Map<string, SftpStore>`
created lazily by session id, with `forget(id)` called from the existing
`sessionClosed` handling. `SftpBrowser` and `ForwardPanel` take the store for
`app.tabs.activeSessionId()` rather than reaching for a single global one.

- [ ] **Step 9: Write the empty states (spec §5)**

Two, both currently blank space:

```tsx
// Drawer, no session open.
{sessionId === null && (
  <p className="drawer__empty">{t('sftp.empty.noSession')}</p>
)}
```

```tsx
// Main area, no tabs.
<div className="terminal-tabs__empty">{t('terminal.empty')}</div>
```

Add both strings to `packages/core/src/i18n/en.ts`: `sftp.empty.noSession` =
"Connect to a host to browse files", `terminal.empty` = "Select a host, or ⌘N to
add one". Replace `.terminal-tabs__empty`'s `margin: auto` with
`place-content: center` — the current rule works only because its parent happens
to be a flex column.

- [ ] **Step 10: Add the ⌘J shortcut**

In `MainLayout`, one effect:

```tsx
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'j') {
        event.preventDefault()
        app.prefs.set('drawerTab', app.prefs.get().drawerTab === null ? 'files' : null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app.prefs])
```

- [ ] **Step 11: Run everything and commit**

Run: `cd apps/desktop && npm test`

```bash
git add apps/desktop/src/renderer packages/core/src/i18n/en.ts apps/desktop/test/renderer
git commit -m "feat(desktop): move Files and Forwards into a bottom drawer"
```

---

### Task 6: Refit the terminal on every size change

Without this, every other task in this plan looks right and the terminal's text is wrong.

**Files:**
- Modify: `apps/desktop/src/renderer/views/TerminalPane.tsx`
- Modify: `apps/desktop/test/setup.ts` (the `ResizeObserver` stub must now record callbacks)
- Test: `apps/desktop/test/renderer/terminalPane.test.tsx`

**Interfaces:**
- Consumes: `FitAddon` from `@xterm/addon-fit`, `app.sessions.resize(channelId, cols, rows)`.
- Produces: nothing new; behaviour only.

- [ ] **Step 1: Make the test double observable**

Replace the stub in `test/setup.ts`:

```ts
// jsdom has no ResizeObserver. The stub records instances so a test can fire a
// resize by hand — the real one never fires in jsdom, and TerminalPane's whole
// job is reacting to it.
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = []
  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  fire(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
;(globalThis as Record<string, unknown>).ResizeObserverStub = ResizeObserverStub
```

- [ ] **Step 2: Write the failing test**

`apps/desktop/test/renderer/terminalPane.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { TerminalPane } from '../../src/renderer/views/TerminalPane.js'

const stub = (): { instances: { fire(): void }[] } =>
  (globalThis as Record<string, unknown>).ResizeObserverStub as never

describe('TerminalPane resize', () => {
  beforeEach(() => {
    ;(stub() as unknown as { instances: unknown[] }).instances = []
  })

  it('fits and reports the new size when its container resizes', async () => {
    const onResize = vi.fn()
    render(<TerminalPane channelId="7" onData={vi.fn()} onResize={onResize} />)

    stub().instances[0]!.fire()
    await vi.waitFor(() => expect(onResize).toHaveBeenCalled())
    const [cols, rows] = onResize.mock.calls[0]!
    expect(cols).toBeGreaterThan(0)
    expect(rows).toBeGreaterThan(0)
  })

  it('does not report when the size did not actually change', async () => {
    const onResize = vi.fn()
    render(<TerminalPane channelId="7" onData={vi.fn()} onResize={onResize} />)

    stub().instances[0]!.fire()
    await vi.waitFor(() => expect(onResize).toHaveBeenCalledTimes(1))
    onResize.mockClear()
    stub().instances[0]!.fire()
    await new Promise((r) => setTimeout(r, 150))
    // Re-sending an unchanged size is a wasted SSH round trip, and a fit() that
    // resizes the element it observes can loop forever.
    expect(onResize).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/terminalPane.test.tsx`
Expected: FAIL — no resize is reported.

- [ ] **Step 4: Implement**

In `TerminalPane.tsx`, inside the mount effect, after the terminal and fit addon exist:

```tsx
    let lastCols = 0
    let lastRows = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const refit = (): void => {
      fit.fit()
      const { cols, rows } = term
      // Guard against both a wasted round trip and the classic observer loop:
      // fit() resizes the very element we observe.
      if (cols === lastCols && rows === lastRows) return
      lastCols = cols
      lastRows = rows
      onResize(cols, rows)
    }

    const observer = new ResizeObserver(() => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        refit()
      }, 100)
    })
    observer.observe(container)

    return () => {
      if (timer !== null) clearTimeout(timer)
      observer.disconnect()
      // ...existing teardown
    }
```

- [ ] **Step 5: Run it**

Run: `cd apps/desktop && npx vitest run test/renderer/terminalPane.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the suite and commit**

Run: `cd apps/desktop && npm test`

```bash
git add apps/desktop/src/renderer/views/TerminalPane.tsx apps/desktop/test
git commit -m "fix(desktop): refit the terminal when its container resizes"
```

---

### Task 7: Tab overflow menu

**Files:**
- Create: `apps/desktop/src/renderer/views/Menu.tsx`
- Modify: `apps/desktop/src/renderer/views/TerminalTabs.tsx`
- Test: `apps/desktop/test/renderer/menu.test.tsx`, extend `apps/desktop/test/renderer/tabStore.test.ts`

**Interfaces:**
- Produces:

```tsx
export interface MenuItem {
  id: string
  label: string
  danger?: boolean
  disabled?: boolean
  shortcut?: string
}
export function Menu(props: {
  items: readonly (MenuItem | 'separator')[]
  x: number
  y: number
  onPick(id: string): void
  onClose(): void
}): JSX.Element
```

This component is reused by Task 9's context menus. Build it once, here.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/renderer/menu.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu } from '../../src/renderer/views/Menu.js'

const items = [
  { id: 'rename', label: 'Rename' },
  'separator' as const,
  { id: 'delete', label: 'Delete', danger: true },
  { id: 'nope', label: 'Unavailable', disabled: true },
]

describe('Menu', () => {
  it('renders one menuitem per entry, separators excluded', () => {
    render(<Menu items={items} x={0} y={0} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })

  it('reports the picked id', async () => {
    const onPick = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onPick).toHaveBeenCalledWith('rename')
  })

  it('ignores a disabled item', async () => {
    const onPick = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unavailable' }))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={vi.fn()} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('moves the active item with the arrow keys and runs it on Enter', async () => {
    const onPick = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledWith('delete')
  })

  it('skips disabled items while arrowing', async () => {
    const onPick = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={onPick} onClose={vi.fn()} />)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    // Wraps back to the first enabled item rather than landing on 'nope'.
    expect(onPick).toHaveBeenCalledWith('rename')
  })

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    render(<Menu items={items} x={0} y={0} onPick={vi.fn()} onClose={onClose} />)
    await userEvent.click(screen.getByTestId('menu-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/menu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `Menu.tsx`**

```tsx
import { useEffect, useState } from 'react'

export interface MenuItem {
  id: string
  label: string
  danger?: boolean
  disabled?: boolean
  shortcut?: string
}

export function Menu({
  items,
  x,
  y,
  onPick,
  onClose,
}: {
  items: readonly (MenuItem | 'separator')[]
  x: number
  y: number
  onPick(id: string): void
  onClose(): void
}) {
  const enabled = items.filter(
    (item): item is MenuItem => item !== 'separator' && item.disabled !== true,
  )
  const [active, setActive] = useState(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') return onClose()
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        return setActive((i) => (i + 1) % enabled.length)
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        return setActive((i) => (i - 1 + enabled.length) % enabled.length)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const item = enabled[active]
        if (item !== undefined) onPick(item.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, enabled, onClose, onPick])

  return (
    <>
      <div className="menu__backdrop" data-testid="menu-backdrop" onClick={onClose} />
      <div className="menu" role="menu" style={{ left: x, top: y }}>
        {items.map((item, index) =>
          item === 'separator' ? (
            <hr key={`sep-${index}`} className="menu__sep" />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled === true}
              data-active={enabled[active]?.id === item.id ? 'true' : undefined}
              data-danger={item.danger === true ? 'true' : undefined}
              onClick={() => onPick(item.id)}
            >
              <span className="u-clip">{item.label}</span>
              {item.shortcut !== undefined && (
                <span className="menu__shortcut">{item.shortcut}</span>
              )}
            </button>
          ),
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 4: Style it**

```css
.menu__backdrop { position: fixed; inset: 0; z-index: var(--z-sheet); }
.menu {
  position: fixed;
  z-index: var(--z-palette);
  min-width: 180px;
  padding: var(--space-1);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-overlay);
  box-shadow: var(--shadow-overlay);
}
.menu button {
  display: flex;
  gap: var(--space-4);
  width: 100%;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  text-align: start;
}
.menu button[data-active='true'] { background: var(--accent); color: var(--accent-fg); }
.menu button[data-danger='true'] { color: var(--danger); }
.menu button:disabled { color: var(--fg-subtle); }
.menu__shortcut { margin-inline-start: auto; color: var(--fg-subtle); }
.menu__sep { margin: var(--space-1) 0; border: none; border-top: 1px solid var(--border); }
```

- [ ] **Step 5: Use it for tab overflow**

In `TerminalTabs.tsx`:

```tsx
  const bar = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(tabs.length)

  useEffect(() => {
    const element = bar.current
    if (element === null) return
    const measure = (): void => {
      // 120px is the tab's minimum plus its gap; 44px reserves room for the
      // `+N` button and the new-tab button so they are never the ones clipped.
      const room = Math.max(1, Math.floor((element.clientWidth - 44) / 120))
      setVisibleCount(room)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const shown = tabs.slice(0, visibleCount)
  const hidden = tabs.slice(visibleCount)
```

Render `shown` as tabs. When `hidden.length > 0`, render one more button labelled `+${hidden.length}` that opens `Menu` at its bounding rect with `hidden.map((tab) => ({ id: tab.id, label: tab.title }))`, and `onPick` selects that tab.

In `app.css`, replace `overflow-x: auto` on `.terminal-tabs__bar` with `overflow: hidden` — horizontal scrolling in a tab bar is a control nobody finds.

- [ ] **Step 6: Run and commit**

Run: `cd apps/desktop && npm test`

```bash
git add apps/desktop/src/renderer apps/desktop/test/renderer/menu.test.tsx
git commit -m "feat(desktop): add a menu component and collapse tab overflow into it"
```

---

### Task 8: Private keys — passphrase, file picker, validation

Three things, one migration. The passphrase defect is a **connection failure**, not a cosmetic issue: a passphrase-protected key cannot connect today.

**Files:**
- Modify: `packages/core/src/model.ts`, `packages/core/src/store.ts`
- Modify: `apps/desktop/src/renderer/state/hostStore.ts`, `state/connectFlow.tsx`
- Create: `apps/desktop/src/renderer/state/privateKey.ts`
- Test: `packages/core/test/store.test.ts`, `apps/desktop/test/renderer/privateKey.test.ts`

**Interfaces:**
- Produces:

```ts
// model.ts
storedCredentialSchema: { ..., secret: string, passphrase: string | null }

// privateKey.ts
export type KeyReport =
  | { ok: true; type: 'ed25519' | 'rsa' | 'ecdsa' | 'unknown'; encrypted: boolean; fingerprint: string | null }
  | { ok: false; reason: 'empty' | 'public-key' | 'not-a-key' }
export function inspectPrivateKey(text: string): Promise<KeyReport>
```

- [ ] **Step 1: Write the failing store test**

Add to `packages/core/test/store.test.ts`:

```ts
  it('round trips a key credential with its passphrase', async () => {
    const store = await open()
    const saved = await store.saveCredential({
      label: 'prod key',
      kind: 'key',
      secret: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
      passphrase: 'correct horse',
    })
    const read = await store.getCredential(saved.id)
    expect(read?.passphrase).toBe('correct horse')
  })

  it('stores null for a credential with no passphrase', async () => {
    const store = await open()
    const saved = await store.saveCredential({
      label: 'prod password',
      kind: 'password',
      secret: 'hunter2',
      passphrase: null,
    })
    expect((await store.getCredential(saved.id))?.passphrase).toBeNull()
  })

  it('migrates a version 2 database by adding the column', async () => {
    // Additive: existing credentials survive, unlike the version 2 migration
    // which had to drop them.
    const store = await openAtVersion(2, [{ table: 'credentials', rows: 1 }])
    await store.migrate()
    expect(await store.getMetaValue('schemaVersion')).toBe('3')
    expect((await store.listCredentials()).length).toBe(1)
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/core && npx vitest run test/store.test.ts`
Expected: FAIL — `passphrase` is not a known property.

- [ ] **Step 3: Implement the schema change**

In `model.ts`, add to `storedCredentialSchema`:

```ts
  /** Only meaningful for `kind: 'key'`; null for a password. */
  passphrase: z.string().nullable(),
```

In `store.ts`, add migration index 3 (additive — no data is dropped):

```ts
  `ALTER TABLE credentials ADD COLUMN passphrase TEXT`,
```

Set `SCHEMA_VERSION = 3`, and add `passphrase` to the credential INSERT, the conflict clause, the row type, and `toCredential`.

- [ ] **Step 4: Run it**

Run: `cd packages/core && npx vitest run test/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Carry the passphrase through the renderer**

`hostStore.ts`:

```ts
export interface SecretInput {
  kind: 'password' | 'key'
  label: string
  secret: string
  passphrase: string | null
}
```

`connectFlow.tsx`, in `resolveCredential`:

```ts
  return credential.kind === 'password'
    ? { password: credential.secret }
    : {
        privateKeyPem: credential.secret,
        // Was silently dropped before: HostForm.tsx:60 had a ternary whose two
        // branches were identical, so a passphrase-protected key could never
        // connect.
        ...(credential.passphrase === null ? {} : { passphrase: credential.passphrase }),
      }
```

- [ ] **Step 6: Write the failing key-inspection test**

`apps/desktop/test/renderer/privateKey.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { inspectPrivateKey } from '../../src/renderer/state/privateKey.js'

describe('inspectPrivateKey', () => {
  it('rejects an empty string', async () => {
    expect(await inspectPrivateKey('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects a public key, the most common paste mistake', async () => {
    const report = await inspectPrivateKey('ssh-ed25519 AAAAC3NzaC1lZDI1 user@host')
    expect(report).toEqual({ ok: false, reason: 'public-key' })
  })

  it('rejects arbitrary text', async () => {
    expect(await inspectPrivateKey('hello world')).toEqual({ ok: false, reason: 'not-a-key' })
  })

  it('accepts an OpenSSH private key and names its type', async () => {
    const report = await inspectPrivateKey(OPENSSH_ED25519)
    expect(report).toMatchObject({ ok: true, type: 'ed25519', encrypted: false })
  })

  it('computes a SHA256 fingerprint for an OpenSSH key', async () => {
    const report = await inspectPrivateKey(OPENSSH_ED25519)
    expect(report.ok && report.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })

  it('detects an encrypted key without needing the passphrase', async () => {
    // The OPENSSH container keeps its public half in the clear even when the
    // private half is encrypted, so type and fingerprint are still readable.
    const report = await inspectPrivateKey(OPENSSH_ENCRYPTED)
    expect(report).toMatchObject({ ok: true, encrypted: true, type: 'ed25519' })
  })

  it('accepts a PKCS#1 RSA key but reports no fingerprint', async () => {
    const report = await inspectPrivateKey(PKCS1_RSA)
    expect(report).toMatchObject({ ok: true, type: 'rsa', fingerprint: null })
  })
})
```

Generate the three fixtures once and paste them into the test file as constants:

```bash
ssh-keygen -t ed25519 -N '' -f /tmp/k1 -C test          # OPENSSH_ED25519
ssh-keygen -t ed25519 -N 'pw' -f /tmp/k2 -C test        # OPENSSH_ENCRYPTED
ssh-keygen -t rsa -b 2048 -m PEM -N '' -f /tmp/k3       # PKCS1_RSA
```

These are throwaway keys for a unit test. Do not reuse a real one.

- [ ] **Step 7: Implement `privateKey.ts`**

```ts
export type KeyType = 'ed25519' | 'rsa' | 'ecdsa' | 'unknown'

export type KeyReport =
  | { ok: true; type: KeyType; encrypted: boolean; fingerprint: string | null }
  | { ok: false; reason: 'empty' | 'public-key' | 'not-a-key' }

const OPENSSH_BEGIN = '-----BEGIN OPENSSH PRIVATE KEY-----'
const MAGIC = 'openssh-key-v1\0'

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** The OPENSSH container is a run of `uint32 length` + payload fields. */
function readField(bytes: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const length = view.getUint32(offset)
  return { value: bytes.subarray(offset + 4, offset + 4 + length), next: offset + 4 + length }
}

function typeOf(name: string): KeyType {
  if (name.includes('ed25519')) return 'ed25519'
  if (name.includes('rsa')) return 'rsa'
  if (name.includes('ecdsa')) return 'ecdsa'
  return 'unknown'
}

export async function inspectPrivateKey(text: string): Promise<KeyReport> {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (/^(ssh-|ecdsa-)\S+\s+AAAA/.test(trimmed)) return { ok: false, reason: 'public-key' }

  if (trimmed.startsWith(OPENSSH_BEGIN)) {
    const body = trimmed
      .split('\n')
      .filter((line) => !line.startsWith('-----'))
      .join('')
    let bytes: Uint8Array
    try {
      bytes = b64ToBytes(body)
    } catch {
      return { ok: false, reason: 'not-a-key' }
    }
    if (new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) {
      return { ok: false, reason: 'not-a-key' }
    }

    let offset = MAGIC.length
    const cipher = readField(bytes, offset)
    offset = cipher.next
    const kdf = readField(bytes, offset)
    offset = kdf.next
    const kdfOptions = readField(bytes, offset)
    offset = kdfOptions.next + 4 // skip the key count
    const publicKey = readField(bytes, offset)

    const cipherName = new TextDecoder().decode(cipher.value)
    const algo = new TextDecoder().decode(readField(publicKey.value, 0).value)
    const digest = await crypto.subtle.digest('SHA-256', publicKey.value)
    const fingerprint = `SHA256:${btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=+$/, '')}`

    return {
      ok: true,
      type: typeOf(algo),
      encrypted: cipherName !== 'none',
      fingerprint,
    }
  }

  if (/-----BEGIN (RSA|EC|PRIVATE) .*KEY-----/.test(trimmed)) {
    // PKCS#1 and SEC1 wrap the private key only; there is no public half to
    // fingerprint without doing real crypto, which is not worth it here.
    return {
      ok: true,
      type: trimmed.includes('RSA') ? 'rsa' : trimmed.includes('EC') ? 'ecdsa' : 'unknown',
      encrypted: trimmed.includes('ENCRYPTED'),
      fingerprint: null,
    }
  }

  return { ok: false, reason: 'not-a-key' }
}
```

- [ ] **Step 8: Run both suites**

Run: `cd packages/core && npm test && cd ../../apps/desktop && npm test`
Expected: green in both.

- [ ] **Step 9: Commit**

```bash
git add packages/core apps/desktop/src/renderer apps/desktop/test
git commit -m "fix: carry the key passphrase through to connect, and validate pasted keys"
```

---

### Task 9: The inspector

**Files:**
- Create: `apps/desktop/src/renderer/views/Inspector.tsx`
- Modify: `apps/desktop/src/renderer/app/MainLayout.tsx`
- Delete: `apps/desktop/src/renderer/views/HostForm.tsx` and its test
- Test: `apps/desktop/test/renderer/inspector.test.tsx`

**Interfaces:**
- Consumes: `hostStore.save`, `inspectPrivateKey` (Task 8), `app.pickFile` IPC.
- Produces:

```tsx
export function Inspector(props: {
  host: Host | null
  credential: StoredCredential | null
  groups: readonly string[]
  onSave(input: SaveHostInput, secret: SecretInput | null): Promise<void>
  onPickKeyFile(): Promise<string | null>
}): JSX.Element
```

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/renderer/inspector.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Host } from '@termif/core'
import { Inspector } from '../../src/renderer/views/Inspector.js'

const host: Host = {
  id: 'h1',
  label: 'prod-db',
  hostname: '103.172.78.21',
  port: 22,
  username: 'root',
  authRef: null,
  tags: [],
  groupId: 'Production',
  updatedAt: '2026-08-30T00:00:00.000Z',
  deleted: false,
}

const base = {
  host,
  credential: null,
  groups: ['Production', 'Staging'],
  onSave: vi.fn(),
  onPickKeyFile: vi.fn(),
}

describe('Inspector', () => {
  it('prompts when no host is selected', () => {
    render(<Inspector {...base} host={null} />)
    expect(screen.getByText(/select a host/i)).toBeInTheDocument()
  })

  it('saves a valid edit after the debounce', async () => {
    const onSave = vi.fn()
    render(<Inspector {...base} onSave={onSave} />)
    await userEvent.clear(screen.getByLabelText(/hostname/i))
    await userEvent.type(screen.getByLabelText(/hostname/i), 'db.internal')
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 1000 })
    expect(onSave.mock.lastCall?.[0]).toMatchObject({ hostname: 'db.internal' })
  })

  it('does not save an empty label', async () => {
    const onSave = vi.fn()
    render(<Inspector {...base} onSave={onSave} />)
    await userEvent.clear(screen.getByLabelText(/^label/i))
    await new Promise((r) => setTimeout(r, 600))
    // Persisting an empty label is data corruption, not convenience.
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/label/i)
  })

  it('does not save a port outside 1–65535', async () => {
    const onSave = vi.fn()
    render(<Inspector {...base} onSave={onSave} />)
    await userEvent.clear(screen.getByLabelText(/port/i))
    await userEvent.type(screen.getByLabelText(/port/i), '99999')
    await new Promise((r) => setTimeout(r, 600))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('offers the existing groups as suggestions', () => {
    render(<Inspector {...base} />)
    const list = screen.getByLabelText(/group/i).getAttribute('list')
    expect(list).not.toBeNull()
    expect(screen.getByTestId('group-options').children).toHaveLength(2)
  })

  it('reads a key file through the picker and reports its type', async () => {
    const onPickKeyFile = vi.fn().mockResolvedValue(OPENSSH_ED25519)
    render(<Inspector {...base} onPickKeyFile={onPickKeyFile} />)
    await userEvent.selectOptions(screen.getByLabelText(/authentication/i), 'key')
    await userEvent.click(screen.getByRole('button', { name: /choose file/i }))
    await vi.waitFor(() => expect(screen.getByText(/ed25519/i)).toBeInTheDocument())
  })

  it('refuses a pasted public key', async () => {
    render(<Inspector {...base} />)
    await userEvent.selectOptions(screen.getByLabelText(/authentication/i), 'key')
    await userEvent.click(screen.getByRole('button', { name: /paste/i }))
    await userEvent.type(screen.getByLabelText(/private key/i), 'ssh-ed25519 AAAAC3 user@h')
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/public key/i),
    )
  })

  it('masks the password until the reveal button is pressed', async () => {
    render(<Inspector {...base} />)
    const field = screen.getByLabelText(/^password/i)
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: /show/i }))
    expect(field).toHaveAttribute('type', 'text')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/inspector.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `Inspector.tsx`**

Reuse the validation rules already in `HostForm.tsx:29-34` verbatim — label, hostname, username non-empty; port an integer in 1–65535. The difference is when they run: on a 400ms debounce and on blur, gating the write rather than gating a submit button.

Structure:

```tsx
  const [draft, setDraft] = useState(() => fromHost(host))
  const [error, setError] = useState<string | null>(null)

  // Reset when the selection changes, or edits leak between hosts.
  useEffect(() => setDraft(fromHost(host)), [host?.id])

  useEffect(() => {
    if (host === null) return
    const problem = validate(draft)
    setError(problem)
    if (problem !== null) return
    const timer = setTimeout(() => void onSave(toInput(draft, host), secretOf(draft)), 400)
    return () => clearTimeout(timer)
  }, [draft, host])
```

The group field is an `<input list="group-options">` with a `<datalist id="group-options" data-testid="group-options">`.

- [ ] **Step 4: Add the ⌘N flow**

In `MainLayout`, ⌘N calls `hostStore.save({ label: 'New host', hostname: '', port: 22, username: '', tags: [], groupId: null }, null)`, selects the created host, opens the inspector, and focuses the label field. Same as Finder's New Folder: the row exists immediately and typing renames it.

- [ ] **Step 5: Delete `HostForm.tsx`**

Remove the file, its test, and the `editing` state and branch in `MainLayout`.

- [ ] **Step 6: Wire the inspector column**

```tsx
    <div
      className="layout"
      data-inspector={prefs.inspectorOpen ? 'open' : 'closed'}
      style={{ ['--sidebar-w' as string]: `${prefs.sidebarWidth}px` }}
    >
```

```css
.layout { grid-template-columns: var(--sidebar-w) minmax(0, 1fr); }
.layout[data-inspector='open'] {
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr) var(--inspector-w);
}
@container (max-width: 1099px) {
  .layout[data-inspector='open'] {
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
  }
  .inspector {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    width: var(--inspector-w);
    z-index: var(--z-inspector);
    box-shadow: var(--shadow-overlay);
  }
}
```

- [ ] **Step 7: Run and commit**

Run: `cd apps/desktop && npm test`

```bash
git add apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): replace the host form with a live inspector column"
```

---

### Task 10: SFTP context menu and hidden files

**Files:**
- Modify: `apps/desktop/src/renderer/views/SftpBrowser.tsx`
- Modify: `apps/desktop/src/renderer/state/sftpStore.ts`
- Test: `apps/desktop/test/renderer/sftpBrowser.test.tsx`, extend `sftpStore.test.ts`

**Interfaces:**
- Consumes: `Menu` (Task 7), `prefs.showHidden` (Task 2), `sftpStore.rename`, `sftpStore.remove`.
- Produces, both pure and exported from `sftpStore.ts`:

```ts
export function visibleEntries(
  entries: readonly SshDirEntry[],
  showHidden: boolean,
): SshDirEntry[]
export function hiddenCount(entries: readonly SshDirEntry[]): number
```

- [ ] **Step 1: Write the failing filter test**

Add to `apps/desktop/test/renderer/sftpStore.test.ts`:

```ts
  it('hides dotfiles by default', () => {
    const entries = [entry('.bashrc'), entry('app.log'), entry('.config', true)]
    expect(visibleEntries(entries, false).map((e) => e.name)).toEqual(['app.log'])
  })

  it('shows dotfiles when asked', () => {
    const entries = [entry('.bashrc'), entry('app.log')]
    expect(visibleEntries(entries, true)).toHaveLength(2)
  })

  it('never hides the parent entry', () => {
    // '..' starts with a dot but is navigation, not a hidden file.
    expect(visibleEntries([entry('..', true)], false).map((e) => e.name)).toEqual(['..'])
  })

  it('counts what it hid so the UI can say so', () => {
    expect(hiddenCount([entry('.a'), entry('.b'), entry('c')])).toBe(2)
  })
```

- [ ] **Step 2: Write the failing context-menu test**

`apps/desktop/test/renderer/sftpBrowser.test.tsx`:

```tsx
  it('opens a context menu on right click', async () => {
    render(<SftpBrowserView {...props} entries={[dirEntry('logs'), fileEntry('app.log')]} />)
    fireEvent.contextMenu(screen.getByText('app.log'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
  })

  it('renames in place rather than in a dialog', async () => {
    const onRename = vi.fn()
    render(<SftpBrowserView {...props} onRename={onRename} entries={[fileEntry('app.log')]} />)
    fireEvent.contextMenu(screen.getByText('app.log'))
    await userEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    const field = screen.getByRole('textbox', { name: /rename/i })
    await userEvent.clear(field)
    await userEvent.type(field, 'app.old.log{Enter}')
    expect(onRename).toHaveBeenCalledWith('app.log', 'app.old.log')
  })

  it('cancels an in-place rename on Escape', async () => {
    const onRename = vi.fn()
    render(<SftpBrowserView {...props} onRename={onRename} entries={[fileEntry('app.log')]} />)
    fireEvent.contextMenu(screen.getByText('app.log'))
    await userEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    await userEvent.keyboard('{Escape}')
    expect(onRename).not.toHaveBeenCalled()
  })

  it('deletes a file without confirmation', async () => {
    const onRemove = vi.fn()
    render(<SftpBrowserView {...props} onRemove={onRemove} entries={[fileEntry('app.log')]} />)
    fireEvent.contextMenu(screen.getByText('app.log'))
    await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    expect(onRemove).toHaveBeenCalledWith('app.log', false)
  })

  it('confirms before deleting a directory and says it is recursive', async () => {
    const onRemove = vi.fn()
    render(<SftpBrowserView {...props} onRemove={onRemove} entries={[dirEntry('logs')]} />)
    fireEvent.contextMenu(screen.getByText('logs'))
    await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent(/everything inside/i)
    await userEvent.click(screen.getByRole('button', { name: /^delete/i }))
    expect(onRemove).toHaveBeenCalledWith('logs', true)
  })

  it('reports how many entries are hidden', () => {
    render(<SftpBrowserView {...props} showHidden={false} entries={[fileEntry('.env'), fileEntry('a')]} />)
    expect(screen.getByText(/1 hidden/i)).toBeInTheDocument()
  })

  it('opens the menu from the keyboard', async () => {
    render(<SftpBrowserView {...props} entries={[fileEntry('app.log')]} />)
    screen.getByText('app.log').closest('li')!.focus()
    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
```

- [ ] **Step 3: Run both and watch them fail**

Run: `cd apps/desktop && npx vitest run test/renderer/sftpStore.test.ts test/renderer/sftpBrowser.test.tsx`
Expected: FAIL — `visibleEntries` missing, no `menu` role.

- [ ] **Step 4: Implement**

In `sftpStore.ts`:

```ts
/** '..' is navigation, not a hidden file, so it is never filtered. */
export function visibleEntries(
  entries: readonly SshDirEntry[],
  showHidden: boolean,
): SshDirEntry[] {
  if (showHidden) return [...entries]
  return entries.filter((entry) => entry.name === '..' || !entry.name.startsWith('.'))
}

export function hiddenCount(entries: readonly SshDirEntry[]): number {
  return entries.filter((entry) => entry.name !== '..' && entry.name.startsWith('.')).length
}
```

In `SftpBrowser.tsx`: hold `menu: { x, y, name } | null` and `renaming: string | null` in state, render `<Menu>` from Task 7, and swap the row's name span for an input while renaming.

- [ ] **Step 5: Add the view menu and ⌘⇧.**

The drawer's toolbar gets a `⋯` button opening `Menu` with New folder, Upload…, Refresh, separator, "Show hidden files ⌘⇧.". Bind the shortcut in `SftpBrowser` and toggle `app.prefs.set('showHidden', …)`.

- [ ] **Step 6: Run and commit**

Run: `cd apps/desktop && npm test`

```bash
git add apps/desktop/src/renderer apps/desktop/test/renderer
git commit -m "feat(desktop): add SFTP context menus and a hidden-file toggle"
```

---

### Task 11: Drag-and-drop upload

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/renderer/platform.ts`
- Modify: `apps/desktop/src/renderer/views/SftpBrowser.tsx`
- Test: `apps/desktop/test/renderer/dropUpload.test.tsx`, `apps/desktop/e2e/drop.spec.ts`

**Interfaces:**
- Produces: `window.termif.app.pathForDroppedFile(file: File): string` — synchronous, returns `''` when the path is unavailable.

- [ ] **Step 1: Write the failing test**

`apps/desktop/test/renderer/dropUpload.test.tsx`:

```tsx
  it('highlights the drop target on dragover', () => {
    render(<SftpBrowserView {...props} />)
    const zone = screen.getByTestId('drop-zone')
    fireEvent.dragOver(zone)
    expect(zone).toHaveAttribute('data-dropping', 'true')
  })

  it('clears the highlight on dragleave', () => {
    render(<SftpBrowserView {...props} />)
    const zone = screen.getByTestId('drop-zone')
    fireEvent.dragOver(zone)
    fireEvent.dragLeave(zone)
    expect(zone).not.toHaveAttribute('data-dropping')
  })

  it('uploads dropped files into the current directory', () => {
    const onUploadPaths = vi.fn()
    render(<SftpBrowserView {...props} path="/root" onUploadPaths={onUploadPaths} />)
    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: { files: [new File(['x'], 'a.txt')], items: [] },
    })
    expect(onUploadPaths).toHaveBeenCalledWith(['/fake/a.txt'], '/root')
  })

  it('uploads into a directory row when dropped on one', () => {
    const onUploadPaths = vi.fn()
    render(
      <SftpBrowserView {...props} path="/root" onUploadPaths={onUploadPaths}
        entries={[dirEntry('logs')]} />,
    )
    fireEvent.drop(screen.getByText('logs'), {
      dataTransfer: { files: [new File(['x'], 'a.txt')], items: [] },
    })
    expect(onUploadPaths).toHaveBeenCalledWith(['/fake/a.txt'], '/root/logs')
  })

  it('refuses a dropped directory with a message', () => {
    const onUploadPaths = vi.fn()
    render(<SftpBrowserView {...props} onUploadPaths={onUploadPaths} />)
    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: {
        files: [],
        items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }],
      },
    })
    expect(onUploadPaths).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/folder/i)
  })
```

The fake `pathForDroppedFile` returns `/fake/${file.name}` in `test/renderer/fakes/platform.ts`.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/dropUpload.test.tsx`
Expected: FAIL — no `drop-zone`.

- [ ] **Step 3: Bridge the path in preload**

`src/preload/index.ts`:

```ts
import { webUtils } from 'electron'

// Electron 32 removed `File.path` under a sandboxed renderer. Without this
// bridge, drag-and-drop silently does nothing: no error, no upload.
pathForDroppedFile: (file: File): string => {
  try {
    return webUtils.getPathForFile(file)
  } catch {
    return ''
  }
},
```

Add it to `TermifApi['app']` in `shared/ipc.ts` and to the renderer adapter in `platform.ts`.

- [ ] **Step 4: Implement the drop zone**

Files with an empty path are skipped. Uploads run **sequentially** — one connection served by ten parallel transfers is slower, not faster:

```ts
  const upload = async (paths: readonly string[], into: string): Promise<void> => {
    for (const local of paths) {
      await store.upload(local, joinPath(into, basename(local)))
    }
  }
```

- [ ] **Step 5: Write the e2e test that actually drops a file**

`apps/desktop/e2e/drop.spec.ts`, gated behind the live-server env like Plan 7's specs. A unit test of the handler cannot prove the preload bridge works; this is the only thing that can.

- [ ] **Step 6: Run and commit**

Run: `cd apps/desktop && npm test`

```bash
git add apps/desktop/src apps/desktop/test apps/desktop/e2e
git commit -m "feat(desktop): upload files by dropping them on the file browser"
```

---

### Task 12: Sheets, and the palette as a panel

**Files:**
- Create: `apps/desktop/src/renderer/views/Sheet.tsx`
- Modify: `apps/desktop/src/renderer/views/HostKeyPrompt.tsx`, `views/SnippetPalette.tsx`
- Modify: `apps/desktop/src/renderer/styles/app.css`
- Test: `apps/desktop/test/renderer/sheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
  it('marks itself as a modal dialog', () => {
    render(<Sheet title="Trust this host?" onClose={vi.fn()}>body</Sheet>)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Sheet title="t" onClose={onClose}>body</Sheet>)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('moves focus into itself on open', () => {
    render(<Sheet title="t" onClose={vi.fn()}><button>Go</button></Sheet>)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveFocus()
  })

  it('keeps Tab inside the sheet', async () => {
    render(
      <Sheet title="t" onClose={vi.fn()}>
        <button>One</button>
        <button>Two</button>
      </Sheet>,
    )
    await userEvent.tab()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'One' })).toHaveFocus()
  })

  it('returns focus to the opener on close', async () => {
    // Losing focus to <body> after a dialog closes strands keyboard users.
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(<Sheet title="t" onClose={vi.fn()}>body</Sheet>)
    unmount()
    expect(opener).toHaveFocus()
  })

  it('keeps the mismatch variant visually distinct', () => {
    render(<Sheet title="t" variant="danger" onClose={vi.fn()}>body</Sheet>)
    expect(screen.getByRole('dialog')).toHaveAttribute('data-variant', 'danger')
  })
```

- [ ] **Step 2: Run it, implement `Sheet.tsx`, run it again**

Expected first: FAIL, module not found. After: PASS, 6 tests.

- [ ] **Step 3: Convert the two existing overlays**

`HostKeyPrompt` renders inside `Sheet` with `variant="warn"` for unknown and `variant="danger"` for mismatch — the distinction already in `app.css` moves into the component. The connect-time password prompt does the same.

- [ ] **Step 4: Make the snippet palette a floating panel**

Not a sheet: 560px wide, 15% from the top, `z-index: var(--z-palette)`, no backdrop dimming. A sheet says "finish this first"; a palette appears and vanishes.

- [ ] **Step 5: Run and commit**

```bash
git add apps/desktop/src/renderer apps/desktop/test/renderer/sheet.test.tsx
git commit -m "feat(desktop): unify modal dialogs behind one sheet component"
```

---

### Task 13: Two token sets

**Files:**
- Create: `apps/desktop/src/renderer/styles/tokens-macos.css`, `tokens-windows.css`
- Modify: `apps/desktop/src/renderer/styles/palette.ts`, `app.css`, `src/renderer/main.tsx`
- Test: `apps/desktop/test/renderer/palette.test.ts`

**Interfaces:**
- Produces: `export const palettes: { macos: Palette; windows: Palette }`. The existing `palette` export stays as an alias for `palettes.macos` so no other import breaks.

- [ ] **Step 1: Extend the contrast test to both sets**

Wrap the existing `describe('palette contrast')` body in `for (const [name, palette] of Object.entries(palettes))` and put the platform name in each test title. The thresholds do not change: body ≥ 4.5:1, large text and borders ≥ 3:1.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/desktop && npx vitest run test/renderer/palette.test.ts`
Expected: FAIL — `palettes` is not exported.

- [ ] **Step 3: Split the palette module and write the two CSS files**

Windows differs in: `--radius-sm: 3px`, `--radius-md: 6px`, row height 36px, accent `#4cc2ff`, sidebar surface solid `--bg-surface` instead of the translucent overlay. Nothing else. Spacing and the type ramp stay shared, or they become two applications.

- [ ] **Step 4: Set the attribute at boot**

In `main.tsx`, before render:

```ts
document.documentElement.dataset.platform = await window.termif.app.platformKind()
```

- [ ] **Step 5: Apply the type ramp (spec §8)**

Five roles, no sixth. In `base.css`:

```css
.t-group  { font-size: 11px; font-weight: 600; letter-spacing: .08em;
            text-transform: uppercase; color: var(--fg-subtle); }
.t-second { font-size: 11px; color: var(--fg-muted); }
.t-body   { font-size: 13px; color: var(--fg); }
.t-emph   { font-size: 15px; font-weight: 600; color: var(--fg); }
.t-mono   { font-size: 12px; font-family: var(--font-mono); }

/* Numbers must not jitter as they update. */
.t-num { font-variant-numeric: tabular-nums; }
```

Then sweep `app.css` for hard-coded `font-size` declarations and replace each
with the matching role. Add `.t-num` to every port, byte count, and transfer
figure.

- [ ] **Step 6: Add the mirror test**

Extend the existing check that `palette.ts` matches `tokens.css` so it checks each palette against its own CSS file. That check is what stops the Windows set from rotting unnoticed.

- [ ] **Step 7: Run and commit**

```bash
git add apps/desktop/src/renderer apps/desktop/test/renderer/palette.test.ts
git commit -m "feat(desktop): ship separate macOS and Windows token sets"
```

---

### Task 14: The layout test tier

The one that keeps everything above from regressing. **jsdom cannot lay out** — every `getBoundingClientRect` returns zeroes — so none of the 227 existing tests can catch an overflow.

**Files:**
- Create: `apps/desktop/e2e/fixtures/hostile.ts`
- Create: `apps/desktop/e2e/layout.spec.ts`
- Modify: `apps/desktop/playwright.config.ts`

- [ ] **Step 1: Write the hostile fixture**

`e2e/fixtures/hostile.ts` seeds a database directly through `better-sqlite3` before the app launches:

```ts
export interface HostileHost {
  label: string
  group: string | null
  port: number
  username: string
}

const GROUPS = ['Production', 'Staging', 'g'.repeat(40), 'Databases', 'Edge', null]

/** Five deliberately awful rows, then 35 ordinary ones to force scrolling. */
export const HOSTILE_HOSTS: HostileHost[] = [
  { label: 'a'.repeat(60), group: 'Production', port: 22, username: 'root' },
  { label: 'Máy chủ sản xuất Hà Nội', group: 'Production', port: 22, username: 'root' },
  { label: '🚀 deploy', group: 'Production', port: 22, username: 'root' },
  { label: 'edge', group: 'g'.repeat(40), port: 22, username: 'root' },
  { label: 'high-port', group: null, port: 65535, username: 'u'.repeat(30) },
  ...Array.from({ length: 35 }, (_, index) => ({
    label: `host-${String(index).padStart(2, '0')}`,
    group: GROUPS[index % GROUPS.length]!,
    port: 22,
    username: 'deploy',
  })),
]

export const HOSTILE_PATH = `/root/${'d'.repeat(190)}`
export const HOSTILE_FILENAME = `${'f'.repeat(120)}.log`
```

Layouts break on real, ugly data. A fixture full of `prod-db` will stay green and stay useless.

- [ ] **Step 2: Write the invariant spec**

`e2e/layout.spec.ts`:

```ts
const WIDTHS = [900, 1000, 1100, 1280, 1600, 2560]

for (const platform of ['macos', 'windows'] as const) {
  for (const width of WIDTHS) {
    test(`no overflow at ${width}px on ${platform}`, async () => {
      await window.evaluate((p) => (document.documentElement.dataset.platform = p), platform)
      await window.setViewportSize({ width, height: 800 })

      const report = await window.evaluate(() => {
        const overflowing: string[] = []
        for (const sel of ['.layout__sidebar', '.layout__main', '.drawer', '.inspector']) {
          const el = document.querySelector(sel)
          if (el !== null && el.scrollWidth > el.clientWidth + 1) overflowing.push(sel)
        }
        let maxRight = 0
        for (const el of document.querySelectorAll('*')) {
          maxRight = Math.max(maxRight, el.getBoundingClientRect().right)
        }
        return {
          bodyScroll: document.body.scrollWidth,
          bodyClient: document.body.clientWidth,
          overflowing,
          maxRight,
        }
      })

      expect(report.overflowing).toEqual([])
      expect(report.bodyScroll).toBeLessThanOrEqual(report.bodyClient)
      expect(report.maxRight).toBeLessThanOrEqual(width + 1)
    })
  }
}
```

These are invariants, not snapshots: no updating when a colour changes, red exactly when something overflows. All twelve share one app launch.

- [ ] **Step 3: Test both sides of both breakpoints**

```ts
test('the sidebar collapses at exactly 1000px', async () => {
  await window.setViewportSize({ width: 999, height: 800 })
  expect(await sidebarWidth()).toBe(48)
  await window.setViewportSize({ width: 1001, height: 800 })
  expect(await sidebarWidth()).toBeGreaterThan(200)
})

test('the inspector overlays at exactly 1100px', async () => {
  await openInspector()
  await window.setViewportSize({ width: 1099, height: 800 })
  expect(await inspectorPosition()).toBe('absolute')
  await window.setViewportSize({ width: 1101, height: 800 })
  expect(await inspectorPosition()).toBe('static')
})
```

Off-by-one breakpoint errors are the classic failure here, and only a both-sides assertion catches them.

- [ ] **Step 4: Test that the terminal really re-fits**

```ts
test('resizing the drawer changes the terminal geometry', async () => {
  const before = await window.evaluate(() => window.__termif_test_cols())
  await dragDrawerHandle(-150)
  const after = await window.evaluate(() => window.__termif_test_cols())
  expect(after.rows).toBeLessThan(before.rows)
})
```

Expose `__termif_test_cols` from `TerminalPane` only when `process.env.NODE_ENV === 'test'`.

- [ ] **Step 5: Capture screenshots for human review**

One PNG per width into `test-results/`. **No pixel-diff baselines** — the 2026-08-28 spec §8 records that a broad e2e suite is maintenance debt, and an image baseline goes red on every one-pixel colour change, which teaches people to click "update baseline" without looking.

- [ ] **Step 6: Run it**

Run: `cd apps/desktop && npm run e2e`
Expected: all layout tests pass against the hostile fixture.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/e2e apps/desktop/playwright.config.ts
git commit -m "test(desktop): assert layout invariants at six widths on real Electron"
```

---

### Task 15: Close the record

- [ ] **Step 1: Re-run everything**

```bash
cd packages/core && npm test
cd ../../apps/desktop && npm test && npm run typecheck && npm run e2e
```

- [ ] **Step 2: Check for leftovers**

```bash
grep -rn "HostForm\|layout.tab.terminals\|--sidebar-width\|--titlebar-height" \
  apps/desktop/src packages/core/src
```

Expected: no hits. Remove the two compatibility aliases added in Task 1 Step 3.

- [ ] **Step 3: Update the plan index**

Mark Plan 8 complete in `docs/superpowers/README.md` with the real test counts.

- [ ] **Step 4: Record the measurements**

Append to this file: final test count, the number of widths covered, and any spec section that turned out wrong in practice. The next plan's estimates are only as good as this note.

- [ ] **Step 5: Commit**

```bash
git add docs apps packages
git commit -m "docs: close out the desktop layout plan"
```

---

## Risks

1. **The `ResizeObserver` loop (Task 6).** `fit()` resizes the element the observer watches. The unchanged-size guard and the 100ms throttle are both load-bearing. The symptom is a pegged CPU, not a visual bug, so no screenshot review will find it.
2. **`webUtils.getPathForFile` (Task 11).** A wrong preload bridge means drag-and-drop fails silently — no error, no upload. Only the e2e drop test proves it.
3. **Container queries.** `@container` needs `container-type: inline-size` on `.shell`, and a container query cannot read the container it is declared on. If the rail never appears, this is why.
4. **Two token sets double the review surface (Task 13).** The contrast test over both palettes is the only thing stopping the Windows set from rotting.
5. **Debounced save writing bad rows (Task 9).** The validity gate must run inside the debounce, not before it. A check that runs first still writes stale invalid state.
6. **Schema version 3 (Task 8).** Additive `ALTER TABLE`, so unlike Plan 6's version 2 it destroys nothing — but it must land before Plan 7's live acceptance run, or that run tests a schema nobody ships.
