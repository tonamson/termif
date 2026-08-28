//! Thin translation layer: JS types in, ssh-core types out, and no logic.
//! Every entry point catches panics, because a panic across the FFI boundary
//! is undefined behaviour (spec §7).

use napi::bindgen_prelude::*;
use napi_derive::napi;

use ssh_core as ssh;

fn to_napi(e: ssh::SshError) -> Error {
    // "<code>: <message>" so the TypeScript layer can switch on the code.
    Error::new(Status::GenericFailure, format!("{}: {}", e.code(), e))
}

/// Converts a panic into an ordinary rejected promise.
fn guard<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(_) => Err(Error::new(
            Status::GenericFailure,
            "internal: panic in ssh-core",
        )),
    }
}

#[napi(object)]
pub struct JsConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    /// Exactly one of `password` or `private_key_pem` must be set.
    /// Double `Option` so napi-rs decodes `null` as `None` for object fields
    /// (napi-rs maps `undefined`/absent -> None but rejects `null` for
    /// `Option<String>`); `.flatten()` below restores the plain type.
    pub password: Option<Option<String>>,
    pub private_key_pem: Option<Option<String>>,
    pub passphrase: Option<Option<String>>,
    pub connect_timeout_ms: u32,
    pub keepalive_secs: u32,
}

impl TryFrom<JsConnectConfig> for ssh::ConnectConfig {
    type Error = Error;

