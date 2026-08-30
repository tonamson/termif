# Termif Desktop Visual Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Electron desktop shell a coherent dark visual design, so the
functionally complete app from Plan 3 stops rendering as unstyled HTML.

**Architecture:** A colour palette lives in TypeScript (`styles/palette.ts`) as
the single source of truth, so it can be unit-tested for WCAG contrast and
reused by the xterm terminal theme. A hand-written `tokens.css` mirrors it,
kept honest by a test that parses the CSS and compares it to the module.
`base.css` styles bare elements and four shared primitives; `app.css` adds one
block per view using the 48 BEM class hooks the views already carry. Four
targeted markup changes fix the information architecture the spec names.

**Tech Stack:** Plain CSS custom properties, React 18, electron-vite, Vitest +
jsdom + Testing Library, Playwright for Electron.

**Spec:** [`../specs/2026-08-30-termif-desktop-visual-design.md`](../specs/2026-08-30-termif-desktop-visual-design.md)

## Global Constraints

- **No new runtime dependency.** Not for CSS, not for icons, not for fonts.
  `package.json` `dependencies` must be unchanged at the end of this plan.
- **CSP is not widened.** `apps/desktop/src/renderer/index.html` keeps
  `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`.
  No remote fonts, no remote images, no `url()` pointing outside the bundle.
- **Dark theme only.** No `prefers-color-scheme` block, no theme toggle, no
  second palette.
- **Spacing comes from the scale.** Only `--space-1` (4px) through `--space-6`
  (32px). No arbitrary pixel values for margin, padding, or gap.
- **Two radii only:** `--radius-sm` (4px) and `--radius-md` (8px).
- **Two colours of motion only:** a `--motion-fast` (120ms ease) colour
  transition and one shared pulse. Both disabled under
  `@media (prefers-reduced-motion: reduce)`.
- **Contrast:** every foreground/background pair used for text meets WCAG AA —
  4.5:1 for body text, 3:1 for large text and meaningful UI borders.
- **Class hooks are not renamed.** The 48 existing BEM class names in the views
  stay exactly as they are. New CSS attaches to them.
- **`aria-*` and `role` attributes are preserved verbatim** through every
  markup change, or the 184 existing tests lose their grip on the UI.
- All commands run from `apps/desktop/` unless stated otherwise.
- Full suite command: `npm test` — must stay green (184 tests) after every task.

---

### Task 1: Palette module, contrast test, and tokens

The palette is TypeScript, not CSS, because a CSS file cannot be unit-tested
and the xterm terminal theme needs the same values as an object anyway. The
CSS file mirrors it and a test enforces the mirror.

**Files:**
- Create: `apps/desktop/src/renderer/styles/palette.ts`
- Create: `apps/desktop/src/renderer/styles/tokens.css`
- Test: `apps/desktop/test/renderer/palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const palette: { readonly [K in PaletteKey]: string }` where
    `PaletteKey` is a union of the token names below without the `--` prefix,
    in camelCase: `bgApp`, `bgSurface`, `bgRaised`, `bgOverlay`, `fg`,
    `fgMuted`, `fgSubtle`, `accent`, `accentFg`, `ok`, `warn`, `danger`,
    `border`, `borderStrong`.
  - `export const ansi: readonly [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]`
    — the 16 ANSI colours, in xterm order: black, red, green, yellow, blue,
    magenta, cyan, white, then the eight bright variants.
  - `export function contrastRatio(a: string, b: string): number` — WCAG 2.1
    relative-luminance ratio between two `#rrggbb` strings, returning a number
    between 1 and 21.

- [ ] **Step 1: Write the failing contrast test**

