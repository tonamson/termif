# Main Panel Switching (terminal-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bottom drawer with three exclusive main panels — Terminal (default), Files, Forwards — switched from the titlebar, so the app always opens on the terminal and SFTP is a real full-height panel.

**Architecture:** The main area becomes a one-row grid hosting at most one panel at a time; the selected panel is React state in `MainLayout` (never persisted). Terminal panes stay mounted and are hidden with the `hidden` attribute so sessions and scrollback survive switches; a zero-size guard keeps xterm's fit from collapsing while hidden. The Playwright geometry tier that Plan 8 promised but never built is delivered as the regression net.

**Tech Stack:** React 18, CSS Grid, Vitest + jsdom (logic), Playwright + `_electron.launch` (geometry), @xterm/addon-fit.

**Spec:** [`docs/superpowers/specs/2026-08-30-termif-main-panels.md`](../specs/2026-08-30-termif-main-panels.md)

## Global Constraints

- Launch state is Terminal, always; the selected panel is never persisted (spec §3.2).
- `drawerTab`, `drawerHeight`, `Drawer.tsx`, `.drawer*` CSS, ⌘J are deleted (spec §2, §3.7).
- All terminal panes stay mounted across panel switches; hiding uses the `hidden` attribute (spec §3.4).
- The panel Escape handler lives on the panel section, never on `window` (spec §3.6).
- No change to `packages/core` beyond the two i18n strings in Task 2 (spec §7).
- Commands run from `apps/desktop/` unless noted: `npm run typecheck`, `npm test` (vitest), `npm run e2e -- <spec>`. Core suite: `npm test` from `packages/core/`.
- The working tree currently holds uncommitted dual-pane SFTP work; Task 1 lands it before anything else.

---

### Task 1: Land the uncommitted dual-pane SFTP work on a green suite

The tree has uncommitted work from a previous session: dual-pane `SftpBrowser.tsx` (local/remote), new `localStore.ts`, `app.localList`/`app.localHome`/`app.pickSaveLocation` IPC in `handlers.ts`/`preload/index.ts`/`shared/ipc.ts`, a `TerminalTabs.tsx` overflow fix, plus tests (`localStore.test.ts`, `TerminalTabs.test.tsx`, updated `SftpBrowser.test.tsx`) and i18n strings. This plan builds on it, so it becomes a commit first.

**Files:**
- Commit as-is: `apps/desktop/src/main/handlers.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/renderer/state/localStore.ts`, `apps/desktop/src/renderer/views/SftpBrowser.tsx`, `apps/desktop/src/renderer/views/TerminalTabs.tsx`, `apps/desktop/src/renderer/styles/app.css`, `apps/desktop/test/renderer/SftpBrowser.test.tsx`, `apps/desktop/test/renderer/TerminalTabs.test.tsx`, `apps/desktop/test/renderer/localStore.test.ts`, `packages/core/src/i18n/en.ts`

**Interfaces:**
- Produces: `SftpBrowser` (`{ app }`) rendering `.sftp-panes` with two panes; `createLocalStore({ list, sep })` from `state/localStore.js`; `window.termif.app.localList(path)`, `localHome()`, `pickSaveLocation(name)` — all consumed by later tasks only through `SftpBrowser`, unchanged.

- [x] **Step 1: Run the desktop suite and typecheck**

```bash
cd apps/desktop && npm run typecheck && npm test
```

