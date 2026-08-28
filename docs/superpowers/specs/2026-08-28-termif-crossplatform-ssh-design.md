# Termif — Cross-Platform SSH Client Design

**Date:** 2026-08-28
**Status:** Approved design, ready for implementation planning

## 1. Purpose

A Termius-like SSH client for macOS, Windows, iOS, and Android. Host and
credential data lives in the user's own Google Sheet, encrypted client-side.
One protocol core and one business-logic core are written once and shared by
all four platforms; only the UI shell differs.

### Success criteria

- A real SSH terminal on all four platforms, not a host manager with a desktop-only terminal.
- Adding a host on a phone makes it appear on the desktop, and the reverse.
- Google never holds a readable credential.
- SSH protocol behaviour is identical on every platform, because it is one implementation.
- Works offline for everything that does not require the network.

### Non-goals for this design

Telnet, Mosh, serial console, terminal split panes, team/shared vaults,
agent forwarding, and a hosted sync service. Locales other than English.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Mobile scope | Full SSH terminal | The product is a terminal; a host-manager-only mobile app is a different product. |
| Credential storage | Google Sheet holding ciphertext, client-side key | Sync is trivial and Google is not trusted with secrets. |
| Code sharing | Shared cores, two UI shells | Sharing the expensive layers (protocol, logic) without forcing one UI toolkit to be mediocre on four platforms. |
| Feature scope | SSH multi-tab, snippets, SFTP, port forwarding | Requested. Acknowledged as a multi-month build. |
| Sync conflicts | Per-row last-write-wins on `updated_at` | Single-user app; real conflicts are rare and an event log is not worth its cost. |
| SSH transport | One Rust core over FFI | Identical behaviour everywhere, full control, no dependency on a weakly maintained RN SSH library. |
| Mobile terminal | `xterm.js` inside a WebView | The same emulator on all four platforms; writing a terminal emulator is thousands of edge cases already solved. |
| i18n | Present from day one, `en` only in v1 | Retrofitting i18n means touching every view; the wrapper is cheap now. |

## 3. Architecture

    ┌──────────────────────────────────────────────────────┐
    │  UI shells (written twice, both React)               │
    │  apps/desktop  Electron + xterm.js                   │
    │  apps/mobile   React Native + xterm.js in WebView    │
    └────────────────────┬─────────────────────────────────┘
                         │  TypeScript API
    ┌────────────────────┴─────────────────────────────────┐
    │  packages/core  (TS, written once, fully shared)     │
    │  vault · store · sync · sessions · transfers · forwards │
    └────────────────────┬─────────────────────────────────┘
                         │  FFI (napi-rs / uniffi)
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

| Target | Bridge | Loaded by |
|---|---|---|
| macOS / Windows / Linux | `napi-rs` → `.node` | Electron main process |
| iOS | `uniffi` → XCFramework | React Native native module |
| Android | `uniffi` → `.so` + JNI | React Native native module |

One `crates/ssh-core` with a single async API, plus two thin binding crates
(`crates/ffi-napi`, `crates/ffi-uniffi`) that translate types only. Logic in
a binding is a bug written twice.

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
force expensive. `kdf_params` lives in `meta` rather than in code so cost can
be raised later without breaking existing vaults, and so weaker mobile
hardware is accounted for.

The vault key exists only in memory and is cleared when the app locks or goes
to the background. An opt-in "remember this device" wraps the vault key with
the platform keystore (iOS Keychain, Android Keystore, macOS Keychain,
Windows DPAPI) behind biometrics. Without this, users would pick short
passwords to survive daily use, which is a net loss.

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
    async fn trust_host_key(host: String, fingerprint: String) -> Result<()>

    // PTY / shell — one session, many channels, so many tabs
    async fn open_shell(s: SessionId, pty: PtySize) -> Result<ChannelId>
    async fn write(c: ChannelId, data: Vec<u8>) -> Result<()>
    async fn resize(c: ChannelId, pty: PtySize) -> Result<()>
    async fn close_channel(c: ChannelId) -> Result<()>

    // SFTP
    async fn sftp_list(s: SessionId, path: String) -> Result<Vec<DirEntry>>
    async fn sftp_stat / sftp_mkdir / sftp_rename / sftp_remove(...)
    async fn sftp_read_range(s, remote: String, off: u64, len: u32) -> Result<Vec<u8>>
    async fn sftp_download(s, remote: String, local: String) -> Result<TransferId>
    async fn sftp_upload(s, local: String, remote: String) -> Result<TransferId>
    async fn cancel_transfer(t: TransferId) -> Result<()>

    // Port forwarding
    async fn forward_local(s, local_bind: String, remote: String) -> Result<ForwardId>
    async fn forward_remote(s, remote_bind: String, local: String) -> Result<ForwardId>
    async fn close_forward(f: ForwardId) -> Result<()>

    // The single upward channel
    async fn next_events(timeout_ms: u32) -> Vec<Event>

