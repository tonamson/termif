# Termif — Cross-Platform SSH Client Design

**Date:** 2026-08-28
**Status:** Approved design. v1 implementation plans 1–3 exist. Mobile is out
of v1 scope (§11); there is no Plan 4.
**Scope revision (2026-08-28):** v1 targets **macOS and Windows only**. The
mobile shells are deferred to a later phase; see §11.

## 1. Purpose

A Termius-like SSH client. v1 ships on **macOS and Windows**; iOS and
Android are a deferred phase (§11). Host and credential data lives in the
user's own Google Sheet, encrypted client-side. One protocol core and one
business-logic core are written once, so the deferred mobile shells add a UI
shell rather than a second implementation of anything.

### Success criteria

- A real SSH terminal on macOS and Windows: multi-tab shell, snippets, SFTP, port forwarding.
- Adding a host on one desktop makes it appear on the other, through the Sheet.
- Google never holds a readable credential.
- Behaviour is identical on both desktops, because the protocol is one implementation.
- Works offline for everything that does not require the network.
- The cores carry no desktop-only assumption, so the deferred mobile phase is
  a new shell and a new FFI bridge, not a rewrite.

### Non-goals for this design

iOS and Android shells (deferred, §11). Telnet, Mosh, serial console,
terminal split panes, team/shared vaults, agent forwarding, and a hosted sync
service. Locales other than English.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| v1 platforms | macOS and Windows | Ship one shell well. Mobile is deferred (§11), not cancelled. |
| Mobile scope, when built | Full SSH terminal | The product is a terminal; a host-manager-only mobile app is a different product. |
| Credential storage | Google Sheet holding ciphertext, client-side key | Sync is trivial and Google is not trusted with secrets. |
| Code sharing | Shared cores, one UI shell in v1 | Sharing the expensive layers (protocol, logic) without forcing one UI toolkit to be mediocre everywhere. The sharing boundary is built in v1 even though only one shell consumes it, because retrofitting it later means touching every module. |
| Feature scope | SSH multi-tab, snippets, SFTP, port forwarding | Requested. Acknowledged as a multi-month build. |
| Sync conflicts | Per-row last-write-wins on `updated_at` | Single-user app; real conflicts are rare and an event log is not worth its cost. |
| SSH transport | One Rust core over FFI | Full control, and the same core serves the deferred mobile phase with no protocol work repeated. |
| Terminal emulator | `xterm.js` | Writing a terminal emulator is thousands of edge cases already solved. Mobile, when built, runs the same `xterm.js` inside a WebView. |
| i18n | Present from day one, `en` only in v1 | Retrofitting i18n means touching every view; the wrapper is cheap now. |

## 3. Architecture

    ┌──────────────────────────────────────────────────────┐
    │  UI shell (React)                                    │
    │  apps/desktop  Electron + xterm.js       ← v1        │
    │  apps/mobile   React Native + WebView    ← deferred  │
    └────────────────────┬─────────────────────────────────┘
                         │  TypeScript API
    ┌────────────────────┴─────────────────────────────────┐
    │  packages/core  (TS, written once, fully shared)     │
    │  vault · store · sync · sessions · transfers · forwards │
    └────────────────────┬─────────────────────────────────┘
                         │  FFI (napi-rs; uniffi deferred)
    ┌────────────────────┴─────────────────────────────────┐
    │  crates/ssh-core  (Rust, written once)               │
    │  russh transport · PTY · SFTP · forwarding · known_hosts │
    └──────────────────────────────────────────────────────┘

### Rust / TypeScript split

Rust owns everything that touches a socket or the SSH protocol's crypto:
handshake, authentication, channels, PTY, SFTP, forwarding, host key
verification.

TypeScript owns everything that is data or decision: which hosts exist,
tags, snippets, vault encryption, Google Sheet sync, UI state.

`ssh-core` knows nothing about Google Sheets and never sees the master
password. TypeScript decrypts the vault and passes a credential down as a
one-shot connect parameter. The Rust core holds no configuration and reads
no config file, so it is testable in isolation.