Expected: all green. If a WIP test is red, fix the WIP code (not the test's intent) until green — the dual-pane work shipped with its tests, so a red means an incomplete edit somewhere in the listed files.

- [x] **Step 2: Run the core suite (i18n strings changed)**

```bash
cd packages/core && npm test
```

Expected: all green.

- [x] **Step 3: Commit**

```bash
git add apps/desktop/src apps/desktop/test packages/core/src/i18n/en.ts
git commit -m "feat(desktop): dual-pane sftp browser (local + remote)"
```

---

### Task 2: Three exclusive panels — the core fix

One compile unit: `Titlebar` gains a Terminal button and `MainPanel` type; `MainLayout` holds `panel` state and renders one `<section class="panel">` at a time (terminal hidden, not unmounted); `prefs.ts` loses the drawer keys; `Drawer.tsx`, its test, `.drawer*` CSS and ⌘J are deleted. The failing test below reproduces the owner's bug report at the logic tier before the fix.

**Files:**
- Modify: `apps/desktop/src/renderer/views/Titlebar.tsx` (whole file)
- Modify: `apps/desktop/src/renderer/app/MainLayout.tsx`
- Modify: `apps/desktop/src/renderer/state/prefs.ts:1-61`
- Modify: `apps/desktop/test/renderer/prefs.test.ts`
- Modify: `apps/desktop/test/renderer/Titlebar.test.tsx` (rename `drawerTab` props to `panel`)
- Delete: `apps/desktop/src/renderer/views/Drawer.tsx`
- Delete: `apps/desktop/test/renderer/drawer.test.tsx`
- Create: `apps/desktop/test/renderer/panels.test.tsx`
- Modify: `apps/desktop/src/renderer/styles/app.css:105-131` (grid row + `.panel`, delete `.drawer*` rules)
- Modify: `packages/core/src/i18n/en.ts` (two strings near line 132)

**Interfaces:**
- Produces: `export type MainPanel = 'terminal' | 'files' | 'forwards'` from `views/Titlebar.tsx`; `TitlebarProps { panel: MainPanel; onPanel(p: MainPanel): void; inspectorOpen: boolean; onInspector(open: boolean): void }`; DOM contract `section.panel[data-panel="terminal"|"files"|"forwards"]`, terminal gets `hidden` when inactive.
- Consumes: Task 1's `SftpBrowser { app }`; existing `ForwardPanel { app }`, `TerminalTabs { app }`.

- [x] **Step 1: Write the failing tests**

Create `apps/desktop/test/renderer/panels.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MainLayout } from '../../src/renderer/app/MainLayout.js'
import { bootApp } from '../../src/renderer/state/boot.js'
import { fakePlatform } from './fakes/platform.js'

vi.mock('../../src/renderer/state/connectFlow.js', () => ({
  useConnectFlow: () => ({ start: vi.fn().mockResolvedValue(undefined), lastError: null, prompt: null }),
}))

async function boot() {
  const platform = await fakePlatform()
  return bootApp(platform)
}

function fakeSessions() {
  return {
    hostStates: () => new Map(),
    onSessionState: () => () => {},
    onTabClosed: () => () => {},
    connectedHostIds: () => [],
    openSessionIds: () => [],
  } as any
}

describe('MainLayout panels', () => {
  it('launches on the terminal panel with no files panel in the DOM', async () => {
    const app = await boot()
    ;(app as any).sessions = fakeSessions()
    render(<MainLayout app={app} />)

    expect(screen.getByRole('tab', { name: /terminal/i })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-panel="terminal"]')).not.toHaveAttribute('hidden')
    expect(document.querySelector('[data-panel="files"]')).toBeNull()
    expect(document.querySelector('.drawer')).toBeNull()
  })

  it('files panel replaces the terminal view; terminal stays mounted and hidden', async () => {
    const app = await boot()
    ;(app as any).sessions = fakeSessions()
    render(<MainLayout app={app} />)

    await userEvent.click(screen.getByRole('tab', { name: /files/i }))

    expect(screen.getByText(/Connect to a host to browse/i)).toBeInTheDocument()
    expect(document.querySelector('[data-panel="terminal"]')).toHaveAttribute('hidden')
  })

  it('Escape inside the files panel returns to the terminal', async () => {
    const app = await boot()
    ;(app as any).sessions = fakeSessions()
    render(<MainLayout app={app} />)

    await userEvent.click(screen.getByRole('tab', { name: /files/i }))
    const files = document.querySelector('[data-panel="files"]')!
    files.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(document.querySelector('[data-panel="files"]')).toBeNull()
    expect(document.querySelector('[data-panel="terminal"]')).not.toHaveAttribute('hidden')
  })

  it('connecting a host switches to the terminal panel before starting', async () => {
    const app = await boot()
    ;(app as any).sessions = fakeSessions()
    await app.store.upsertHost({ label: 'web-1', hostname: 'web1.example.com', port: 22, username: 'deploy', authRef: null, tags: [], groupId: null })
    render(<MainLayout app={app} />)
    await screen.findByText('web-1')

    await userEvent.click(screen.getByRole('tab', { name: /files/i }))
    // HostList's connect button is `aria-label={t('host.connect')}` → "Connect".
    await userEvent.click(screen.getByRole('button', { name: /^connect$/i }))

    expect(document.querySelector('[data-panel="files"]')).toBeNull()
    expect(document.querySelector('[data-panel="terminal"]')).not.toHaveAttribute('hidden')
  })
})
```

Note: the host fields mirror `mainLayoutStatus.test.tsx:13-21`; the connect button's accessible name is exactly `t('host.connect')` — "Connect" (`HostList.tsx:114`, `en.ts:89`).

- [x] **Step 2: Run to verify the tests fail**

```bash
cd apps/desktop && npx vitest run test/renderer/panels.test.tsx
```

Expected: FAIL — no `layout.tab.terminal` key, no `[data-panel]` sections, drawer still present.

- [x] **Step 3: Implement**

`packages/core/src/i18n/en.ts`, next to `layout.tab.files` (line ~132):

```ts
  'layout.tab.terminal': 'terminal',
  'layout.panels': 'Main panels',
```

`apps/desktop/src/renderer/views/Titlebar.tsx`, whole file:

```tsx
import { t } from '@termif/core'

export type MainPanel = 'terminal' | 'files' | 'forwards'

export interface TitlebarProps {
  panel: MainPanel
  onPanel(panel: MainPanel): void
  inspectorOpen: boolean
  onInspector(open: boolean): void
}

export function Titlebar({ panel, onPanel, inspectorOpen, onInspector }: TitlebarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar__panes" role="tablist" aria-label={t('layout.panels')}>
        {(['terminal', 'files', 'forwards'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={panel === name}
            onClick={() => onPanel(name)}
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

The old `DrawerTab`/`Pane` exports die with this file.

`apps/desktop/src/renderer/app/MainLayout.tsx` — replace the `editing !== null ? ... : <>` main-area block and wire state. The changed pieces:

```tsx
import { t } from '@termif/core'
import type { MainPanel } from '../views/Titlebar.js'
// Drawer import deleted; SftpBrowser/ForwardPanel imports stay

export function MainLayout({ app }: { app: App }) {
  // ...existing hooks...
  const [panel, setPanel] = useState<MainPanel>('terminal')
  const returnOnEsc = (event: import('react').KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') setPanel('terminal')
  }
  // ⌘J branch DELETED from the existing onKey effect — ⌘N stays.
  // ...connect flow unchanged...
```

```tsx
      <Titlebar
        panel={panel}
        onPanel={setPanel}
        inspectorOpen={prefs.inspectorOpen}
        onInspector={(open) => app.prefs.set('inspectorOpen', open)}
      />
```

```tsx
        <main className="layout__main">
          {editing !== null ? (
            <HostForm /* unchanged */ />
          ) : (
            <>
              <section className="panel" data-panel="terminal" hidden={panel !== 'terminal'}>
                <TerminalTabs app={app} />
              </section>
              {panel === 'files' && (
                <section className="panel" data-panel="files" onKeyDown={returnOnEsc}>
                  <SftpBrowser app={app} />
                </section>
              )}
              {panel === 'forwards' && (
                <section className="panel" data-panel="forwards" onKeyDown={returnOnEsc}>
                  <ForwardPanel app={app} />
                </section>
              )}
            </>
          )}
        </main>
```

Host row wiring becomes:

```tsx
            onConnect={(id) => {
              setPanel('terminal')
              void connect.start(id)
            }}
```

`apps/desktop/src/renderer/state/prefs.ts` — `UiPrefs` loses `drawerTab` and `drawerHeight`; `DEFAULT_PREFS` and `sanitise()` drop them accordingly. Resulting shape:

```ts
export interface UiPrefs {
  sidebarWidth: number
  collapsedGroups: string[]
  showHidden: boolean
  inspectorOpen: boolean
}

export const DEFAULT_PREFS: UiPrefs = {
  sidebarWidth: 260,
  collapsedGroups: [],
  showHidden: false,
  inspectorOpen: false,
}
```

and in `sanitise()` delete the `drawerHeight` and `drawerTab` branches (stale keys in an existing `ui.prefs` blob are then ignored — that is the migration).

`apps/desktop/src/renderer/styles/app.css` — replace lines 105-131 with:

```css
.layout__main {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  background: var(--bg-app);
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.panel[hidden] { display: none; }
```

Delete the `.drawer`, `.drawer__handle`, `.drawer__handle:hover`, `.drawer__body`, `.drawer__empty` rules. Leave `.titlebar`/`.titlebar__panes` as they are.

Delete `apps/desktop/src/renderer/views/Drawer.tsx` and `apps/desktop/test/renderer/drawer.test.tsx`. Update `Titlebar.test.tsx` and `prefs.test.ts` to the new prop/shape names (mechanical rename; in `prefs.test.ts` add one case: a raw blob containing `drawerTab: 'files'` sanitises to an object without it).

- [x] **Step 4: Run the full desktop suite and typecheck**

```bash
cd apps/desktop && npm run typecheck && npm test
```

Expected: PASS, including the four new panel tests. If `e2e/screenshots.spec.ts` semantics worry you — it clicks `role=tab name=/files/i`, which still exists; no change needed.

- [x] **Step 5: Run core suite (i18n changed) and commit**

```bash
cd packages/core && npm test && cd ../../apps/desktop
git add apps/desktop packages/core
git commit -m "fix(desktop): terminal-first exclusive main panels replace the drawer"
```

---

### Task 3: Zero-size fit guard in TerminalPane

A hidden panel measures 0×0; `FitAddon.fit()` on that collapses the terminal. Bail before fitting (spec §3.5).

**Files:**
- Modify: `apps/desktop/src/renderer/views/TerminalPane.tsx` (the `refit` closure, ~line 75)
- Test: `apps/desktop/test/renderer/TerminalPane.test.tsx`

**Interfaces:**
- Consumes: existing `ResizeObserverStub` in `apps/desktop/test/setup.ts` (static `instances`, fire `callback([])`).
- Produces: no API change; behavior only.

- [x] **Step 1: Write the failing tests**

The existing TerminalPane tests never fire the ResizeObserver (only the
terminal-level `onResize`), and the mocked `FitAddon` instances are not
recorded anywhere — so first give the mock a static recorder. In
`apps/desktop/test/renderer/TerminalPane.test.tsx`, change the FitAddon mock:

```tsx
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    static instances: { fit: ReturnType<typeof vi.fn> }[] = []
    fit = vi.fn()
    dispose = vi.fn()
    constructor() {
      FitAddon.instances.push(this as never)
    }
  },
}))
```

Then add two tests beside the existing resize test. The observed element is
the pane's container div (`TerminalPane.tsx:124`, class `terminal-pane`);
the stub fires via `ResizeObserverStub.fire()` (`test/setup.ts:20`):

```tsx
async function fireObserver(): Promise<void> {
  const stub = (globalThis as { ResizeObserverStub: { instances: { fire(): void }[] } })
    .ResizeObserverStub.instances.at(-1)!
  stub.fire()
}

