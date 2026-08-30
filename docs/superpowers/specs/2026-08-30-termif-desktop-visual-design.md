# Termif Desktop — Visual Design

**Date:** 2026-08-30
**Status:** Approved design. Awaiting an implementation plan. The plan number is not fixed here: `README.md` reserves 4 for the deferred mobile shell.
**Parent spec:** [`2026-08-28-termif-crossplatform-ssh-design.md`](2026-08-28-termif-crossplatform-ssh-design.md)

## Why this spec exists

Plan 3 finished: 92 steps done, 184 tests green, the app builds. It also
looks like an unstyled HTML document, because it is one.

The cause is not a bug. `apps/desktop/src` contains no stylesheet. The only
CSS the renderer imports is `@xterm/xterm/css/xterm.css`, at
`src/renderer/views/TerminalPane.tsx:6`, which styles the terminal widget and
nothing else. The built bundle `out/renderer/assets/index-*.css` is that file
alone.

The views were written with 48 BEM class hooks — `layout__sidebar`,
`host-list__toolbar`, `hostkey--mismatch`, and so on — but no rule ever
defined them. The parent spec has no visual design section, so no plan step
ever asked for one. The work was done correctly against a spec that was
incomplete.

This spec supplies what was missing. It covers the desktop shell only.

## Goals

1. Every one of the 13 renderer views reads as one deliberate product.
2. Security-critical screens — host-key prompt, unlock — are visually
   unmistakable.
3. Keyboard operation is fully visible. Focus is never ambiguous.
4. No new runtime dependency.

## Non-goals

Locked. Anything here is a separate spec, not scope creep discovered
mid-implementation.

- **Light theme.** Dark only in v1. Tokens are structured so a light theme is
  a second `:root` block later, but that block is not written now.
- **User-selectable themes**, theme persistence, settings UI.
- **UX redesign.** The connect flow, the SFTP model, the forward model, and
  the onboarding sequence stay exactly as built.
- **`HostForm` as a drawer or modal.** It keeps replacing the main pane.
- **A new command palette.** `Cmd+K` already opens the snippet palette.
- **Icon set or illustrations.** System glyphs and text only.
- **Pixel-comparison snapshot testing.**

## Decisions taken

| Question | Decision | Why |
|---|---|---|
| Aesthetic | Dev-tool dark, in the VS Code / Warp family | Matches an SSH client's use; a single dark palette is the most achievable consistently |
| Scope | Skin, plus four named IA repairs | Pure skin cannot fix the doubled tab rows or the floating sync badge |
| Theme range | Dark only | Halves the contrast surface to verify |
| Stack | Plain CSS with custom properties | Zero new dependencies, reuses the 48 existing class hooks, satisfies the current CSP, leaves the test suite intact |

Tailwind was rejected: it would rewrite `className` across all 13 views for a
codebase of this size. Radix was rejected: the overlays already exist and
already have accessibility test coverage.

## 1. Foundation

### File layout

New directory `apps/desktop/src/renderer/styles/`:

| File | Contents |
|---|---|
| `tokens.css` | `:root` custom properties only. No selectors besides `:root`. |
| `base.css` | Reset, `body`, element defaults, focus ring, scrollbars, shared primitives |
| `app.css` | `@import` of the two above, then one block per view |
| `terminalTheme.ts` | The xterm `ITheme` object, built from the same colour values |

`app.css` is imported once, in `src/renderer/main.tsx`. `xterm.css` stays
where it is.

### Tokens

Proposed values. Every foreground/background pair MUST be verified against
WCAG AA — 4.5:1 for body text, 3:1 for large text and for UI borders that
carry meaning — before the palette is considered final. Where a value below
fails, the value changes; the structure does not.

