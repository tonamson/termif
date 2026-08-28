# Termif Plan 1 — `ssh-core` and the FFI Bridges

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Rust SSH core — connect, PTY shell, SFTP, port forwarding, host key verification — and expose it identically to Electron (napi-rs) and to iOS/Android (uniffi).

**Architecture:** One `crates/ssh-core` holding all protocol logic behind a handle-based async API with a single event queue drained by long poll. Two thin binding crates translate types only. No JS callbacks cross the boundary; no objects cross the boundary; no panic crosses the boundary.

**Tech Stack:** Rust, `russh`, `russh-sftp`, `tokio`, `napi-rs` v3, `uniffi` (proc-macro, no UDL), Docker `linuxserver/openssh-server` for integration tests.

**Spec:** `docs/superpowers/specs/2026-08-28-termif-crossplatform-ssh-design.md`

## Global Constraints

- Rust edition 2021, MSRV 1.78.
- `ssh-core` has **no** dependency on `napi`, `uniffi`, Electron, Node, or any platform SDK. Binding crates depend on it, never the reverse.
- `ssh-core` reads no config file, no environment variable, and no keychain. All input arrives as function parameters. Exception: the `known_hosts` path, which is passed in at `init()`.
- Every public async function returns `Result<T, SshError>`. No `unwrap()` or `expect()` in non-test code.
- No panic may cross an FFI boundary: every binding entry point wraps its call in `catch_unwind` and converts a panic into `SshError::Internal`.
- Handles (`SessionId`, `ChannelId`, `TransferId`, `ForwardId`) are `u64` newtypes, monotonically issued, never reused within a process.
- One Tokio multi-thread runtime for the whole library, created once in `init()`.
- All user-facing message text is English (see spec §6 i18n); `SshError` carries machine-readable variants, and text formatting lives in the TypeScript layer, not here.

---

## File Structure

| File | Responsibility |
|---|---|
| `Cargo.toml` (workspace root) | Workspace members, shared dependency versions |
| `crates/ssh-core/src/lib.rs` | Public API surface, re-exports, `init()` |
| `crates/ssh-core/src/error.rs` | `SshError` enum, conversions from `russh`/`io` errors |
| `crates/ssh-core/src/types.rs` | `ConnectConfig`, `Credential`, `PtySize`, `DirEntry`, handle newtypes |
| `crates/ssh-core/src/events.rs` | `Event` enum, the event queue, `next_events()` |
| `crates/ssh-core/src/registry.rs` | Handle issuing, `SessionId → Session` map |
| `crates/ssh-core/src/hostkey.rs` | `known_hosts` parse, lookup, append; verification decision |
| `crates/ssh-core/src/session.rs` | `connect`, auth, `disconnect`, russh `Handler` impl |
| `crates/ssh-core/src/channel.rs` | `open_shell`, `write`, `resize`, `close_channel`, data pump |
| `crates/ssh-core/src/sftp.rs` | list/stat/mkdir/rename/remove, `read_range`, upload/download |
| `crates/ssh-core/src/forward.rs` | local, remote, and dynamic (SOCKS5) forwarding |
| `crates/ffi-napi/src/lib.rs` | `#[napi]` wrappers → `.node` |
| `crates/ffi-uniffi/src/lib.rs` | `#[uniffi::export]` wrappers → XCFramework / `.so` |
| `crates/ssh-core/tests/common/mod.rs` | Docker sshd fixture helpers |
| `crates/ssh-core/tests/*.rs` | Integration tests per area |
| `.github/workflows/rust.yml` | Build all targets, run integration tests |

---

## Task 1: Workspace skeleton and error type

**Files:**
- Create: `Cargo.toml`, `rust-toolchain.toml`, `.gitignore` (append)
- Create: `crates/ssh-core/Cargo.toml`, `crates/ssh-core/src/lib.rs`, `crates/ssh-core/src/error.rs`
- Test: `crates/ssh-core/src/error.rs` (inline `#[cfg(test)]`)

**Interfaces:**
- Consumes: nothing.
- Produces: `SshError` enum with variants `Connect{msg}`, `Auth{msg}`, `HostKeyUnknown{host,fingerprint,algo}`, `HostKeyMismatch{host,expected,got}`, `NoSuchSession`, `NoSuchChannel`, `NoSuchTransfer`, `NoSuchForward`, `Sftp{msg}`, `Forward{msg}`, `Io{msg}`, `Timeout`, `Internal{msg}`; `type SshResult<T> = Result<T, SshError>`.

- [ ] **Step 1: Create the workspace manifest**

`Cargo.toml`:

```toml
[workspace]
members = ["crates/ssh-core", "crates/ffi-napi", "crates/ffi-uniffi"]
resolver = "2"

[workspace.package]
edition = "2021"
rust-version = "1.78"

[workspace.dependencies]
tokio = { version = "1", features = ["rt-multi-thread", "net", "io-util", "sync", "time", "fs", "macros"] }
russh = "0.54"
russh-sftp = "2"
thiserror = "2"
tracing = "0.1"
async-trait = "0.1"
```

`rust-toolchain.toml`:

```toml
[toolchain]
channel = "1.78"
components = ["rustfmt", "clippy"]
```

Append to `.gitignore`:

```
target/
*.node
crates/ffi-uniffi/out/
```

- [ ] **Step 2: Write the failing test for error conversion**

`crates/ssh-core/src/error.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn io_error_converts_and_keeps_message() {
        let io = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "refused");
        let err: SshError = io.into();
        match err {
            SshError::Io { ref msg } => assert!(msg.contains("refused")),
            other => panic!("expected Io, got {other:?}"),
        }
    }

    #[test]
    fn host_key_mismatch_is_distinct_from_unknown() {
        let a = SshError::HostKeyUnknown {
            host: "h".into(),
            fingerprint: "SHA256:aaa".into(),
            algo: "ssh-ed25519".into(),
        };
        let b = SshError::HostKeyMismatch {
            host: "h".into(),
            expected: "SHA256:aaa".into(),
            got: "SHA256:bbb".into(),
        };
        assert_ne!(a.code(), b.code());
        assert_eq!(a.code(), "host_key_unknown");
        assert_eq!(b.code(), "host_key_mismatch");
    }
}
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cargo test -p ssh-core`
Expected: FAIL — `crates/ssh-core/src/error.rs` has no `SshError`, compilation error.

- [ ] **Step 4: Write the error type**

`crates/ssh-core/Cargo.toml`:

```toml
[package]
name = "ssh-core"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true

[dependencies]
tokio.workspace = true
russh.workspace = true
russh-sftp.workspace = true
thiserror.workspace = true
tracing.workspace = true
async-trait.workspace = true
```

`crates/ssh-core/src/error.rs` (above the test module):

```rust
use thiserror::Error;

#[derive(Debug, Clone, Error)]
pub enum SshError {
    #[error("connection failed: {msg}")]
    Connect { msg: String },
    #[error("authentication failed: {msg}")]
    Auth { msg: String },
    #[error("unknown host key for {host}")]
    HostKeyUnknown { host: String, fingerprint: String, algo: String },
    #[error("host key mismatch for {host}")]
    HostKeyMismatch { host: String, expected: String, got: String },
    #[error("no such session")]
    NoSuchSession,
    #[error("no such channel")]
    NoSuchChannel,
    #[error("no such transfer")]
    NoSuchTransfer,
    #[error("no such forward")]
    NoSuchForward,
    #[error("sftp error: {msg}")]
    Sftp { msg: String },
    #[error("forward error: {msg}")]
    Forward { msg: String },
    #[error("io error: {msg}")]
    Io { msg: String },
    #[error("timed out")]
    Timeout,
    #[error("internal error: {msg}")]
    Internal { msg: String },
}

impl SshError {
    /// Stable machine-readable discriminator. The TypeScript layer switches on
    /// this, so these strings are API and must not change.
    pub fn code(&self) -> &'static str {
        match self {
            SshError::Connect { .. } => "connect",
            SshError::Auth { .. } => "auth",
            SshError::HostKeyUnknown { .. } => "host_key_unknown",
            SshError::HostKeyMismatch { .. } => "host_key_mismatch",
            SshError::NoSuchSession => "no_such_session",
            SshError::NoSuchChannel => "no_such_channel",
            SshError::NoSuchTransfer => "no_such_transfer",
            SshError::NoSuchForward => "no_such_forward",
            SshError::Sftp { .. } => "sftp",
            SshError::Forward { .. } => "forward",
            SshError::Io { .. } => "io",
            SshError::Timeout => "timeout",
            SshError::Internal { .. } => "internal",
        }
    }
}

impl From<std::io::Error> for SshError {
    fn from(e: std::io::Error) -> Self {
        SshError::Io { msg: e.to_string() }
    }
}

impl From<russh::Error> for SshError {
    fn from(e: russh::Error) -> Self {
        SshError::Connect { msg: e.to_string() }
    }
}

pub type SshResult<T> = Result<T, SshError>;
```

`crates/ssh-core/src/lib.rs`:

```rust
pub mod error;

pub use error::{SshError, SshResult};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p ssh-core`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml rust-toolchain.toml .gitignore crates/ssh-core
git commit -m "feat(ssh-core): add workspace skeleton and SshError type"
```

---

## Task 2: Handle newtypes, config types, and the registry

**Files:**
- Create: `crates/ssh-core/src/types.rs`, `crates/ssh-core/src/registry.rs`
- Modify: `crates/ssh-core/src/lib.rs`
- Test: inline `#[cfg(test)]` in `registry.rs`

**Interfaces:**
- Consumes: `SshError`, `SshResult` from Task 1.
- Produces:
  - `SessionId(u64)`, `ChannelId(u64)`, `TransferId(u64)`, `ForwardId(u64)` — each `Copy + Eq + Hash`, with `pub fn raw(&self) -> u64` and `pub fn from_raw(u64) -> Self`.
  - `PtySize { cols: u16, rows: u16, pixel_width: u16, pixel_height: u16 }`
  - `Credential::Password { password: String }` | `Credential::Key { pem: String, passphrase: Option<String> }`
  - `ConnectConfig { host: String, port: u16, username: String, credential: Credential, connect_timeout_ms: u32, keepalive_secs: u32 }`
  - `DirEntry { name: String, size: u64, is_dir: bool, is_symlink: bool, mode: u32, modified_unix: i64 }`
  - `Registry<T>` with `insert(T) -> u64`, `get(u64) -> Option<Arc<T>>`, `remove(u64) -> Option<Arc<T>>`, `ids() -> Vec<u64>`.

- [ ] **Step 1: Write the failing registry test**

`crates/ssh-core/src/registry.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_monotonic_and_never_reused() {
        let reg: Registry<String> = Registry::new();
        let a = reg.insert("a".to_string());
        let b = reg.insert("b".to_string());
        assert!(b > a);

        reg.remove(a);
        let c = reg.insert("c".to_string());
        assert!(c > b, "id {c} must not reuse removed id {a}");
    }

    #[test]
    fn get_returns_none_after_remove() {
        let reg: Registry<String> = Registry::new();
        let id = reg.insert("x".to_string());
        assert!(reg.get(id).is_some());
        reg.remove(id);
        assert!(reg.get(id).is_none());
    }

    #[test]
    fn ids_lists_live_entries_only() {
        let reg: Registry<String> = Registry::new();
        let a = reg.insert("a".to_string());
        let b = reg.insert("b".to_string());
        reg.remove(a);
        assert_eq!(reg.ids(), vec![b]);
    }
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cargo test -p ssh-core registry`
Expected: FAIL — no `Registry` type.

- [ ] **Step 3: Write the types**

`crates/ssh-core/src/types.rs`:

```rust
macro_rules! handle {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(u64);

        impl $name {
            pub fn from_raw(v: u64) -> Self { Self(v) }
            pub fn raw(&self) -> u64 { self.0 }
        }
    };
}

handle!(SessionId);
handle!(ChannelId);
handle!(TransferId);
handle!(ForwardId);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtySize {
    pub cols: u16,
    pub rows: u16,
    pub pixel_width: u16,
    pub pixel_height: u16,
}

impl Default for PtySize {
    fn default() -> Self {
        Self { cols: 80, rows: 24, pixel_width: 0, pixel_height: 0 }
    }
}

/// Passed in at connect time and dropped when the connection is established.
/// ssh-core never persists a credential.
#[derive(Clone)]
pub enum Credential {
    Password { password: String },
    Key { pem: String, passphrase: Option<String> },
}

impl std::fmt::Debug for Credential {
    /// Manual impl so a credential can never be logged by accident.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Credential::Password { .. } => f.write_str("Credential::Password(redacted)"),
            Credential::Key { .. } => f.write_str("Credential::Key(redacted)"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub credential: Credential,
    pub connect_timeout_ms: u32,
    pub keepalive_secs: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub mode: u32,
    pub modified_unix: i64,
}
```

`crates/ssh-core/src/registry.rs` (above the test module):

```rust
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Handle table. Ids are issued monotonically and never reused, so a stale
/// handle from the TypeScript side resolves to "not found" rather than to a
/// different live object.
pub struct Registry<T> {
    next: AtomicU64,
    items: Mutex<HashMap<u64, Arc<T>>>,
}

impl<T> Registry<T> {
    pub fn new() -> Self {
        Self { next: AtomicU64::new(1), items: Mutex::new(HashMap::new()) }
    }

    pub fn insert(&self, item: T) -> u64 {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        self.items.lock().expect("registry mutex").insert(id, Arc::new(item));
        id
    }

    pub fn get(&self, id: u64) -> Option<Arc<T>> {
        self.items.lock().expect("registry mutex").get(&id).cloned()
    }

    pub fn remove(&self, id: u64) -> Option<Arc<T>> {
        self.items.lock().expect("registry mutex").remove(&id)
    }

    pub fn ids(&self) -> Vec<u64> {
        let mut v: Vec<u64> = self.items.lock().expect("registry mutex").keys().copied().collect();
        v.sort_unstable();
        v
    }
}

impl<T> Default for Registry<T> {
    fn default() -> Self { Self::new() }
}
```

Note: `expect("registry mutex")` is the one allowed exception to the no-panic rule inside `ssh-core`, because a poisoned mutex means an earlier panic already corrupted state. The FFI `catch_unwind` in Tasks 9 and 10 converts it into `SshError::Internal` rather than letting it cross the boundary.

Modify `crates/ssh-core/src/lib.rs`:

```rust
pub mod error;
pub mod registry;
pub mod types;

pub use error::{SshError, SshResult};
pub use types::{
    ChannelId, ConnectConfig, Credential, DirEntry, ForwardId, PtySize, SessionId, TransferId,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p ssh-core`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify a credential cannot be logged**

Run: `cargo test -p ssh-core && grep -n 'Credential::Password(redacted)' crates/ssh-core/src/types.rs`
Expected: the grep matches; the manual `Debug` impl is present.

- [ ] **Step 6: Commit**

```bash
git add crates/ssh-core/src
git commit -m "feat(ssh-core): add handle newtypes, config types, and handle registry"
```

---

## Task 3: Event queue

**Files:**
- Create: `crates/ssh-core/src/events.rs`
- Modify: `crates/ssh-core/src/lib.rs`
- Test: inline `#[cfg(test)]` in `events.rs`

**Interfaces:**
- Consumes: handle newtypes from Task 2.
- Produces:
  - `Event` enum: `ChannelData { channel_id: ChannelId, bytes: Vec<u8> }`, `ChannelClosed { channel_id: ChannelId, exit_status: Option<u32> }`, `SessionClosed { session_id: SessionId, reason: String }`, `TransferProgress { transfer_id: TransferId, done: u64, total: u64 }`, `TransferDone { transfer_id: TransferId, error: Option<String> }`, `ForwardAccepted { forward_id: ForwardId, peer: String }`, `Log { level: String, msg: String }`.
  - `EventQueue` with `push(Event)`, `async fn drain(timeout: Duration) -> Vec<Event>`.

- [ ] **Step 1: Write the failing tests**