### Build targets

| Target | Bridge | Loaded by | Phase |
|---|---|---|---|
| macOS / Windows | `napi-rs` → `.node` | Electron main process | v1, shipping |
| Linux | `napi-rs` → `.node` | Electron main process | v1 CI and local-dev only; not a shipping OS |
| iOS | `uniffi` → XCFramework | React Native native module | deferred |
| Android | `uniffi` → `.so` + JNI | React Native native module | deferred |

One `crates/ssh-core` with a single async API, plus thin binding crates that
translate types only. Logic in a binding is a bug written twice. v1 builds
`crates/ffi-napi`; `crates/ffi-uniffi` arrives with the mobile phase.

`ssh-core`'s API is designed so a second binding is a translation layer and
nothing more: handles cross as `u64`, no callbacks cross the boundary, and
events are pulled by long poll rather than pushed. Those three constraints are
what make `uniffi` a later addition instead of a redesign, so they hold in v1
even though only `napi` consumes them.

The `.node` module is loaded in the Electron **main** process, not the
renderer; the renderer talks to it over IPC. That gives `packages/core` the
same shape of interface on both platforms — one async call surface plus one
event stream — which is what makes a single logic core possible.

## 4. Data model and Google Sheet sync

The Sheet is a sync medium, not a runtime database. Each device keeps a local
SQLite copy and reads from it; the Sheet is where devices meet.

### Tabs

| Tab | Columns |
|---|---|
| `hosts` | `id`, `label`, `hostname`, `port`, `username`, `auth_ref`, `tags`, `group_id`, `updated_at`, `deleted` |
| `credentials` | `id`, `label`, `kind` (`password` \| `key`), `cipher`, `updated_at`, `deleted` |
| `snippets` | `id`, `label`, `body`, `tags`, `updated_at`, `deleted` |
| `meta` | `schema_version`, `kdf_salt`, `kdf_params`, `vault_check` |

Only `cipher` is encrypted. Hostnames and usernames are plaintext so the host
list is searchable and sortable while the vault is locked. Encrypting whole
rows would remove filtering and sorting for a small gain against an adversary
who already knows the user runs an SSH client.

`deleted` is a tombstone column; rows are never removed. A physically deleted
row is indistinguishable from a row that has not synced yet, so other devices
would never learn of the deletion. Tombstones older than 90 days are pruned
during sync.

### Crypto

    master password ──Argon2id(kdf_salt, kdf_params)──> vault key (32 B)
    vault key ──XChaCha20-Poly1305(fresh random nonce per write)──> cipher
    cipher = base64(nonce ‖ ciphertext ‖ tag)
    AAD = credential.id        (binds a ciphertext to its row)

`vault_check` is the ciphertext of a fixed constant; decrypting it verifies
the password. No password hash is stored anywhere.

Argon2id rather than PBKDF2: the master password is human-chosen and will be
weak, and a memory-hard KDF is the only defence that makes offline brute
force expensive. Defaults for a new vault: `m = 65536` KiB (64 MiB), `t = 3`,
`p = 1`, 32-byte output. 64 MiB costs a brute-forcer real RAM per guess while
unlocking in well under a second on any desktop. The schema floor is 16 MiB —
below that Argon2id stops being meaningfully memory-hard. `kdf_params` lives
in `meta` rather than in code so cost can be raised later without breaking
existing vaults.

The vault key exists only in memory and is cleared when the app locks. An
opt-in "remember this device" wraps the vault key with the platform keystore
— macOS Keychain or Windows DPAPI in v1 — behind biometrics. iOS Keychain and
Android Keystore arrive with the mobile phase (§11). Without this, users would
pick short passwords to survive daily use, which is a net loss.

### Sync loop

Pull rows with `updated_at` greater than `last_pull`, merge per row by
`updated_at` with `id` as a deterministic tie-break, then push locally newer
rows via `batchUpdate`. Triggered on app start, on foreground, and after each
edit with roughly a 2-second debounce. Not realtime — the Sheets API is not
built for it and quota would not survive.