    fn try_from(c: JsConnectConfig) -> Result<Self> {
        let password = c.password.flatten();
        let private_key_pem = c.private_key_pem.flatten();
        let passphrase = c.passphrase.flatten();
        let credential = match (password, private_key_pem) {
            (Some(password), None) => ssh::Credential::Password { password },
            (None, Some(pem)) => ssh::Credential::Key { pem, passphrase },
            _ => {
                return Err(Error::new(
                    Status::InvalidArg,
                    "auth: set exactly one of password or privateKeyPem",
                ))
            }
        };
        Ok(ssh::ConnectConfig {
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

impl From<ssh::DirEntry> for JsDirEntry {
    fn from(e: ssh::DirEntry) -> Self {
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

impl From<ssh::Event> for JsEvent {
    fn from(e: ssh::Event) -> Self {
        use ssh::Event as E;
        match e {
            E::ChannelData { channel_id, bytes } => {
                let mut o = JsEvent::empty("channelData");
                o.channel_id = Some(BigInt::from(channel_id.raw()));
                o.bytes = Some(Buffer::from(bytes));
                o
            }
            E::ChannelClosed {
                channel_id,
                exit_status,
            } => {
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
            E::TransferProgress {
                transfer_id,
                done,
                total,
            } => {
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

#[napi(catch_unwind)]
pub fn init(known_hosts_path: String) -> Result<()> {
    guard(|| ssh::init(known_hosts_path.into()).map_err(to_napi))
}

#[napi(catch_unwind)]
pub async fn connect(cfg: JsConnectConfig) -> Result<BigInt> {
    let cfg: ssh::ConnectConfig = cfg.try_into()?;
    let id = ssh::connect(cfg).await.map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi(catch_unwind)]
pub async fn disconnect(session_id: BigInt) -> Result<()> {
    ssh::disconnect(ssh::SessionId::from_raw(u64_of(session_id)))
        .await
        .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn trust_host_key(
    host: String,
    port: u16,
    algo: String,
    fingerprint: String,
) -> Result<()> {
    ssh::trust_host_key(host, port, algo, fingerprint)
        .await
        .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn open_shell(session_id: BigInt, cols: u16, rows: u16) -> Result<BigInt> {
    let pty = ssh::PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    };
    let id = ssh::open_shell(ssh::SessionId::from_raw(u64_of(session_id)), pty)
        .await
        .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi(catch_unwind)]
pub async fn write(channel_id: BigInt, data: Buffer) -> Result<()> {
    ssh::write(ssh::ChannelId::from_raw(u64_of(channel_id)), data.to_vec())
        .await
        .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn resize(channel_id: BigInt, cols: u16, rows: u16) -> Result<()> {
    let pty = ssh::PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    };
    ssh::resize(ssh::ChannelId::from_raw(u64_of(channel_id)), pty)
        .await
        .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn close_channel(channel_id: BigInt) -> Result<()> {
    ssh::close_channel(ssh::ChannelId::from_raw(u64_of(channel_id)))
        .await
        .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn sftp_list(session_id: BigInt, path: String) -> Result<Vec<JsDirEntry>> {
    let entries = ssh::sftp_list(ssh::SessionId::from_raw(u64_of(session_id)), path)
        .await
        .map_err(to_napi)?;
    Ok(entries.into_iter().map(Into::into).collect())
}

#[napi(catch_unwind)]
pub async fn sftp_stat(session_id: BigInt, path: String) -> Result<JsDirEntry> {
    let entry = ssh::sftp_stat(ssh::SessionId::from_raw(u64_of(session_id)), path)
        .await
        .map_err(to_napi)?;
    Ok(entry.into())
}

#[napi(catch_unwind)]
pub async fn sftp_mkdir(session_id: BigInt, path: String) -> Result<()> {
    ssh::sftp_mkdir(ssh::SessionId::from_raw(u64_of(session_id)), path)
        .await
        .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn sftp_rename(session_id: BigInt, from: String, to: String) -> Result<()> {
    ssh::sftp_rename(ssh::SessionId::from_raw(u64_of(session_id)), from, to)
        .await
        .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn sftp_remove(session_id: BigInt, path: String, recursive: bool) -> Result<()> {
    ssh::sftp_remove(
        ssh::SessionId::from_raw(u64_of(session_id)),
        path,
        recursive,
    )
    .await
    .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn sftp_read_range(
    session_id: BigInt,
    path: String,
    offset: BigInt,
    len: u32,
) -> Result<Buffer> {
    let bytes = ssh::sftp_read_range(
        ssh::SessionId::from_raw(u64_of(session_id)),
        path,
        u64_of(offset),
        len,
    )
    .await
    .map_err(to_napi)?;
    Ok(Buffer::from(bytes))
}

#[napi(catch_unwind)]
pub async fn sftp_upload(session_id: BigInt, local: String, remote: String) -> Result<BigInt> {
    let id = ssh::sftp_upload(ssh::SessionId::from_raw(u64_of(session_id)), local, remote)
        .await
        .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi(catch_unwind)]
pub async fn sftp_download(session_id: BigInt, remote: String, local: String) -> Result<BigInt> {
    let id = ssh::sftp_download(ssh::SessionId::from_raw(u64_of(session_id)), remote, local)
        .await
        .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi(catch_unwind)]
pub async fn cancel_transfer(transfer_id: BigInt) -> Result<()> {
    ssh::cancel_transfer(ssh::TransferId::from_raw(u64_of(transfer_id)))
        .await
        .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn forward_local(
    session_id: BigInt,
    local_bind: String,
    remote_host: String,
    remote_port: u16,
) -> Result<BigInt> {
    let id = ssh::forward_local(
        ssh::SessionId::from_raw(u64_of(session_id)),
        local_bind,
        remote_host,
        remote_port,
    )
    .await
    .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi(catch_unwind)]
pub async fn forward_remote(
    session_id: BigInt,
    remote_bind_host: String,
    remote_bind_port: u16,
    local_host: String,
    local_port: u16,
) -> Result<BigInt> {
    let id = ssh::forward_remote(
        ssh::SessionId::from_raw(u64_of(session_id)),
        remote_bind_host,
        remote_bind_port,
        local_host,
        local_port,
    )
    .await
    .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi(catch_unwind)]
pub async fn forward_socks(session_id: BigInt, local_bind: String) -> Result<BigInt> {
    let id = ssh::forward_socks(ssh::SessionId::from_raw(u64_of(session_id)), local_bind)
        .await
        .map_err(to_napi)?;
    Ok(BigInt::from(id.raw()))
}

#[napi(catch_unwind)]
pub async fn forward_bound_port(forward_id: BigInt) -> Result<u16> {
    ssh::forward_bound_port(ssh::ForwardId::from_raw(u64_of(forward_id)))
        .await
        .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn close_forward(forward_id: BigInt) -> Result<()> {
    ssh::close_forward(ssh::ForwardId::from_raw(u64_of(forward_id)))
        .await
        .map_err(to_napi)
}

#[napi(catch_unwind)]
pub async fn next_events(timeout_ms: u32) -> Vec<JsEvent> {
    ssh::next_events(timeout_ms)
        .await
        .into_iter()
        .map(Into::into)
        .collect()
}