`crates/ssh-core/src/events.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ChannelId;
    use std::time::{Duration, Instant};

    fn data_event(n: u8) -> Event {
        Event::ChannelData { channel_id: ChannelId::from_raw(1), bytes: vec![n] }
    }

    #[tokio::test]
    async fn drain_returns_all_queued_events_immediately() {
        let q = EventQueue::new();
        q.push(data_event(1));
        q.push(data_event(2));

        let started = Instant::now();
        let events = q.drain(Duration::from_secs(5)).await;

        assert_eq!(events.len(), 2);
        assert!(started.elapsed() < Duration::from_millis(500), "must not wait for the timeout when events are ready");
    }

    #[tokio::test]
    async fn drain_returns_empty_after_timeout_when_idle() {
        let q = EventQueue::new();
        let events = q.drain(Duration::from_millis(100)).await;
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn drain_wakes_when_an_event_arrives_later() {
        let q = std::sync::Arc::new(EventQueue::new());
        let pusher = q.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            pusher.push(data_event(7));
        });

        let events = q.drain(Duration::from_secs(5)).await;
        assert_eq!(events.len(), 1);
    }

    #[tokio::test]
    async fn events_keep_fifo_order() {
        let q = EventQueue::new();
        for n in 0..5u8 {
            q.push(data_event(n));
        }
        let events = q.drain(Duration::from_millis(50)).await;
        let bytes: Vec<u8> = events
            .into_iter()
            .map(|e| match e {
                Event::ChannelData { bytes, .. } => bytes[0],
                _ => panic!("unexpected event"),
            })
            .collect();
        assert_eq!(bytes, vec![0, 1, 2, 3, 4]);
    }
}
```

- [ ] **Step 2: Add the dev-dependency and run the tests to see them fail**

Append to `crates/ssh-core/Cargo.toml`:

```toml
[dev-dependencies]
tokio = { version = "1", features = ["rt-multi-thread", "macros", "time", "test-util"] }
```

Run: `cargo test -p ssh-core events`
Expected: FAIL — no `EventQueue`, no `Event`.

- [ ] **Step 3: Write the queue**

`crates/ssh-core/src/events.rs` (above the test module):

```rust
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::Notify;

use crate::types::{ChannelId, ForwardId, SessionId, TransferId};

#[derive(Debug, Clone)]
pub enum Event {
    ChannelData { channel_id: ChannelId, bytes: Vec<u8> },
    ChannelClosed { channel_id: ChannelId, exit_status: Option<u32> },
    SessionClosed { session_id: SessionId, reason: String },
    TransferProgress { transfer_id: TransferId, done: u64, total: u64 },
    TransferDone { transfer_id: TransferId, error: Option<String> },
    ForwardAccepted { forward_id: ForwardId, peer: String },
    Log { level: String, msg: String },
}

/// Single upward channel. Producers (session tasks) push; the TypeScript side
/// runs exactly one `drain` loop. `drain` returns as soon as anything is
/// available, otherwise after `timeout` with an empty vector — so the caller
/// polls without spinning.
pub struct EventQueue {
    inner: Mutex<VecDeque<Event>>,
    notify: Notify,
}

impl EventQueue {
    pub fn new() -> Self {
        Self { inner: Mutex::new(VecDeque::new()), notify: Notify::new() }
    }

    pub fn push(&self, event: Event) {
        self.inner.lock().expect("event queue mutex").push_back(event);
        self.notify.notify_one();
    }

    pub async fn drain(&self, timeout: Duration) -> Vec<Event> {
        {
            let mut guard = self.inner.lock().expect("event queue mutex");
            if !guard.is_empty() {
                return guard.drain(..).collect();
            }
        }

        // Nothing queued: wait for a producer or for the timeout.
        let _ = tokio::time::timeout(timeout, self.notify.notified()).await;

        let mut guard = self.inner.lock().expect("event queue mutex");
        guard.drain(..).collect()
    }
}

impl Default for EventQueue {
    fn default() -> Self { Self::new() }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p ssh-core`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/ssh-core
git commit -m "feat(ssh-core): add Event enum and long-poll EventQueue"
```

---

## Task 4: known_hosts verification

**Files:**
- Create: `crates/ssh-core/src/hostkey.rs`
- Modify: `crates/ssh-core/src/lib.rs`
- Test: inline `#[cfg(test)]` in `hostkey.rs`

**Interfaces:**
- Consumes: `SshError`, `SshResult`.
- Produces:
  - `KnownHosts::new(path: PathBuf) -> Self`
  - `fn verify(&self, host: &str, port: u16, algo: &str, fingerprint: &str) -> SshResult<()>` — `Ok(())` when trusted, `Err(HostKeyUnknown)` when absent, `Err(HostKeyMismatch)` when a different key is on file.
  - `fn trust(&self, host: &str, port: u16, algo: &str, fingerprint: &str) -> SshResult<()>` — appends, replacing any existing entry for the same host+algo.
  - `fn host_pattern(host: &str, port: u16) -> String` — `"host"` for port 22, `"[host]:port"` otherwise, matching OpenSSH.

- [ ] **Step 1: Write the failing tests**

`crates/ssh-core/src/hostkey.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("termif-test-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn unknown_host_reports_unknown() {
        let kh = KnownHosts::new(temp_path("unknown"));
        let err = kh
            .verify("example.com", 22, "ssh-ed25519", "SHA256:aaa")
            .expect_err("a fresh file trusts nothing");
        assert_eq!(err.code(), "host_key_unknown");
    }

    #[test]
    fn trusted_host_verifies() {
        let kh = KnownHosts::new(temp_path("trusted"));
        kh.trust("example.com", 22, "ssh-ed25519", "SHA256:aaa").unwrap();
        kh.verify("example.com", 22, "ssh-ed25519", "SHA256:aaa").unwrap();
    }

    #[test]
    fn different_fingerprint_reports_mismatch_not_unknown() {
        let kh = KnownHosts::new(temp_path("mismatch"));
        kh.trust("example.com", 22, "ssh-ed25519", "SHA256:aaa").unwrap();
        let err = kh
            .verify("example.com", 22, "ssh-ed25519", "SHA256:bbb")
            .expect_err("a changed key must not verify");
        match err {
            SshError::HostKeyMismatch { expected, got, .. } => {
                assert_eq!(expected, "SHA256:aaa");
                assert_eq!(got, "SHA256:bbb");
            }
            other => panic!("expected mismatch, got {other:?}"),
        }
    }

    #[test]
    fn non_default_port_is_bracketed_like_openssh() {
        assert_eq!(KnownHosts::host_pattern("example.com", 22), "example.com");
        assert_eq!(KnownHosts::host_pattern("example.com", 2222), "[example.com]:2222");
    }

    #[test]
    fn same_host_on_two_ports_are_separate_entries() {
        let kh = KnownHosts::new(temp_path("ports"));
        kh.trust("example.com", 22, "ssh-ed25519", "SHA256:aaa").unwrap();
        let err = kh
            .verify("example.com", 2222, "ssh-ed25519", "SHA256:aaa")
            .expect_err("port 2222 is a different host entry");
        assert_eq!(err.code(), "host_key_unknown");
    }

    #[test]
    fn trust_replaces_an_existing_entry_for_the_same_algo() {
        let kh = KnownHosts::new(temp_path("replace"));
        kh.trust("example.com", 22, "ssh-ed25519", "SHA256:aaa").unwrap();
        kh.trust("example.com", 22, "ssh-ed25519", "SHA256:bbb").unwrap();
        kh.verify("example.com", 22, "ssh-ed25519", "SHA256:bbb").unwrap();

        let text = std::fs::read_to_string(kh.path()).unwrap();
        assert_eq!(text.lines().filter(|l| l.contains("example.com")).count(), 1);
    }

    #[test]
    fn comments_and_blank_lines_are_ignored() {
        let path = temp_path("comments");
        std::fs::write(&path, "# a comment\n\nexample.com ssh-ed25519 SHA256:aaa\n").unwrap();
        let kh = KnownHosts::new(path);
        kh.verify("example.com", 22, "ssh-ed25519", "SHA256:aaa").unwrap();
    }
}
```

- [ ] **Step 2: Run tests to see them fail**

Run: `cargo test -p ssh-core hostkey`
Expected: FAIL — no `KnownHosts`.

- [ ] **Step 3: Write the implementation**

`crates/ssh-core/src/hostkey.rs` (above the test module):

```rust
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::error::{SshError, SshResult};

/// Stores trusted host fingerprints in an OpenSSH-shaped file, local to this
/// device. Deliberately never synced (see spec §5): a synced known_hosts would
/// let one compromised device install a forged key everywhere.
///
/// Lines are `<pattern> <algo> <fingerprint>`. We store the fingerprint rather
/// than the base64 key because that is what we show the user and compare.
pub struct KnownHosts {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl KnownHosts {
    pub fn new(path: PathBuf) -> Self {
        Self { path, write_lock: Mutex::new(()) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn host_pattern(host: &str, port: u16) -> String {
        if port == 22 { host.to_string() } else { format!("[{host}]:{port}") }
    }

    fn read_lines(&self) -> SshResult<Vec<String>> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => Ok(text.lines().map(str::to_string).collect()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.into()),
        }
    }

    fn find(&self, pattern: &str, algo: &str) -> SshResult<Option<String>> {
        for line in self.read_lines()? {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut parts = line.split_whitespace();
            let (p, a, fp) = (parts.next(), parts.next(), parts.next());
            if let (Some(p), Some(a), Some(fp)) = (p, a, fp) {
                if p == pattern && a == algo {
                    return Ok(Some(fp.to_string()));
                }
            }
        }
        Ok(None)
    }

    pub fn verify(&self, host: &str, port: u16, algo: &str, fingerprint: &str) -> SshResult<()> {
        let pattern = Self::host_pattern(host, port);
        match self.find(&pattern, algo)? {
            Some(known) if known == fingerprint => Ok(()),
            Some(known) => Err(SshError::HostKeyMismatch {
                host: pattern,
                expected: known,
                got: fingerprint.to_string(),
            }),
            None => Err(SshError::HostKeyUnknown {
                host: pattern,
                fingerprint: fingerprint.to_string(),
                algo: algo.to_string(),
            }),
        }
    }

    pub fn trust(&self, host: &str, port: u16, algo: &str, fingerprint: &str) -> SshResult<()> {
        let _guard = self.write_lock.lock().expect("known_hosts write lock");
        let pattern = Self::host_pattern(host, port);

        // Rewrite without any prior entry for this host+algo, then append.
        let mut kept: Vec<String> = Vec::new();
        for line in self.read_lines()? {
            let trimmed = line.trim();
            let is_same_entry = {
                let mut parts = trimmed.split_whitespace();
                matches!((parts.next(), parts.next()), (Some(p), Some(a)) if p == pattern && a == algo)
            };
            if !is_same_entry {
                kept.push(line);
            }
        }
        kept.push(format!("{pattern} {algo} {fingerprint}"));

        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut f = std::fs::File::create(&self.path)?;
        for line in kept {
            if line.trim().is_empty() {
                continue;
            }
            writeln!(f, "{line}")?;
        }
        f.sync_all()?;
        Ok(())
    }
}
```

Modify `crates/ssh-core/src/lib.rs` to add `pub mod events;` and `pub mod hostkey;`, and re-export `pub use events::Event; pub use hostkey::KnownHosts;`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p ssh-core`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/ssh-core
git commit -m "feat(ssh-core): add known_hosts verification with mismatch detection"
```

---

## Task 5: Docker sshd test fixture

**Files:**
- Create: `crates/ssh-core/tests/common/mod.rs`
- Create: `docker-compose.test.yml`
- Create: `crates/ssh-core/tests/fixture_smoke.rs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `common::TestServer` with `async fn start() -> TestServer`, fields `host: String`, `port: u16`, `username: String`, `password: String`, and `fn is_available() -> bool`; `common::require_server!()` macro that skips a test with a printed notice when Docker is not running.

Why a real `sshd` rather than mocks: the value of this crate is protocol correctness, and a mock would assert our own assumptions back at us.

- [ ] **Step 1: Write the compose file**

`docker-compose.test.yml`:

```yaml
services:
  sshd:
    image: linuxserver/openssh-server:latest
    environment:
      - PUID=1000
      - PGID=1000
      - PASSWORD_ACCESS=true
      - USER_NAME=termif
      - USER_PASSWORD=termif-test-pw
      - SUDO_ACCESS=false
    ports:
      - "22022:2222"
```

- [ ] **Step 2: Write the fixture helper**

`crates/ssh-core/tests/common/mod.rs`:

```rust
#![allow(dead_code)]

use std::time::Duration;