Google auth uses the OAuth device flow with scopes `spreadsheets` and
`drive.file`. `drive.file` lets the app create and use its own spreadsheet
while being unable to read anything else in the user's Drive. The refresh
token is stored in the platform keystore.

v1 ships the device-flow screen: show the user code and verification URL,
poll until Google authorises or the code expires, then attach a spreadsheet.
On first success the app looks up an existing Termif spreadsheet via Drive
`files.list` (still under `drive.file`) and creates one only if none exists.
A second desktop must find the same spreadsheet — creating a new one on every
device would fork the vault. Until the user signs in, the app stays fully
offline against the local database. The vault and SSH still work.

## 5. `ssh-core` API (the FFI boundary)

Two rules hold this boundary together: **no JS callbacks are passed into
Rust**, and **handles cross the boundary, not objects**. Callbacks over FFI
produce deadlocks and hard-to-trace crashes; objects tie two garbage
collectors' lifetimes together. Instead Rust keeps a `SessionId → Session`
registry and an event queue that TypeScript drains with an async long poll.

    // Connect / authenticate
    async fn connect(cfg: ConnectConfig) -> Result<SessionId>
    async fn disconnect(s: SessionId) -> Result<()>

    // Host keys — connect stops and asks rather than trusting
    //   Err(HostKeyUnknown { fingerprint, algo }) | Err(HostKeyMismatch { .. })
    // port and algo are part of the entry: two servers on one host, or two
    // algorithms on one server, are distinct known_hosts rows.
    async fn trust_host_key(host: String, port: u16, algo: String, fingerprint: String) -> Result<()>

    // PTY / shell — one session, many channels, so many tabs
    async fn open_shell(s: SessionId, pty: PtySize) -> Result<ChannelId>
    async fn write(c: ChannelId, data: Vec<u8>) -> Result<()>
    async fn resize(c: ChannelId, pty: PtySize) -> Result<()>
    async fn close_channel(c: ChannelId) -> Result<()>

    // SFTP
    async fn sftp_list(s: SessionId, path: String) -> Result<Vec<DirEntry>>
    async fn sftp_stat / sftp_mkdir / sftp_rename / sftp_remove(...)
    async fn sftp_read_range(s, remote: String, off: u64, len: u32) -> Result<Vec<u8>>  // cap 1 MiB
    async fn sftp_download(s, remote: String, local: String) -> Result<TransferId>
    async fn sftp_upload(s, local: String, remote: String) -> Result<TransferId>
    async fn cancel_transfer(t: TransferId) -> Result<()>

    // Port forwarding
    async fn forward_local(s, local_bind: String, remote: String) -> Result<ForwardId>
    async fn forward_remote(s, remote_bind: String, local: String) -> Result<ForwardId>
    async fn forward_dynamic(s, local_bind: String) -> Result<ForwardId>  // SOCKS5
    async fn close_forward(f: ForwardId) -> Result<()>

    // The single upward channel
    async fn next_events(timeout_ms: u32) -> Vec<Event>

`Event` is a tagged enum: `ChannelData { channel_id, bytes }`,
`ChannelClosed { id, exit_status }`, `SessionClosed { id, reason }`,
`TransferProgress { id, done, total }`, `TransferDone { id, result }`,
`ForwardAccepted { id, peer }`, `Log { level, msg }`.

Transfers take local file paths instead of returning bytes: moving a 2 GB
file through FFI into a JS buffer and then to disk is three copies and an
out-of-memory crash in the renderer. Rust writes the file directly and
reports progress. Viewing a remote file is the separate `sftp_read_range`,
capped at 1 MiB (`SFTP_READ_RANGE_MAX`). Anything larger uses upload/download.

Threading: one Tokio runtime holds every session. `next_events` is async and
does not spin. TypeScript runs exactly one drain loop and fans out to tabs,
rather than one loop per tab.

### known_hosts

Managed by Rust in a local per-device file and deliberately **not** synced
through the Sheet. Syncing known_hosts would let one compromised device
install a forged host key on every other device, turning a convenience
feature into an MITM vector.