it('does not fit while the container measures 0x0 (hidden panel)', async () => {
  const sessions = makeSessions()
  render(<TerminalPane tabId="t1" sessions={sessions as never} active />)
  vi.spyOn(document.querySelector('.terminal-pane')!, 'getBoundingClientRect')
    .mockReturnValue({ width: 0, height: 0 } as DOMRect)

  await fireObserver()
  // The refit throttle is 100ms; give it room to have fired if it were going to.
  await new Promise((resolve) => setTimeout(resolve, 250))

  expect(FitAddon.instances.at(-1)!.fit).not.toHaveBeenCalled()
})

it('still fits at a real size', async () => {
  const sessions = makeSessions()
  render(<TerminalPane tabId="t1" sessions={sessions as never} active />)
  vi.spyOn(document.querySelector('.terminal-pane')!, 'getBoundingClientRect')
    .mockReturnValue({ width: 800, height: 600 } as DOMRect)

  await fireObserver()
  await waitFor(() => expect(FitAddon.instances.at(-1)!.fit).toHaveBeenCalled())
})
```

`FitAddon` must be imported from `@xterm/addon-fit` at the top of the test
file so the static recorder is reachable.

- [x] **Step 2: Run to verify failure**

```bash
cd apps/desktop && npx vitest run test/renderer/TerminalPane.test.tsx
```

Expected: the 0×0 test FAILS (fit is called today); the real-size test passes.

- [x] **Step 3: Implement the guard**

In `TerminalPane.tsx`, top of the `refit` closure:

```ts
    const refit = (): void => {
      const box = element.getBoundingClientRect()
      // A hidden panel reports 0×0; fitting then would collapse the terminal
      // to zero rows. The ResizeObserver fires again when the panel returns.
      if (box.width === 0 || box.height === 0) return
      try {
        fitAddon.fit()
      } catch {
        return
      }
      // ...existing unchanged-dims guard...
```

- [x] **Step 4: Run the full desktop suite**

```bash
cd apps/desktop && npm run typecheck && npm test
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/views/TerminalPane.tsx apps/desktop/test/renderer/TerminalPane.test.tsx
git commit -m "fix(desktop): terminal refit bails on zero-size containers"
```

---

### Task 4: Stop the resize oscillation (the "flash scroll" bug)

Measured 2026-08-30 (spec §6): once a session is open the document scrollbar
toggles and the terminal re-fits forever — 28.5 ResizeObserver callbacks/s,
`scrollHeight 804 > clientHeight 790`; with the fix, 0.0/s and no overflow.
Root cause: `.terminal-pane` does not clip xterm's canvas and `body` does not
forbid document scrolling, so every fit's few-pixel height change toggles the
page scrollbar, which re-lays-out the terminal, which re-fits. The fix is the
driver, not a smarter guard. The failing test lives in the e2e tier because
jsdom cannot lay out.

**Files:**
- Create: `apps/desktop/e2e/oscillation.spec.ts`
- Modify: `apps/desktop/src/renderer/styles/base.css:7-12` (the `html, body, #root` block)
- Modify: `apps/desktop/src/renderer/styles/app.css:339-343` (`.terminal-pane`)

**Interfaces:**
- Consumes: docker test sshd on `127.0.0.1:22022` (`termif` / `termif-test-pw`, `docker-compose.test.yml`), the launch + seed + trust flow from `e2e/status.spec.ts:40-72`.
- Produces: the standing oscillation invariant CI runs via `npm run e2e`.

- [x] **Step 1: Write the failing test**

Create `apps/desktop/e2e/oscillation.spec.ts`:

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Main-panels spec §6: the document never scrolls and the terminal never
    oscillates. Fails at ~171 RO callbacks / 6 s and scrollHeight 804 > 790
    before the fix; bounded and clean after. */

async function launch(userData: string) {
  return electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  })
}

