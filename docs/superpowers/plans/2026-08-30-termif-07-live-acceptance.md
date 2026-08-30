# Plan 7 — Live acceptance test: real SSH server, real Google account, packaged DMG

**Status:** spec only. No code written yet. Nothing here is executed by CI.

**Purpose.** Everything green so far is unit tests, a fake platform, and one
Playwright run against a local SQLite file. Nothing has ever talked to a real
`sshd` or run from a signed `.dmg`. This plan is the checklist that closes that
gap.

**Depends on Plan 6.** The master password, the vault, and Google Sheets sync
are being removed. Run this plan after Plan 6 lands, or the C-layer steps below
will not match the app. The Google layer that used to be §5 of this plan is
deleted, not deferred.

## 0. Credentials and safety

Never commit the test credentials. They live in a gitignored file that each
operator creates locally:

    apps/desktop/e2e/.env.live      # add to .gitignore before writing it

    TERMIF_LIVE_HOST=103.172.78.21
    TERMIF_LIVE_PORT=22
    TERMIF_LIVE_USER=root
    TERMIF_LIVE_PASSWORD=...        # supplied out of band

Every live test skips itself when `TERMIF_LIVE_HOST` is unset, so the default
`npm test` / `npm run e2e` stays offline and deterministic.

**Warnings, read before running anything:**

- The account is `root`. Every SFTP write, delete, and rename test must be
  confined to a scratch directory (`/root/termif-e2e/<run-id>/`) created at the
  start of the run and removed at the end. No test may target a path outside it.
- A password in `.env.live` is plaintext on disk. Rotate it after the test
  window, and prefer creating a throwaway non-root user (`termif-e2e`) on the
  server for repeat runs.
- The remote-forward and SOCKS tests open listening ports on a public host.
  Bind them to `127.0.0.1` on the server side, never `0.0.0.0`.
- After Plan 6 lands, `termif.sqlite` holds the root password in plaintext. The
  scratch database used for this run is itself a secret: keep it in a temporary
  user-data directory and delete it when the run ends.

## 1. Preconditions to verify first

These are cheap and they fail fast. Do them before writing any test.

- [ ] `ssh root@103.172.78.21` succeeds from the shell with the given password
      (proves the server is reachable and password auth is enabled).
- [ ] Record the server host key fingerprint:
      `ssh-keyscan -t ed25519 103.172.78.21 | ssh-keygen -lf -`. The trust-on-
      first-use test asserts this exact string.
- [ ] `npx napi build --platform --release` in `crates/ffi-napi` produces
      `termif-ssh.darwin-arm64.node`, and
      `node -e "require('@termif/ssh-native').init('/tmp/kh')"` does not throw.
- [ ] Plan 1's 63 remaining checkboxes are reviewed: the Rust code exists but the
      plan is unticked, so treat every `ssh-core` behaviour below as unverified
      rather than assumed working.

## 2. Layer A — native SSH against the real server (no UI)

A Node script under `crates/ffi-napi/__test__/live.mjs`, run with
`node --env-file=../../apps/desktop/e2e/.env.live live.mjs`. This layer isolates
Rust and FFI failures from Electron failures, so a red result points at one
side of the boundary.

- [ ] **A1 Connect, host key unknown.** `init()` with an empty known-hosts path,
      then `connect()`. Expect a rejection naming an unknown/untrusted host key —
      *not* a silent success. A connect that succeeds here is a security bug and
      stops the run.
- [ ] **A2 Trust then connect.** `trustHostKey(host, 22, algo, fingerprint)` with
      the fingerprint from §1, then `connect()` returns a non-zero session id.
      Assert the known-hosts file on disk now contains one line.
- [ ] **A3 Host key mismatch.** Hand-edit the known-hosts fingerprint to a wrong
      value, reconnect, expect a mismatch error. Restore the file after.
- [ ] **A4 Wrong password.** Connect with a bad password, expect an auth failure
      error and no leaked session handle.
- [ ] **A5 Shell round trip.** `openShell(session, 80, 24)`, write `echo
      TERMIF_OK_$$\n`, drain `nextEvents(2000)` until a `channelData` event
      contains `TERMIF_OK_`. Assert bytes arrive as `Uint8Array`, not a string.
- [ ] **A6 Resize.** `resize(channel, 120, 40)`, then `stty size` on the remote
      reports `40 120`.
- [ ] **A7 Exit status.** Write `exit 3\n`; expect a `channelClosed` event with
      `exitStatus === 3`.
- [ ] **A8 SFTP list/stat.** `sftpList(session, '/')` contains `etc` with
      `isDir === true`. `sftpStat` on `/etc/hostname` returns a plausible `size`
      and `modifiedUnix`.
- [ ] **A9 SFTP write path, scratch only.** `sftpMkdir('/root/termif-e2e/<run>')`,
      upload a 5 MB random file, assert `transferProgress` events are monotonic
      and the final `done === total`, then `transferDone` with `error === null`.
      Download it back and compare SHA-256. Then `sftpRename`, `sftpRemove`
      recursive, and assert the directory is gone.
- [ ] **A10 Transfer cancel.** Start a 200 MB upload, call `cancelTransfer` mid
      flight, expect `transferDone` with a cancellation error and no hang.
