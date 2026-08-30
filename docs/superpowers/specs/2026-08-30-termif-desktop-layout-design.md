# Termif — desktop layout and interaction design

**Date:** 2026-08-30
**Status:** design of record for the desktop shell's layout.
**Extends:** [`2026-08-30-termif-desktop-visual-design.md`](2026-08-30-termif-desktop-visual-design.md)
— that spec set the palette, the type ramp, and the dark-only decision, and all
of it still holds. This one settles *arrangement*: what lives where, what
happens when the window is resized, and how the app stops breaking its own
layout.
**Interacts with:** [Plan 6](../plans/2026-08-30-termif-06-local-only.md) — it
deletes the sign-in screen and the sync badge, which frees the sidebar footer,
and it rewrites the `credentials` table, which is where the passphrase fix in §6
belongs.

## 1. The problem

Three complaints, each with a cause in the code rather than in taste:

1. **The layout breaks when the window is resized.** `.layout` is
   `grid-template-columns: var(--sidebar-width) 1fr` with a hard 260px sidebar
   that never yields. A bare `1fr` track is `minmax(auto, 1fr)`, so the main
   column can never be narrower than its content — long output pushes it wider
   instead of letting it scroll. Three list rows (`.host-list li`,
   `.forwards__list li`, `.transfer-list li`) are grid or flex containers whose
   text cells lack `min-width: 0`, so a long hostname widens the row rather than
   being clipped.
2. **Things are in the wrong place.** Terminals, Files, and Forwards are three
   mutually exclusive panes: opening Files destroys the terminal view, even
   mid-command. The host form does the same thing — editing a host replaces the
   entire main area. Two instances of one mistake.
3. **It does not look like a finished product.** No visual hierarchy in the
   sidebar, `groupId` and `tags` written to the database but never displayed,
   four overlay styles for four dialogs, and dead space where structure should
   be.

## 2. Direction

**Native macOS.** Xcode and Finder are the reference: a quiet sidebar with small
uppercase group headers, a toolbar that carries the window controls, sheets for
document-modal work, an inspector column for properties.

**Two token sets.** v1 ships macOS and Windows. macOS follows Apple's
conventions; Windows follows Fluent. They differ in corner radius, row height,
accent, sidebar treatment, and button style — and in nothing else. Diverging the
spacing scale or the type ramp as well would make them two applications.

## 3. Layout skeleton

```
┌─ titlebar ─────────────────────────────────────────┐  38px, drag region
│ ●●●   [ Files | Forwards ]                    ⓘ    │
├──────────┬──────────────────────────┬──────────────┤
│ sidebar  │ tab  tab  tab         +  │  inspector   │
│          ├──────────────────────────┤  (toggled)   │
│ groups   │        terminal          │              │
│ hosts    ├──────────────────────────┤              │
│          │  drawer: Files/Forwards  │              │
└──────────┴──────────────────────────┴──────────────┘
```

`.layout` becomes:

    grid-template-columns: var(--sidebar-w) minmax(0, 1fr) var(--inspector-w)

`minmax(0, 1fr)` is the load-bearing change. Without the explicit `0` minimum,
the main column inherits `min-width: auto` and refuses to shrink below its
content — the direct cause of complaint 1.

### 3.1 Four invariants

Written once in `base.css`, applied everywhere:

1. Every grid and flex cell containing text carries `min-width: 0`.
2. Every scroll region carries `min-height: 0` and `overflow: auto`. No
   percentage heights on flex items whose own height is not resolved —
   `.transfer-list`'s `max-height: 30%` is replaced by `max-height: 160px`.
3. Single-line text clips with `text-overflow: ellipsis`; multi-line text uses
   `line-clamp`. Nothing overflows its container.
4. No hard pixel widths outside three custom properties: `--sidebar-w`,
   `--inspector-w`, `--titlebar-h`.

### 3.2 Breakpoints

The sidebar and the inspector have their own thresholds; they are not the same
number and must not be written as one table row.