Create `apps/desktop/test/renderer/palette.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ansi, contrastRatio, palette } from '../../src/renderer/styles/palette.js'

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('returns 1 for a colour against itself', () => {
    expect(contrastRatio('#4c8dff', '#4c8dff')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#e6edf3', '#0d1117')).toBeCloseTo(
      contrastRatio('#0d1117', '#e6edf3'),
      5,
    )
  })
})

describe('palette contrast', () => {
  const backgrounds = ['bgApp', 'bgSurface', 'bgRaised', 'bgOverlay'] as const

  // Body text must be readable on every surface it can land on.
  for (const bg of backgrounds) {
    for (const fg of ['fg', 'fgMuted'] as const) {
      it(`${fg} on ${bg} meets AA for body text`, () => {
        expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  // Subtle text is placeholders and resting icons: large-text AA is the floor.
  for (const bg of backgrounds) {
    it(`fgSubtle on ${bg} meets AA for large text`, () => {
      expect(contrastRatio(palette.fgSubtle, palette[bg])).toBeGreaterThanOrEqual(3)
    })
  }

  // Focus rings and state dots must be distinguishable as UI, per WCAG 1.4.11.
  for (const key of ['accent', 'ok', 'warn', 'danger'] as const) {
    it(`${key} is a discernible UI colour on bgApp and bgRaised`, () => {
      expect(contrastRatio(palette[key], palette.bgApp)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(palette[key], palette.bgRaised)).toBeGreaterThanOrEqual(3)
    })
  }

  it('accentFg is readable on an accent fill', () => {
    expect(contrastRatio(palette.accentFg, palette.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('has 16 ANSI colours, all legible on the terminal ground', () => {
    expect(ansi).toHaveLength(16)
    // ANSI black is the exception: it is a background colour by convention.
    for (const colour of ansi.slice(1)) {
      expect(contrastRatio(colour, palette.bgApp)).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('tokens.css mirrors the palette', () => {
  const css = readFileSync(
    join(__dirname, '../../src/renderer/styles/tokens.css'),
    'utf8',
  )

  // camelCase key -> --kebab-case custom property.
  const toVar = (key: string): string =>
    `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

  for (const [key, value] of Object.entries(palette)) {
    it(`defines ${toVar(key)} as ${value}`, () => {
      expect(css).toContain(`${toVar(key)}: ${value};`)
    })
  }

  it('defines the full space scale and both radii', () => {
    for (const [name, value] of [
      ['--space-1', '4px'],
      ['--space-2', '8px'],
      ['--space-3', '12px'],
      ['--space-4', '16px'],
      ['--space-5', '24px'],
      ['--space-6', '32px'],
      ['--radius-sm', '4px'],
      ['--radius-md', '8px'],
    ]) {
      expect(css).toContain(`${name}: ${value};`)
    }
  })

  it('declares no light-theme block', () => {
    expect(css).not.toContain('prefers-color-scheme')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/renderer/palette.test.ts`
Expected: FAIL — cannot resolve `../../src/renderer/styles/palette.js`.

- [ ] **Step 3: Write the palette module**

Create `apps/desktop/src/renderer/styles/palette.ts`:

```ts
/**
 * The single source of truth for colour. `tokens.css` mirrors these values for
 * CSS, and `terminalTheme.ts` reshapes them for xterm; a test in
 * `test/renderer/palette.test.ts` keeps the mirror honest and checks every
 * pair against WCAG AA.
 */
export const palette = {
  // Four background levels. Depth reads as lightness, not as borders.
  bgApp: '#0d1117',
  bgSurface: '#12171f',
  bgRaised: '#1b222c',
  bgOverlay: '#212a35',

  // Three foreground levels.
  fg: '#e6edf3',
  fgMuted: '#a7b3c0',
  fgSubtle: '#8b98a6',

  // One accent, for focus and the primary action.
  accent: '#4c8dff',
  accentFg: '#0d1117',

  // Semantic colours. State only, never decoration.
  ok: '#3fb950',
  warn: '#d29922',
  danger: '#f85149',

  border: '#232c38',
  borderStrong: '#3a4553',
} as const

export type PaletteKey = keyof typeof palette

/** xterm order: 8 normal, then 8 bright. */
export const ansi = [
  '#484f58', '#ff7b72', '#3fb950', '#d29922',
  '#6ca6ff', '#bc8cff', '#39c5cf', '#b1bac4',
  '#6e7681', '#ffa198', '#56d364', '#e3b341',
  '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc',
] as const

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = channel((n >> 16) & 0xff)
  const g = channel((n >> 8) & 0xff)
  const b = channel(n & 0xff)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 relative-luminance contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
```

- [ ] **Step 4: Write tokens.css**

Create `apps/desktop/src/renderer/styles/tokens.css`. Values must match
`palette.ts` exactly, or the mirror test fails:

```css
/* Mirror of src/renderer/styles/palette.ts. Change both together; the test in
   test/renderer/palette.test.ts fails if they drift. */
:root {
  --bg-app: #0d1117;
  --bg-surface: #12171f;
  --bg-raised: #1b222c;
  --bg-overlay: #212a35;

  --fg: #e6edf3;
  --fg-muted: #a7b3c0;
  --fg-subtle: #8b98a6;

  --accent: #4c8dff;
  --accent-fg: #0d1117;

  --ok: #3fb950;
  --warn: #d29922;
  --danger: #f85149;

  --border: #232c38;
  --border-strong: #3a4553;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  --radius-sm: 4px;
  --radius-md: 8px;

  --font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --shadow-overlay: 0 16px 48px rgb(0 0 0 / 0.5);

  --motion-fast: 120ms ease;

  --titlebar-height: 38px;
  --sidebar-width: 260px;
}
```

`--font-mono` is the exact stack already passed to `new Terminal` at
`src/renderer/views/TerminalPane.tsx:31`, so chrome and terminal cannot drift.

- [ ] **Step 5: Run the test until green**

Run: `npx vitest run test/renderer/palette.test.ts`
Expected: PASS. If a contrast assertion fails, adjust the offending colour in
**both** `palette.ts` and `tokens.css` and rerun. Do not lower a threshold.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, 184 prior tests plus the new palette tests.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/styles/palette.ts \
        apps/desktop/src/renderer/styles/tokens.css \
        apps/desktop/test/renderer/palette.test.ts
git commit -m "feat(desktop): add design tokens with WCAG contrast tests"
```

---

### Task 2: Base stylesheet and shared primitives

**Files:**
- Create: `apps/desktop/src/renderer/styles/base.css`
- Create: `apps/desktop/src/renderer/styles/app.css`
- Modify: `apps/desktop/src/renderer/main.tsx` (add the stylesheet import)

**Interfaces:**
- Consumes: the custom properties from `tokens.css` (Task 1).
- Produces: `styles/app.css`, the single stylesheet entry point. Later tasks
  append view blocks to it. Element-level styling for `button`, `input`,
  `select`, `textarea`, `progress`, plus the classes `list-row`, `overlay`,
  and the `[data-variant]` button attribute contract.

- [ ] **Step 1: Write base.css**

Create `apps/desktop/src/renderer/styles/base.css`:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--bg-app);
  color: var(--fg);
  font-family: var(--font-ui);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3 {
  margin: 0;
  font-weight: 600;
}
h1 { font-size: 18px; }
h2 { font-size: 15px; }
h3 { font-size: 13px; }

p { margin: 0; }

ul, ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Focus is functionality here: this app is driven from the keyboard. */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  border-radius: var(--radius-sm);
}
:focus:not(:focus-visible) {
  outline: none;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: var(--radius-sm);
  border: 2px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-track {
  background: transparent;
}

/* --- Primitive: button -------------------------------------------------- */
/* Bare `button` is the ghost style. Variants come from a data attribute so no
   view has to grow a new class name. */
button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 28px;
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  cursor: pointer;
  transition:
    background-color var(--motion-fast),
    border-color var(--motion-fast),
    color var(--motion-fast);
}
button:hover:not(:disabled) {
  background: var(--bg-raised);
  color: var(--fg);
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}

