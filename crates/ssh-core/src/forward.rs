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
    let listener = tokio::net::TcpListener::bind(&local_bind)
        .await
        .map_err(fwd_err)?;
    let bound_port = listener.local_addr().map_err(fwd_err)?.port();

    let queue = events()?;
    let sess = session_of(session)?;
    let cancel = CancellationToken::new();
    let id_raw = core.forwards.insert(ForwardEntry {
        cancel: cancel.clone(),
        bound_port,
    });
    let id = ForwardId::from_raw(id_raw);

    core.runtime.spawn(async move {
        loop {
            let accepted = tokio::select! {
                _ = cancel.cancelled() => break,
                r = listener.accept() => r,
            };
            let (mut socket, peer) = match accepted {
                Ok(v) => v,
                Err(e) => {
                    queue.push(Event::Log {
                        level: "warn".into(),
                        msg: format!("forward accept: {e}"),
                    });
                    break;
                }
            };
            queue.push(Event::ForwardAccepted {
                forward_id: id,
                peer: peer.to_string(),
            });

            let sess = sess.clone();
            let queue2 = queue.clone();
            let remote_host = remote_host.clone();
            tokio::spawn(async move {
                let channel = match sess
                    .handle
                    .lock()
                    .await
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

        core.forwards.remove(id.raw());
    });

    Ok(id)
}

/// `-R`: ask the server to listen and forward back to us. No local listener is
/// involved, which is why a remote forward has no listening-socket problem
/// on a mobile OS later (spec §5).
pub async fn forward_remote(
    session: SessionId,
    remote_bind_host: String,
    remote_bind_port: u16,
    local_host: String,
    local_port: u16,
) -> SshResult<ForwardId> {
    let core = core()?;
    let sess = session_of(session)?;

    // `tcpip_forward` returns the server-assigned port only for a `:0` request;
    // for a fixed port the reply carries no port and it returns 0. So the bound
    // port the caller sees is the requested one, unless the server picked it.
    let assigned = sess
        .handle
        .lock()
        .await
        .tcpip_forward(&remote_bind_host, remote_bind_port as u32)
        .await
        .map_err(fwd_err)?;
    let bound_port = if remote_bind_port == 0 {
        u16::try_from(assigned).map_err(|_| fwd_err("server assigned an invalid bound port"))?
    } else {
        remote_bind_port
    };

    let queue = events()?;
    let cancel = CancellationToken::new();
    let id_raw = core.forwards.insert(ForwardEntry {
        cancel: cancel.clone(),
        bound_port,
    });
    let id = ForwardId::from_raw(id_raw);

    // Incoming forwarded-tcpip channels arrive through the session handler.
    // Registering the destination is enough here; the handler pairs them.
    if let Err(e) = crate::session::register_remote_forward(
        id,
        bound_port,
        local_host,
        local_port,
        cancel.clone(),
    ) {
        core.forwards.remove(id.raw());
        return Err(e);
    }
    queue.push(Event::Log {
        level: "info".into(),
        msg: format!("remote forward listening on {remote_bind_host}:{bound_port}"),
    });

    Ok(id)
}

/// `-D`: a minimal SOCKS5 front end. Only CONNECT with no authentication is
/// supported, which is what browsers and curl use; BIND and UDP ASSOCIATE are
/// out of scope.
pub async fn forward_socks(session: SessionId, local_bind: String) -> SshResult<ForwardId> {
    let core = core()?;
    let listener = tokio::net::TcpListener::bind(&local_bind)
        .await
        .map_err(fwd_err)?;
    let bound_port = listener.local_addr().map_err(fwd_err)?.port();

    let queue = events()?;
    let sess = session_of(session)?;
    let cancel = CancellationToken::new();
    let id_raw = core.forwards.insert(ForwardEntry {
        cancel: cancel.clone(),
        bound_port,
    });
    let id = ForwardId::from_raw(id_raw);

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
            queue.push(Event::ForwardAccepted {
                forward_id: id,
                peer: peer.to_string(),
            });

            let sess = sess.clone();
            let queue2 = queue.clone();
            tokio::spawn(async move {
                if let Err(e) = socks_serve(socket, sess).await {
                    queue2.push(Event::Log {
                        level: "debug".into(),
                        msg: format!("socks: {e}"),
                    });
                }
            });
        }
        core.forwards.remove(id.raw());
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
        socket
            .write_all(&[0x05, 0x07, 0, 1, 0, 0, 0, 0, 0, 0])
            .await?; // command not supported
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
            socket
                .write_all(&[0x05, 0x08, 0, 1, 0, 0, 0, 0, 0, 0])
                .await?; // bad address type
            return Err(fwd_err("unsupported address type"));
        }
    };
    let mut port_bytes = [0u8; 2];
    socket.read_exact(&mut port_bytes).await?;
    let port = u16::from_be_bytes(port_bytes);

    let channel = sess
        .handle
        .lock()
        .await
        .channel_open_direct_tcpip(&host, port as u32, "127.0.0.1", 0)
        .await;
    match channel {
        Ok(channel) => {
            // Success, with a zero BND.ADDR/BND.PORT: clients ignore it for CONNECT.
            socket
                .write_all(&[0x05, 0x00, 0, 1, 0, 0, 0, 0, 0, 0])
                .await?;
            let mut stream = channel.into_stream();
            // Either side closing ends the pair; errors here are ordinary
            // connection lifecycle, not faults worth surfacing.
            let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
            Ok(())
        }
        Err(e) => {
            socket
                .write_all(&[0x05, 0x05, 0, 1, 0, 0, 0, 0, 0, 0])
                .await?; // connection refused
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
    let core = core()?;
    let entry = core
        .forwards
        .remove(id.raw())
        .ok_or(SshError::NoSuchForward)?;
    // Drop any remote-forward registration so the routing map does not keep a
    // cancelled entry accumulating across closes.
    crate::session::unregister_remote_forward(id);
    entry.cancel.cancel();
    Ok(())
}
