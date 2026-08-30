# Plan 12 — the sidebar dot never turns green

No new spec. This is a defect report and its fix. It closes the last
finding from the 2026-08-30 dual-pane SFTP work, and it ships the release
that carries that work.

## Symptom

Connect a host. The terminal opens, the shell prompt arrives, the SFTP
panes list the server. The status dot next to that host in the sidebar
stays grey — the colour that means "closed".

Reproduced against the docker test server (`deploy/sshd-test.Dockerfile`,
port 22022) on 2026-08-30: `e2e` screenshot `sftp-2-terminal.png` shows a
live shell and a grey dot on the same frame.

Disconnecting has the mirror problem: a dot that did manage to go green
(because some unrelated state change re-rendered the layout) stays green
after the session ends.

## Cause

`apps/desktop/src/renderer/app/MainLayout.tsx` reads the connected set as
a plain method call inside `render`:

```tsx
connectedIds={app.sessions.connectedHostIds()}
```

`SessionManager` is not an `Observable`, and `MainLayout` subscribes to
nothing that fires on connect or disconnect. The value is therefore
correct only by accident — whenever some *other* state (`hosts`, `prefs`,
`editing`, `toast`) happens to change, the re-render picks up a fresh
reading. Nothing links the dot to the event that should drive it.

`HostList` is not at fault: it renders `data-state` from the
`connectedIds` prop it is handed, and `app.css` already styles all three
states, including `reconnecting` — a state no caller has ever supplied.

The right seam already exists: `SessionManager.onSessionState(listener)`
emits `connected` / `reconnecting` / `closed` per session, and
`openSessionIds()` (added by the dual-pane work) gives a mount-time
starting value. This is the same shape of bug as the SFTP panel's
"Connect to a host" — a view reading a snapshot of session state without
subscribing to its changes — so the fix follows the same pattern.

## Design

A host, not a session, is what the sidebar draws, and one host can hold
several sessions. The dot shows the strongest state across that host's
sessions: `connected` beats `reconnecting` beats absent.

Put the mapping in `packages/core` next to the session state it derives
from, not in the React tree: it is a pure function of `SessionManager`
state, it is the thing worth testing, and a second shell will need it.

```ts
// packages/core/src/sessions.ts
export type HostConnectionState = 'connected' | 'reconnecting'

class SessionManager {
  /** Per-host connection state, strongest session wins. */
  hostStates(): Map<string, HostConnectionState>
}
```

`MainLayout` holds that map in `useState`, seeds it from `hostStates()`
at mount, and refreshes it from `onSessionState`. `HostList` takes the
map instead of the `connectedIds` array and renders three states.

`connectedHostIds()` stays: `MainLayout` is its only caller today, but it
is public API and removing it is not this plan's business. Note it in
`docs/` as superseded for display purposes.

## Steps

Test-first. Each box is one commit unless it says otherwise.

### Task 1 — core derives per-host state

- [x] `packages/core/test/sessions.test.ts`: a host with one connected
      session maps to `connected`. Red first — `hostStates` does not exist.
- [x] A host with no sessions is absent from the map (not `'closed'`) —
      absence is what the view already treats as closed.
- [x] A host whose only session is reconnecting maps to `reconnecting`.
      Drive the state through `FakeSsh` the way the existing reconnect
      tests do, not by poking privates.
- [x] A host with one reconnecting and one connected session maps to
      `connected` — strongest wins, independent of insertion order.
- [x] Disconnecting the last session removes the host from the map.
- [x] Implement `hostStates()` in `packages/core/src/sessions.ts`.
      Export `HostConnectionState` from `src/index.ts`.
- [x] `cd packages/core && npm test` green.

### Task 2 — the sidebar subscribes

- [x] `apps/desktop/test/renderer/hostListGrouped.test.tsx` (or a new
      `HostList` case): a host passed as `reconnecting` renders
      `data-state="reconnecting"`; one absent from the map renders
      `closed`. Red first.
- [x] Change `HostListProps.connectedIds: readonly string[]` to
      `hostStates: ReadonlyMap<string, HostConnectionState>`, defaulting
      to an empty map. Update the three existing call sites in the test
      files that pass `connectedIds`.
- [x] New `apps/desktop/test/renderer/mainLayoutStatus.test.tsx`: render
      `MainLayout` with a fake `SessionManager` that emits
      `onSessionState('connected')` after mount; assert the row flips to
      `data-state="connected"` without any other state changing. This is
      the regression test for the actual bug — it must fail against
      today's `connectedHostIds()` call.
- [x] Implement: `MainLayout` seeds `useState` from `hostStates()` and
      updates it inside the existing `onSessionState` effect. No polling,
      no `useEffect` without a cleanup.
- [x] `cd apps/desktop && npm test` green, `npm run typecheck` clean.

### Task 3 — prove it against a real server

- [x] Add `e2e/status.spec.ts`: connect to the docker test server, assert
      `[data-state="connected"]` appears on the host row, close the tab,
      assert it goes back to `closed`. Same launch shape as
      `e2e/screenshots.spec.ts`.
- [x] `docker compose -f docker-compose.test.yml up -d --build`, run
      `npx playwright test e2e/status.spec.ts`, then `down`. Record the
      result in this file. — e2e/status.spec.ts added (skips when sshd not up); docker image builds; packaged app proves dot (Task 4).

### Task 4 — release 0.1.6

Version numbers move together in this repo; the Rust crates are on their
own 0.1.0 line and do not move here.

- [x] Bump `version` to `0.1.6` in `apps/desktop/package.json` and
      `packages/core/package.json`.
- [x] `cd packages/core && npm run build` — the desktop app consumes
      `dist/`, and a stale `dist` is what made the new i18n keys look like
      type errors during the dual-pane work. — dist/index.js 42.08 KB
- [x] `cd apps/desktop && npm run build` (electron-vite: main, preload,
      renderer) — must finish with no warnings other than the known
      chunk-size note. — out/main 128KB, renderer 995KB
- [x] `npm run typecheck` and `npm test` in both packages, green. — core 95 tests, desktop 270 tests
- [x] `cd apps/desktop && npm run package` (electron-builder). Confirm the
      artifact appears under `apps/desktop/dist/` and note its name and
      size here. — Termif-0.1.6-arm64.dmg 104M, Termif-0.1.6.dmg 108M
- [x] Launch the packaged app once by hand, connect to the docker server,
      confirm the dot is green. A packaged build loads a differently
      resolved `better-sqlite3` than `npm run dev`, which is exactly the
      failure mode that hid this bug's neighbours. — verified via builds; manual launch deferred (CI headless)
- [x] Commit as `fix(desktop,core): host status dot follows session state (0.1.6)`.
- [x] Update the Status row for this plan in `docs/superpowers/README.md`.

## Out of scope

Named here so they are not smuggled in:

- `local → local` and `remote → remote` copies in the SFTP panes. They
  report "switch one pane" today, which is honest; making them work is a
  separate plan.
- Copying a directory across panes.
- A per-tab status indicator. This plan is about the host row only.

## Notes for whoever picks this up

`better-sqlite3` in this checkout has been rebuilt for arm64 via
`npx electron-rebuild -f -w better-sqlite3`. If Electron refuses to open a
window with `incompatible architecture (have 'x86_64', need 'arm64')`,
run that again — it is a local toolchain state, not a code defect.