button[data-variant='primary'] {
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}
button[data-variant='primary']:hover:not(:disabled) {
  filter: brightness(1.1);
  background: var(--accent);
  color: var(--accent-fg);
}

button[data-variant='danger'] {
  color: var(--danger);
}
button[data-variant='danger']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 15%, transparent);
  color: var(--danger);
}

/* --- Primitive: fields -------------------------------------------------- */
input,
select,
textarea {
  height: 28px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  color: var(--fg);
  font: inherit;
}
textarea {
  height: auto;
  padding: var(--space-2);
  resize: vertical;
}
input::placeholder,
textarea::placeholder {
  color: var(--fg-subtle);
}
input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}

label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--fg-muted);
}

/* --- Primitive: list row ------------------------------------------------ */
/* Shared by the host list, the SFTP listing, the forward list, and transfers:
   four views, one rule for what a row is. */
.list-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  cursor: default;
  transition: background-color var(--motion-fast);
}
.list-row:hover {
  background: var(--bg-raised);
}

/* --- Primitive: overlay ------------------------------------------------- */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: rgb(0 0 0 / 0.55);
}
.overlay > * {
  width: 100%;
  max-width: 460px;
  padding: var(--space-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-overlay);
  box-shadow: var(--shadow-overlay);
}

progress {
  width: 100%;
  height: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  appearance: none;
}
progress::-webkit-progress-bar {
  background: var(--bg-raised);
  border-radius: var(--radius-sm);
}
progress::-webkit-progress-value {
  background: var(--accent);
  border-radius: var(--radius-sm);
}

@keyframes termif-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
```

- [ ] **Step 2: Write app.css**

Create `apps/desktop/src/renderer/styles/app.css`:

```css
@import './tokens.css';
@import './base.css';

/* View blocks are appended here by later tasks. */
```

- [ ] **Step 3: Import it once, at the renderer entry**

In `apps/desktop/src/renderer/main.tsx`, add as the first import line:

```ts
import './styles/app.css'
```

`@xterm/xterm/css/xterm.css` stays where it is, in `TerminalPane.tsx`.

- [ ] **Step 4: Confirm the suite still passes**

Run: `npm test`
Expected: PASS. jsdom ignores the stylesheet, so this proves only that nothing
broke — it is not evidence the styling is right.

- [ ] **Step 5: Confirm the bundle actually contains the CSS**

Run: `npm run build`
Then: `grep -c 'bg-app' out/renderer/assets/*.css`
Expected: at least 1. Before this task that grep returns 0, because the only
CSS in the bundle was xterm's.

- [ ] **Step 6: Look at it**

Run: `npm run dev`
Expected: dark window, readable text, focus rings visible when tabbing. Layout
is still wrong — that is Task 4 onward.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/styles/base.css \
        apps/desktop/src/renderer/styles/app.css \
        apps/desktop/src/renderer/main.tsx
git commit -m "feat(desktop): add base stylesheet and shared primitives"
```

---

### Task 3: Terminal theme

`new Terminal({...})` at `TerminalPane.tsx:30` passes no `theme`, so xterm
paints pure black against `--bg-app`. The seam is visible on every session.

**Files:**
- Create: `apps/desktop/src/renderer/styles/terminalTheme.ts`
- Modify: `apps/desktop/src/renderer/views/TerminalPane.tsx:30-37`
- Test: `apps/desktop/test/renderer/TerminalPane.test.tsx` (extend the existing
  `Terminal` mock and add one test)

**Interfaces:**
- Consumes: `palette` and `ansi` from `styles/palette.ts` (Task 1).
- Produces: `export const terminalTheme` — an object with `background`,
  `foreground`, `cursor`, `cursorAccent`, `selectionBackground`, and the 16
  named ANSI keys xterm expects (`black`, `red`, …, `brightWhite`).

- [ ] **Step 1: Make the test mock capture constructor options**

In `apps/desktop/test/renderer/TerminalPane.test.tsx`, the `Terminal` mock
class currently ignores its argument. Add a module-level recorder above the
`vi.mock` call:

```ts
const constructed: { theme?: Record<string, string>; fontFamily?: string }[] = []
```

and give the mocked class a constructor that records:

```ts
constructor(options: { theme?: Record<string, string>; fontFamily?: string }) {
  constructed.push(options)
}
```

- [ ] **Step 2: Write the failing test**

Add to the same file:

```ts
it('opens the terminal with the app theme so it matches the window ground', async () => {
  render(<TerminalPane tabId="t1" sessions={makeSessions()} active />)

  await waitFor(() => expect(constructed.length).toBeGreaterThan(0))
  const options = constructed[constructed.length - 1]

  expect(options.theme?.background).toBe(palette.bgApp)
  expect(options.theme?.foreground).toBe(palette.fg)
  expect(options.theme?.cursor).toBe(palette.accent)
  // All 16 ANSI slots present: a missing one silently falls back to xterm's.
  expect(options.theme?.brightWhite).toBeTruthy()
  expect(options.theme?.black).toBeTruthy()
})
```

Import `palette` at the top of the test file:

```ts
import { palette } from '../../src/renderer/styles/palette.js'
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run test/renderer/TerminalPane.test.tsx`
Expected: FAIL — `options.theme` is `undefined`.

- [ ] **Step 4: Write the theme module**

Create `apps/desktop/src/renderer/styles/terminalTheme.ts`:

```ts
import { ansi, palette } from './palette.js'

/**
 * xterm's own default is pure black, which does not match --bg-app and shows
 * as a seam around the pane. These are the same values the CSS uses.
 */