```
/* Background, four levels. Depth comes from lightness, not from borders. */
--bg-app:      #0d1117;   /* window ground */
--bg-surface:  #12171f;   /* sidebar, panels */
--bg-raised:   #1b222c;   /* inputs, active tab, hovered row */
--bg-overlay:  #212a35;   /* dialogs, palette */

/* Foreground, three levels. */
--fg:          #e6edf3;
--fg-muted:    #9aa7b4;   /* user@host, timestamps, secondary labels */
--fg-subtle:   #7d8b9a;   /* placeholders, resting icons — never load-bearing text */

/* One accent. Focus and primary action only. */
--accent:      #4c8dff;
--accent-fg:   #0d1117;   /* text on an accent fill */

/* Semantic. State only — never decoration. */
--ok:          #3fb950;
--warn:        #d29922;
--danger:      #f85149;

/* Structure. */
--border:        #232c38;
--border-strong: #303b49;  /* sidebar/main division, titlebar underline */

/* Space, 4px scale. No values off this scale. */
--space-1: 4px;  --space-2: 8px;   --space-3: 12px;
--space-4: 16px; --space-5: 24px;  --space-6: 32px;

/* Radius. Two values, no third. */
--radius-sm: 4px;   /* inputs, buttons */
--radius-md: 8px;   /* cards, panels, overlays */

/* Type. */
--font-ui:   -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

/* Elevation. */
--shadow-overlay: 0 16px 48px rgb(0 0 0 / 0.5);

/* Motion. */
--motion-fast: 120ms ease;
```

`--font-mono` is the exact stack already at `TerminalPane.tsx:31`. Tab titles
and SFTP paths use it too, so terminal and chrome do not drift apart.

No web font is loaded. The CSP is `default-src 'self'`, which blocks remote
fonts silently. The CSP is not widened for typography.

### Terminal theme

`new Terminal({...})` at `TerminalPane.tsx:30` currently passes no `theme`, so
xterm renders pure black against the app's `--bg-app`. Add a `theme` built in
`styles/terminalTheme.ts` from the same values: `background` set to
`--bg-app`, `foreground` to `--fg`, plus `cursor`, `cursorAccent`,
`selectionBackground`, and the 16 ANSI colours.

The ANSI palette must stay legible on `--bg-app` — remote programs choose
those colours, and the user cannot correct them.

## 2. Layout and information architecture

Four markup changes. This list is exhaustive.

### 2.1 Titlebar

The OS default titlebar cuts a light bar across a dark window.

- macOS: `titleBarStyle: 'hiddenInset'` on the `BrowserWindow`.
- Windows: `titleBarOverlay` with colours matching `--bg-surface`.
- Renderer gains `<header className="titlebar">`, 38px tall,
  `-webkit-app-region: drag`, with left padding reserved for the macOS
  traffic lights.
- Every control inside it sets `-webkit-app-region: no-drag`, or it will not
  be clickable.

### 2.2 One tab row, not two

`layout__tabs` (terminals / files / forwards) and `terminal-tabs__bar` render
as two stacked rows of tabs that mean different things.

- `layout__tabs` becomes a three-way segmented control, centred in the
  titlebar.
- `terminal-tabs__bar` remains a real tab bar, directly below, shown only
  while the `terminals` pane is active.
- `role="tablist"`, `role="tab"`, and `aria-selected` are preserved exactly,
  so `MainLayout` and `TerminalTabs` tests keep passing.

### 2.3 Sidebar gains a top, middle, and bottom

`SyncBadge` and the sign-in button currently sit above the search box — the
first thing the eye lands on when the app opens.

- **Top, sticky:** search field and Add button (`host-list__toolbar`).
- **Middle, scrolls:** the host list.
- **Bottom:** an account row holding `SyncBadge` or the sign-in button.

In `MainLayout.tsx` this is JSX repositioning. No logic changes; `hasSync`,
`signingIn`, and the `SignInScreen` overlay behave as they do today.

### 2.4 Host rows get quiet

Each `<li>` renders three to four always-visible buttons — ten hosts means
forty buttons.

- The row shows `host-list__label`, `host-list__target`, and tags.
- `host-list__actions` becomes visible on `:hover` and `:focus-within`.
- It stays in the DOM at all times, so `getByRole('button', …)` in
  `HostList.test.tsx` still finds it. Visibility is `opacity`, not
  `display: none`.
- Double-click and Enter to connect are unchanged.
- Inline delete confirmation stays inline, for the reason already recorded in
  the comment in `HostList.tsx`.

## 3. Components and state

Four shared primitives; the per-view blocks compose them rather than
redefining them.