### Port forwarding by platform

| Platform | Local (`-L`) | Remote (`-R`) | Dynamic (`-D`, SOCKS) | Phase |
|---|---|---|---|---|
| macOS / Windows / Linux | yes | yes | yes | v1 |
| Android | yes (foreground service required while backgrounded) | yes | yes | deferred |
| iOS | foreground only | yes (no local listener needed) | foreground only | deferred |

All three forward types work unrestricted on desktop, so v1 has no platform
caveat to surface. The mobile limits are recorded here because they shape an
API decision that lands in v1: a forward carries an optional human-readable
`note`, and `ForwardManager` can attach one. On desktop it is always absent.
Adding that field later would mean changing a type every shell consumes, so it
is cheaper to leave the seam open now than to cut it and re-cut it.

## 6. `packages/core` and the UI boundary

Core is plain TypeScript and imports nothing from Electron, Node, or any UI
framework. The platform is injected:

    interface Platform {
      ssh: SshBridge           // down to Rust, via IPC or native module
      secureStore: SecureStore // Keychain / Keystore / DPAPI
      db: LocalDb              // SQLite
      net: HttpClient          // Sheets API
    }

A CI purity check guards this: core is compiled with no platform bound, and a
single stray `import { ipcRenderer }` fails the build. In v1 this discipline
buys testability — core is unit-tested against a fake `Platform` with no
Electron in the process — and it is what keeps the deferred mobile phase from
becoming a fork of core.

| Module | Responsibility |
|---|---|
| `vault` | Argon2id, encrypt/decrypt, unlock/lock, key wrapping in `secureStore` |
| `store` | CRUD over hosts/credentials/snippets in `LocalDb`, change events |
| `sync` | Sheet pull/merge/push, last-write-wins, tombstones |
| `sessions` | tab → `ChannelId` map, the `next_events` drain loop, fan-out |
| `transfers` | SFTP queue, progress, retry |
| `forwards` | Forward state, re-establish after reconnect |

`sessions` is the only module with substantial state and is where bugs will
concentrate. It owns one `next_events` loop and a `Map<ChannelId,
Subscriber>`. Bytes pass straight through to the emulator; core does not
parse ANSI. Parsing in core would duplicate what the emulator does better and
would move work off the render thread that belongs on it.

### Terminal rendering

v1 runs `xterm.js` with `@xterm/addon-webgl` in the Electron renderer. The
alternative — a hand-written emulator — means wide characters, combining
marks, mouse tracking, and alternate screen handling all done worse.

Bytes arrive from core as `Uint8Array` and go straight to `term.write()`; core
does not parse ANSI. Keeping the byte path opaque is also what lets the
deferred mobile phase reuse it: the same emulator runs inside
`react-native-webview` with bytes bridged over `postMessage`, and only the
transport of those bytes differs.

### Reconnect

When the network changes, the session dies. Core sees `SessionClosed`,
reconnects with backoff, and rebuilds channels and forwards. Terminal
**contents cannot be restored** — plain SSH has no resume; that is what Mosh
is for, and it is out of scope. The UI says the connection dropped and a new
shell was opened, with scrollback preserved, rather than pretending the
session was continuous.

### i18n

Every user-facing string goes through `t()` from the first commit, with `en`
as the only bundled locale in v1. The catalogue lives in `packages/core`, not
in the shell, so a second shell inherits it rather than restating it.

Retrofitting i18n means touching every view, which is why the wrapper goes in
now even though there is one locale and one shell to serve.

## 7. Error handling

| Class | Examples | Behaviour |
|---|---|---|
| User-correctable | wrong password, unknown host, DNS failure | state the cause, keep the form open for editing |
| Security, must block | host key mismatch | **hard block**, with no "continue once" escape |
| Transient | network drop, timeout | retry with backoff, show status |
| Sync | Sheets 429 / quota | back off, queue locally, app stays usable offline |
| Programming error | FFI panic | `catch_unwind` at the boundary → `Err`, process survives |