test('no document overflow, no resize loop once a session is open', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-osc-'))
  const app = await launch(userData)
  try {
    // Wrap ResizeObserver before any page script runs so every callback —
    // ours and xterm's internal ones — is counted.
    await app.context().addInitScript(() => {
      ;(window as unknown as { __roCount: number }).__roCount = 0
      const Orig = window.ResizeObserver
      window.ResizeObserver = class extends Orig {
        constructor(cb: ResizeObserverCallback) {
          super((entries, obs) => {
            ;(window as unknown as { __roCount: number }).__roCount++
            return cb(entries, obs)
          })
        }
      }
    })
    const window = await app.firstWindow()

    await window.getByRole('button', { name: /add host/i }).click()
    await window.locator('#host-label').fill('osc-test')
    await window.locator('#host-hostname').fill('127.0.0.1')
    await window.locator('#host-port').fill('22022')
    await window.locator('#host-username').fill('termif')
    await window.locator('#host-password').fill('termif-test-pw')
    await window.getByRole('button', { name: /^save$/i }).click()

    // Skip gracefully when the test sshd is not running.
    const reachable = await new Promise<boolean>((resolve) => {
      import('node:net').then(({ createConnection }) => {
        const socket = createConnection({ host: '127.0.0.1', port: 22022 }, () => {
          socket.end()
          resolve(true)
        })
        socket.on('error', () => resolve(false))
      })
    })
    test.skip(!reachable, 'docker test sshd (127.0.0.1:22022) is not running')

    await window.getByText('osc-test').waitFor()
    await window.getByRole('button', { name: /connect/i }).first().click()
    const trust = window.getByRole('button', { name: /trust and connect/i })
    await trust.waitFor({ timeout: 8000 })
    await trust.click()
    await window.locator('.terminal-tabs__tab').first().waitFor({ timeout: 20000 })
    await window.waitForTimeout(3000) // let the shell settle after the prompt

    const before = await window.evaluate(() => (window as unknown as { __roCount: number }).__roCount)
    await window.waitForTimeout(6000)
    const after = await window.evaluate(() => (window as unknown as { __roCount: number }).__roCount)
    const overflow = await window.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      sh: document.documentElement.scrollHeight,
      ch: document.documentElement.clientHeight,
    }))

    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw)
    expect(overflow.sh).toBeLessThanOrEqual(overflow.ch)
    expect(after - before).toBeLessThanOrEqual(10)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
