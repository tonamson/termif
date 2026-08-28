use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use russh::client;
use russh::keys::{HashAlg, PrivateKeyWithHashAlg};

use crate::error::{SshError, SshResult};
use crate::events::{Event, EventQueue};
use crate::hostkey::KnownHosts;
use crate::registry::Registry;
use crate::types::{ConnectConfig, Credential, SessionId};

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
    // `tcpip_forward` (used by `-R`) takes `&mut self` on the handle, but a
    // session is shared behind `Arc`, which cannot yield `&mut`. Tokio's
    // `Mutex` provides Send-safe interior mutability we can hold across await.
    pub(crate) handle: tokio::sync::Mutex<client::Handle<ClientHandler>>,
    pub(crate) host: String,
    pub(crate) port: u16,
}

static CORE: OnceLock<Core> = OnceLock::new();
// Guards the build in `init` so a concurrent initialization race can't build a
// second runtime and drop it inside an async context (tokio refuses that).
static INIT: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn core() -> SshResult<&'static Core> {
    CORE.get().ok_or_else(|| SshError::Internal {
        msg: "init() was not called".into(),
    })
}

/// Idempotent: a second call with a different path is ignored, because the
/// runtime and handle tables must not be replaced while sessions are live.
pub fn init(known_hosts_path: PathBuf) -> SshResult<()> {
    if CORE.get().is_some() {
        return Ok(());
    }
    let _guard = INIT.lock().expect("init mutex");
    if CORE.get().is_some() {
        return Ok(());
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("ssh-core")
        .build()
        .map_err(|e| SshError::Internal {
            msg: format!("runtime: {e}"),
        })?;

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

impl client::Handler for ClientHandler {
    type Error = SshError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = format!("{}", server_public_key.fingerprint(HashAlg::Sha256));
        let algo = server_public_key.algorithm().to_string();
        let core = core()?;

        match core
            .known_hosts
            .verify(&self.host, self.port, &algo, &fingerprint)
        {
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
    .map_err(|e| SshError::Connect {
        msg: format!("{addr}: {e}"),
    })?;

    let mut handle = client::connect_stream(config, tcp, handler).await?;

    let authenticated = match &cfg.credential {
        Credential::Password { password } => handle
            .authenticate_password(&cfg.username, password)
            .await
            .map_err(|e| SshError::Auth { msg: e.to_string() })?,
        Credential::Key { pem, passphrase } => {
            let key = russh::keys::decode_secret_key(pem, passphrase.as_deref()).map_err(|e| {
                SshError::Auth {
                    msg: format!("key: {e}"),
                }
            })?;
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
        return Err(SshError::Auth {
            msg: "server rejected the credential".into(),
        });
    }

    let id = core.sessions.insert(Session {
        handle: tokio::sync::Mutex::new(handle),
        host: cfg.host,
        port: cfg.port,
    });
    Ok(SessionId::from_raw(id))
}

pub async fn disconnect(id: SessionId) -> SshResult<()> {
    let core = core()?;
    let session = core
        .sessions
        .remove(id.raw())
        .ok_or(SshError::NoSuchSession)?;
    session
        .handle
        .lock()
        .await
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
        Ok(c) => {
            c.events
                .drain(Duration::from_millis(timeout_ms as u64))
                .await
        }
        Err(e) => vec![Event::Log {
            level: "error".into(),
            msg: e.to_string(),
        }],
    }
}

/// Resolve a channel's owning session; used by the channel and sftp modules.
pub(crate) fn session_of(id: SessionId) -> SshResult<Arc<Session>> {
    core()?
        .sessions
        .get(id.raw())
        .ok_or(SshError::NoSuchSession)
}

pub(crate) fn events() -> SshResult<Arc<EventQueue>> {
    Ok(core()?.events.clone())
}

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
        .insert(
            id.raw(),
            RemoteForward {
                local_host,
                local_port,
                cancel,
            },
        );
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