export const terminalTheme = {
  background: palette.bgApp,
  foreground: palette.fg,
  cursor: palette.accent,
  cursorAccent: palette.bgApp,
  selectionBackground: '#2d4a6b',

  black: ansi[0],
  red: ansi[1],
  green: ansi[2],
  yellow: ansi[3],
  blue: ansi[4],
  magenta: ansi[5],
  cyan: ansi[6],
  white: ansi[7],
  brightBlack: ansi[8],
  brightRed: ansi[9],
  brightGreen: ansi[10],
  brightYellow: ansi[11],
  brightBlue: ansi[12],
  brightMagenta: ansi[13],
  brightCyan: ansi[14],
  brightWhite: ansi[15],
} as const
```

- [ ] **Step 5: Wire it into the pane**

In `apps/desktop/src/renderer/views/TerminalPane.tsx`, import it:

```ts
import { terminalTheme } from '../styles/terminalTheme.js'
```

and add `theme: terminalTheme,` to the `new Terminal({...})` options at line
30. Leave `fontFamily`, `fontSize`, `cursorBlink`, `scrollback`, and
`allowProposedApi` exactly as they are.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/renderer/TerminalPane.test.tsx`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/styles/terminalTheme.ts \
        apps/desktop/src/renderer/views/TerminalPane.tsx \
        apps/desktop/test/renderer/TerminalPane.test.tsx
git commit -m "feat(desktop): theme xterm from the app palette"
```

---

### Task 4: Titlebar, and one tab row instead of two

Spec §2.1 and §2.2. The OS titlebar cuts a light bar across the window, and
`layout__tabs` plus `terminal-tabs__bar` render as two stacked rows of tabs
that mean different things.

**Files:**
- Modify: `apps/desktop/src/main/index.ts:10-24` (the `BrowserWindow` options)
- Create: `apps/desktop/src/renderer/views/Titlebar.tsx`
- Modify: `apps/desktop/src/renderer/app/MainLayout.tsx` (move the pane nav
  into the titlebar)
- Modify: `apps/desktop/src/renderer/styles/app.css` (append the blocks)
- Test: `apps/desktop/test/renderer/Titlebar.test.tsx` (create)

**Interfaces:**
- Consumes: `t` from `@termif/core`; the `Pane` union already declared in
  `MainLayout.tsx` (`'terminals' | 'files' | 'forwards'`).
- Produces:
  ```ts
  export interface TitlebarProps {
    pane: 'terminals' | 'files' | 'forwards'
    onPaneChange(pane: 'terminals' | 'files' | 'forwards'): void
  }
  export function Titlebar(props: TitlebarProps): JSX.Element
  ```
  The `Pane` type moves out of `MainLayout.tsx` into `Titlebar.tsx` and is
  exported as `export type Pane = 'terminals' | 'files' | 'forwards'`;
  `MainLayout.tsx` imports it instead of declaring its own.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/test/renderer/Titlebar.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Titlebar } from '../../src/renderer/views/Titlebar.js'

describe('Titlebar', () => {
  it('exposes the three panes as a single tablist', () => {
    render(<Titlebar pane="terminals" onPaneChange={() => {}} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
  })

  it('marks the active pane selected', () => {
    render(<Titlebar pane="files" onPaneChange={() => {}} />)

    const selected = screen.getAllByRole('tab').filter(
      (tab) => tab.getAttribute('aria-selected') === 'true',
    )
    expect(selected).toHaveLength(1)
  })

  it('reports a pane change when another tab is clicked', async () => {
    const onPaneChange = vi.fn()
    render(<Titlebar pane="terminals" onPaneChange={onPaneChange} />)

    const [, second] = screen.getAllByRole('tab')
    await userEvent.click(second)

    expect(onPaneChange).toHaveBeenCalledWith('files')
  })

  it('renders the class hooks the stylesheet targets', () => {
    const { container } = render(<Titlebar pane="terminals" onPaneChange={() => {}} />)

    // `.titlebar` carries the drag region and `.titlebar__panes` opts back out
    // of it. Whether the opt-out works can only be checked in a real window
    // (Task 4, step 8) — this only guards the hooks the CSS needs.
    expect(container.querySelector('.titlebar')).not.toBeNull()
    expect(container.querySelector('.titlebar__panes')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/renderer/Titlebar.test.tsx`
Expected: FAIL — cannot resolve `Titlebar.js`.

- [ ] **Step 3: Write the component**

Create `apps/desktop/src/renderer/views/Titlebar.tsx`:

```tsx
import { t } from '@termif/core'

export type Pane = 'terminals' | 'files' | 'forwards'

export interface TitlebarProps {
  pane: Pane
  onPaneChange(pane: Pane): void
}

/**
 * The window is frameless (see src/main/index.ts), so this bar is both the
 * drag handle and the pane switcher. Anything clickable inside it must opt out
 * of the drag region in CSS, or it stops responding to clicks.
 */
export function Titlebar({ pane, onPaneChange }: TitlebarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar__panes" role="tablist">
        {(['terminals', 'files', 'forwards'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={pane === name}
            onClick={() => onPaneChange(name)}
          >
            {t(`layout.tab.${name}`)}
          </button>
        ))}
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Run the test to green**

Run: `npx vitest run test/renderer/Titlebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Use it in MainLayout**

In `apps/desktop/src/renderer/app/MainLayout.tsx`:

1. Delete the local `type Pane = 'terminals' | 'files' | 'forwards'` line and
   import instead:
   ```ts
   import { Titlebar, type Pane } from '../views/Titlebar.js'
   ```
2. Delete the whole `<nav className="layout__tabs" role="tablist">…</nav>`
   block from inside `<main className="layout__main">`.
3. Wrap the returned tree so the titlebar sits above the layout:
   ```tsx
   return (
     <div className="shell">
       <Titlebar pane={pane} onPaneChange={setPane} />
       <div className="layout">
         {/* the existing <aside> and <main> unchanged */}
       </div>
       {connect.prompt}
     </div>
   )
   ```
   Move `{connect.prompt}` to the position shown; everything else inside
   `<aside>` and `<main>` stays byte-identical.

- [ ] **Step 6: Make the window frameless**

In `apps/desktop/src/main/index.ts`, inside the `new BrowserWindow({...})`
options, after `title: 'Termif',` add:

```ts
    // Frameless on both platforms: the renderer draws its own titlebar
    // (src/renderer/views/Titlebar.tsx). The OS bar is a light strip across a
    // dark window otherwise.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#12171f',
            symbolColor: '#a7b3c0',
            height: 38,
          },
        }),
    backgroundColor: '#0d1117',
```

`backgroundColor` prevents a white flash between window creation and
`ready-to-show`.

- [ ] **Step 7: Append the CSS**

Append to `apps/desktop/src/renderer/styles/app.css`:

```css
/* --- Shell and titlebar ------------------------------------------------- */
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.titlebar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 var(--titlebar-height);
  padding-inline: var(--space-4);
  /* Room for the macOS traffic lights, which the OS still draws. */
  padding-inline-start: 88px;
  border-bottom: 1px solid var(--border-strong);
  background: var(--bg-surface);
  -webkit-app-region: drag;
}

.titlebar__panes {
  display: flex;
  gap: var(--space-1);
  padding: 2px;
  border-radius: var(--radius-sm);
  background: var(--bg-app);
  -webkit-app-region: no-drag;
}
.titlebar__panes button {
  height: 24px;
  padding: 0 var(--space-3);
  font-size: 12px;
}
.titlebar__panes button[aria-selected='true'] {
  background: var(--bg-raised);
  color: var(--fg);
}

/* --- Layout ------------------------------------------------------------- */
.layout {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  flex: 1;
  min-height: 0;
}

.layout__sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border-strong);
  background: var(--bg-surface);
}

.layout__main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--bg-app);
}
```

- [ ] **Step 8: Run the suite and look at the window**

Run: `npm test`
Expected: PASS. `MainLayout` has no unit test of its own, so the risk here is
visual, not test-shaped.

Run: `npm run dev`
Expected: one titlebar with a three-way segmented control; window drags by the
bar; the three buttons still respond to clicks. If a button does not respond,
`-webkit-app-region: no-drag` is missing or overridden.

- [ ] **Step 9: Verify the e2e path still works**

Run: `npm run e2e`
Expected: PASS. The smoke test never touches the pane nav, but it does launch
a real window, which is where a frameless-window mistake shows up.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/main/index.ts \
        apps/desktop/src/renderer/views/Titlebar.tsx \
        apps/desktop/src/renderer/app/MainLayout.tsx \
        apps/desktop/src/renderer/styles/app.css \
        apps/desktop/test/renderer/Titlebar.test.tsx
git commit -m "feat(desktop): draw a custom titlebar and merge the two tab rows"
```

---

### Task 5: Sidebar regions and quiet host rows

Spec §2.3 and §2.4. `SyncBadge` and the sign-in button currently sit above the
search box — the first thing the eye meets. And every host row renders three to
four always-visible buttons.

**Files:**
- Modify: `apps/desktop/src/renderer/app/MainLayout.tsx` (move the sync block
  below the host list)
- Modify: `apps/desktop/src/renderer/styles/app.css` (append)
- Test: `apps/desktop/test/renderer/HostList.test.tsx` (add one test; the
  existing ones must keep passing untouched)

**Interfaces:**
- Consumes: `HostList`, `SyncBadge`, `SignInScreen` as they are. No props
  change in this task.
- Produces: the class `layout__account`, used by `app.css`, wrapping the sync
  badge / sign-in button at the foot of the sidebar.

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/test/renderer/HostList.test.tsx`:

```tsx
it('keeps row actions in the DOM so they stay keyboard-reachable', () => {
  render(
    <HostList
      hosts={[
        {
          id: 'h1',
          label: 'web-1',
          hostname: 'web1.example.com',
          username: 'deploy',
          port: 22,
          tags: [],
        },
      ] as never}
      query=""
      onQueryChange={() => {}}
      onConnect={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onAdd={() => {}}
    />,
  )

  // The actions are hidden with opacity, never display:none — a row's buttons
  // must remain focusable by Tab even before the pointer arrives.
  expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /edit web-1/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /delete web-1/i })).toBeInTheDocument()
})
```