| Window width | Sidebar |
|---|---|
| ≥ 1000px | open, drag-resizable 200–400px |
| < 1000px | collapses to a 48px rail |

| Window width | Inspector (when toggled on) |
|---|---|
| ≥ 1100px | inline third column |
| < 1100px | overlays the main area with a dimmed backdrop |

Minimum window size stays 900×600. At 900px the sidebar is a 48px rail, leaving
852px — enough for 80 columns of 12px monospace with the drawer open.

## 4. Sidebar

**Groups.** `groupId` is a nullable string already in the schema and already
written by the host form, but never read for display. Use the string itself as
the group name. Creating a group means typing a new name in the inspector; a
group with no hosts disappears. No `groups` table, no management screen, no
migration.

Hosts with no group fall into "Other", pinned last. Other groups sort by name.
Collapsed state persists in `meta` under `sidebar.collapsedGroups` as a JSON
array of names.

**Host row.** Two lines in a `[dot] [content] [actions]` grid, 40px tall:

- Line 1: label, `--fg`, 13px, weight 500.
- Line 2: `user@hostname`, plus `:port` when it is not 22, `--fg-muted`, 11px
  monospace.
- Both lines: `min-width: 0` and ellipsis.

The status dot uses the same colours as the terminal tab dot — green connected,
amber reconnecting, grey closed. Today the tab has a dot and the sidebar does
not, so one state is described two ways.

The `⋯` actions button appears on hover and on `:focus-within`, hidden by
opacity rather than `display` so it stays keyboard-reachable. It opens the same
menu component as the file context menu (§6).

**Search** flattens the list and ignores groups and collapsed state. A collapsed
group hiding a search result is a bug, not a feature.

**The 48px rail** does not attempt to list 40 hosts as icons. It shows only
*connected* hosts as status dots with tooltips, plus a button at the top that
opens the full sidebar as an overlay. With nothing connected it shows only that
button.

**Resize** grabs a 4px strip on the right border, `cursor: col-resize`, clamped
to 200–400px, persisted in `meta` under `sidebar.width`. Double-clicking the
border restores 260px.

**Footer.** Plan 6 removes the sync badge and the sign-in button, emptying
`.layout__account`. The footer is removed rather than refilled; host counts
already live in the group headers.

## 5. Main area

**Tab bar.** One tab per session: status dot, title, close button. Width
`minmax(80px, 180px)`. Overflow collapses into a `+N` button that opens a menu —
not horizontal scrolling, which nobody discovers, and which
`.terminal-tabs__bar` uses today. `+` opens a session to the selected host.
⌘1–9 select, ⌘W closes, ⌘⇧[ / ⌘⇧] cycle.

**Drawer.** Files and Forwards slide up from the bottom of the main area,
pushing the terminal up rather than covering it. Height is drag-resizable from
120px to 70% of the main area, persisted in `meta` under `drawer.height`. ⌘J
toggles, Esc closes.

The titlebar's segmented control changes meaning: it no longer selects one of
three exclusive panes, it selects the drawer's content and toggles the drawer.
Pressing "Files" while the drawer is closed opens it on Files; pressing it again
closes the drawer. Terminals leaves the control entirely, because the terminal
is always visible — the control has two buttons, not three.

**The drawer follows the active session.** Switching terminal tabs switches the
drawer's target. Per-session state is kept separately: current directory, scroll
position, open forwards. Returning to a tab returns to where you were, not to
`/`.

With no session open, the drawer shows one line — "Connect to a host to browse
files" — rather than empty space.

**Empty main area.** No tabs: a centred block, `--fg-subtle`, "Select a host, or
⌘N to add one". `.terminal-tabs__empty` currently centres with `margin: auto`,
which works only because its parent is a flex column; it becomes
`place-content: center`.

