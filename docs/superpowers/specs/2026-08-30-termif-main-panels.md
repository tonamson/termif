# Termif — main panel switching (terminal-first)

**Date:** 2026-08-30
**Status:** design of record for how the main area switches between the
terminal and the SFTP panel.
**Supersedes:** the *drawer paragraphs* of §5 in
[`2026-08-30-termif-desktop-layout-design.md`](2026-08-30-termif-desktop-layout-design.md)
— the bottom drawer for Files/Forwards, the drawer's meaning for the titlebar
segmented control, ⌘J, and `drawer.height` persistence. Everything else in
that spec (sidebar, inspector, invariants, tokens, SFTP drag-and-drop and
context menus, §9's real-layout test tier) still stands.
**Owner decision, 2026-08-30:** the drawer model was wrong for this product.
SFTP must behave like Termius — a top-menu click switches to a dedicated SFTP
panel — not a drawer merged into the terminal's space.

## 1. The problem, with causes in code

Three defects, one per layer:

1. **Opening Files destroys the terminal layout.** `.layout__main` is a grid
   with `grid-template-rows: auto minmax(0, 1fr) auto`
   (`apps/desktop/src/renderer/styles/app.css:107`), but `MainLayout` renders
   exactly two children in it: `<TerminalTabs/>` then `<Drawer/>`
   (`apps/desktop/src/renderer/app/MainLayout.tsx:119-131`). CSS grid
   auto-placement puts the first child in row 1 (`auto`) and the second in
   row 2 (`1fr`) — so **the drawer lands in the flexible row and the terminal
   is squeezed into the auto row**. `flex: 1` on `.terminal-tabs`
   (`app.css:266`) is inert inside a grid. The layout spec §5 said the drawer
   should *push the terminal up*; the implementation inverted the two rows.
2. **The app opens on SFTP.** `drawerTab` is persisted in the `ui.prefs`
   meta blob (`apps/desktop/src/renderer/state/prefs.ts:19`). Click Files
   once and every future launch reopens the drawer on Files. The owner's
   report — "vào là giao diện sftp, không có giao diện terminal" — is this
   plus defect 1.
3. **Nothing could catch it.** The Playwright real-geometry tier promised by
   the layout spec §9 and Plan 8's own architecture note exists only as a
   self-skipping placeholder
   (`apps/desktop/e2e/layout.spec.ts:7` — `test.skip(true)`). Every layout
   test that shipped runs in jsdom, which does not lay out. The debt was
   recorded as paid; it was not.

## 2. Direction

**Termius model: three exclusive main panels.** The titlebar's segmented
control gains a Terminal button and selects exactly one panel at a time:

    Terminal   |   Files   |   Forwards

- **Terminal is the default and the home.** Every launch lands on it. It is
  never persisted away from.
- **Files** is a full-height SFTP panel — the dual-pane local/remote browser
  (uncommitted work already in the tree) — not a strip under a terminal.
- **Forwards** is the existing `ForwardPanel`, full-height.
- One panel occupies the main area at a time. There is no drawer, no
  resizable drawer height, no drawer keyboard shortcut.

## 3. Behavior

1. **Switching** is by the titlebar buttons only (plus Esc, below). Clicking
   the active panel's button again does nothing — panels are exclusive
   selections, not toggles.
2. **Launch state is Terminal, always.** The selected panel is React state in
   `MainLayout`, default `'terminal'`, **never persisted**. The stale
   `drawerTab`/`drawerHeight` keys in existing `ui.prefs` blobs are simply
   dropped by the sanitiser on next load; no migration.
3. **Connecting a host lands on the terminal.** Double-clicking a host or
   pressing Connect while on Files/Forwards switches to Terminal before the
   connection starts. A user who reaches for a host is reaching for a shell.
4. **Sessions outlive panel switches.** All terminal tabs and their xterm
   instances stay mounted; the terminal panel is hidden with the `hidden`
   attribute while another panel is active. Switching back shows the same
   tabs with scrollback intact. `display: none` on a grid item removes it
   from the grid, so the active panel owns the full row.
5. **Re-fit on return.** xterm's fit must not run against a zero-size
   container: the refit path bails when the container measures 0×0 (what a
   hidden panel reports) and re-fits through the existing throttled
   `ResizeObserver` when the terminal panel is shown again. This guard is
   what keeps hide/show from collapsing the terminal to 0 rows.
6. **Esc returns to the terminal** when focus is inside the Files or Forwards
   panel. The handler lives on the panel section, not on `window`, so it
   cannot fight the shell-level sheets (host-key, delete confirm) which
   listen on `window` and render outside the panels.
7. **⌘J is deleted.** It opened the drawer; the drawer no longer exists. ⌘N
   (new host) is untouched.
8. **No-session empty state stays.** Files with no connected session shows
   the existing `sftp.noSession` line. The panel is still a full-height
   surface — the empty state is centred in it, not a one-line orphan.

## 4. The Files panel

The dual-pane SFTP browser currently uncommitted in the working tree
(`SftpBrowser.tsx` local/remote panes, `localStore.ts`, `app.localList` /
`app.localHome` / `app.pickSaveLocation` IPC) is **kept** and re-homed into
this panel. It already follows the layout spec §7 rules that still stand:
sequential upload queue, directory-drop refusal, hidden-files toggle in
`meta`. The panel wrapper is `<section class="panel" data-panel="files">` —
the browser fills it; nothing else is added in v1.

## 5. The grid that cannot regress

`.layout__main` becomes `grid-template-rows: minmax(0, 1fr)` and hosts at
most one visible panel. The auto-placement inversion of §1.1 becomes
structurally impossible: there is never a second child to misplace. The
`.drawer*` CSS rules are deleted with the component.

## 6. The resize oscillation (measured 2026-08-30)

**Symptom:** "screen bị flash scroll liên tục" — the page scrollbar toggles
and the terminal re-fits forever once a session is open.

**Instrumented evidence** (Playwright + `_electron.launch`, ResizeObserver
wrapped by an init script, connected session against the docker test sshd):

| | RO callbacks | overflow |
|---|---|---|
| unfixed | **28.5 / s**, alternating two geometries | `scrollHeight 804 > clientHeight 790` |
| + the two CSS lines below | **0.0 / s** | `800 = 800`, `1280 = 1280` |

The two alternating states, sampled at 60 ms:

| | state A | state B |
|---|---|---|
| body | `sw 1273 > cw 1270` — scrollbar on | `sw 1280 = cw 1280` — scrollbar off |
| xterm | 994 × **720** | 1004 × **705** |

**Chain:** xterm's fitted canvas sits exactly at the viewport edge → a few
pixels of height change push `scrollHeight` past `clientHeight` → the
**document** scrollbar appears (`.terminal-pane` has no `overflow: hidden`
and `body` none either, so the pane's overflow propagates to the page) →
the viewport narrows 10 px → `ResizeObserver` → `fit()` recomputes cols/rows
→ `ssh:resize` → shell redraw changes height again → scrollbar disappears →
… forever. The existing unchanged-dims guard cannot stop this: cols/rows
*alternate* between two values, they never repeat consecutively. This is the
loop layout spec §11.1 warned about; its prescribed fix ("bail when
dimensions are unchanged") was implemented and is provably insufficient
against alternation.

**Fix — the driver, not a smarter guard:**

1. `html, body { overflow: hidden }` in `base.css` — the app is a
   fixed-viewport desktop shell with internal scroll regions; the document
   never scrolls, so content can never resize the layout viewport.
2. `.terminal-pane { overflow: hidden }` — xterm's canvas overhang is
   clipped inside the pane instead of poking the page's scrollable overflow.

No latch, no hysteresis in the refit path: with the viewport frozen, the
A↔B driver cannot exist. The regression net is a real e2e invariant
(`e2e/oscillation.spec.ts`, sshd-gated like `status.spec.ts`): after
connect, `document.documentElement` must satisfy
`scrollWidth ≤ clientWidth && scrollHeight ≤ clientHeight`, and the wrapped
ResizeObserver callback count over a 6 s idle window must be bounded (≤ 10).
Measured today: 171 callbacks in 6 s unfixed, 0 fixed.

## 7. Testing

1. **jsdom (logic tier):** panel switching — launch lands on Terminal with
   the other panels absent; Files shows the SFTP browser and hides the
   terminal container; Esc returns; Connect switches to Terminal; the prefs
   sanitiser drops the dead drawer keys. The panel switch itself is
   state, not geometry, so jsdom is the right tier for it.
2. **Playwright + Electron (geometry tier — the debt paid):** rewrite
   `e2e/layout.spec.ts` with the real harness shape already proven by
   `e2e/smoke.spec.ts`:
   - At launch the terminal surface fills the main column (≥ 80% of
     `.layout__main`'s height) and no `.drawer` element exists.
   - Clicking Files shows a full-height `[data-panel="files"]` while the
     terminal container is `hidden`.
   - Returning to Terminal shows the terminal again.
   - One sshd-gated test (same skip-if-offline pattern as
     `e2e/status.spec.ts`): connect to the docker test server, switch to
     Files, press Esc, assert the connected tab is still there.
   These run in CI (`npm run e2e`); the sshd-gated one self-skips offline.
3. **The zero-size fit guard** gets a unit test against the existing
   `ResizeObserverStub`: a 0×0 observation produces no `fit()`/`ssh:resize`;
   a real-size observation still does. The pre-existing resize test mocks
   `getBoundingClientRect` to a non-zero box for the same reason.
4. **The oscillation invariant** — `e2e/oscillation.spec.ts` (§6): no
   document overflow, bounded RO rate after connect. This is the failing
   test that precedes the two CSS lines.

## 8. Non-goals

- A side-by-side terminal+files split view — the owner explicitly chose
  exclusive panels; do not relitigate.
- Persisting the selected panel — launch is Terminal, by owner decision.
- Replacing the host-editing `HostForm` with the inspector — pre-existing
  debt from layout spec §1.2, untouched here.
- Any change to `packages/core` beyond two i18n strings.