Two points are deliberately rigid. A host key mismatch is the signature of an
MITM in progress rather than an inconvenience, so it blocks. And a panic must
never cross an FFI boundary, because that is undefined behaviour and takes
down the whole app.

Offline is the default state, not an error state: the local database is the
read source and the Sheet is only sync. With no network the user can still
browse hosts and still connect to any reachable server.

## 8. Testing

- `ssh-core`: integration tests against a real `sshd` in Docker — password
  and key auth, PTY echo, large-file SFTP round trip, each forward type, and
  host key mismatch. This is the layer most worth testing, because it is the
  protocol.
- `packages/core`: unit tests with a fake `Platform`. Fixed-vector crypto
  tests; a case table for last-write-wins merges (both sides edited, one
  deleted while the other edited, equal `updated_at`); `sessions` fan-out.
- Desktop UI: smoke tests only. UI churns, and cheap UI tests become debt.

## 9. Repository layout

    termif/
      crates/
        ssh-core/          # russh and protocol logic, no FFI
        ffi-napi/          # → Electron
      packages/
        core/              # shared TypeScript
      apps/
        desktop/           # Electron
      docs/superpowers/specs/

Deferred to the mobile phase: `crates/ffi-uniffi`, `apps/mobile`, and a
`packages/ui-shared` for components worth sharing between the two shells.

v1 creates no `ui-shared`. With one shell there is nothing to share yet, and a
package with a single consumer is an abstraction guessing at its second
caller. The mobile phase extracts it from real desktop components, which is
the only way to know what actually belongs in it.

## 10. Known risks

| Risk | Mitigation |
|---|---|
| Rust toolchain setup cost | v1 builds two targets (macOS, Windows) in CI from day one, so a broken target is caught immediately rather than at release |
| Deferring mobile lets a desktop-only assumption leak into the cores | The CI purity check on `packages/core`, and the rule that `ssh-core` reads no config and takes all input as parameters. Both are v1 requirements, both are mechanically enforced |
| The FFI shape proves wrong for `uniffi` when mobile is built | The three constraints in §3 (handles as `u64`, no callbacks across the boundary, events pulled by long poll) are chosen for `uniffi` and cost nothing under `napi`. Accepted residual risk: it is not proven until a second binding exists |
| Sheets API quota under frequent edits | Debounced pushes, `batchUpdate`, exponential backoff |
| Master password loss means unrecoverable credentials | Stated during setup; export of a plaintext backup is an explicit, deliberate user action |

## 11. Deferred: the mobile phase

Not cancelled, not scoped now. Recorded here so the decision is a decision and
not an omission, and so v1 does not quietly foreclose it.

What the deferred phase adds:

- `crates/ffi-uniffi` — `#[uniffi::export]` wrappers over the same `ssh-core`,
  plus `scripts/build-ios.sh` (XCFramework) and `scripts/build-android.sh`
  (`jniLibs` and Kotlin bindings), and CI jobs for both.
- `apps/mobile` — a React Native shell with a `Platform` built over the uniffi
  native module, mirroring the desktop adapter.
- `xterm.js` in `react-native-webview`, bytes bridged via `postMessage`.
- A keyboard accessory bar: `Tab`, `Ctrl`, `Esc`, arrows, `|`, `~`, `/`, and a
  snippet button. Without it, SSH on a phone is unusable, which is why snippets
  matter more there than on desktop.
- Vault key wrapped behind biometrics via Keychain and Keystore.
- Forwarding limited as §5 records, surfaced through the `note` field rather
  than worked around: iOS cannot hold a listening socket in the background.
- `packages/ui-shared`, extracted from the desktop components that turn out to
  be worth sharing.

What v1 must not do, or the phase above becomes a rewrite:

- No Electron, Node, or `ipcRenderer` import inside `packages/core`.
- No configuration read inside `ssh-core` — all input arrives as parameters.
- No callback, closure, or object passed across the FFI boundary.
- No ANSI parsing in core; the byte path from channel to emulator stays opaque.