**The terminal must be re-fit on every size change.** `@xterm/addon-fit`
recomputes rows and columns only when called. Resizing the sidebar, the drawer,
or the inspector changes the terminal's size without changing the window's, so
`window.onresize` never fires. A `ResizeObserver` on the terminal's container
calls `fit()` and then `ssh:resize`, throttled to about 100ms. Without it every
other change in this spec looks right and the terminal's text is wrong.

## 6. Inspector and overlays

**Inspector.** A 240px right column, off by default, toggled with ⌘⌥I or the ⓘ
titlebar button. Below 1100px it overlays the main area with a dimmed backdrop
instead of taking a column.

It shows the host **selected in the sidebar**, not the host of the active
terminal tab. Those are different things and conflating them is confusing: you
can watch logs on one host while editing another.

Fields: Label, Hostname, Port, Username, Group (free-text with suggestions from
existing groups), Tags, Credentials.

**Save-as-you-type, conditionally.** Writes happen on blur, or 400ms after
typing stops, and *only when the value is valid*. Invalid input shows an inline
error under the field with a `--danger` border and does not write. Persisting a
port of 0 or an empty label is data corruption, not convenience.

**Adding a host** follows Finder's "New Folder": ⌘N creates a host named "New
host" immediately, focus lands in the inspector's label field, typing saves. One
interaction model, no separate add-sheet.

### 6.1 Private keys

The form already supports pasting a key: `HostForm.tsx` renders a textarea for
PEM plus a passphrase field, `sessions.ts` accepts `privateKeyPem` and
`passphrase`, and `crates/ffi-napi/src/lib.rs:51` maps them to
`ssh::Credential::Key { pem, passphrase }`. Two things are missing and one is
broken.

**Missing — a file picker.** The `app:pickFile` IPC channel already exists and
is used for SFTP uploads; the host form never calls it. The inspector gets a
"Choose file…" button that reads the file in the main process and stores its
**contents**, not its path. Storing `/Users/x/.ssh/id_ed25519` would break the
moment the database is copied to another machine, which is Plan 6's entire
purpose.

**Missing — validation on entry.** Whatever arrives, by picker or by paste, is
checked: valid PEM/OPENSSH framing, key type detected (ed25519, rsa, ecdsa),
fingerprint displayed. Pasting a public key or a stray file is then obvious
immediately rather than at connect time.

**Broken — the passphrase is silently discarded.** `HostForm.tsx:60` reads:

    secret: authType === 'key' && passphrase.length > 0 ? secret : secret,

Both branches are identical. `SecretInput` has no passphrase field,
`resolveCredential` returns `{ privateKeyPem: secret }` with no passphrase, and
so **a passphrase-protected key cannot connect at all**. The fix — a
`passphrase` column, a field on `SecretInput`, and passing it through
`resolveCredential` — belongs to Plan 6 Task 2, which is already rewriting the
`credentials` table. Folding it in costs nothing; a second migration later costs
a migration.

The paste textarea stays but is collapsed by default, summarised to one line
once a key is present.

### 6.2 Sheets

One style for three dialogs that currently have three: host-key confirmation,
the connect-time password prompt, and delete confirmation. Slides down from the
titlebar, max-width 520px, backdrop at 45%, `role="dialog"` with `aria-modal`,
focus trapped, Esc closes, focus returns to its origin.

Host-key confirmation keeps the distinction already in the CSS: an unknown key
gets a `--warn` border, a mismatched key a 2px `--danger` border. One is routine
and the other may be an attack; they must not look alike.

**The snippet palette is not a sheet.** It is a Spotlight-style floating panel:
560px wide, 15% from the top, ⌘K to open, type to filter, Enter to run. A sheet
is attached to the window and says "finish this first"; a palette appears and
vanishes. Using one style for both drains the meaning from each.

**Stacking.** `z-index` as named tokens, not magic numbers scattered through the
CSS: drawer 1, overlaid inspector 5, sheet 10, palette 20.

## 7. SFTP: drag-and-drop, context menu, hidden files