```

- [x] **Step 2: Run it to verify it fails**

```bash
cd apps/desktop && npm run e2e -- oscillation
```

Expected: FAIL — `expect(overflow.sh).toBeLessThanOrEqual(overflow.ch)` (804 > 790) and/or the RO count (~170) above the bound. Skips offline.

- [x] **Step 3: Apply the two-line fix**

`apps/desktop/src/renderer/styles/base.css` — extend the existing block:

```css
html,
body,
#root {
  height: 100%;
  margin: 0;
}

/* A fixed-viewport desktop shell: content never scrolls the document, so no
   content change can resize the layout viewport (main-panels spec §6). */
html,
body {
  overflow: hidden;
}
```

`apps/desktop/src/renderer/styles/app.css` — the `.terminal-pane` rule:

```css
.terminal-pane {
  position: absolute;
  inset: 0;
  padding: var(--space-2);
  overflow: hidden;
}
```

- [x] **Step 4: Run the oscillation spec, then the whole suite**

```bash
cd apps/desktop && npm run e2e -- oscillation && npm run e2e && npm test
```

Expected: oscillation PASS (≤ 10 callbacks, no overflow); all other e2e and vitest suites PASS.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/e2e/oscillation.spec.ts apps/desktop/src/renderer/styles
git commit -m "fix(desktop): clip terminal overflow, kill document scrollbar oscillation"
```

