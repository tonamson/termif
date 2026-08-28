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
    // Shared with the handler so `disconnected` can emit `SessionClosed`; the
    // explicit `disconnect()` path clears it before tearing the handle down so
    // a network-drop emission cannot double-report an application close.
    pub(crate) session_id_cell: Arc<Mutex<Option<SessionId>>>,
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
    // Filled in by `connect` after the session is registered, so a network
    // drop can report the correct id. Stays `None` for a session that was
    // never registered or one closed explicitly by the application.
    session_id_cell: Arc<Mutex<Option<SessionId>>>,
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

    /// A network drop always ends the connection for good; unlike a channel
    /// close it can be recovered by reconnecting, so surface it to the host as
    /// `Event::SessionClosed` (§6 reconnect). The application's own
    /// `disconnect()` path clears `session_id_cell` first, so it stays the
    /// single authoritative emission for an intentional close.
    async fn disconnected(
        &mut self,
        reason: client::DisconnectReason<Self::Error>,
    ) -> Result<(), Self::Error> {
        let emit = self.session_id_cell.lock().ok().and_then(|cell| *cell);
        if let Some(id) = emit {
            let reason = match &reason {
                client::DisconnectReason::ReceivedDisconnect(info) => info.message.clone(),
                client::DisconnectReason::Error(e) => e.to_string(),
            };
            self.events.push(Event::SessionClosed {
                session_id: id,
                reason,
            });
        }
        match reason {
            client::DisconnectReason::ReceivedDisconnect(_) => Ok(()),
            client::DisconnectReason::Error(e) => Err(e),
        }
    }

    /// The server opened a channel for a `-R` forward; pipe it to the local
    /// destination the UI registered. Routing is keyed on the port the server
    /// reports as connected, so several concurrent `-R` forwards each reach
    /// their own destination rather than an arbitrary one (§ plan finding 2).
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        connected_port: u32,
        originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let Some((host, port)) = crate::session::remote_forward_target(connected_port) else {
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

    let session_id_cell = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        host: cfg.host.clone(),
        port: cfg.port,
        events: core.events.clone(),
        session_id_cell: session_id_cell.clone(),
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

    let id_raw = core.sessions.insert(Session {
        handle: tokio::sync::Mutex::new(handle),
        session_id_cell: session_id_cell.clone(),
    });
    // Publish the id only after the session is registered, so `disconnected`
    // never reports a session that was not genuinely registered.
    *session_id_cell.lock().expect("session id cell") = Some(SessionId::from_raw(id_raw));
    Ok(SessionId::from_raw(id_raw))
}

pub async fn disconnect(id: SessionId) -> SshResult<()> {
    let core = core()?;
    let session = core
        .sessions
        .remove(id.raw())
        .ok_or(SshError::NoSuchSession)?;
    // Drop the handler's id first: the teardown below will still fire
    // `disconnected`, and we must not emit a second `SessionClosed` for an
    // intentional close. The app path below stays the single emission.
    if let Ok(mut cell) = session.session_id_cell.lock() {
        *cell = None;
    }
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
    /// The port the server actually bound (the assigned port for a `:0`
    /// request). Incoming forwarded-tcpip channels report this as their
    /// `connected_port`, so it is the routing key and must be accurate.
    pub(crate) bound_port: u16,
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
    bound_port: u16,
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
                bound_port,
                local_host,
                local_port,
                cancel,
            },
        );
    Ok(())
}

/// Removes a remote forwarding registration by id. A no-op for a forward that
/// was never a remote forward, so `close_forward` is safe to call for any id.
pub(crate) fn unregister_remote_forward(id: crate::types::ForwardId) {
    remote_forwards()
        .lock()
        .expect("remote forwards mutex")
        .remove(&id.raw());
}