**Drag-and-drop upload.** The whole Files area of the drawer is the drop target.
On dragover its inner border lights `--accent` with "Drop to upload to
`<path>`". Dropping on a directory row uploads into that directory and
highlights that row; dropping anywhere else uses the current directory.

Electron 33 with `sandbox: true` no longer exposes `File.path`. The path must
come from `webUtils.getPathForFile`, surfaced through the preload bridge as one
narrow function. Without it, drag-and-drop silently does nothing.

Multiple files queue and upload **sequentially**. One SSH connection served by
ten concurrent transfers is slower, not faster, and makes the progress bar
meaningless.

Dropping a **directory** is refused in v1 with "Uploading folders is not
supported yet". `sftpUpload` takes a single file; recursive directory walking
belongs in the Rust layer and is out of scope here.

Progress reuses the existing `TransferList`, moved to the drawer's footer.

**Context menu.** Built in HTML rather than Electron's native `Menu`. A native
menu is more authentically macOS, but it needs a new IPC channel, cannot be
tested in jsdom, and cannot be reused for the sidebar's `⋯` button. One HTML
menu component serves both and is covered by the existing Vitest suite. The
trade is real and accepted: it is a drawn menu, not a system menu.

On a file or directory:

    Open / Download
    Rename            ⏎
    Copy path
    ──────────────
    Delete            ⌫

On empty space: New folder, Upload…, Refresh, separator, Show hidden files ⌘⇧.

Rename edits in place on the row — Enter commits, Esc cancels — with no dialog.
Deleting a directory asks for confirmation in a sheet and says explicitly that
it is recursive; deleting a file does not ask, because a real server has no
trash. `sftpRename` and `sftpRemove` already exist in both the IPC surface and
`sftpStore`; this is wiring, not new capability.

Keyboard parity is required: the context-menu key and ⇧F10 open the menu, arrows
move, Esc closes, `role="menu"` with `aria-activedescendant`.

**Hidden files.** A client-side filter on names beginning with `.`; no Rust
change. The toggle persists in `meta` under `sftp.showHidden` and applies to
every session. ⌘⇧. matches Finder. While hiding, the list footer reads "3 hidden
items" in muted text — a signal, not a silent omission.

## 8. Tokens, type, and density

Three files instead of one:

    tokens.css           shared: spacing, radius, motion, z-index, font stacks
    tokens-macos.css     overrides: colour, radius, row heights, sidebar surface
    tokens-windows.css   overrides: the same, per Fluent

Selection is `document.documentElement.dataset.platform`, set at boot from the
existing `app:platformKind` channel, and matched in CSS as
`:root[data-platform="windows"]`. One build serves both platforms, and a test
can exercise either by setting the attribute.

**Vibrancy is not implemented in v1.** A true Finder-style translucent sidebar
needs `vibrancy` on the `BrowserWindow` and a transparent window background, and
a transparent window combined with xterm's WebGL renderer is a known source of
GPU cost and flicker during resize. Instead the sidebar uses
`rgba(255,255,255,.03)` over `--bg-app` — visually most of the way there, at no
risk. Real vibrancy stays an optional later step with its cost recorded here.

**Type ramp**, five roles:

| Role | Size | Used for |
|---|---|---|
| Group header | 11px, uppercase, .08em tracking, `--fg-subtle` | sidebar group headers |
| Secondary | 11px, `--fg-muted` | `user@host`, file sizes |
| Body | 13px, `--fg` | host labels, field labels, buttons |
| Emphasis | 15px, weight 600 | sheet titles |
| Mono | 12px | terminal, paths, ports, fingerprints |

Every numeric column uses `font-variant-numeric: tabular-nums` so values do not
jitter as they update. The current CSS does this in some places; it becomes
consistent.

**Density.** Host row 40px, file row 28px, toolbar 34px, titlebar 38px. The
existing 4px spacing scale stays, plus `--space-0: 2px` for intra-row gaps.