---

### Task 5: The real geometry tier — rewrite e2e/layout.spec.ts

Plan 8's architecture promised this tier; the placeholder `test.skip`s itself (`e2e/layout.spec.ts:7`) — that is how Task 2's inversion class stayed invisible. Replace it with real assertions using the harness shape already proven by `e2e/smoke.spec.ts`. Written against the post-Task-2 code, all four tests pass; if run against pre-Task-2 code they fail — that is the tier working.

**Files:**
- Rewrite: `apps/desktop/e2e/layout.spec.ts` (whole file)

**Interfaces:**
- Consumes: `_electron.launch` pattern from `e2e/smoke.spec.ts:10-17`; docker test sshd on `127.0.0.1:22022` and its skip-if-offline gate from `e2e/status.spec.ts`.
- Produces: the standing geometry invariant suite CI runs via `npm run e2e`.

- [x] **Step 1: Rewrite the spec**

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Geometry invariants for the three exclusive main panels (main-panels spec §6.2). */

async function launch(userData: string) {
  return electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  })
}

test('terminal fills the main column at launch; no drawer exists', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-layout-'))
  try {
    const app = await launch(userData)
    const window = await app.firstWindow()

    const main = window.locator('.layout__main')
    const terminal = window.locator('[data-panel="terminal"]')
    await expect(terminal).toBeVisible()
    const mainBox = (await main.boundingBox())!
    const termBox = (await terminal.boundingBox())!
    expect(termBox.height).toBeGreaterThanOrEqual(mainBox.height * 0.8)
    expect(await window.locator('.drawer').count()).toBe(0)
    await app.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('files panel is full-height and hides the terminal', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-layout-'))
  try {
    const app = await launch(userData)
    const window = await app.firstWindow()

    await window.getByRole('tab', { name: /files/i }).click()
    const files = window.locator('[data-panel="files"]')
    await expect(files).toBeVisible()
    const mainBox = (await window.locator('.layout__main').boundingBox())!
    const filesBox = (await files.boundingBox())!
    expect(filesBox.height).toBeGreaterThanOrEqual(mainBox.height * 0.8)
    await expect(window.locator('[data-panel="terminal"]')).toBeHidden()
    await app.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('returning to the terminal panel shows it again', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-layout-'))
  try {
    const app = await launch(userData)
    const window = await app.firstWindow()

    await window.getByRole('tab', { name: /files/i }).click()
    await window.getByRole('tab', { name: /terminal/i }).click()
    await expect(window.locator('[data-panel="terminal"]')).toBeVisible()
    await expect(window.locator('[data-panel="files"]')).toHaveCount(0)
    await app.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a connected session survives a files round-trip', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-layout-'))
  try {
    const app = await launch(userData)
    const window = await app.firstWindow()

    // Add the docker test host the way status.spec.ts seeds it.
    await window.getByRole('button', { name: /Add host/i }).click()
    await window.locator('#host-label').fill('layout-sshd')
    await window.locator('#host-hostname').fill('127.0.0.1')
    await window.locator('#host-port').fill('22022')
    await window.locator('#host-username').fill('tester')
    await window.locator('#host-password').fill('tester')
    await window.getByRole('button', { name: /^Save$/i }).click()

    // Skip gracefully when the test sshd is not running.
    let reachable = false
    try {
      const net = await import('node:net')
      reachable = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port: 22022 }, () => {
          socket.end()
          resolve(true)
        })
        socket.on('error', () => resolve(false))
      })
    } catch {
      reachable = false
    }
    test.skip(!reachable, 'docker test sshd (127.0.0.1:22022) is not running')

    await window.getByText('layout-sshd').dblclick()
    await expect(window.locator('[data-panel="terminal"] .terminal-tabs__tab')).toBeVisible({ timeout: 30_000 })

    await window.getByRole('tab', { name: /files/i }).click()
    await expect(window.locator('[data-panel="files"]')).toBeVisible()
    // Esc returns; the connected tab is still there.
    await window.locator('[data-panel="files"]').press('Escape')
    await expect(window.locator('[data-panel="terminal"] .terminal-tabs__tab')).toBeVisible()
    await app.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})