/// The destination for a forwarded-tcpip channel the server opened on
/// `connected_port`. Routing is deterministic:
///
/// 1. Exact match: the forward whose bound port equals the incoming port.
///    Server-assigned bound ports are unique, so this is unambiguous.
/// 2. Fallback: only when exactly one live remote forward exists — the
///    single-forward case is unambiguous. Otherwise None (never an arbitrary
///    pick from the map), so a stray channel is dropped rather than misrouted.
pub(crate) fn remote_forward_target(connected_port: u32) -> Option<(String, u16)> {
    let map = remote_forwards().lock().expect("remote forwards mutex");
    let live = |f: &RemoteForward| !f.cancel.is_cancelled();
    if let Some(f) = map
        .values()
        .find(|f| f.bound_port == connected_port as u16 && live(f))
    {
        return Some((f.local_host.clone(), f.local_port));
    }
    let live_forwards = map.values().filter(|f| live(f)).collect::<Vec<_>>();
    if live_forwards.len() == 1 {
        let f = live_forwards[0];
        return Some((f.local_host.clone(), f.local_port));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ForwardId;
    use russh::client::Handler;
    use serial_test::serial;
    use std::time::Duration;
    use tokio_util::sync::CancellationToken;

    fn handler_with_id(id: Option<SessionId>) -> (ClientHandler, Arc<EventQueue>) {
        let cell = Arc::new(Mutex::new(id));
        let events = Arc::new(EventQueue::new());
        let handler = ClientHandler {
            host: "example.com".into(),
            port: 22,
            events: events.clone(),
            session_id_cell: cell,
        };
        (handler, events)
    }

    #[tokio::test]
    async fn disconnected_emits_session_closed_when_a_session_is_registered() {
        let (mut handler, events) = handler_with_id(Some(SessionId::from_raw(7)));
        // A network drop surfaces as `DisconnectReason::Error`.
        let r = handler
            .disconnected(client::DisconnectReason::Error(SshError::Connect {
                msg: "connection reset".into(),
            }))
            .await;
        assert!(r.is_err(), "an underlying error must still propagate");
        let ev = events.drain(Duration::from_millis(50)).await;
        match &ev[..] {
            [Event::SessionClosed { session_id, reason }] => {
                assert_eq!(*session_id, SessionId::from_raw(7));
                assert!(
                    reason.contains("connection reset"),
                    "reason must describe the drop, got {reason:?}"
                );
            }
            other => panic!("expected one SessionClosed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn disconnected_does_not_emit_for_an_unregistered_or_app_closed_session() {
        // id is None for a session never registered (or cleared by disconnect).
        let (mut handler, events) = handler_with_id(None);
        let r = handler
            .disconnected(client::DisconnectReason::Error(SshError::Connect {
                msg: "connection reset".into(),
            }))
            .await;
        assert!(r.is_err());
        assert!(events.drain(Duration::from_millis(50)).await.is_empty());
    }

    fn register(id: u64, bound_port: u16, local_port: u16) -> (ForwardId, CancellationToken) {
        let id = ForwardId::from_raw(id);
        let cancel = CancellationToken::new();
        register_remote_forward(
            id,
            bound_port,
            "127.0.0.1".into(),
            local_port,
            cancel.clone(),
        )
        .expect("register");
        (id, cancel)
    }

    #[test]
    #[serial]
    fn single_remote_forward_routes_by_bound_port() {
        let (id, _cancel) = register(1, 8080, 1001);
        // Exact match and the single-live fallback both resolve to it.
        assert_eq!(
            remote_forward_target(8080),
            Some(("127.0.0.1".into(), 1001))
        );
        assert_eq!(
            remote_forward_target(9999),
            Some(("127.0.0.1".into(), 1001))
        );
        unregister_remote_forward(id);
    }

    #[test]
    #[serial]
    fn concurrent_remote_forwards_route_each_incoming_port_to_its_destination() {
        let (a, _ca) = register(1, 8080, 1001);
        let (b, _cb) = register(2, 9090, 1002);
        // Each server-assigned port must reach its own local destination, not an
        // arbitrary entry in the map.
        assert_eq!(
            remote_forward_target(8080),
            Some(("127.0.0.1".into(), 1001))
        );
        assert_eq!(
            remote_forward_target(9090),
            Some(("127.0.0.1".into(), 1002))
        );
        // A port with no live registration must NOT be guessed when several
        // forwards are live — return None rather than misroute.
        assert_eq!(remote_forward_target(12345), None);
        unregister_remote_forward(a);
        unregister_remote_forward(b);
    }

    #[test]
    #[serial]
    fn cancelled_forward_is_not_an_exact_target_and_unregister_clears_it() {
        let (id, cancel) = register(1, 8080, 1001);
        cancel.cancel();
        // A cancelled entry is skipped as an exact match. With no other live
        // forward, the single-live fallback no longer applies, so a stray
        // channel is dropped rather than misrouted.
        assert_eq!(remote_forward_target(8080), None);
        unregister_remote_forward(id);
        assert_eq!(remote_forward_target(8080), None);
    }
}