**Contrast tests cover both sets.** `palette.ts` and `palette.test.ts` currently
mirror `tokens.css` one-to-one and assert WCAG ratios. They become two palettes
exported from one module, with the test looping over both. The thresholds do not
change: body text ≥ 4.5:1, large text and borders ≥ 3:1.

## 9. Testing: how this stops regressing

**The current suite cannot catch layout breakage.** All 227 desktop tests run in
jsdom, which does not lay out — every `getBoundingClientRect` returns zeroes.
Overlap, overflow, and clipping are invisible to it. That is why the missing
`min-width` rules never turned a test red. A real-layout tier is therefore not
optional.

**1. A hostile fixture, written once.** A seeded database with 40 hosts across 6
groups; one group name of 40 characters; one host label of 60 characters with no
spaces; one with Vietnamese diacritics; one with emoji; a five-digit port; a
30-character username; 12 open tabs; a 200-character SFTP path; a 120-character
filename. Layouts break on real, ugly data. A test using `prod-db` will stay
green and stay useless.

**2. Layout invariants under Playwright with real Electron.** For each width in
`[900, 1000, 1100, 1280, 1600, 2560]` and each token set:

    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth)

    for (const sel of ['.sidebar', '.main', '.drawer', '.inspector'])
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1)

    expect(maxElementRight).toBeLessThanOrEqual(windowWidth)

These are invariants, not snapshots: they need no updating when a colour
changes, and they go red exactly when something overflows. Twelve passes share
one app launch.

**3. Both sides of every breakpoint.** At 999px the sidebar is a rail; at 1001px
it is open. At 1099px the inspector overlays; at 1101px it is a column. Off-by-one
breakpoint errors are the classic failure here.

**4. The terminal really re-fits.** Read `term.cols` through `page.evaluate`,
drag the drawer, read it again, and assert both that it changed and that
`ssh:resize` was called. This is where §5's `ResizeObserver` lives or dies, and
no jsdom test can reach it.

**5. Screenshots for humans, not for machines.** One image per width into
`test-results/`, reviewed by eye. **No pixel-diff baselines**: the 2026-08-28
spec §8 already records that a broad end-to-end suite is maintenance debt, and
an image baseline goes red on every one-pixel colour change, which teaches
people to click "update baseline" without looking.

**6. What stays in jsdom.** Logic is cheap to test at the old tier: the hidden
file filter, grouping hosts by `groupId`, collapse state, the context menu
opening on the right item, the inspector writing only on valid input, the upload
queue running sequentially.

## 10. Non-goals

- Light theme and theme switching — still excluded, per the visual design spec.
- Real macOS vibrancy — deferred, with its cost recorded in §8.
- Recursive directory upload — needs Rust work, out of scope.
- A groups management screen — groups are strings, created by typing.
- Pixel-diff visual regression baselines — §9.5.
- Mobile layouts — still out of v1 scope.

## 11. Risks

1. **The `ResizeObserver` loop.** Calling `fit()` inside an observer that
   observes an element `fit()` resizes can loop. It must be throttled and must
   bail when dimensions are unchanged. Symptom is a pegged CPU, not a visual
   bug, so it will not show up in a screenshot review.
2. **`webUtils.getPathForFile` under a sandboxed renderer.** If the preload
   bridge is wrong, drag-and-drop fails silently — no error, no upload. Needs an
   e2e test that actually drops a file, not a unit test of the handler.
3. **Two token sets doubling the review surface.** Every visual change now has
   two correct answers. The contrast test covering both palettes is what keeps
   the Windows set from quietly rotting.
4. **Save-as-you-type writing partial data.** The 400ms debounce plus the
   validity gate must be tested together; a validity check that runs before the
   debounce rather than inside it will still write bad rows.
5. **Scope collision with Plan 6.** Both specs edit the sidebar footer, the
   `credentials` table, and `boot.ts`. Plan 6 runs first; this work rebases onto
   it rather than the two proceeding in parallel.