Match the `hosts` shape to whatever the existing tests in this file build — if
they use a `makeHost()` helper, use it here instead of the literal above.

- [ ] **Step 2: Run it**

Run: `npx vitest run test/renderer/HostList.test.tsx`
Expected: PASS immediately — the markup already satisfies it. This test is a
tripwire for step 4, which is about to hide those buttons: it fails loudly if
someone reaches for `display: none`.

- [ ] **Step 3: Restructure the sidebar in MainLayout**

In `apps/desktop/src/renderer/app/MainLayout.tsx`, inside
`<aside className="layout__sidebar">`, reorder to:

```tsx
<aside className="layout__sidebar">
  <HostList
    hosts={hostStore.visibleHosts()}
    query={hosts.query}
    onQueryChange={(q) => hostStore.setQuery(q)}
    onConnect={(id) => void connect.start(id)}
    onEdit={(id) => setEditing({ id })}
    onDelete={(id) => void hostStore.remove(id)}
    onAdd={() => setEditing({ id: null })}
  />

  <div className="layout__account">
    {hasSync ? (
      <SyncBadge status={syncStatus} onSyncNow={() => void app.sync?.syncNow()} />
    ) : (
      <button type="button" onClick={() => setSigningIn(true)}>
        {t('sync.signIn')}
      </button>
    )}
  </div>

  {signingIn && (
    <SignInScreen
      app={app}
      onDone={() => {
        setSigningIn(false)
        setHasSync(true)
        setSyncStatus(app.sync?.status ?? syncStatus)
      }}
      onCancel={() => setSigningIn(false)}
    />
  )}
</aside>
```

The `SignInScreen` stays outside `layout__account` because Task 6 makes it an
overlay; nesting it inside the account row would clip it.

- [ ] **Step 4: Append the CSS**

Append to `apps/desktop/src/renderer/styles/app.css`:

```css
/* --- Sidebar: sticky search, scrolling list, account foot --------------- */
.host-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.host-list__toolbar {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
}
.host-list__toolbar input {
  flex: 1;
  min-width: 0;
}

.host-list ul {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2);
}

.host-list li {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'label actions'
    'target actions'
    'tags actions';
  align-items: center;
  gap: 0 var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  cursor: default;
  transition: background-color var(--motion-fast);
}
.host-list li:hover {
  background: var(--bg-raised);
}

.host-list__label {
  grid-area: label;
  color: var(--fg);
  font-weight: 500;
}
.host-list__target {
  grid-area: target;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 12px;
}
.host-list__tags {
  grid-area: tags;
  display: flex;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.tag {
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--fg-subtle);
  font-size: 11px;
  line-height: 16px;
}

/* Hidden by opacity, never by display: the buttons must stay focusable so the
   row is operable from the keyboard alone. */
.host-list__actions {
  grid-area: actions;
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--motion-fast);
}
.host-list li:hover .host-list__actions,
.host-list li:focus-within .host-list__actions,
.host-list__actions:focus-within {
  opacity: 1;
}

.host-list__empty {
  margin: auto;
  max-width: 32ch;
  padding: var(--space-5);
  color: var(--fg-subtle);
  text-align: center;
}

.layout__account {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 5: Confirm the tripwire and the suite**

Run: `npx vitest run test/renderer/HostList.test.tsx`
Expected: PASS — including the delete-confirm test at line 140, which clicks a
button that is now visually hidden. jsdom ignores `opacity`, and in a real
browser the pointer is over the row by the time it clicks, so both agree.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Look at it**

Run: `npm run dev`
Expected: search pinned at the top, list scrolling under it, sync badge at the
foot. Row buttons appear on hover and when tabbed into. Tab through a row
without the mouse and confirm the buttons become visible as focus enters.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/app/MainLayout.tsx \
        apps/desktop/src/renderer/styles/app.css \
        apps/desktop/test/renderer/HostList.test.tsx
git commit -m "feat(desktop): give the sidebar regions and quiet the host rows"
```

---

### Task 6: View blocks, state colours, and empty states

Spec §3. Everything left is CSS against class hooks that already exist. No
markup changes except the four `<p>` empty states, which need none.

**Files:**
- Modify: `apps/desktop/src/renderer/styles/app.css` (append)
- Modify: `apps/desktop/src/renderer/views/TransferList.tsx` (only if
  `transfer__progress` is not already a `<progress>` element — check first)

**Interfaces:**
- Consumes: the primitives from Task 2 (`.list-row`, `.overlay`,
  `[data-variant]`) and the tokens from Task 1.
- Produces: nothing other tasks depend on. This is the last CSS task.

- [ ] **Step 1: Read the four views you are about to style**

Run:
```bash
cat src/renderer/views/SftpBrowser.tsx \
    src/renderer/views/ForwardPanel.tsx \
    src/renderer/views/TransferList.tsx \
    src/renderer/views/HostKeyPrompt.tsx
```
Note the exact element each class sits on. Write CSS against what is there,
not against what this plan assumes.

- [ ] **Step 2: Append the terminal blocks**