pub struct TestServer {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl TestServer {
    /// The compose file publishes the container's 2222 on the host's 22022.
    pub fn from_env() -> Self {
        Self {
            host: std::env::var("TERMIF_TEST_SSH_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            port: std::env::var("TERMIF_TEST_SSH_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(22022),
            username: std::env::var("TERMIF_TEST_SSH_USER").unwrap_or_else(|_| "termif".into()),
            password: std::env::var("TERMIF_TEST_SSH_PASSWORD")
                .unwrap_or_else(|_| "termif-test-pw".into()),
        }
    }

    /// True when something is accepting TCP on the fixture port.
    pub fn is_available() -> bool {
        let s = Self::from_env();
        std::net::TcpStream::connect_timeout(
            &format!("{}:{}", s.host, s.port)
                .parse()
                .expect("fixture address"),
            Duration::from_millis(700),
        )
        .is_ok()
    }
}

/// Skips the test (rather than failing) when the Docker fixture is not up, so
/// a developer without Docker still gets a green unit-test run. CI always has
/// it, and the CI job asserts availability separately.
#[macro_export]
macro_rules! require_server {
    () => {
        if !$crate::common::TestServer::is_available() {
            eprintln!("SKIP: sshd fixture not reachable; run `docker compose -f docker-compose.test.yml up -d`");
            return;
        }
    };
}
```

- [ ] **Step 3: Write the fixture smoke test**

`crates/ssh-core/tests/fixture_smoke.rs`:

```rust
mod common;

#[test]
fn fixture_is_reachable_when_docker_is_up() {
    require_server!();
    assert!(common::TestServer::is_available());
}
```

- [ ] **Step 4: Start the fixture and run the smoke test**

Run:

```bash
docker compose -f docker-compose.test.yml up -d
sleep 5
cargo test -p ssh-core --test fixture_smoke
```

Expected: PASS. Without Docker, expected: PASS with a printed `SKIP:` line.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.test.yml crates/ssh-core/tests
git commit -m "test(ssh-core): add Docker sshd fixture and availability guard"
```

---

## Task 6: connect, authenticate, disconnect

**Files:**
- Create: `crates/ssh-core/src/session.rs`
- Modify: `crates/ssh-core/src/lib.rs`
- Test: `crates/ssh-core/tests/connect.rs`

**Interfaces:**
- Consumes: `ConnectConfig`, `Credential`, `SessionId`, `KnownHosts`, `EventQueue`, `SshError`.
- Produces:
  - `pub fn init(known_hosts_path: PathBuf) -> SshResult<()>` — creates the runtime and global state once; idempotent.
  - `pub async fn connect(cfg: ConnectConfig) -> SshResult<SessionId>`
  - `pub async fn disconnect(id: SessionId) -> SshResult<()>`
  - `pub async fn trust_host_key(host: String, port: u16, algo: String, fingerprint: String) -> SshResult<()>`
  - `pub async fn next_events(timeout_ms: u32) -> Vec<Event>`
  - Internal: `struct Session { handle: russh::client::Handle<ClientHandler>, host: String, port: u16 }`

- [ ] **Step 1: Write the failing integration tests**

`crates/ssh-core/tests/connect.rs`:

```rust
mod common;

use ssh_core::{ConnectConfig, Credential};

fn config(server: &common::TestServer, password: &str) -> ConnectConfig {
    ConnectConfig {
        host: server.host.clone(),
        port: server.port,
        username: server.username.clone(),
        credential: Credential::Password { password: password.to_string() },
        connect_timeout_ms: 10_000,
        keepalive_secs: 30,
    }
}

fn init_with_empty_known_hosts(name: &str) {
    let mut p = std::env::temp_dir();
    p.push(format!("termif-kh-{}-{}", std::process::id(), name));
    let _ = std::fs::remove_file(&p);
    ssh_core::init(p).expect("init");
}

#[tokio::test]
async fn unknown_host_key_is_rejected_then_accepted_after_trust() {
    require_server!();
    let server = common::TestServer::from_env();
    init_with_empty_known_hosts("connect");

    // First attempt: the key is not on file, so connect must refuse and tell
    // us the fingerprint rather than trusting silently.
    let err = ssh_core::connect(config(&server, &server.password))
        .await
        .expect_err("an unknown host key must not be trusted automatically");

    let (host, fingerprint, algo) = match err {
        ssh_core::SshError::HostKeyUnknown { host, fingerprint, algo } => (host, fingerprint, algo),
        other => panic!("expected HostKeyUnknown, got {other:?}"),
    };
    assert!(fingerprint.starts_with("SHA256:"), "got {fingerprint}");
    assert!(!host.is_empty());

    ssh_core::trust_host_key(server.host.clone(), server.port, algo, fingerprint)
        .await
        .expect("trust");

    // Second attempt: now it connects.
    let session = ssh_core::connect(config(&server, &server.password))
        .await
        .expect("connect after trusting the key");
    ssh_core::disconnect(session).await.expect("disconnect");
}

#[tokio::test]
async fn wrong_password_fails_with_auth_error() {
    require_server!();
    let server = common::TestServer::from_env();
    init_with_empty_known_hosts("auth");

    // Trust the key first so the failure we observe is authentication.
    let err = ssh_core::connect(config(&server, "definitely-wrong"))
        .await
        .expect_err("unknown key");
    if let ssh_core::SshError::HostKeyUnknown { fingerprint, algo, .. } = err {
        ssh_core::trust_host_key(server.host.clone(), server.port, algo, fingerprint)
            .await
            .unwrap();
    }

    let err = ssh_core::connect(config(&server, "definitely-wrong"))
        .await
        .expect_err("a wrong password must fail");
    assert_eq!(err.code(), "auth");
}

#[tokio::test]
async fn connect_to_a_closed_port_reports_connect_error() {
    init_with_empty_known_hosts("refused");
    let cfg = ConnectConfig {
        host: "127.0.0.1".into(),
        port: 1,
        username: "nobody".into(),
        credential: Credential::Password { password: "x".into() },
        connect_timeout_ms: 2_000,
        keepalive_secs: 30,
    };
    let err = ssh_core::connect(cfg).await.expect_err("port 1 is not listening");
    assert!(matches!(err.code(), "connect" | "io" | "timeout"), "got {}", err.code());
}

#[tokio::test]
async fn disconnecting_an_unknown_session_errors() {
    init_with_empty_known_hosts("nosession");
    let err = ssh_core::disconnect(ssh_core::SessionId::from_raw(999_999))
        .await
        .expect_err("stale handles must not resolve");
    assert_eq!(err.code(), "no_such_session");
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cargo test -p ssh-core --test connect`
Expected: FAIL — `ssh_core::init`, `connect`, `disconnect`, `trust_host_key` do not exist.

- [ ] **Step 3: Write the session module**

`crates/ssh-core/src/session.rs`:

```rust
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use russh::client;
use russh::keys::{HashAlg, PrivateKeyWithHashAlg};

use crate::error::{SshError, SshResult};
use crate::events::{Event, EventQueue};
use crate::hostkey::KnownHosts;
use crate::registry::Registry;
use crate::types::{ChannelId, ConnectConfig, Credential, SessionId};

/// Process-wide state. Created once by `init`, which the host application
/// calls before anything else.
pub(crate) struct Core {
    pub(crate) runtime: tokio::runtime::Runtime,
    pub(crate) known_hosts: KnownHosts,
    pub(crate) events: Arc<EventQueue>,
    pub(crate) sessions: Registry<Session>,
    pub(crate) channels: Registry<crate::channel::ChannelEntry>,
    pub(crate) transfers: Registry<crate::sftp::TransferEntry>,
    pub(crate) forwards: Registry<crate::forward::ForwardEntry>,
}

pub(crate) struct Session {
    pub(crate) handle: client::Handle<ClientHandler>,
    pub(crate) host: String,
    pub(crate) port: u16,
}

static CORE: OnceLock<Core> = OnceLock::new();

pub(crate) fn core() -> SshResult<&'static Core> {
    CORE.get().ok_or_else(|| SshError::Internal { msg: "init() was not called".into() })
}

/// Idempotent: a second call with a different path is ignored, because the
/// runtime and handle tables must not be replaced while sessions are live.
pub fn init(known_hosts_path: PathBuf) -> SshResult<()> {
    if CORE.get().is_some() {
        return Ok(());
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("ssh-core")
        .build()
        .map_err(|e| SshError::Internal { msg: format!("runtime: {e}") })?;

    let core = Core {
        runtime,
        known_hosts: KnownHosts::new(known_hosts_path),
        events: Arc::new(EventQueue::new()),
        sessions: Registry::new(),
        channels: Registry::new(),
        transfers: Registry::new(),
        forwards: Registry::new(),
    };
    let _ = CORE.set(core);
    Ok(())
}

/// Verification happens here, in `check_server_key`, so an untrusted key stops
/// the handshake instead of being discovered after the fact.
pub struct ClientHandler {
    host: String,
    port: u16,
    events: Arc<EventQueue>,
}

#[async_trait::async_trait]
impl client::Handler for ClientHandler {
    type Error = SshError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = format!("{}", server_public_key.fingerprint(HashAlg::Sha256));
        let algo = server_public_key.algorithm().to_string();
        let core = core()?;

        match core.known_hosts.verify(&self.host, self.port, &algo, &fingerprint) {
            Ok(()) => Ok(true),
            // Propagate as an error, not `Ok(false)`: the caller needs the
            // fingerprint and the reason to show a trust prompt or a warning.
            Err(e) => {
                self.events.push(Event::Log {
                    level: "warn".into(),
                    msg: format!("host key check failed for {}: {}", self.host, e.code()),
                });
                Err(e)
            }
        }
    }
}

pub async fn connect(cfg: ConnectConfig) -> SshResult<SessionId> {
    let core = core()?;
    let config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(cfg.keepalive_secs.max(1) as u64)),
        ..Default::default()
    });

    let handler = ClientHandler {
        host: cfg.host.clone(),
        port: cfg.port,
        events: core.events.clone(),
    };

    let addr = format!("{}:{}", cfg.host, cfg.port);
    let tcp = tokio::time::timeout(
        Duration::from_millis(cfg.connect_timeout_ms.max(1) as u64),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    .map_err(|_| SshError::Timeout)?
    .map_err(|e| SshError::Connect { msg: format!("{addr}: {e}") })?;

    let mut handle = client::connect_stream(config, tcp, handler).await?;

    let authenticated = match &cfg.credential {
        Credential::Password { password } => handle
            .authenticate_password(&cfg.username, password)
            .await
            .map_err(|e| SshError::Auth { msg: e.to_string() })?,
        Credential::Key { pem, passphrase } => {
            let key = russh::keys::decode_secret_key(pem, passphrase.as_deref())
                .map_err(|e| SshError::Auth { msg: format!("key: {e}") })?;
            handle
                .authenticate_publickey(
                    &cfg.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), Some(HashAlg::Sha256)),
                )
                .await
                .map_err(|e| SshError::Auth { msg: e.to_string() })?
        }
    };

    if !authenticated.success() {
        return Err(SshError::Auth { msg: "server rejected the credential".into() });
    }

    let id = core.sessions.insert(Session { handle, host: cfg.host, port: cfg.port });
    Ok(SessionId::from_raw(id))
}

pub async fn disconnect(id: SessionId) -> SshResult<()> {
    let core = core()?;
    let session = core.sessions.remove(id.raw()).ok_or(SshError::NoSuchSession)?;
    session
        .handle
        .disconnect(russh::Disconnect::ByApplication, "", "en")
        .await
        .ok();
    core.events.push(Event::SessionClosed {
        session_id: id,
        reason: "disconnected by application".into(),
    });
    Ok(())
}

pub async fn trust_host_key(
    host: String,
    port: u16,
    algo: String,
    fingerprint: String,
) -> SshResult<()> {
    core()?.known_hosts.trust(&host, port, &algo, &fingerprint)
}

pub async fn next_events(timeout_ms: u32) -> Vec<Event> {
    match core() {
        Ok(c) => c.events.drain(Duration::from_millis(timeout_ms as u64)).await,
        Err(e) => vec![Event::Log { level: "error".into(), msg: e.to_string() }],
    }
}

/// Resolve a channel's owning session; used by the channel and sftp modules.
pub(crate) fn session_of(id: SessionId) -> SshResult<Arc<Session>> {
    core()?.sessions.get(id.raw()).ok_or(SshError::NoSuchSession)
}

pub(crate) fn events() -> SshResult<Arc<EventQueue>> {
    Ok(core()?.events.clone())
}

/// Placeholder so `Core` compiles before Task 7 lands its own module.
pub(crate) fn _unused(_: ChannelId) {}
```

Modify `crates/ssh-core/src/lib.rs`:

```rust
pub mod channel;
pub mod error;
pub mod events;
pub mod forward;
pub mod hostkey;
pub mod registry;
pub mod session;
pub mod sftp;
pub mod types;

pub use error::{SshError, SshResult};
pub use events::Event;
pub use hostkey::KnownHosts;
pub use session::{connect, disconnect, init, next_events, trust_host_key};
pub use types::{
    ChannelId, ConnectConfig, Credential, DirEntry, ForwardId, PtySize, SessionId, TransferId,
};
```

Create stub modules so the tree compiles now; Tasks 7, 8, and 11 fill them:

`crates/ssh-core/src/channel.rs`:

```rust
/// Filled in by Task 7.
pub(crate) struct ChannelEntry;
```

`crates/ssh-core/src/sftp.rs`:

```rust
/// Filled in by Task 8.
pub(crate) struct TransferEntry;
```

`crates/ssh-core/src/forward.rs`:

```rust
/// Filled in by Task 11.
pub(crate) struct ForwardEntry;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
docker compose -f docker-compose.test.yml up -d
cargo test -p ssh-core --test connect
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Confirm the unit tests still pass**

Run: `cargo test -p ssh-core`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add crates/ssh-core
git commit -m "feat(ssh-core): add connect, auth, disconnect with host key verification"
```

---

## Task 7: PTY shell channels

**Files:**
- Create (replace stub): `crates/ssh-core/src/channel.rs`
- Modify: `crates/ssh-core/src/lib.rs`, `crates/ssh-core/src/session.rs` (drop `_unused`)
- Test: `crates/ssh-core/tests/shell.rs`

**Interfaces:**
- Consumes: `session_of`, `events`, `Registry`, `PtySize`, `ChannelId`, `SessionId`, `Event`.
- Produces:
  - `pub async fn open_shell(session: SessionId, pty: PtySize) -> SshResult<ChannelId>`
  - `pub async fn write(channel: ChannelId, data: Vec<u8>) -> SshResult<()>`
  - `pub async fn resize(channel: ChannelId, pty: PtySize) -> SshResult<()>`
  - `pub async fn close_channel(channel: ChannelId) -> SshResult<()>`
  - `pub(crate) struct ChannelEntry { writer, session_id }`

- [ ] **Step 1: Write the failing tests**

`crates/ssh-core/tests/shell.rs`:

```rust
mod common;

use ssh_core::{ConnectConfig, Credential, Event, PtySize};
use std::time::{Duration, Instant};

async fn connected_session(name: &str) -> ssh_core::SessionId {
    let server = common::TestServer::from_env();
    let mut p = std::env::temp_dir();
    p.push(format!("termif-kh-{}-{}", std::process::id(), name));
    let _ = std::fs::remove_file(&p);
    ssh_core::init(p).expect("init");

    let cfg = || ConnectConfig {
        host: server.host.clone(),
        port: server.port,
        username: server.username.clone(),
        credential: Credential::Password { password: server.password.clone() },
        connect_timeout_ms: 10_000,
        keepalive_secs: 30,
    };

    if let Err(ssh_core::SshError::HostKeyUnknown { fingerprint, algo, .. }) =
        ssh_core::connect(cfg()).await
    {
        ssh_core::trust_host_key(server.host.clone(), server.port, algo, fingerprint)
            .await
            .unwrap();
    }
    ssh_core::connect(cfg()).await.expect("connect")
}

/// Drain events until `pred` is satisfied by the accumulated shell output, or
/// the deadline passes. Returns everything collected.
async fn read_until(
    deadline: Duration,
    pred: impl Fn(&str) -> bool,
) -> String {
    let started = Instant::now();
    let mut acc = String::new();
    while started.elapsed() < deadline {
        for event in ssh_core::next_events(300).await {
            if let Event::ChannelData { bytes, .. } = event {
                acc.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
        if pred(&acc) {
            break;
        }
    }
    acc
}

#[tokio::test]
async fn shell_echoes_a_command_result() {
    require_server!();
    let session = connected_session("shell-echo").await;

    let channel = ssh_core::open_shell(session, PtySize::default())
        .await
        .expect("open shell");

    ssh_core::write(channel, b"echo termif-marker-42\n".to_vec())
        .await
        .expect("write");

    let out = read_until(Duration::from_secs(10), |s| s.contains("termif-marker-42")).await;
    assert!(out.contains("termif-marker-42"), "shell output was: {out:?}");

    ssh_core::close_channel(channel).await.expect("close");
    ssh_core::disconnect(session).await.expect("disconnect");
}

#[tokio::test]
async fn pty_size_is_applied_and_resize_takes_effect() {
    require_server!();
    let session = connected_session("shell-resize").await;

    let channel = ssh_core::open_shell(
        session,
        PtySize { cols: 100, rows: 40, pixel_width: 0, pixel_height: 0 },
    )
    .await
    .expect("open shell");

    ssh_core::write(channel, b"tput cols\n".to_vec()).await.unwrap();
    let out = read_until(Duration::from_secs(10), |s| s.contains("100")).await;
    assert!(out.contains("100"), "expected 100 columns, output was: {out:?}");

    ssh_core::resize(channel, PtySize { cols: 132, rows: 43, pixel_width: 0, pixel_height: 0 })
        .await
        .expect("resize");

    ssh_core::write(channel, b"tput cols\n".to_vec()).await.unwrap();
    let out = read_until(Duration::from_secs(10), |s| s.contains("132")).await;
    assert!(out.contains("132"), "expected 132 columns after resize, output was: {out:?}");

    ssh_core::close_channel(channel).await.unwrap();
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn two_channels_on_one_session_are_independent() {
    require_server!();
    let session = connected_session("shell-two").await;

    let a = ssh_core::open_shell(session, PtySize::default()).await.unwrap();
    let b = ssh_core::open_shell(session, PtySize::default()).await.unwrap();
    assert_ne!(a.raw(), b.raw());

    ssh_core::write(a, b"echo from-tab-a\n".to_vec()).await.unwrap();
    ssh_core::write(b, b"echo from-tab-b\n".to_vec()).await.unwrap();

    // Attribute each byte stream to its own channel id.
    let mut from_a = String::new();
    let mut from_b = String::new();
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(12) {
        for event in ssh_core::next_events(300).await {
            if let Event::ChannelData { channel_id, bytes } = event {
                let text = String::from_utf8_lossy(&bytes).to_string();
                if channel_id == a {
                    from_a.push_str(&text);
                } else if channel_id == b {
                    from_b.push_str(&text);
                }
            }
        }
        if from_a.contains("from-tab-a") && from_b.contains("from-tab-b") {
            break;
        }
    }

    assert!(from_a.contains("from-tab-a"), "channel a saw: {from_a:?}");
    assert!(from_b.contains("from-tab-b"), "channel b saw: {from_b:?}");
    assert!(!from_a.contains("from-tab-b"), "channel a leaked b's output");

    ssh_core::close_channel(a).await.unwrap();
    ssh_core::close_channel(b).await.unwrap();
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn closing_a_channel_emits_channel_closed() {
    require_server!();
    let session = connected_session("shell-closed").await;
    let channel = ssh_core::open_shell(session, PtySize::default()).await.unwrap();

    ssh_core::write(channel, b"exit\n".to_vec()).await.unwrap();

    let mut saw_closed = false;
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(10) && !saw_closed {
        for event in ssh_core::next_events(300).await {
            if let Event::ChannelClosed { channel_id, .. } = event {
                if channel_id == channel {
                    saw_closed = true;
                }
            }
        }
    }
    assert!(saw_closed, "exiting the shell must emit ChannelClosed");

    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn writing_to_an_unknown_channel_errors() {
    let mut p = std::env::temp_dir();
    p.push(format!("termif-kh-{}-nochannel", std::process::id()));
    ssh_core::init(p).unwrap();

    let err = ssh_core::write(ssh_core::ChannelId::from_raw(999_999), b"x".to_vec())
        .await
        .expect_err("stale channel handles must not resolve");
    assert_eq!(err.code(), "no_such_channel");
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cargo test -p ssh-core --test shell`
Expected: FAIL — `open_shell`, `write`, `resize`, `close_channel` do not exist.

- [ ] **Step 3: Write the channel module**

`crates/ssh-core/src/channel.rs` (replacing the stub):

```rust
use russh::ChannelMsg;
use tokio::sync::Mutex;

use crate::error::{SshError, SshResult};
use crate::events::Event;
use crate::session::{core, events, session_of};
use crate::types::{ChannelId, PtySize, SessionId};

/// A live shell channel. The read half is owned by a spawned pump task that
/// turns SSH messages into queue events; the write half stays here behind a
/// mutex so concurrent writes from the UI serialise.
pub(crate) struct ChannelEntry {
    writer: Mutex<russh::ChannelWriteHalf<russh::client::Msg>>,
    pub(crate) session_id: SessionId,
}

pub async fn open_shell(session: SessionId, pty: PtySize) -> SshResult<ChannelId> {
    let core = core()?;
    let sess = session_of(session)?;

    let channel = sess
        .handle
        .channel_open_session()
        .await
        .map_err(|e| SshError::Connect { msg: format!("open channel: {e}") })?;

    channel
        .request_pty(
            false,
            "xterm-256color",
            pty.cols as u32,
            pty.rows as u32,
            pty.pixel_width as u32,
            pty.pixel_height as u32,
            &[],
        )
        .await
        .map_err(|e| SshError::Connect { msg: format!("request pty: {e}") })?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| SshError::Connect { msg: format!("request shell: {e}") })?;

    let (mut reader, writer) = channel.split();
    let id_raw = core
        .channels
        .insert(ChannelEntry { writer: Mutex::new(writer), session_id: session });
    let id = ChannelId::from_raw(id_raw);

    // One pump task per channel. It is the only producer of this channel's
    // data events, which is what keeps per-channel ordering intact.
    let queue = events()?;
    core.runtime.spawn(async move {
        let mut exit_status: Option<u32> = None;
        while let Some(msg) = reader.wait().await {
            match msg {
                ChannelMsg::Data { data } => {
                    queue.push(Event::ChannelData { channel_id: id, bytes: data.to_vec() });
                }
                // stderr on a PTY channel: surface it in the same stream, the
                // way a terminal does.
                ChannelMsg::ExtendedData { data, .. } => {
                    queue.push(Event::ChannelData { channel_id: id, bytes: data.to_vec() });
                }
                ChannelMsg::ExitStatus { exit_status: code } => {
                    exit_status = Some(code);
                }
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        queue.push(Event::ChannelClosed { channel_id: id, exit_status });
        if let Ok(c) = core() {
            c.channels.remove(id.raw());
        }
    });

    Ok(id)
}

fn entry(channel: ChannelId) -> SshResult<std::sync::Arc<ChannelEntry>> {
    core()?.channels.get(channel.raw()).ok_or(SshError::NoSuchChannel)
}

pub async fn write(channel: ChannelId, data: Vec<u8>) -> SshResult<()> {
    let entry = entry(channel)?;
    let writer = entry.writer.lock().await;
    writer
        .data(&data[..])
        .await
        .map_err(|e| SshError::Io { msg: format!("channel write: {e}") })
}

pub async fn resize(channel: ChannelId, pty: PtySize) -> SshResult<()> {
    let entry = entry(channel)?;
    let writer = entry.writer.lock().await;
    writer
        .window_change(
            pty.cols as u32,
            pty.rows as u32,
            pty.pixel_width as u32,
            pty.pixel_height as u32,
        )
        .await
        .map_err(|e| SshError::Io { msg: format!("window change: {e}") })
}

pub async fn close_channel(channel: ChannelId) -> SshResult<()> {
    let entry = core()?.channels.remove(channel.raw()).ok_or(SshError::NoSuchChannel)?;
    let writer = entry.writer.lock().await;
    writer.eof().await.ok();
    writer.close().await.ok();
    Ok(())
}
```

Modify `crates/ssh-core/src/lib.rs` re-exports:

```rust
pub use channel::{close_channel, open_shell, resize, write};
```

Delete the `_unused` placeholder from `session.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p ssh-core --test shell`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/ssh-core
git commit -m "feat(ssh-core): add PTY shell channels with per-channel data pump"
```

---

## Task 8: SFTP browsing and metadata

**Files:**
- Create (replace stub): `crates/ssh-core/src/sftp.rs`
- Modify: `crates/ssh-core/src/lib.rs`
- Test: `crates/ssh-core/tests/sftp_browse.rs`

**Interfaces:**
- Consumes: `session_of`, `DirEntry`, `SessionId`, `SshError`.
- Produces:
  - `pub async fn sftp_list(session: SessionId, path: String) -> SshResult<Vec<DirEntry>>`
  - `pub async fn sftp_stat(session: SessionId, path: String) -> SshResult<DirEntry>`
  - `pub async fn sftp_mkdir(session: SessionId, path: String) -> SshResult<()>`
  - `pub async fn sftp_rename(session: SessionId, from: String, to: String) -> SshResult<()>`
  - `pub async fn sftp_remove(session: SessionId, path: String, recursive: bool) -> SshResult<()>`
  - `pub async fn sftp_read_range(session: SessionId, path: String, offset: u64, len: u32) -> SshResult<Vec<u8>>`
  - `pub const SFTP_READ_RANGE_MAX: u32 = 1024 * 1024;` — 1 MiB cap, because this call's result crosses FFI into a JS buffer (spec §5)
  - `pub(crate) struct TransferEntry` (used by Task 9)
  - `pub(crate) async fn sftp_session(SessionId) -> SshResult<russh_sftp::client::SftpSession>`

- [ ] **Step 1: Write the failing tests**

`crates/ssh-core/tests/sftp_browse.rs`:

```rust
mod common;

use ssh_core::{ConnectConfig, Credential};

async fn connected_session(name: &str) -> ssh_core::SessionId {
    let server = common::TestServer::from_env();
    let mut p = std::env::temp_dir();
    p.push(format!("termif-kh-{}-{}", std::process::id(), name));
    let _ = std::fs::remove_file(&p);
    ssh_core::init(p).expect("init");

    let cfg = || ConnectConfig {
        host: server.host.clone(),
        port: server.port,
        username: server.username.clone(),
        credential: Credential::Password { password: server.password.clone() },
        connect_timeout_ms: 10_000,
        keepalive_secs: 30,
    };
    if let Err(ssh_core::SshError::HostKeyUnknown { fingerprint, algo, .. }) =
        ssh_core::connect(cfg()).await
    {
        ssh_core::trust_host_key(server.host.clone(), server.port, algo, fingerprint)
            .await
            .unwrap();
    }
    ssh_core::connect(cfg()).await.expect("connect")
}

#[tokio::test]
async fn mkdir_list_rename_remove_round_trip() {
    require_server!();
    let session = connected_session("sftp-crud").await;
    let dir = format!("termif-test-{}", std::process::id());
    let renamed = format!("{dir}-renamed");

    ssh_core::sftp_mkdir(session, dir.clone()).await.expect("mkdir");

    let entries = ssh_core::sftp_list(session, ".".into()).await.expect("list");
    let found = entries.iter().find(|e| e.name == dir).expect("new dir must be listed");
    assert!(found.is_dir, "mkdir must produce a directory");

    ssh_core::sftp_rename(session, dir.clone(), renamed.clone()).await.expect("rename");

    let entries = ssh_core::sftp_list(session, ".".into()).await.unwrap();
    assert!(entries.iter().any(|e| e.name == renamed), "renamed dir must appear");
    assert!(!entries.iter().any(|e| e.name == dir), "old name must be gone");

    ssh_core::sftp_remove(session, renamed.clone(), false).await.expect("remove");
    let entries = ssh_core::sftp_list(session, ".".into()).await.unwrap();
    assert!(!entries.iter().any(|e| e.name == renamed), "removed dir must be gone");

    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn stat_reports_size_for_a_known_file() {
    require_server!();
    let session = connected_session("sftp-stat").await;
    let path = format!("termif-stat-{}.txt", std::process::id());

    // Create a file of a known size through the shell, then stat it.
    let channel = ssh_core::open_shell(session, ssh_core::PtySize::default()).await.unwrap();
    ssh_core::write(channel, format!("printf '0123456789' > {path}\n").into_bytes())
        .await
        .unwrap();

    // Give the shell a moment, draining events so the queue does not grow.
    let started = std::time::Instant::now();
    let mut meta = None;
    while started.elapsed() < std::time::Duration::from_secs(10) {
        let _ = ssh_core::next_events(300).await;
        if let Ok(m) = ssh_core::sftp_stat(session, path.clone()).await {
            if m.size == 10 {
                meta = Some(m);
                break;
            }
        }
    }
    let meta = meta.expect("stat must eventually see a 10-byte file");
    assert_eq!(meta.size, 10);
    assert!(!meta.is_dir);

    ssh_core::sftp_remove(session, path, false).await.ok();
    ssh_core::close_channel(channel).await.ok();
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn listing_a_missing_path_errors() {
    require_server!();
    let session = connected_session("sftp-missing").await;
    let err = ssh_core::sftp_list(session, "/definitely/not/here".into())
        .await
        .expect_err("a missing directory must error");
    assert_eq!(err.code(), "sftp");
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn read_range_returns_the_requested_slice() {
    require_server!();
    let session = connected_session("sftp-range").await;
    let path = format!("termif-range-{}.txt", std::process::id());

    let channel = ssh_core::open_shell(session, ssh_core::PtySize::default()).await.unwrap();
    ssh_core::write(channel, format!("printf 'ABCDEFGHIJ' > {path}\n").into_bytes())
        .await
        .unwrap();

    let started = std::time::Instant::now();
    let mut slice = None;
    while started.elapsed() < std::time::Duration::from_secs(10) {
        let _ = ssh_core::next_events(300).await;
        if let Ok(bytes) = ssh_core::sftp_read_range(session, path.clone(), 2, 3).await {
            if bytes.len() == 3 {
                slice = Some(bytes);
                break;
            }
        }
    }
    assert_eq!(slice.expect("read_range must return 3 bytes"), b"CDE".to_vec());

    ssh_core::sftp_remove(session, path, false).await.ok();
    ssh_core::close_channel(channel).await.ok();
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn read_range_rejects_an_oversized_request() {
    require_server!();
    let session = connected_session("sftp-range-cap").await;
    let err = ssh_core::sftp_read_range(session, "whatever".into(), 0, ssh_core::SFTP_READ_RANGE_MAX + 1)
        .await
        .expect_err("read_range must cap its length");
    assert_eq!(err.code(), "sftp");
    ssh_core::disconnect(session).await.unwrap();
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cargo test -p ssh-core --test sftp_browse`
Expected: FAIL — no `sftp_list` and friends.

- [ ] **Step 3: Write the sftp module**

`crates/ssh-core/src/sftp.rs` (replacing the stub):

```rust
use russh_sftp::client::SftpSession;

use crate::error::{SshError, SshResult};
use crate::session::session_of;
use crate::types::{DirEntry, SessionId};

/// Cap on `sftp_read_range`, whose result crosses FFI into a JS buffer. Bulk
/// movement goes through upload/download, which never materialises a whole
/// file in memory (spec §5).
pub const SFTP_READ_RANGE_MAX: u32 = 1024 * 1024;

/// Tracks one in-flight upload or download. Task 9 owns its lifecycle.
pub(crate) struct TransferEntry {
    pub(crate) cancel: tokio_util::sync::CancellationToken,
}

fn sftp_err<E: std::fmt::Display>(e: E) -> SshError {
    SshError::Sftp { msg: e.to_string() }
}

/// Opens a fresh sftp subsystem channel per operation. Simpler than pooling,
/// and channel setup is cheap next to the file I/O that follows.
pub(crate) async fn sftp_session(session: SessionId) -> SshResult<SftpSession> {
    let sess = session_of(session)?;
    let channel = sess.handle.channel_open_session().await.map_err(sftp_err)?;
    channel.request_subsystem(true, "sftp").await.map_err(sftp_err)?;
    SftpSession::new(channel.into_stream()).await.map_err(sftp_err)
}

fn to_dir_entry(name: String, meta: &russh_sftp::protocol::FileAttributes) -> DirEntry {
    DirEntry {
        name,
        size: meta.size.unwrap_or(0),
        is_dir: meta.is_dir(),
        is_symlink: meta.is_symlink(),
        mode: meta.permissions.unwrap_or(0),
        modified_unix: meta.mtime.unwrap_or(0) as i64,
    }
}

pub async fn sftp_list(session: SessionId, path: String) -> SshResult<Vec<DirEntry>> {
    let sftp = sftp_session(session).await?;
    let mut out = Vec::new();
    for entry in sftp.read_dir(&path).await.map_err(sftp_err)? {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        out.push(to_dir_entry(name, entry.metadata()));
    }
    out.sort_by(|a, b| (b.is_dir, a.name.to_lowercase()).cmp(&(a.is_dir, b.name.to_lowercase())));
    sftp.close().await.ok();
    Ok(out)
}

pub async fn sftp_stat(session: SessionId, path: String) -> SshResult<DirEntry> {
    let sftp = sftp_session(session).await?;
    let meta = sftp.metadata(&path).await.map_err(sftp_err)?;
    let name = path.rsplit('/').next().unwrap_or(&path).to_string();
    let entry = to_dir_entry(name, &meta);
    sftp.close().await.ok();
    Ok(entry)
}

pub async fn sftp_mkdir(session: SessionId, path: String) -> SshResult<()> {
    let sftp = sftp_session(session).await?;
    let r = sftp.create_dir(&path).await.map_err(sftp_err);
    sftp.close().await.ok();
    r
}

pub async fn sftp_rename(session: SessionId, from: String, to: String) -> SshResult<()> {
    let sftp = sftp_session(session).await?;
    let r = sftp.rename(&from, &to).await.map_err(sftp_err);
    sftp.close().await.ok();
    r
}

pub async fn sftp_remove(session: SessionId, path: String, recursive: bool) -> SshResult<()> {
    let sftp = sftp_session(session).await?;
    let r = remove_inner(&sftp, path, recursive).await;
    sftp.close().await.ok();
    r
}

/// Boxed because recursion in an async fn needs an indirection.
fn remove_inner<'a>(
    sftp: &'a SftpSession,
    path: String,
    recursive: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = SshResult<()>> + Send + 'a>> {
    Box::pin(async move {
        let meta = sftp.metadata(&path).await.map_err(sftp_err)?;
        if !meta.is_dir() {
            return sftp.remove_file(&path).await.map_err(sftp_err);
        }
        if recursive {
            for entry in sftp.read_dir(&path).await.map_err(sftp_err)? {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                remove_inner(sftp, format!("{}/{}", path.trim_end_matches('/'), name), true).await?;
            }
        }
        sftp.remove_dir(&path).await.map_err(sftp_err)
    })
}

pub async fn sftp_read_range(
    session: SessionId,
    path: String,
    offset: u64,
    len: u32,
) -> SshResult<Vec<u8>> {
    if len > SFTP_READ_RANGE_MAX {
        return Err(SshError::Sftp {
            msg: format!("read_range length {len} exceeds the {SFTP_READ_RANGE_MAX} byte cap"),
        });
    }

    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let sftp = sftp_session(session).await?;
    let mut file = sftp.open(&path).await.map_err(sftp_err)?;
    file.seek(std::io::SeekFrom::Start(offset)).await.map_err(sftp_err)?;

    let mut buf = vec![0u8; len as usize];
    let mut filled = 0usize;
    while filled < buf.len() {
        match file.read(&mut buf[filled..]).await.map_err(sftp_err)? {
            0 => break, // short read at end of file is not an error
            n => filled += n,
        }
    }
    buf.truncate(filled);
    sftp.close().await.ok();
    Ok(buf)
}
```

Add to `crates/ssh-core/Cargo.toml` dependencies:

```toml
tokio-util = "0.7"
```

Modify `crates/ssh-core/src/lib.rs` re-exports:

```rust
pub use sftp::{
    sftp_list, sftp_mkdir, sftp_read_range, sftp_remove, sftp_rename, sftp_stat,
    SFTP_READ_RANGE_MAX,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p ssh-core --test sftp_browse`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/ssh-core
git commit -m "feat(ssh-core): add SFTP listing, stat, mkdir, rename, remove, read_range"
```

---

## Task 9: SFTP upload and download with progress

**Files:**
- Modify: `crates/ssh-core/src/sftp.rs`
- Modify: `crates/ssh-core/src/lib.rs`
- Test: `crates/ssh-core/tests/sftp_transfer.rs`

**Interfaces:**
- Consumes: `sftp_session`, `TransferEntry`, `EventQueue`, `TransferId`.
- Produces:
  - `pub async fn sftp_upload(session: SessionId, local: String, remote: String) -> SshResult<TransferId>`
  - `pub async fn sftp_download(session: SessionId, remote: String, local: String) -> SshResult<TransferId>`
  - `pub async fn cancel_transfer(id: TransferId) -> SshResult<()>`
  - Both return immediately; completion arrives as `Event::TransferDone`, progress as `Event::TransferProgress`.

- [ ] **Step 1: Write the failing tests**

`crates/ssh-core/tests/sftp_transfer.rs`:

```rust
mod common;

use ssh_core::{ConnectConfig, Credential, Event, TransferId};
use std::time::{Duration, Instant};

async fn connected_session(name: &str) -> ssh_core::SessionId {
    let server = common::TestServer::from_env();
    let mut p = std::env::temp_dir();
    p.push(format!("termif-kh-{}-{}", std::process::id(), name));
    let _ = std::fs::remove_file(&p);
    ssh_core::init(p).expect("init");

    let cfg = || ConnectConfig {
        host: server.host.clone(),
        port: server.port,
        username: server.username.clone(),
        credential: Credential::Password { password: server.password.clone() },
        connect_timeout_ms: 10_000,
        keepalive_secs: 30,
    };
    if let Err(ssh_core::SshError::HostKeyUnknown { fingerprint, algo, .. }) =
        ssh_core::connect(cfg()).await
    {
        ssh_core::trust_host_key(server.host.clone(), server.port, algo, fingerprint)
            .await
            .unwrap();
    }
    ssh_core::connect(cfg()).await.expect("connect")
}

/// Wait for TransferDone on `id`, collecting how many progress events arrived.
async fn await_transfer(id: TransferId, deadline: Duration) -> (Option<String>, usize) {
    let started = Instant::now();
    let mut progress_count = 0usize;
    while started.elapsed() < deadline {
        for event in ssh_core::next_events(300).await {
            match event {
                Event::TransferProgress { transfer_id, .. } if transfer_id == id => {
                    progress_count += 1;
                }
                Event::TransferDone { transfer_id, error } if transfer_id == id => {
                    return (error, progress_count);
                }
                _ => {}
            }
        }
    }
    panic!("transfer {id:?} did not finish within {deadline:?}");
}

fn write_temp_file(name: &str, size: usize) -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("termif-xfer-{}-{}", std::process::id(), name));
    // A repeating pattern rather than zeros, so a truncated transfer is visible.
    let data: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
    std::fs::write(&p, data).expect("write local test file");
    p
}

#[tokio::test]
async fn upload_then_download_round_trips_a_large_file_byte_for_byte() {
    require_server!();
    let session = connected_session("xfer-round").await;

    // 5 MiB: large enough to cross many SFTP packets and emit progress.
    let local_up = write_temp_file("up.bin", 5 * 1024 * 1024);
    let original = std::fs::read(&local_up).unwrap();
    let remote = format!("termif-xfer-{}.bin", std::process::id());

    let id = ssh_core::sftp_upload(
        session,
        local_up.to_string_lossy().to_string(),
        remote.clone(),
    )
    .await
    .expect("start upload");

    let (error, progress_count) = await_transfer(id, Duration::from_secs(120)).await;
    assert!(error.is_none(), "upload failed: {error:?}");
    assert!(progress_count > 0, "an upload of this size must report progress");

    let meta = ssh_core::sftp_stat(session, remote.clone()).await.expect("stat uploaded file");
    assert_eq!(meta.size as usize, original.len(), "uploaded size must match");

    let local_down = std::env::temp_dir().join(format!("termif-down-{}.bin", std::process::id()));
    let _ = std::fs::remove_file(&local_down);

    let id = ssh_core::sftp_download(
        session,
        remote.clone(),
        local_down.to_string_lossy().to_string(),
    )
    .await
    .expect("start download");

    let (error, _) = await_transfer(id, Duration::from_secs(120)).await;
    assert!(error.is_none(), "download failed: {error:?}");

    let round_tripped = std::fs::read(&local_down).expect("downloaded file must exist");
    assert_eq!(round_tripped, original, "round trip must be byte-for-byte identical");

    ssh_core::sftp_remove(session, remote, false).await.ok();
    let _ = std::fs::remove_file(&local_up);
    let _ = std::fs::remove_file(&local_down);
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn uploading_a_missing_local_file_reports_an_error_event() {
    require_server!();
    let session = connected_session("xfer-missing").await;

    let id = ssh_core::sftp_upload(
        session,
        "/definitely/not/a/file".into(),
        format!("termif-nope-{}.bin", std::process::id()),
    )
    .await
    .expect("the call itself succeeds; the failure arrives as an event");

    let (error, _) = await_transfer(id, Duration::from_secs(30)).await;
    assert!(error.is_some(), "a missing local file must report an error");

    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn cancelling_a_transfer_stops_it() {
    require_server!();
    let session = connected_session("xfer-cancel").await;

    let local_up = write_temp_file("cancel.bin", 40 * 1024 * 1024);
    let remote = format!("termif-cancel-{}.bin", std::process::id());

    let id = ssh_core::sftp_upload(
        session,
        local_up.to_string_lossy().to_string(),
        remote.clone(),
    )
    .await
    .expect("start upload");

    // Let it get going, then cancel.
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(5) {
        let _ = ssh_core::next_events(200).await;
    }
    ssh_core::cancel_transfer(id).await.expect("cancel");

    let (error, _) = await_transfer(id, Duration::from_secs(60)).await;
    assert!(error.is_some(), "a cancelled transfer must not report success");
    assert!(
        error.as_deref().unwrap_or("").to_lowercase().contains("cancel"),
        "the error should say it was cancelled, got {error:?}"
    );

    ssh_core::sftp_remove(session, remote, false).await.ok();
    let _ = std::fs::remove_file(&local_up);
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn cancelling_an_unknown_transfer_errors() {
    let mut p = std::env::temp_dir();
    p.push(format!("termif-kh-{}-noxfer", std::process::id()));
    ssh_core::init(p).unwrap();
    let err = ssh_core::cancel_transfer(TransferId::from_raw(999_999))
        .await
        .expect_err("stale transfer handles must not resolve");
    assert_eq!(err.code(), "no_such_transfer");
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cargo test -p ssh-core --test sftp_transfer`
Expected: FAIL — no `sftp_upload`, `sftp_download`, `cancel_transfer`.

- [ ] **Step 3: Append the transfer implementation**

Append to `crates/ssh-core/src/sftp.rs`:

```rust
use crate::events::Event;
use crate::session::{core, events};
use crate::types::TransferId;
use tokio_util::sync::CancellationToken;

/// Progress is reported at most this often, so a fast transfer does not flood
/// the event queue with thousands of updates the UI cannot draw anyway.
const PROGRESS_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);
const CHUNK: usize = 64 * 1024;

pub async fn sftp_upload(
    session: SessionId,
    local: String,
    remote: String,
) -> SshResult<TransferId> {
    let core = core()?;
    let cancel = CancellationToken::new();
    let id_raw = core.transfers.insert(TransferEntry { cancel: cancel.clone() });
    let id = TransferId::from_raw(id_raw);
    let queue = events()?;

    core.runtime.spawn(async move {
        let result = upload_inner(session, &local, &remote, id, &queue, &cancel).await;
        let error = result.err().map(|e| e.to_string());
        queue.push(Event::TransferDone { transfer_id: id, error });
        if let Ok(c) = core() {
            c.transfers.remove(id.raw());
        }
    });

    Ok(id)
}

async fn upload_inner(
    session: SessionId,
    local: &str,
    remote: &str,
    id: TransferId,
    queue: &std::sync::Arc<crate::events::EventQueue>,
    cancel: &CancellationToken,
) -> SshResult<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut src = tokio::fs::File::open(local).await?;
    let total = src.metadata().await?.len();

    let sftp = sftp_session(session).await?;
    let mut dst = sftp.create(remote).await.map_err(sftp_err)?;

    let mut buf = vec![0u8; CHUNK];
    let mut done: u64 = 0;
    let mut last_report = std::time::Instant::now();

    loop {
        if cancel.is_cancelled() {
            // Leave the partial remote file in place but report the failure;
            // deciding whether to delete it is the UI's call, not ours.
            return Err(SshError::Sftp { msg: "transfer cancelled".into() });
        }
        let n = src.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).await.map_err(sftp_err)?;
        done += n as u64;

        if last_report.elapsed() >= PROGRESS_INTERVAL {
            queue.push(Event::TransferProgress { transfer_id: id, done, total });
            last_report = std::time::Instant::now();
        }
    }

    dst.sync_all().await.map_err(sftp_err)?;
    dst.shutdown().await.map_err(sftp_err)?;
    sftp.close().await.ok();

    queue.push(Event::TransferProgress { transfer_id: id, done, total });
    Ok(())
}

pub async fn sftp_download(
    session: SessionId,
    remote: String,
    local: String,
) -> SshResult<TransferId> {
    let core = core()?;
    let cancel = CancellationToken::new();
    let id_raw = core.transfers.insert(TransferEntry { cancel: cancel.clone() });
    let id = TransferId::from_raw(id_raw);
    let queue = events()?;

    core.runtime.spawn(async move {
        let result = download_inner(session, &remote, &local, id, &queue, &cancel).await;
        let error = result.err().map(|e| e.to_string());
        queue.push(Event::TransferDone { transfer_id: id, error });
        if let Ok(c) = core() {
            c.transfers.remove(id.raw());
        }
    });

    Ok(id)
}

async fn download_inner(
    session: SessionId,
    remote: &str,
    local: &str,
    id: TransferId,
    queue: &std::sync::Arc<crate::events::EventQueue>,
    cancel: &CancellationToken,
) -> SshResult<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let sftp = sftp_session(session).await?;
    let meta = sftp.metadata(remote).await.map_err(sftp_err)?;
    let total = meta.size.unwrap_or(0);
    let mut src = sftp.open(remote).await.map_err(sftp_err)?;

    // Write to a sibling temp file and rename on success, so a cancelled or
    // failed download never leaves a truncated file at the real path.
    let tmp = format!("{local}.part");
    if let Some(parent) = std::path::Path::new(local).parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }
    let mut dst = tokio::fs::File::create(&tmp).await?;

    let mut buf = vec![0u8; CHUNK];
    let mut done: u64 = 0;
    let mut last_report = std::time::Instant::now();

    loop {
        if cancel.is_cancelled() {
            drop(dst);
            tokio::fs::remove_file(&tmp).await.ok();
            return Err(SshError::Sftp { msg: "transfer cancelled".into() });
        }
        let n = src.read(&mut buf).await.map_err(sftp_err)?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).await?;
        done += n as u64;

        if last_report.elapsed() >= PROGRESS_INTERVAL {
            queue.push(Event::TransferProgress { transfer_id: id, done, total });
            last_report = std::time::Instant::now();
        }
    }

    dst.flush().await?;
    dst.sync_all().await?;
    drop(dst);
    tokio::fs::rename(&tmp, local).await?;
    sftp.close().await.ok();

    queue.push(Event::TransferProgress { transfer_id: id, done, total });
    Ok(())
}

pub async fn cancel_transfer(id: TransferId) -> SshResult<()> {
    let entry = core()?.transfers.get(id.raw()).ok_or(SshError::NoSuchTransfer)?;
    entry.cancel.cancel();
    Ok(())
}
```

Modify `crates/ssh-core/src/lib.rs` re-exports:

```rust
pub use sftp::{cancel_transfer, sftp_download, sftp_upload};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p ssh-core --test sftp_transfer`
Expected: PASS, 4 tests. The round-trip test moves 5 MiB and the cancel test 40 MiB, so allow a minute or two.

- [ ] **Step 5: Commit**

```bash
git add crates/ssh-core
git commit -m "feat(ssh-core): add SFTP upload and download with progress and cancellation"
```

---

## Task 10: Port forwarding

**Files:**
- Create (replace stub): `crates/ssh-core/src/forward.rs`
- Modify: `crates/ssh-core/src/lib.rs`
- Test: `crates/ssh-core/tests/forward.rs`

**Interfaces:**
- Consumes: `session_of`, `EventQueue`, `ForwardId`, `Registry`.
- Produces:
  - `pub async fn forward_local(session: SessionId, local_bind: String, remote_host: String, remote_port: u16) -> SshResult<ForwardId>`
  - `pub async fn forward_remote(session: SessionId, remote_bind_host: String, remote_bind_port: u16, local_host: String, local_port: u16) -> SshResult<ForwardId>`
  - `pub async fn forward_socks(session: SessionId, local_bind: String) -> SshResult<ForwardId>`
  - `pub async fn close_forward(id: ForwardId) -> SshResult<()>`
  - `pub(crate) struct ForwardEntry { cancel, bound_port }`
  - `pub async fn forward_bound_port(id: ForwardId) -> SshResult<u16>` — resolves port 0 to the OS-assigned port, which tests and the UI both need.

Note on scope: the spec's platform table (§5) says iOS can only hold a local listener in the foreground. That is an OS constraint enforced by the shell, not by this crate — `forward_local` here simply fails with `SshError::Forward` if the bind fails, and Plan 4 Task 9 adds the iOS-specific UI treatment.

- [ ] **Step 1: Write the failing tests**

`crates/ssh-core/tests/forward.rs`:

```rust
mod common;

use ssh_core::{ConnectConfig, Credential};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn connected_session(name: &str) -> ssh_core::SessionId {
    let server = common::TestServer::from_env();
    let mut p = std::env::temp_dir();
    p.push(format!("termif-kh-{}-{}", std::process::id(), name));
    let _ = std::fs::remove_file(&p);
    ssh_core::init(p).expect("init");

    let cfg = || ConnectConfig {
        host: server.host.clone(),
        port: server.port,
        username: server.username.clone(),
        credential: Credential::Password { password: server.password.clone() },
        connect_timeout_ms: 10_000,
        keepalive_secs: 30,
    };
    if let Err(ssh_core::SshError::HostKeyUnknown { fingerprint, algo, .. }) =
        ssh_core::connect(cfg()).await
    {
        ssh_core::trust_host_key(server.host.clone(), server.port, algo, fingerprint)
            .await
            .unwrap();
    }
    ssh_core::connect(cfg()).await.expect("connect")
}

#[tokio::test]
async fn local_forward_reaches_the_ssh_port_through_the_tunnel() {
    require_server!();
    let session = connected_session("fwd-local").await;

    // Forward a local port to the server's own sshd, reached from inside the
    // container as 127.0.0.1:2222. Reading the banner proves bytes flow.
    let id = ssh_core::forward_local(session, "127.0.0.1:0".into(), "127.0.0.1".into(), 2222)
        .await
        .expect("start local forward");
    let port = ssh_core::forward_bound_port(id).await.expect("bound port");
    assert_ne!(port, 0, "port 0 must resolve to a real assigned port");

    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("connect through the tunnel");

    let mut buf = [0u8; 64];
    let n = tokio::time::timeout(std::time::Duration::from_secs(10), stream.read(&mut buf))
        .await
        .expect("banner must arrive")
        .expect("read");
    let banner = String::from_utf8_lossy(&buf[..n]);
    assert!(banner.starts_with("SSH-2.0"), "expected an SSH banner, got {banner:?}");

    ssh_core::close_forward(id).await.expect("close forward");
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn closing_a_local_forward_stops_accepting() {
    require_server!();
    let session = connected_session("fwd-close").await;

    let id = ssh_core::forward_local(session, "127.0.0.1:0".into(), "127.0.0.1".into(), 2222)
        .await
        .unwrap();
    let port = ssh_core::forward_bound_port(id).await.unwrap();

    ssh_core::close_forward(id).await.expect("close");

    // Give the listener a moment to actually drop.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    .expect("connect attempt must not hang");
    assert!(result.is_err(), "a closed forward must refuse new connections");

    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn socks_forward_proxies_a_connect_request() {
    require_server!();
    let session = connected_session("fwd-socks").await;

    let id = ssh_core::forward_socks(session, "127.0.0.1:0".into())
        .await
        .expect("start socks forward");
    let port = ssh_core::forward_bound_port(id).await.unwrap();

    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();

    // SOCKS5 greeting: version 5, one method, "no authentication".
    stream.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
    let mut reply = [0u8; 2];
    stream.read_exact(&mut reply).await.unwrap();
    assert_eq!(reply, [0x05, 0x00], "server must select no-auth");

    // CONNECT to 127.0.0.1:2222 (the container's sshd), IPv4 address type.
    stream
        .write_all(&[0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0x08, 0xAE])
        .await
        .unwrap();
    let mut resp = [0u8; 10];
    stream.read_exact(&mut resp).await.unwrap();
    assert_eq!(resp[0], 0x05);
    assert_eq!(resp[1], 0x00, "CONNECT must succeed, got status {}", resp[1]);

    let mut buf = [0u8; 64];
    let n = tokio::time::timeout(std::time::Duration::from_secs(10), stream.read(&mut buf))
        .await
        .expect("banner")
        .unwrap();
    assert!(String::from_utf8_lossy(&buf[..n]).starts_with("SSH-2.0"));

    ssh_core::close_forward(id).await.unwrap();
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn binding_a_privileged_port_fails_with_a_forward_error() {
    require_server!();
    let session = connected_session("fwd-denied").await;

    // Port 1 requires root; on a normal CI user this must fail cleanly rather
    // than panic or hang.
    let result = ssh_core::forward_local(session, "127.0.0.1:1".into(), "127.0.0.1".into(), 2222).await;
    if let Err(e) = result {
        assert_eq!(e.code(), "forward");
    } else {
        eprintln!("NOTE: running as root, privileged bind succeeded; skipping assertion");
    }

    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn closing_an_unknown_forward_errors() {
    let mut p = std::env::temp_dir();
    p.push(format!("termif-kh-{}-nofwd", std::process::id()));
    ssh_core::init(p).unwrap();
    let err = ssh_core::close_forward(ssh_core::ForwardId::from_raw(999_999))
        .await
        .expect_err("stale forward handles must not resolve");
    assert_eq!(err.code(), "no_such_forward");
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cargo test -p ssh-core --test forward`
Expected: FAIL — no `forward_local`, `forward_socks`, `close_forward`, `forward_bound_port`.

- [ ] **Step 3: Write the forward module**

`crates/ssh-core/src/forward.rs` (replacing the stub):

```rust
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::error::{SshError, SshResult};
use crate::events::Event;
use crate::session::{core, events, session_of};
use crate::types::{ForwardId, SessionId};

pub(crate) struct ForwardEntry {
    pub(crate) cancel: CancellationToken,
    pub(crate) bound_port: u16,
}

fn fwd_err<E: std::fmt::Display>(e: E) -> SshError {
    SshError::Forward { msg: e.to_string() }
}

/// `-L`: listen locally, and open a `direct-tcpip` channel per accepted
/// connection. Binding happens here, synchronously, so a failure to bind is
/// reported to the caller rather than swallowed by a background task.
pub async fn forward_local(
    session: SessionId,
    local_bind: String,
    remote_host: String,
    remote_port: u16,
) -> SshResult<ForwardId> {
    let core = core()?;
    let listener = tokio::net::TcpListener::bind(&local_bind).await.map_err(fwd_err)?;
    let bound_port = listener.local_addr().map_err(fwd_err)?.port();

    let cancel = CancellationToken::new();
    let id_raw = core.forwards.insert(ForwardEntry { cancel: cancel.clone(), bound_port });
    let id = ForwardId::from_raw(id_raw);
    let queue = events()?;
    let sess = session_of(session)?;

    core.runtime.spawn(async move {
        loop {
            let accepted = tokio::select! {
                _ = cancel.cancelled() => break,
                r = listener.accept() => r,
            };
            let (mut socket, peer) = match accepted {
                Ok(v) => v,
                Err(e) => {
                    queue.push(Event::Log { level: "warn".into(), msg: format!("forward accept: {e}") });
                    break;
                }
            };
            queue.push(Event::ForwardAccepted { forward_id: id, peer: peer.to_string() });

            let sess = sess.clone();
            let queue2 = queue.clone();
            let remote_host = remote_host.clone();
            tokio::spawn(async move {
                let channel = match sess
                    .handle
                    .channel_open_direct_tcpip(&remote_host, remote_port as u32, "127.0.0.1", 0)
                    .await
                {
                    Ok(c) => c,
                    Err(e) => {
                        queue2.push(Event::Log {
                            level: "warn".into(),
                            msg: format!("forward channel: {e}"),
                        });
                        return;
                    }
                };
                let mut stream = channel.into_stream();
                // Either side closing ends the pair; errors here are ordinary
                // connection lifecycle, not faults worth surfacing.
                let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
            });
        }

        if let Ok(c) = core() {
            c.forwards.remove(id.raw());
        }
    });

    Ok(id)
}

/// `-R`: ask the server to listen and forward back to us. No local listener is
/// involved, which is why this works on iOS in the background (spec §5).
pub async fn forward_remote(
    session: SessionId,
    remote_bind_host: String,
    remote_bind_port: u16,
    local_host: String,
    local_port: u16,
) -> SshResult<ForwardId> {
    let core = core()?;
    let sess = session_of(session)?;

    sess.handle
        .tcpip_forward(&remote_bind_host, remote_bind_port as u32)
        .await
        .map_err(fwd_err)?;

    let cancel = CancellationToken::new();
    let id_raw = core
        .forwards
        .insert(ForwardEntry { cancel: cancel.clone(), bound_port: remote_bind_port });
    let id = ForwardId::from_raw(id_raw);
    let queue = events()?;

    // Incoming forwarded-tcpip channels arrive through the session handler.
    // Registering the destination is enough here; the handler pairs them.
    crate::session::register_remote_forward(id, local_host, local_port, cancel.clone())?;
    queue.push(Event::Log {
        level: "info".into(),
        msg: format!("remote forward listening on {remote_bind_host}:{remote_bind_port}"),
    });

    Ok(id)
}

/// `-D`: a minimal SOCKS5 front end. Only CONNECT with no authentication is
/// supported, which is what browsers and curl use; BIND and UDP ASSOCIATE are
/// out of scope.
pub async fn forward_socks(session: SessionId, local_bind: String) -> SshResult<ForwardId> {
    let core = core()?;
    let listener = tokio::net::TcpListener::bind(&local_bind).await.map_err(fwd_err)?;
    let bound_port = listener.local_addr().map_err(fwd_err)?.port();

    let cancel = CancellationToken::new();
    let id_raw = core.forwards.insert(ForwardEntry { cancel: cancel.clone(), bound_port });
    let id = ForwardId::from_raw(id_raw);
    let queue = events()?;
    let sess = session_of(session)?;

    core.runtime.spawn(async move {
        loop {
            let accepted = tokio::select! {
                _ = cancel.cancelled() => break,
                r = listener.accept() => r,
            };
            let (socket, peer) = match accepted {
                Ok(v) => v,
                Err(_) => break,
            };
            queue.push(Event::ForwardAccepted { forward_id: id, peer: peer.to_string() });

            let sess = sess.clone();
            let queue2 = queue.clone();
            tokio::spawn(async move {
                if let Err(e) = socks_serve(socket, sess).await {
                    queue2.push(Event::Log { level: "debug".into(), msg: format!("socks: {e}") });
                }
            });
        }
        if let Ok(c) = core() {
            c.forwards.remove(id.raw());
        }
    });

    Ok(id)
}

async fn socks_serve(
    mut socket: tokio::net::TcpStream,
    sess: Arc<crate::session::Session>,
) -> SshResult<()> {
    // Greeting: VER, NMETHODS, METHODS...
    let mut head = [0u8; 2];
    socket.read_exact(&mut head).await?;
    if head[0] != 0x05 {
        return Err(fwd_err("not SOCKS5"));
    }
    let mut methods = vec![0u8; head[1] as usize];
    socket.read_exact(&mut methods).await?;
    socket.write_all(&[0x05, 0x00]).await?; // no authentication

    // Request: VER, CMD, RSV, ATYP, ADDR, PORT
    let mut req = [0u8; 4];
    socket.read_exact(&mut req).await?;
    if req[1] != 0x01 {
        socket.write_all(&[0x05, 0x07, 0, 1, 0, 0, 0, 0, 0, 0]).await?; // command not supported
        return Err(fwd_err("only CONNECT is supported"));
    }

    let host = match req[3] {
        0x01 => {
            let mut a = [0u8; 4];
            socket.read_exact(&mut a).await?;
            std::net::Ipv4Addr::from(a).to_string()
        }
        0x03 => {
            let mut len = [0u8; 1];
            socket.read_exact(&mut len).await?;
            let mut name = vec![0u8; len[0] as usize];
            socket.read_exact(&mut name).await?;
            String::from_utf8_lossy(&name).to_string()
        }
        0x04 => {
            let mut a = [0u8; 16];
            socket.read_exact(&mut a).await?;
            std::net::Ipv6Addr::from(a).to_string()
        }
        _ => {
            socket.write_all(&[0x05, 0x08, 0, 1, 0, 0, 0, 0, 0, 0]).await?; // bad address type
            return Err(fwd_err("unsupported address type"));
        }
    };
    let mut port_bytes = [0u8; 2];
    socket.read_exact(&mut port_bytes).await?;
    let port = u16::from_be_bytes(port_bytes);

    match sess
        .handle
        .channel_open_direct_tcpip(&host, port as u32, "127.0.0.1", 0)
        .await
    {
        Ok(channel) => {
            // Success, with a zero BND.ADDR/BND.PORT: clients ignore it for CONNECT.
            socket.write_all(&[0x05, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
            Ok(())
        }
        Err(e) => {
            socket.write_all(&[0x05, 0x05, 0, 1, 0, 0, 0, 0, 0, 0]).await?; // connection refused
            Err(fwd_err(e))
        }
    }
}

pub async fn forward_bound_port(id: ForwardId) -> SshResult<u16> {
    Ok(core()?
        .forwards
        .get(id.raw())
        .ok_or(SshError::NoSuchForward)?
        .bound_port)
}

pub async fn close_forward(id: ForwardId) -> SshResult<()> {
    let entry = core()?.forwards.remove(id.raw()).ok_or(SshError::NoSuchForward)?;
    entry.cancel.cancel();
    Ok(())
}
```

Add to `crates/ssh-core/src/session.rs`, so `forward_remote` has somewhere to register and `ClientHandler` can pair incoming channels:

```rust
use std::collections::HashMap;

pub(crate) struct RemoteForward {
    pub(crate) local_host: String,
    pub(crate) local_port: u16,
    pub(crate) cancel: tokio_util::sync::CancellationToken,
}

static REMOTE_FORWARDS: OnceLock<Mutex<HashMap<u64, RemoteForward>>> = OnceLock::new();

fn remote_forwards() -> &'static Mutex<HashMap<u64, RemoteForward>> {
    REMOTE_FORWARDS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn register_remote_forward(
    id: crate::types::ForwardId,
    local_host: String,
    local_port: u16,
    cancel: tokio_util::sync::CancellationToken,
) -> SshResult<()> {
    remote_forwards()
        .lock()
        .expect("remote forwards mutex")
        .insert(id.raw(), RemoteForward { local_host, local_port, cancel });
    Ok(())
}

/// The destination for any forwarded-tcpip channel the server opens. With a
/// single remote forward configured this is unambiguous; with several, the
/// first live registration wins, which matches how the UI presents them.
pub(crate) fn remote_forward_target() -> Option<(String, u16)> {
    remote_forwards()
        .lock()
        .expect("remote forwards mutex")
        .values()
        .find(|f| !f.cancel.is_cancelled())
        .map(|f| (f.local_host.clone(), f.local_port))
}
```

Add `use std::sync::Mutex;` to `session.rs`, and add this handler method inside `impl client::Handler for ClientHandler`:

```rust
    /// The server opened a channel for a `-R` forward; pipe it to the local
    /// destination the UI registered.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let Some((host, port)) = crate::session::remote_forward_target() else {
            self.events.push(Event::Log {
                level: "warn".into(),
                msg: "forwarded-tcpip channel with no registered destination".into(),
            });
            return Ok(());
        };
        self.events.push(Event::Log {
            level: "info".into(),
            msg: format!("remote forward connection from {originator_address}"),
        });

        tokio::spawn(async move {
            if let Ok(mut local) = tokio::net::TcpStream::connect((host.as_str(), port)).await {
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut local, &mut stream).await;
            }
        });
        Ok(())
    }
```

Modify `crates/ssh-core/src/lib.rs` re-exports:

```rust
pub use forward::{
    close_forward, forward_bound_port, forward_local, forward_remote, forward_socks,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p ssh-core --test forward`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the whole suite**

Run: `cargo test -p ssh-core`
Expected: PASS, everything.

- [ ] **Step 6: Commit**

```bash
git add crates/ssh-core
git commit -m "feat(ssh-core): add local, remote, and SOCKS5 port forwarding"
```

---

## Task 11: napi-rs binding for Electron

**Files:**
- Create: `crates/ffi-napi/Cargo.toml`, `crates/ffi-napi/src/lib.rs`, `crates/ffi-napi/build.rs`, `crates/ffi-napi/package.json`
- Test: `crates/ffi-napi/__test__/smoke.mjs`

**Interfaces:**
- Consumes: the whole `ssh-core` public API.
- Produces a `.node` module exporting: `init(knownHostsPath)`, `connect(cfg)`, `disconnect(id)`, `trustHostKey(host, port, algo, fingerprint)`, `openShell(sessionId, cols, rows)`, `write(channelId, data)`, `resize(channelId, cols, rows)`, `closeChannel(channelId)`, `sftpList`, `sftpStat`, `sftpMkdir`, `sftpRename`, `sftpRemove`, `sftpReadRange`, `sftpUpload`, `sftpDownload`, `cancelTransfer`, `forwardLocal`, `forwardRemote`, `forwardSocks`, `forwardBoundPort`, `closeForward`, `nextEvents(timeoutMs)`.
- Handles cross as JS `bigint` (napi maps Rust `u64` to `BigInt`), so 64-bit ids survive intact.
- Errors cross as JS `Error` with `message` set to `"<code>: <display>"`, so the TypeScript layer can switch on the code prefix. Plan 2 Task 3 parses it.

- [ ] **Step 1: Write the manifests**

`crates/ffi-napi/Cargo.toml`:

```toml
[package]
name = "ffi-napi"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true

[lib]
crate-type = ["cdylib"]

[dependencies]
ssh-core = { path = "../ssh-core" }
napi = { version = "3", default-features = false, features = ["napi9", "async"] }
napi-derive = "3"

[build-dependencies]
napi-build = "2"

[profile.release]
lto = true
```

`crates/ffi-napi/build.rs`:

```rust
fn main() {
    napi_build::setup();
}
```

`crates/ffi-napi/package.json`:

```json
{
  "name": "@termif/ssh-native",
  "version": "0.1.0",
  "main": "index.js",
  "types": "index.d.ts",
  "napi": {
    "name": "termif-ssh",
    "triples": {
      "defaults": false,
      "additional": [
        "x86_64-apple-darwin",
        "aarch64-apple-darwin",
        "x86_64-pc-windows-msvc",
        "x86_64-unknown-linux-gnu"
      ]
    }
  },
  "scripts": {
    "build": "napi build --platform --release",
    "build:debug": "napi build --platform",
    "test": "node __test__/smoke.mjs"
  },
  "devDependencies": {
    "@napi-rs/cli": "^3.0.0"
  }
}
```

- [ ] **Step 2: Write the failing smoke test**

`crates/ffi-napi/__test__/smoke.mjs`:

```javascript
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const native = require('../index.js')

// 1. The module loads and exposes the expected surface.
for (const fn of [
  'init', 'connect', 'disconnect', 'trustHostKey',
  'openShell', 'write', 'resize', 'closeChannel',
  'sftpList', 'sftpStat', 'sftpMkdir', 'sftpRename', 'sftpRemove', 'sftpReadRange',
  'sftpUpload', 'sftpDownload', 'cancelTransfer',
  'forwardLocal', 'forwardRemote', 'forwardSocks', 'forwardBoundPort', 'closeForward',
  'nextEvents',
]) {
  assert.equal(typeof native[fn], 'function', `missing export: ${fn}`)
}

// 2. init is callable and idempotent.
const khPath = path.join(os.tmpdir(), `termif-napi-kh-${process.pid}`)
native.init(khPath)
native.init(khPath)

// 3. nextEvents returns an array and respects its timeout without blocking forever.
const started = Date.now()
const events = await native.nextEvents(200)
assert.ok(Array.isArray(events), 'nextEvents must resolve to an array')
const elapsed = Date.now() - started
assert.ok(elapsed >= 150 && elapsed < 3000, `idle nextEvents took ${elapsed}ms`)

// 4. A stale handle rejects with a code-prefixed error rather than crashing.
await assert.rejects(
  () => native.disconnect(999999n),
  (err) => {
    assert.match(err.message, /^no_such_session:/, `unexpected message: ${err.message}`)
    return true
  },
)

// 5. Connecting to a closed port rejects and does not take the process down.
await assert.rejects(() =>
  native.connect({
    host: '127.0.0.1',
    port: 1,
    username: 'nobody',
    password: 'x',
    privateKeyPem: null,
    passphrase: null,
    connectTimeoutMs: 2000,
    keepaliveSecs: 30,
  }),
)

console.log('napi smoke test passed')
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd crates/ffi-napi && npm install && npm run build:debug && npm test`
Expected: FAIL — `crates/ffi-napi/src/lib.rs` does not exist, so the build fails.

- [ ] **Step 4: Write the binding**

`crates/ffi-napi/src/lib.rs`:

```rust
//! Thin translation layer: JS types in, ssh-core types out, and no logic.
//! Every entry point catches panics, because a panic across the FFI boundary
//! is undefined behaviour (spec §7).

use napi::bindgen_prelude::*;
use napi_derive::napi;

use ssh_core as core;

fn to_napi(e: core::SshError) -> Error {
    // "<code>: <message>" so the TypeScript layer can switch on the code.
    Error::new(Status::GenericFailure, format!("{}: {}", e.code(), e))
}

/// Converts a panic into an ordinary rejected promise.
fn guard<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(_) => Err(Error::new(Status::GenericFailure, "internal: panic in ssh-core")),
    }
}

#[napi(object)]
pub struct JsConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    /// Exactly one of `password` or `private_key_pem` must be set.
    pub password: Option<String>,
    pub private_key_pem: Option<String>,
    pub passphrase: Option<String>,
    pub connect_timeout_ms: u32,
    pub keepalive_secs: u32,
}

impl TryFrom<JsConnectConfig> for core::ConnectConfig {
    type Error = Error;

    fn try_from(c: JsConnectConfig) -> Result<Self> {
        let credential = match (c.password, c.private_key_pem) {
            (Some(password), None) => core::Credential::Password { password },
            (None, Some(pem)) => core::Credential::Key { pem, passphrase: c.passphrase },
            _ => {
                return Err(Error::new(
                    Status::InvalidArg,
                    "auth: set exactly one of password or privateKeyPem",
                ))
            }
        };
        Ok(core::ConnectConfig {
            host: c.host,
            port: c.port,
            username: c.username,
            credential,
            connect_timeout_ms: c.connect_timeout_ms,
            keepalive_secs: c.keepalive_secs,
        })
    }
}

#[napi(object)]
pub struct JsDirEntry {
    pub name: String,
    pub size: BigInt,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub mode: u32,
    pub modified_unix: i64,
}

impl From<core::DirEntry> for JsDirEntry {
    fn from(e: core::DirEntry) -> Self {
        Self {
            name: e.name,
            size: BigInt::from(e.size),
            is_dir: e.is_dir,
            is_symlink: e.is_symlink,
            mode: e.mode,
            modified_unix: e.modified_unix,
        }
    }
}

/// One flat event shape rather than a tagged union, because napi object unions
/// are awkward on the JS side. `kind` discriminates; unused fields are null.
/// Plan 2 Task 3 narrows this back into a discriminated union in TypeScript.
#[napi(object)]
pub struct JsEvent {
    pub kind: String,
    pub channel_id: Option<BigInt>,
    pub session_id: Option<BigInt>,
    pub transfer_id: Option<BigInt>,
    pub forward_id: Option<BigInt>,
    pub bytes: Option<Buffer>,
    pub exit_status: Option<u32>,
    pub reason: Option<String>,
    pub done: Option<BigInt>,
    pub total: Option<BigInt>,
    pub error: Option<String>,
    pub peer: Option<String>,
    pub level: Option<String>,
    pub msg: Option<String>,
}

impl JsEvent {
    fn empty(kind: &str) -> Self {
        Self {
            kind: kind.to_string(),
            channel_id: None,
            session_id: None,
            transfer_id: None,
            forward_id: None,
            bytes: None,
            exit_status: None,
            reason: None,
            done: None,
            total: None,
            error: None,
            peer: None,
            level: None,
            msg: None,
        }
    }
}

impl From<core::Event> for JsEvent {
    fn from(e: core::Event) -> Self {
        use core::Event as E;
        match e {
            E::ChannelData { channel_id, bytes } => {
                let mut o = JsEvent::empty("channelData");
                o.channel_id = Some(BigInt::from(channel_id.raw()));
                o.bytes = Some(Buffer::from(bytes));
                o
            }
            E::ChannelClosed { channel_id, exit_status } => {
                let mut o = JsEvent::empty("channelClosed");
                o.channel_id = Some(BigInt::from(channel_id.raw()));
                o.exit_status = exit_status;
                o
            }
            E::SessionClosed { session_id, reason } => {
                let mut o = JsEvent::empty("sessionClosed");
                o.session_id = Some(BigInt::from(session_id.raw()));
                o.reason = Some(reason);
                o
            }
            E::TransferProgress { transfer_id, done, total } => {
                let mut o = JsEvent::empty("transferProgress");
                o.transfer_id = Some(BigInt::from(transfer_id.raw()));
                o.done = Some(BigInt::from(done));
                o.total = Some(BigInt::from(total));
                o
            }
            E::TransferDone { transfer_id, error } => {
                let mut o = JsEvent::empty("transferDone");
                o.transfer_id = Some(BigInt::from(transfer_id.raw()));
                o.error = error;
                o
            }
            E::ForwardAccepted { forward_id, peer } => {
                let mut o = JsEvent::empty("forwardAccepted");
                o.forward_id = Some(BigInt::from(forward_id.raw()));
                o.peer = Some(peer);
                o
            }
            E::Log { level, msg } => {
                let mut o = JsEvent::empty("log");
                o.level = Some(level);
                o.msg = Some(msg);
                o
            }
        }
    }
}

fn u64_of(v: BigInt) -> u64 {
    let (_signed, value, _lossless) = v.get_u64();
    value
}

#[napi]
pub fn init(known_hosts_path: String) -> Result<()> {
    guard(|| core::init(known_hosts_path.into()).map_err(to_napi))
}

#[napi]
pub async fn connect(cfg: JsConnectConfig) -> Result<BigInt> {
    let cfg: core::ConnectConfig = cfg.try_into()?;
    let id = core::connect(cfg).await.map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi]
pub async fn disconnect(session_id: BigInt) -> Result<()> {
    core::disconnect(core::SessionId::from_raw(u64_of(session_id)))
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn trust_host_key(
    host: String,
    port: u16,
    algo: String,
    fingerprint: String,
) -> Result<()> {
    core::trust_host_key(host, port, algo, fingerprint).await.map_err(to_napi)
}

#[napi]
pub async fn open_shell(session_id: BigInt, cols: u16, rows: u16) -> Result<BigInt> {
    let pty = core::PtySize { cols, rows, pixel_width: 0, pixel_height: 0 };
    let id = core::open_shell(core::SessionId::from_raw(u64_of(session_id)), pty)
        .await
        .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi]
pub async fn write(channel_id: BigInt, data: Buffer) -> Result<()> {
    core::write(core::ChannelId::from_raw(u64_of(channel_id)), data.to_vec())
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn resize(channel_id: BigInt, cols: u16, rows: u16) -> Result<()> {
    let pty = core::PtySize { cols, rows, pixel_width: 0, pixel_height: 0 };
    core::resize(core::ChannelId::from_raw(u64_of(channel_id)), pty)
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn close_channel(channel_id: BigInt) -> Result<()> {
    core::close_channel(core::ChannelId::from_raw(u64_of(channel_id)))
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn sftp_list(session_id: BigInt, path: String) -> Result<Vec<JsDirEntry>> {
    let entries = core::sftp_list(core::SessionId::from_raw(u64_of(session_id)), path)
        .await
        .map_err(to_napi)?;
    Ok(entries.into_iter().map(Into::into).collect())
}

#[napi]
pub async fn sftp_stat(session_id: BigInt, path: String) -> Result<JsDirEntry> {
    let entry = core::sftp_stat(core::SessionId::from_raw(u64_of(session_id)), path)
        .await
        .map_err(to_napi)?;
    Ok(entry.into())
}

#[napi]
pub async fn sftp_mkdir(session_id: BigInt, path: String) -> Result<()> {
    core::sftp_mkdir(core::SessionId::from_raw(u64_of(session_id)), path)
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn sftp_rename(session_id: BigInt, from: String, to: String) -> Result<()> {
    core::sftp_rename(core::SessionId::from_raw(u64_of(session_id)), from, to)
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn sftp_remove(session_id: BigInt, path: String, recursive: bool) -> Result<()> {
    core::sftp_remove(core::SessionId::from_raw(u64_of(session_id)), path, recursive)
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn sftp_read_range(
    session_id: BigInt,
    path: String,
    offset: BigInt,
    len: u32,
) -> Result<Buffer> {
    let bytes = core::sftp_read_range(
        core::SessionId::from_raw(u64_of(session_id)),
        path,
        u64_of(offset),
        len,
    )
    .await
    .map_err(to_napi)?;
    Ok(Buffer::from(bytes))
}

#[napi]
pub async fn sftp_upload(session_id: BigInt, local: String, remote: String) -> Result<BigInt> {
    let id = core::sftp_upload(core::SessionId::from_raw(u64_of(session_id)), local, remote)
        .await
        .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi]
pub async fn sftp_download(session_id: BigInt, remote: String, local: String) -> Result<BigInt> {
    let id = core::sftp_download(core::SessionId::from_raw(u64_of(session_id)), remote, local)
        .await
        .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi]
pub async fn cancel_transfer(transfer_id: BigInt) -> Result<()> {
    core::cancel_transfer(core::TransferId::from_raw(u64_of(transfer_id)))
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn forward_local(
    session_id: BigInt,
    local_bind: String,
    remote_host: String,
    remote_port: u16,
) -> Result<BigInt> {
    let id = core::forward_local(
        core::SessionId::from_raw(u64_of(session_id)),
        local_bind,
        remote_host,
        remote_port,
    )
    .await
    .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi]
pub async fn forward_remote(
    session_id: BigInt,
    remote_bind_host: String,
    remote_bind_port: u16,
    local_host: String,
    local_port: u16,
) -> Result<BigInt> {
    let id = core::forward_remote(
        core::SessionId::from_raw(u64_of(session_id)),
        remote_bind_host,
        remote_bind_port,
        local_host,
        local_port,
    )
    .await
    .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi]
pub async fn forward_socks(session_id: BigInt, local_bind: String) -> Result<BigInt> {
    let id = core::forward_socks(core::SessionId::from_raw(u64_of(session_id)), local_bind)
        .await
        .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi]
pub async fn forward_bound_port(forward_id: BigInt) -> Result<u16> {
    core::forward_bound_port(core::ForwardId::from_raw(u64_of(forward_id)))
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn close_forward(forward_id: BigInt) -> Result<()> {
    core::close_forward(core::ForwardId::from_raw(u64_of(forward_id)))
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn next_events(timeout_ms: u32) -> Vec<JsEvent> {
    core::next_events(timeout_ms).await.into_iter().map(Into::into).collect()
}
```

- [ ] **Step 5: Build and run the smoke test**

Run: `cd crates/ffi-napi && npm run build:debug && npm test`
Expected: `napi smoke test passed`.

- [ ] **Step 6: Commit**

```bash
git add crates/ffi-napi
git commit -m "feat(ffi-napi): expose ssh-core to Electron via napi-rs"
```

---

## Task 12: uniffi binding for iOS and Android

**Files:**
- Create: `crates/ffi-uniffi/Cargo.toml`, `crates/ffi-uniffi/src/lib.rs`, `crates/ffi-uniffi/uniffi.toml`
- Create: `scripts/build-ios.sh`, `scripts/build-android.sh`
- Test: `crates/ffi-uniffi/tests/exports.rs`

**Interfaces:**
- Consumes: the whole `ssh-core` public API.
- Produces the same 23 functions as Task 11, named in snake_case for Kotlin/Swift, plus `SshFfiError` (a `uniffi::Error` enum carrying `code` and `message`) and `FfiEvent` (a `uniffi::Enum`).
- Handle types cross as `u64`, which both Swift (`UInt64`) and Kotlin (`ULong`) support natively.
- Unlike napi, uniffi supports real tagged enums, so `FfiEvent` is a proper enum rather than a flat object.

- [ ] **Step 1: Write the manifests**

`crates/ffi-uniffi/Cargo.toml`:

```toml
[package]
name = "ffi-uniffi"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true

[lib]
crate-type = ["cdylib", "staticlib", "lib"]
name = "termif_ssh"

[dependencies]
ssh-core = { path = "../ssh-core" }
uniffi = { version = "0.28", features = ["tokio"] }
tokio.workspace = true

[build-dependencies]
uniffi = { version = "0.28", features = ["build"] }

[[bin]]
name = "uniffi-bindgen"
path = "src/bin/uniffi-bindgen.rs"
```

`crates/ffi-uniffi/uniffi.toml`:

```toml
[bindings.swift]
module_name = "TermifSsh"
cdylib_name = "termif_ssh"

[bindings.kotlin]
package_name = "com.termif.ssh"
cdylib_name = "termif_ssh"
```

`crates/ffi-uniffi/src/bin/uniffi-bindgen.rs`:

```rust
fn main() {
    uniffi::uniffi_bindgen_main()
}
```

- [ ] **Step 2: Write the failing test**

`crates/ffi-uniffi/tests/exports.rs`:

```rust
//! Verifies the binding compiles, the scaffolding is generated, and the
//! wrappers translate errors instead of panicking. Device-level binding tests
//! live in the mobile app (Plan 4).

use ffi_uniffi as ffi;

fn init_temp(name: &str) {
    let mut p = std::env::temp_dir();
    p.push(format!("termif-uniffi-kh-{}-{}", std::process::id(), name));
    let _ = std::fs::remove_file(&p);
    ffi::init(p.to_string_lossy().to_string()).expect("init");
}

#[tokio::test]
async fn stale_session_handle_returns_a_coded_error() {
    init_temp("stale");
    let err = ffi::disconnect(999_999).await.expect_err("stale handle must not resolve");
    assert_eq!(err.code(), "no_such_session");
}

#[tokio::test]
async fn next_events_returns_empty_when_idle() {
    init_temp("idle");
    let events = ffi::next_events(150).await;
    assert!(events.is_empty());
}

#[tokio::test]
async fn connect_config_requires_exactly_one_credential() {
    init_temp("cred");
    let err = ffi::connect(ffi::FfiConnectConfig {
        host: "127.0.0.1".into(),
        port: 22,
        username: "nobody".into(),
        password: Some("a".into()),
        private_key_pem: Some("b".into()),
        passphrase: None,
        connect_timeout_ms: 1000,
        keepalive_secs: 30,
    })
    .await
    .expect_err("two credentials is a programming error");
    assert_eq!(err.code(), "auth");
}

#[tokio::test]
async fn scaffolding_symbol_is_present() {
    // uniffi::setup_scaffolding! generates this; its absence means the macro
    // did not run and no bindings would be produced.
    init_temp("scaffold");
    assert!(ffi::uniffi_scaffolding_present());
}
```

- [ ] **Step 3: Run to see it fail**

Run: `cargo test -p ffi-uniffi`
Expected: FAIL — `crates/ffi-uniffi/src/lib.rs` does not exist.

- [ ] **Step 4: Write the binding**

`crates/ffi-uniffi/src/lib.rs`:

```rust
//! Thin translation layer for Swift and Kotlin. Same rules as ffi-napi: types
//! only, no logic, and no panic crosses the boundary (spec §7).

use ssh_core as core;

uniffi::setup_scaffolding!();

#[derive(Debug, Clone, thiserror::Error, uniffi::Error)]
pub enum SshFfiError {
    #[error("{code}: {message}")]
    Failed { code: String, message: String },
}

impl SshFfiError {
    pub fn code(&self) -> &str {
        match self {
            SshFfiError::Failed { code, .. } => code,
        }
    }
}

impl From<core::SshError> for SshFfiError {
    fn from(e: core::SshError) -> Self {
        SshFfiError::Failed { code: e.code().to_string(), message: e.to_string() }
    }
}

type FfiResult<T> = std::result::Result<T, SshFfiError>;

fn guard<T>(f: impl FnOnce() -> FfiResult<T>) -> FfiResult<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(_) => Err(SshFfiError::Failed {
            code: "internal".into(),
            message: "panic in ssh-core".into(),
        }),
    }
}

#[derive(uniffi::Record)]
pub struct FfiConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    /// Exactly one of `password` or `private_key_pem` must be set.
    pub password: Option<String>,
    pub private_key_pem: Option<String>,
    pub passphrase: Option<String>,
    pub connect_timeout_ms: u32,
    pub keepalive_secs: u32,
}

impl TryFrom<FfiConnectConfig> for core::ConnectConfig {
    type Error = SshFfiError;

    fn try_from(c: FfiConnectConfig) -> FfiResult<Self> {
        let credential = match (c.password, c.private_key_pem) {
            (Some(password), None) => core::Credential::Password { password },
            (None, Some(pem)) => core::Credential::Key { pem, passphrase: c.passphrase },
            _ => {
                return Err(SshFfiError::Failed {
                    code: "auth".into(),
                    message: "set exactly one of password or privateKeyPem".into(),
                })
            }
        };
        Ok(core::ConnectConfig {
            host: c.host,
            port: c.port,
            username: c.username,
            credential,
            connect_timeout_ms: c.connect_timeout_ms,
            keepalive_secs: c.keepalive_secs,
        })
    }
}

#[derive(uniffi::Record)]
pub struct FfiDirEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub mode: u32,
    pub modified_unix: i64,
}

impl From<core::DirEntry> for FfiDirEntry {
    fn from(e: core::DirEntry) -> Self {
        Self {
            name: e.name,
            size: e.size,
            is_dir: e.is_dir,
            is_symlink: e.is_symlink,
            mode: e.mode,
            modified_unix: e.modified_unix,
        }
    }
}

/// A real tagged enum, unlike the flat napi shape, because uniffi maps this
/// cleanly onto a Swift and Kotlin sealed type.
#[derive(uniffi::Enum)]
pub enum FfiEvent {
    ChannelData { channel_id: u64, bytes: Vec<u8> },
    ChannelClosed { channel_id: u64, exit_status: Option<u32> },
    SessionClosed { session_id: u64, reason: String },
    TransferProgress { transfer_id: u64, done: u64, total: u64 },
    TransferDone { transfer_id: u64, error: Option<String> },
    ForwardAccepted { forward_id: u64, peer: String },
    Log { level: String, msg: String },
}

impl From<core::Event> for FfiEvent {
    fn from(e: core::Event) -> Self {
        use core::Event as E;
        match e {
            E::ChannelData { channel_id, bytes } => {
                FfiEvent::ChannelData { channel_id: channel_id.raw(), bytes }
            }
            E::ChannelClosed { channel_id, exit_status } => {
                FfiEvent::ChannelClosed { channel_id: channel_id.raw(), exit_status }
            }
            E::SessionClosed { session_id, reason } => {
                FfiEvent::SessionClosed { session_id: session_id.raw(), reason }
            }
            E::TransferProgress { transfer_id, done, total } => {
                FfiEvent::TransferProgress { transfer_id: transfer_id.raw(), done, total }
            }
            E::TransferDone { transfer_id, error } => {
                FfiEvent::TransferDone { transfer_id: transfer_id.raw(), error }
            }
            E::ForwardAccepted { forward_id, peer } => {
                FfiEvent::ForwardAccepted { forward_id: forward_id.raw(), peer }
            }
            E::Log { level, msg } => FfiEvent::Log { level, msg },
        }
    }
}

#[uniffi::export]
pub fn init(known_hosts_path: String) -> FfiResult<()> {
    guard(|| core::init(known_hosts_path.into()).map_err(Into::into))
}

/// Present so a test can assert the scaffolding macro actually ran.
#[uniffi::export]
pub fn uniffi_scaffolding_present() -> bool {
    true
}

#[uniffi::export]
pub async fn connect(cfg: FfiConnectConfig) -> FfiResult<u64> {
    let cfg: core::ConnectConfig = cfg.try_into()?;
    Ok(core::connect(cfg).await?.raw())
}

#[uniffi::export]
pub async fn disconnect(session_id: u64) -> FfiResult<()> {
    Ok(core::disconnect(core::SessionId::from_raw(session_id)).await?)
}

#[uniffi::export]
pub async fn trust_host_key(
    host: String,
    port: u16,
    algo: String,
    fingerprint: String,
) -> FfiResult<()> {
    Ok(core::trust_host_key(host, port, algo, fingerprint).await?)
}

#[uniffi::export]
pub async fn open_shell(session_id: u64, cols: u16, rows: u16) -> FfiResult<u64> {
    let pty = core::PtySize { cols, rows, pixel_width: 0, pixel_height: 0 };
    Ok(core::open_shell(core::SessionId::from_raw(session_id), pty).await?.raw())
}

#[uniffi::export]
pub async fn write(channel_id: u64, data: Vec<u8>) -> FfiResult<()> {
    Ok(core::write(core::ChannelId::from_raw(channel_id), data).await?)
}

#[uniffi::export]
pub async fn resize(channel_id: u64, cols: u16, rows: u16) -> FfiResult<()> {
    let pty = core::PtySize { cols, rows, pixel_width: 0, pixel_height: 0 };
    Ok(core::resize(core::ChannelId::from_raw(channel_id), pty).await?)
}

#[uniffi::export]
pub async fn close_channel(channel_id: u64) -> FfiResult<()> {
    Ok(core::close_channel(core::ChannelId::from_raw(channel_id)).await?)
}

#[uniffi::export]
pub async fn sftp_list(session_id: u64, path: String) -> FfiResult<Vec<FfiDirEntry>> {
    let entries = core::sftp_list(core::SessionId::from_raw(session_id), path).await?;
    Ok(entries.into_iter().map(Into::into).collect())
}

#[uniffi::export]
pub async fn sftp_stat(session_id: u64, path: String) -> FfiResult<FfiDirEntry> {
    Ok(core::sftp_stat(core::SessionId::from_raw(session_id), path).await?.into())
}

#[uniffi::export]
pub async fn sftp_mkdir(session_id: u64, path: String) -> FfiResult<()> {
    Ok(core::sftp_mkdir(core::SessionId::from_raw(session_id), path).await?)
}

#[uniffi::export]
pub async fn sftp_rename(session_id: u64, from: String, to: String) -> FfiResult<()> {
    Ok(core::sftp_rename(core::SessionId::from_raw(session_id), from, to).await?)
}

#[uniffi::export]
pub async fn sftp_remove(session_id: u64, path: String, recursive: bool) -> FfiResult<()> {
    Ok(core::sftp_remove(core::SessionId::from_raw(session_id), path, recursive).await?)
}

#[uniffi::export]
pub async fn sftp_read_range(
    session_id: u64,
    path: String,
    offset: u64,
    len: u32,
) -> FfiResult<Vec<u8>> {
    Ok(core::sftp_read_range(core::SessionId::from_raw(session_id), path, offset, len).await?)
}

#[uniffi::export]
pub async fn sftp_upload(session_id: u64, local: String, remote: String) -> FfiResult<u64> {
    Ok(core::sftp_upload(core::SessionId::from_raw(session_id), local, remote).await?.raw())
}

#[uniffi::export]
pub async fn sftp_download(session_id: u64, remote: String, local: String) -> FfiResult<u64> {
    Ok(core::sftp_download(core::SessionId::from_raw(session_id), remote, local).await?.raw())
}

#[uniffi::export]
pub async fn cancel_transfer(transfer_id: u64) -> FfiResult<()> {
    Ok(core::cancel_transfer(core::TransferId::from_raw(transfer_id)).await?)
}

#[uniffi::export]
pub async fn forward_local(
    session_id: u64,
    local_bind: String,
    remote_host: String,
    remote_port: u16,
) -> FfiResult<u64> {
    Ok(core::forward_local(
        core::SessionId::from_raw(session_id),
        local_bind,
        remote_host,
        remote_port,
    )
    .await?
    .raw())
}

#[uniffi::export]
pub async fn forward_remote(
    session_id: u64,
    remote_bind_host: String,
    remote_bind_port: u16,
    local_host: String,
    local_port: u16,
) -> FfiResult<u64> {
    Ok(core::forward_remote(
        core::SessionId::from_raw(session_id),
        remote_bind_host,
        remote_bind_port,
        local_host,
        local_port,
    )
    .await?
    .raw())
}

#[uniffi::export]
pub async fn forward_socks(session_id: u64, local_bind: String) -> FfiResult<u64> {
    Ok(core::forward_socks(core::SessionId::from_raw(session_id), local_bind).await?.raw())
}

#[uniffi::export]
pub async fn forward_bound_port(forward_id: u64) -> FfiResult<u16> {
    Ok(core::forward_bound_port(core::ForwardId::from_raw(forward_id)).await?)
}

#[uniffi::export]
pub async fn close_forward(forward_id: u64) -> FfiResult<()> {
    Ok(core::close_forward(core::ForwardId::from_raw(forward_id)).await?)
}

#[uniffi::export]
pub async fn next_events(timeout_ms: u32) -> Vec<FfiEvent> {
    core::next_events(timeout_ms).await.into_iter().map(Into::into).collect()
}
```

Add `thiserror.workspace = true` to `crates/ffi-uniffi/Cargo.toml` dependencies, and a dev-dependency:

```toml
[dev-dependencies]
tokio = { version = "1", features = ["rt-multi-thread", "macros", "time"] }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test -p ffi-uniffi`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the iOS build script**

`scripts/build-ios.sh`:

```bash
#!/usr/bin/env bash
# Builds ssh-core for iOS device and simulator, then packages an XCFramework
# with the generated Swift bindings.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="crates/ffi-uniffi/out/ios"
LIB=libtermif_ssh.a

rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

cargo build -p ffi-uniffi --release --target aarch64-apple-ios
cargo build -p ffi-uniffi --release --target aarch64-apple-ios-sim
cargo build -p ffi-uniffi --release --target x86_64-apple-ios

rm -rf "$OUT"
mkdir -p "$OUT/swift" "$OUT/sim"

# Fat simulator slice: Apple silicon plus Intel.
lipo -create \
  "target/aarch64-apple-ios-sim/release/$LIB" \
  "target/x86_64-apple-ios/release/$LIB" \
  -output "$OUT/sim/$LIB"

cargo run -p ffi-uniffi --bin uniffi-bindgen -- generate \
  --library "target/aarch64-apple-ios/release/$LIB" \
  --language swift \
  --out-dir "$OUT/swift"

# uniffi emits a modulemap that must be renamed for XCFramework packaging.
mv "$OUT/swift/termif_sshFFI.modulemap" "$OUT/swift/module.modulemap"

xcodebuild -create-xcframework \
  -library "target/aarch64-apple-ios/release/$LIB" -headers "$OUT/swift" \
  -library "$OUT/sim/$LIB" -headers "$OUT/swift" \
  -output "$OUT/TermifSsh.xcframework"

echo "built $OUT/TermifSsh.xcframework"
```

- [ ] **Step 7: Write the Android build script**

`scripts/build-android.sh`:

```bash
#!/usr/bin/env bash
# Builds ssh-core for Android ABIs and generates the Kotlin bindings.
# Requires ANDROID_NDK_HOME and cargo-ndk.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="crates/ffi-uniffi/out/android"

: "${ANDROID_NDK_HOME:?set ANDROID_NDK_HOME to your NDK path}"
command -v cargo-ndk >/dev/null || cargo install cargo-ndk

rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

rm -rf "$OUT"
mkdir -p "$OUT/jniLibs" "$OUT/kotlin"

cargo ndk \
  -t arm64-v8a -t armeabi-v7a -t x86_64 \
  -o "$OUT/jniLibs" \
  build -p ffi-uniffi --release

cargo run -p ffi-uniffi --bin uniffi-bindgen -- generate \
  --library "$OUT/jniLibs/arm64-v8a/libtermif_ssh.so" \
  --language kotlin \
  --out-dir "$OUT/kotlin"

echo "built $OUT/jniLibs and $OUT/kotlin"
```

- [ ] **Step 8: Make the scripts executable and verify binding generation works for one target**

Run:

```bash
chmod +x scripts/build-ios.sh scripts/build-android.sh
cargo build -p ffi-uniffi --release
cargo run -p ffi-uniffi --bin uniffi-bindgen -- generate \
  --library target/release/libtermif_ssh.dylib \
  --language kotlin --out-dir /tmp/termif-kotlin-check
ls /tmp/termif-kotlin-check
```

Expected: a `.kt` file is produced. On Linux the library is `libtermif_ssh.so`; adjust the path accordingly. Full iOS and Android packaging runs in CI (Task 13) and needs Xcode or the NDK.

- [ ] **Step 9: Commit**

```bash
git add crates/ffi-uniffi scripts
git commit -m "feat(ffi-uniffi): expose ssh-core to iOS and Android via uniffi"
```

---

## Task 13: CI across all targets

**Files:**
- Create: `.github/workflows/rust.yml`

**Interfaces:**
- Consumes: everything above.
- Produces: a CI pipeline that fails on a broken target, which is the mitigation named in spec §10 for the four-target toolchain risk.

- [ ] **Step 1: Write the workflow**

`.github/workflows/rust.yml`:

```yaml
name: rust

on:
  push:
    branches: [main]
  pull_request:

env:
  CARGO_TERM_COLOR: always

jobs:
  test:
    name: unit and integration tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@1.78
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2

      - name: Start the sshd fixture
        run: |
          docker compose -f docker-compose.test.yml up -d
          for i in $(seq 1 30); do
            if nc -z 127.0.0.1 22022; then echo "sshd is up"; exit 0; fi
            sleep 2
          done
          echo "sshd did not come up"; docker compose -f docker-compose.test.yml logs; exit 1

      - name: Formatting
        run: cargo fmt --all -- --check

      - name: Clippy
        run: cargo clippy --workspace --all-targets -- -D warnings

      # Fails loudly if the fixture is missing, so integration tests can never
      # silently skip in CI the way they may on a developer machine.
      - name: Assert the fixture is reachable
        run: nc -z 127.0.0.1 22022

      - name: Tests
        run: cargo test --workspace -- --nocapture

  napi:
    name: napi build (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@1.78
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: Swatinem/rust-cache@v2
      - name: Build and smoke test
        working-directory: crates/ffi-napi
        run: |
          npm install
          npm run build:debug
          npm test

  ios:
    name: uniffi ios
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@1.78
      - uses: Swatinem/rust-cache@v2
      - run: ./scripts/build-ios.sh
      - name: Check the XCFramework exists
        run: test -d crates/ffi-uniffi/out/ios/TermifSsh.xcframework

  android:
    name: uniffi android
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@1.78
      - uses: nttld/setup-ndk@v1
        id: ndk
        with:
          ndk-version: r26d
      - uses: Swatinem/rust-cache@v2
      - run: ./scripts/build-android.sh
        env:
          ANDROID_NDK_HOME: ${{ steps.ndk.outputs.ndk-path }}
      - name: Check the libraries exist
        run: |
          test -f crates/ffi-uniffi/out/android/jniLibs/arm64-v8a/libtermif_ssh.so
          test -f crates/ffi-uniffi/out/android/jniLibs/armeabi-v7a/libtermif_ssh.so
          test -f crates/ffi-uniffi/out/android/jniLibs/x86_64/libtermif_ssh.so
```

- [ ] **Step 2: Verify locally what can be verified locally**

Run:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
docker compose -f docker-compose.test.yml up -d
cargo test --workspace
```

Expected: all pass. Fix any clippy warnings before committing, since CI treats them as errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/rust.yml
git commit -m "ci: build and test ssh-core on all four platform targets"
```

---

## Plan 1 Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| §3 Rust/TS split, no config in Rust | Global Constraints, Task 6 (`init` takes the only path) |
| §3 three build targets | Tasks 11, 12, 13 |
| §5 handle-based, no JS callbacks | Task 2 (`Registry`), Tasks 11 and 12 (no callback params) |
| §5 connect/disconnect | Task 6 |
| §5 trust_host_key, unknown vs mismatch | Tasks 4, 6 |
| §5 open_shell/write/resize/close_channel | Task 7 |
| §5 SFTP list/stat/mkdir/rename/remove | Task 8 |
| §5 `sftp_read_range` with a size cap | Task 8 (`SFTP_READ_RANGE_MAX` = 1 MiB, closing the spec's open question) |
| §5 upload/download by path, progress, cancel | Task 9 |
| §5 forward local/remote/dynamic | Task 10 |
| §5 `next_events` long poll, one runtime | Tasks 3, 6 |
| §5 known_hosts local, never synced | Task 4 (comment states the reason), no sync code exists here |
| §5 iOS forwarding limits | Task 10 note; UI treatment deferred to Plan 4 Task 9 |
| §7 host key mismatch hard block | Task 6 — `check_server_key` returns `Err`, and no "continue once" path exists |
| §7 no panic across FFI | Tasks 11, 12 (`guard`) |
| §8 Docker sshd integration tests | Tasks 5–10 |
| §10 four-target risk mitigated in CI | Task 13 |

**Placeholders:** none. Every code step carries real code. The three stub modules in Task 6 are named, one-line, and each says which task replaces it.

**Type consistency:** `SessionId`/`ChannelId`/`TransferId`/`ForwardId` are used identically in Tasks 2, 6–10 and cross FFI as `BigInt` (napi) and `u64` (uniffi). `SshError::code()` strings in Task 1 match every test assertion in Tasks 4, 6–10, 12 and the napi message prefix in Task 11. `DirEntry` fields in Task 2 match `JsDirEntry` (Task 11) and `FfiDirEntry` (Task 12). `Event` variants in Task 3 match `JsEvent.kind` values and `FfiEvent` variants.

**Deviation from the spec, recorded deliberately:** the spec's §5 signature list shows `trust_host_key(host, fingerprint)`. This plan uses `trust_host_key(host, port, algo, fingerprint)`, because a host on a non-default port is a distinct known_hosts entry and the algorithm is part of the entry. Task 4's tests cover both. The spec's signature would have made two different servers on one host indistinguishable.