- [ ] **A11 Local forward.** `forwardLocal(session, '127.0.0.1:0', '127.0.0.1',
      22)`, read the bound port with `forwardBoundPort`, then TCP-connect to it
      and assert the first bytes are an `SSH-2.0-` banner.
- [ ] **A12 SOCKS forward.** `forwardSocks(session, '127.0.0.1:0')`, then
      `curl --socks5-hostname 127.0.0.1:<port> https://example.com` returns 200.
- [ ] **A13 Remote forward.** `forwardRemote(session, '127.0.0.1', 0, ...)` bound
      to loopback on the server; trigger it with `curl` over the shell channel and
      assert a `forwardAccepted` event.
- [ ] **A14 Disconnect and cleanup.** `disconnect(session)` produces exactly one
      `sessionClosed`, and a subsequent `write()` on the dead channel rejects
      rather than crashing the process.
- [ ] **A15 Panic safety.** Call `openShell` with a bogus session id. The process
      must survive with a rejected promise — a Rust panic crossing napi would take
      the whole main process down in production.

## 3. Layer B — main-process wiring (Electron, headless-ish)

Playwright Electron, `apps/desktop/e2e/live-ssh.spec.ts`, driving the real IPC
handlers rather than the fake platform.

- [ ] **B1** `ssh:init` is called with the app's real `userData` known-hosts path
      on first connect, and the file appears there after trusting.
- [ ] **B2** Handles cross IPC as decimal strings and survive the round trip —
      assert the renderer never sees a `bigint` (structured-clone hazard noted in
      `native.ts`).
- [ ] **B3** `ssh:nextEvents` long-poll keeps delivering after an idle minute; no
      event is dropped while the renderer is mid-render.
- [ ] **B4** Every name in `handlerNames()` has a live `ipcMain` handler — extend
      the existing `ipc.test.ts` assertion to run inside the launched app.
- [ ] **B5** A `sessionClosed` caused by killing the connection server-side
      (`pkill -u root sshd` is too blunt — use `ss -K` on the one connection, or
      pull the network with a firewall rule) surfaces in the UI as a
      disconnected tab, not a frozen terminal.

## 4. Layer C — UI acceptance, the packaged app

Manual, scripted, run against the built `.dmg` — not `npm run dev`. Packaging is
where native module loading, code signing, and the sandbox actually get tested.

- [ ] **C1** `npm run package` in `apps/desktop` produces a `.dmg`; the
      `.node` binary is present inside
      `Termif.app/Contents/Resources/app.asar.unpacked/` (an asar-packed `.node`
      fails to load at runtime — check `electron-builder.yml` `asarUnpack`).
- [ ] **C2** Install from the `.dmg` on a machine that has never run the dev
      build. Gatekeeper: note whether it is signed and notarised; if not, record
      the exact bypass steps a user needs.
- [ ] **C3** First run opens straight to an empty host list — no password
      prompt, no sign-in screen. `termif.sqlite` is created on first write.
- [ ] **C4** Add host `103.172.78.21`, user `root`, password auth. Connect.
      Expect the host-key trust prompt showing the fingerprint from §1. Accept.
- [ ] **C5** Terminal renders a live shell: colours correct against the app
      palette, `htop` redraws cleanly, resizing the window reflows the remote
      `stty size`, copy/paste works, and the WebGL addon does not fall back
      silently (check the console for the fallback warning).
- [ ] **C6** Reconnect after a laptop sleep of 5+ minutes behaves as designed —
      either a clean reconnect or a clear error, never a silent dead terminal.
- [ ] **C7** SFTP browser: navigate to `/root/termif-e2e`, upload a file by drag
      and drop, watch the progress bar advance, download it back, delete it.
      Confirm the scratch directory is the only thing touched.
- [ ] **C8** Port-forward UI: create a local forward, confirm the bound port, use
      it from a browser, then close it and confirm the listener is gone
      (`lsof -i :<port>` empty).
- [ ] **C9** Quit and relaunch: the host, its saved password, and the trusted
      host key all persist.
- [ ] **C10 Portability, the point of Plan 6.** Copy `termif.sqlite` to a second
      machine's user-data directory, launch the packaged app there, and connect
      to 103.172.78.21 without re-entering anything. If the host-key prompt
      reappears, Plan 6 Task 9 is unfinished. Delete the copy afterwards — it
      holds the root password in the clear.

## 6. Exit criteria

The run is a pass when:

1. Every A and B checkbox is ticked with saved console output.
2. C1–C10 tested on the packaged `.dmg`, on a clean machine, with screenshots.
3. The scratch directory on 103.172.78.21 is gone, forwards are closed, and the
   test password has been rotated.
4. Each failure found is written up as a plan step in Plan 1, 3, or 6, not
   fixed ad hoc — the plans stay the record.

## 7. Known risk list, ranked

1. **C1** — `.node` not unpacked from asar; the app opens, and every SSH action
   throws `Cannot find module`.
2. **A15 / B5** — a Rust panic or an unhandled disconnect taking down the main
   process. Plan 1 is unticked, so this path is genuinely unproven.
3. **A9/A10** — SFTP progress accounting and cancellation on a real WAN link with
   packet loss, which no local Docker `sshd` reproduces.
4. **C2** — unsigned build; the `.dmg` "works on my machine" and is unopenable
   for anyone else.