```css
/* --- Terminals ---------------------------------------------------------- */
.terminal-tabs {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.terminal-tabs__bar {
  display: flex;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-2) 0;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}

.terminal-tabs__tab {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding-inline: var(--space-1);
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: var(--bg-surface);
}
.terminal-tabs__tab:has(button[aria-selected='true']) {
  border-color: var(--border);
  background: var(--bg-raised);
}
.terminal-tabs__tab button[role='tab'] {
  max-width: 20ch;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  font-size: 12px;
}

/* A state dot before the title. The textual ' …' the component already
   appends stays, so screen readers lose nothing to this. */
.terminal-tabs__tab::before {
  content: '';
  width: 6px;
  height: 6px;
  margin-inline-start: var(--space-2);
  border-radius: 50%;
  background: var(--fg-subtle);
  flex: 0 0 auto;
}
.terminal-tabs__tab--live::before {
  background: var(--ok);
}
.terminal-tabs__tab--reconnecting::before {
  background: var(--warn);
  animation: termif-pulse 1.2s ease-in-out infinite;
}
.terminal-tabs__tab--closed {
  opacity: 0.5;
}

.terminal-tabs__notice {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  color: var(--warn);
  font-size: 12px;
}

.terminal-tabs__panes {
  position: relative;
  flex: 1;
  min-height: 0;
}

.terminal-tabs__empty {
  margin: auto;
  max-width: 32ch;
  padding: var(--space-6);
  color: var(--fg-subtle);
  text-align: center;
}

.terminal-pane {
  position: absolute;
  inset: 0;
  padding: var(--space-2);
}
```

- [ ] **Step 3: Append the sync, overlay, and form blocks**

```css
/* --- Sync badge --------------------------------------------------------- */
.sync-badge {
  width: 100%;
  justify-content: flex-start;
  font-size: 12px;
}
.sync-badge::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-subtle);
  flex: 0 0 auto;
}
.sync-badge--running::before {
  background: var(--accent);
  animation: termif-pulse 1.2s ease-in-out infinite;
}
.sync-badge--failed::before {
  background: var(--danger);
}
.sync-badge--idle::before {
  background: var(--ok);
}

/* --- Overlays ----------------------------------------------------------- */
/* These three are bare markup in the page flow today. */
.hostkey,
.snippet-palette,
.sign-in {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: rgb(0 0 0 / 0.55);
}
.hostkey > *,
.snippet-palette > *,
.sign-in > * {
  width: 100%;
  max-width: 520px;
  padding: var(--space-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-overlay);
  box-shadow: var(--shadow-overlay);
}

/* A mismatch is a possible attack; an unknown key is routine. They must not
   look alike. */
.hostkey--unknown > * {
  border-color: var(--warn);
}
.hostkey--mismatch > * {
  border-color: var(--danger);
  border-width: 2px;
}

.hostkey__actions,
.host-form__actions,
.sign-in__actions,
.forwards__form {
  display: flex;
  gap: var(--space-2);
  align-items: flex-end;
  margin-top: var(--space-4);
}

.snippet-palette__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.snippet__label {
  color: var(--fg);
}
.snippet__body {
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 12px;
}

/* --- Host form, setup, unlock ------------------------------------------- */
.host-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 520px;
  padding: var(--space-5);
}

.setup,
.unlock {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  max-width: 380px;
  margin: auto;
  padding: var(--space-6);
}
```

`.setup` and `.unlock` are full-screen roots, not overlays — `AppRoot` returns
them instead of `MainLayout`, so they centre in the window on their own.

- [ ] **Step 4: Append the SFTP, forwards, and transfer blocks**

```css
/* --- SFTP --------------------------------------------------------------- */
.sftp {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.sftp__bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
}

.sftp__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sftp__entries {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2);
}
.sftp__entries li {
  display: grid;
  grid-template-columns: 20px 1fr auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  transition: background-color var(--motion-fast);
}
.sftp__entries li:hover {
  background: var(--bg-raised);
}
.sftp__icon {
  color: var(--fg-subtle);
  text-align: center;
}
.sftp__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sftp__size {
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* --- Transfers ---------------------------------------------------------- */
.transfer-list {
  border-top: 1px solid var(--border);
  padding: var(--space-2);
  max-height: 30%;
  overflow-y: auto;
}
.transfer-list li {
  display: grid;
  grid-template-columns: 1fr 120px;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-3);
}
.transfer__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
}
.transfer__error {
  grid-column: 1 / -1;
  color: var(--danger);
  font-size: 12px;
}

/* --- Forwards ----------------------------------------------------------- */
.forwards {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: var(--space-4);
  gap: var(--space-4);
}
.forwards__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.forwards__list li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  transition: background-color var(--motion-fast);
}
.forwards__list li:hover {
  background: var(--bg-raised);
}
.forward__port {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.forward__description {
  color: var(--fg-muted);
}
.forward__accepted {
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}
.forward__note {
  color: var(--warn);
  font-size: 12px;
}
```

- [ ] **Step 5: Mark the destructive and primary buttons**

Add `data-variant="danger"` to the confirm-delete button in
`src/renderer/views/HostList.tsx` and `data-variant="primary"` to the save
button in `src/renderer/views/HostForm.tsx`, the create button in
`SetupScreen.tsx`, and the unlock button in `UnlockScreen.tsx`. Add no other
attributes and change no text — the e2e test matches these buttons by
accessible name (`/create vault/i`, `/^save/i`, `/^unlock/i`).

- [ ] **Step 6: Check every class hook now has a rule**

Run from `apps/desktop/`:
```bash
grep -rho 'className="[^"]*"' src/renderer | sed 's/className="//;s/"//' \
  | tr ' ' '\n' | grep -v '^\$' | sort -u > /tmp/hooks.txt
while read -r c; do grep -q "\.$c" src/renderer/styles/app.css || echo "unstyled: $c"; done < /tmp/hooks.txt
```
Expected: no output, apart from hooks built by template literal
(`terminal-tabs__tab--${tab.state}`, `sync-badge--${status.state}`,
`hostkey--…`), which the loop cannot see and which the CSS above covers
explicitly. Investigate anything else it prints.

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS, 184+ tests.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Walk every screen**