```

The `#host-*` field ids and the connect gesture (double-click) mirror `e2e/smoke.spec.ts` / the sidebar's existing behavior — verify the exact selectors against those files when the test runs and adjust to what is really in the DOM, not the other way around.

- [x] **Step 2: Run the layout spec**

```bash
cd apps/desktop && npm run e2e -- layout
```

Expected: 3 pass; the sshd test passes if `127.0.0.1:22022` is up (`nc -z 127.0.0.1 22022`), else skips.

- [x] **Step 3: Run the whole e2e suite (nothing else regressed)**

```bash
npm run e2e
```

Expected: PASS including `smoke`, `status`, `screenshots`.

- [x] **Step 4: Commit**

```bash
git add apps/desktop/e2e/layout.spec.ts
git commit -m "test(desktop): real geometry tier for main panels (pays Plan 8 e2e debt)"
```

---

### Task 6: Docs and release 0.1.7

**Files:**
- Modify: `docs/superpowers/README.md` (plan table + owed-work note)
- Modify: `apps/desktop/package.json` (`"version": "0.1.7"`)

**Interfaces:**
- Produces: the README row future sessions read; release bump matching the repo's per-fix versioning (0.1.6 → 0.1.7).

- [x] **Step 1: Update the README index**

In `docs/superpowers/README.md`, add to the plan table:

```markdown
| 13 | [`plans/2026-08-30-termif-13-main-panels.md`](plans/2026-08-30-termif-13-main-panels.md) — terminal-first exclusive main panels, SFTP via titlebar, real geometry tier | 5 | not started, unblocks on nothing | — |
```

and after completion update Status to `**complete (date)** — panels + geometry tier, N tests green, 0.1.7`. In "Work still owed", note: main-panels spec supersedes the drawer paragraphs of the layout spec §5; drawer, ⌘J and `drawer.height`/`drawerTab` prefs are deleted.

- [x] **Step 2: Bump the version**

`apps/desktop/package.json`: `"version": "0.1.6"` → `"0.1.7"`.

- [x] **Step 3: Full verification, then commit**

```bash
cd packages/core && npm test && cd ../../apps/desktop && npm run typecheck && npm test && npm run e2e
```

Expected: everything green.

```bash
git add docs/superpowers/README.md apps/desktop/package.json
git commit -m "docs+release: main panels plan, version 0.1.7"
```

Tick every `- [ ]` in this plan file and in the spec commit the plan alongside the code per repo convention.