### Primitives

- **Button** — bare `button` is the ghost style: transparent ground,
  `--fg-muted` text, `--bg-raised` on hover. 28px tall, `--radius-sm`.
  Variants come from a data attribute, not new classes:
  `[data-variant="primary"]` fills with `--accent` and uses `--accent-fg`;
  `[data-variant="danger"]` uses `--danger`.
- **Input** — `--bg-raised` ground, `--border` outline; on focus the border
  becomes `--accent` with a 2px ring.
- **List row** — one shared rule serving `host-list li`, `sftp__entries li`,
  `forwards__list li`, and `transfer-list li`: single-row grid, padding
  `--space-2 --space-3`, `--bg-raised` on hover, accent ring on
  `:focus-visible`.
- **Overlay** — one rule for `hostkey`, `snippet-palette`, and `sign-in`:
  `--bg-overlay`, `--radius-md`, `--shadow-overlay`, dimmed backdrop,
  constrained `max-width`, centred. All three are currently bare markup in
  the page flow.

### State expressed as colour

| Class | Treatment |
|---|---|
| `terminal-tabs__tab--live` | `--ok` dot |
| `terminal-tabs__tab--reconnecting` | `--warn` dot, pulsing |
| `terminal-tabs__tab--closed` | reduced opacity |
| `sync-badge--running` | `--fg-muted` text, pulsing dot |
| `sync-badge--failed` | `--danger` dot; text stays `--fg-muted`, the button is not filled red |
| `sync-badge--idle` | `--fg-subtle` |
| `hostkey--unknown` | `--warn` border |
| `hostkey--mismatch` | `--danger` border, heavier weight |
| `transfer__progress` | styled `<progress>` on `--accent` |
| `transfer__error` | `--danger` text |

`hostkey--mismatch` and `hostkey--unknown` must be distinguishable at a
glance. A mismatch is a possible attack; an unknown key is routine.

The existing `' …'` appended to reconnecting tab titles stays — the dot is an
addition, not a replacement, so screen readers lose nothing.

### Empty states

`terminal-tabs__empty` and `host-list__empty` are bare `<p>` elements in open
space. CSS centres them on both axes, sets `--fg-subtle`, and caps width at
`32ch`. No illustrations, no added markup.

### Motion

Two transitions only: `background-color` and `border-color` at
`--motion-fast`, and one shared pulse used by both the reconnecting tab dot
and the running sync dot. Both are disabled under
`@media (prefers-reduced-motion: reduce)`.

### Focus

Every interactive element carries a `:focus-visible` ring in `--accent`, with
enough offset to read against `--bg-raised`. This is a keyboard-driven
application; the focus ring is functionality, not decoration.

## 4. Verification

**jsdom does not compute layout.** The 184 existing tests query by role and
text. A completely wrong stylesheet still leaves them green. Unit tests
cannot be the evidence for this work — the same gap that let Plan 3 finish
"complete" while the app looked unstyled.

Three tiers, in increasing order of trust:

1. **Unit tests, as regression cover for section 2 only.** The four markup
   changes are the sole risk to the suite. Run `npm test` after each. The
   titlebar move specifically must keep `role="tablist"` present and
   `aria-selected` switching.

2. **Playwright screenshots through the existing e2e harness.**
   `apps/desktop/e2e` already boots real Electron. Capture: unlock, empty
   sidebar, populated sidebar, terminal with tabs, SFTP browser, host-key
   mismatch. These are captured for a human to look at. No pixel comparison —
   it would break on every colour change and become debt.

3. **Visual review, which is the real acceptance criterion.** Run
   `npm run dev` and look at every screen. A ticked checkbox over an ugly app
   means nothing.

Additional gates:

- **Contrast** verified per pair before the palette is frozen, not after.
- **CSP** unchanged. No remote fonts, no remote images, no `url()` reaching
  outside the bundle.
- **Drag regions** tested by hand on both macOS and Windows. A wrong
  `-webkit-app-region` makes controls unclickable or the window immovable.

## Risk

Scope drift. The non-goals list will look negotiable once the app starts
looking good. It is not; each item there is a separate spec.