`Event` is a tagged enum: `ChannelData { channel_id, bytes }`,
`ChannelClosed { id, exit_status }`, `SessionClosed { id, reason }`,
`TransferProgress { id, done, total }`, `TransferDone { id, result }`,
`ForwardAccepted { id, peer }`, `Log { level, msg }`.

Transfers take local file paths instead of returning bytes: moving a 2 GB
file through FFI into a JS buffer and then to disk is three copies and an
out-of-memory crash on a phone. Rust writes the file directly and reports
progress. Viewing a remote file is the separate, size-capped
`sftp_read_range`.

Threading: one Tokio runtime holds every session. `next_events` is async and
does not spin. TypeScript runs exactly one drain loop and fans out to tabs,
rather than one loop per tab.

### known_hosts

Managed by Rust in a local per-device file and deliberately **not** synced
through the Sheet. Syncing known_hosts would let one compromised device
install a forged host key on every other device, turning a convenience
feature into an MITM vector.

### Port forwarding by platform

| Platform | Local (`-L`) | Remote (`-R`) | Dynamic (`-D`, SOCKS) |
|---|---|---|---|
| macOS / Windows / Linux | yes | yes | yes |
| Android | yes (foreground service required while backgrounded) | yes | yes |
| iOS | foreground only | yes (no local listener needed) | foreground only |

iOS does not allow a background app to hold a listening socket. This is an OS
limit with no workaround, so the UI states it plainly instead of letting a
forward die silently.

## 6. `packages/core` and the UI boundary

Core is plain TypeScript and imports nothing from Electron or React Native.
The platform is injected:

    interface Platform {
      ssh: SshBridge           // down to Rust, via IPC or native module
      secureStore: SecureStore // Keychain / Keystore / DPAPI
      db: LocalDb              // SQLite
      net: HttpClient          // Sheets API
    }

A CI build of core with no platform bound guards this: a single stray
`import { ipcRenderer }` would break mobile at runtime, so it is caught at
build time instead.

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

Both shells run `xterm.js`, so all four platforms share one emulator and one
set of terminal behaviours.

- Desktop: `xterm.js` with `@xterm/addon-webgl`.
- Mobile: `xterm.js` in `react-native-webview`, bytes bridged via `postMessage`.

The cost is bridge latency and more awkward keyboard handling on mobile; the
alternative is a hand-written emulator, which means wide characters,
combining marks, mouse tracking, and alternate screen handling all done
worse.

Mobile keyboard is real work, not a detail: an accessory bar with `Tab`,
`Ctrl`, `Esc`, arrows, `|`, `~`, `/`, and a snippet button. Without it, SSH on
a phone is unusable — which is why snippets matter more on mobile than on
desktop.

### Reconnect

When the network changes, the session dies. Core sees `SessionClosed`,
reconnects with backoff, and rebuilds channels and forwards. Terminal
**contents cannot be restored** — plain SSH has no resume; that is what Mosh
is for, and it is out of scope. The UI says the connection dropped and a new
shell was opened, with scrollback preserved, rather than pretending the
session was continuous.

### i18n

Every user-facing string goes through `t()` from the first commit, with `en`
as the only bundled locale in v1. Strings live in `packages/core` (or
`ui-shared`) so both shells draw from one catalogue.

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
- UI shells: smoke tests only. UI churns, and cheap UI tests become debt.

## 9. Repository layout

    termif/
      crates/
        ssh-core/          # russh and protocol logic, no FFI
        ffi-napi/          # → Electron
        ffi-uniffi/        # → iOS / Android
      packages/
        core/              # shared TypeScript
        ui-shared/         # shared React components (host list, forms, snippets)
      apps/
        desktop/           # Electron
        mobile/            # React Native
      docs/superpowers/specs/

`ui-shared` holds logic-shaped React components that are compatible with
`react-native-web` where that is practical. Anything needing a native feel is
written per app. UI is not shared for its own sake.

## 10. Known risks

| Risk | Mitigation |
|---|---|
| Four-target Rust toolchain is the main setup cost | Build all targets in CI from day one, so a broken target is caught immediately rather than at release |
| iOS background limits break forwarding | Stated in the UI; foreground-only forwards are labelled as such |
| WebView bridge latency on mobile terminals | Batch `ChannelData` per animation frame; measure before optimising further |
| Sheets API quota under frequent edits | Debounced pushes, `batchUpdate`, exponential backoff |
| Master password loss means unrecoverable credentials | Stated during setup; export of a plaintext backup is an explicit, deliberate user action |