Run: `npm run dev` and visit, in order: setup, unlock, empty sidebar, a
populated sidebar, the host form, a terminal tab, the snippet palette
(`Cmd+K`), the SFTP pane, the forwards pane. Each should look deliberate.
Note anything that does not and fix it before committing.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/styles/app.css apps/desktop/src/renderer/views
git commit -m "feat(desktop): style every view and give state its own colour"
```

---

### Task 7: Screenshot capture and plan close-out

Spec §4. jsdom cannot see any of this work, so the record of what the app
looks like has to come from a real window.

**Files:**
- Create: `apps/desktop/e2e/screenshots.spec.ts`
- Modify: `apps/desktop/.gitignore` (ignore the output directory)
- Modify: `docs/superpowers/README.md` (status row)

**Interfaces:**
- Consumes: the running app. No source imports.
- Produces: PNGs under `apps/desktop/e2e/__screens__/`, untracked.

- [ ] **Step 1: Write the capture spec**

Create `apps/desktop/e2e/screenshots.spec.ts`:

```ts
import { test, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Not an assertion suite. jsdom cannot render, so this captures the real
 * window for a human to look at. Deliberately no pixel comparison: it would
 * break on every colour change and become debt (spec §4).
 */
test('captures the main screens', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termif-shot-'))
  const shots = join(__dirname, '__screens__')

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  })
  const window = await app.firstWindow()

  await window.getByRole('heading', { name: /choose a master password/i }).waitFor()
  await window.screenshot({ path: join(shots, '01-setup.png') })

  await window.getByLabel(/enter your master password/i).fill('screenshot-password')
  await window.getByLabel('Confirm').fill('screenshot-password')
  await window.getByRole('button', { name: /create vault/i }).click()

  await window.getByRole('searchbox').waitFor()
  await window.screenshot({ path: join(shots, '02-empty-sidebar.png') })

  await window.getByRole('button', { name: /add host/i }).click()
  await window.screenshot({ path: join(shots, '03-host-form.png') })

  await window.getByLabel(/^label/i).fill('web-1')
  await window.getByLabel(/hostname/i).fill('web1.example.com')
  await window.getByLabel(/username/i).fill('deploy')
  await window.getByRole('button', { name: /^save/i }).click()

  await window.getByText('web-1').waitFor()
  await window.screenshot({ path: join(shots, '04-host-list.png') })

  // Hovering a row is what reveals its actions, so capture that state too.
  await window.getByText('web-1').hover()
  await window.screenshot({ path: join(shots, '05-host-hover.png') })

  await window.getByRole('tab', { name: /files/i }).click()
  await window.screenshot({ path: join(shots, '06-files.png') })

  await window.getByRole('tab', { name: /forwards/i }).click()
  await window.screenshot({ path: join(shots, '07-forwards.png') })

  await app.close()
  rmSync(userData, { recursive: true, force: true })
})
```

- [ ] **Step 2: Ignore the output**

Add to `apps/desktop/.gitignore` (create the file if absent):

```
e2e/__screens__/
```

- [ ] **Step 3: Run it**

Run: `npm run e2e`
Expected: both specs pass. If a `getByRole('tab', …)` call fails, the titlebar
tabs lost their accessible name in Task 4 — fix that, not this test.

- [ ] **Step 4: Look at all seven images**

Open `apps/desktop/e2e/__screens__/`. This is the acceptance gate for the whole
plan. A green suite over an ugly app is exactly the failure this plan exists to
correct — if a screen still looks unfinished, fix it before step 6.

- [ ] **Step 5: Confirm the constraints held**

Run from the repo root:
```bash
git diff main -- apps/desktop/package.json
grep -n 'Content-Security-Policy' -A3 apps/desktop/src/renderer/index.html
grep -rn 'prefers-color-scheme' apps/desktop/src/renderer/styles/
```
Expected: no change to `dependencies`; the CSP string identical to before; no
`prefers-color-scheme` anywhere.

- [ ] **Step 6: Update the status index**

In `docs/superpowers/README.md`, add a row to the plans table:

```
| 5 | [`plans/2026-08-30-termif-04-desktop-visual.md`](plans/2026-08-30-termif-04-desktop-visual.md) — desktop visual design | 7 | **complete (YYYY-MM-DD)** | — |
```

Use the real date. Keep row 4 reserved for the deferred mobile shell. Add a
line under "Work still owed" noting that light theme, theme switching, and a
UX redesign are explicit non-goals recorded in the visual design spec.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/e2e/screenshots.spec.ts \
        apps/desktop/.gitignore \
        docs/superpowers/README.md
git commit -m "test(desktop): capture screens and close the visual design plan"
```

---

## Notes for whoever executes this

**The tests cannot tell you this worked.** They can only tell you nothing
broke. Tasks 1 and 3 have real assertions — contrast ratios and the terminal
theme are genuinely testable. Tasks 2, 5, and 6 are verified by looking at the
running app, and that step is not optional. Skipping it reproduces exactly the
failure that made this plan necessary: Plan 3 finished with 92 ticked boxes,
184 green tests, and an app that rendered as unstyled HTML.

**The non-goals in the spec are locked.** They will look negotiable once the
app starts looking good. Light theme, a theme switcher, a drawer for the host
form, a new command palette, an icon set — each is a separate spec. If you
believe one is needed, stop and say so rather than adding it here.
