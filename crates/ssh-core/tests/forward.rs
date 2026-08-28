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
        credential: Credential::Password {
            password: server.password.clone(),
        },
        connect_timeout_ms: 10_000,
        keepalive_secs: 30,
    };
    if let Err(ssh_core::SshError::HostKeyUnknown {
        fingerprint, algo, ..
    }) = ssh_core::connect(cfg()).await
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
    assert!(
        banner.starts_with("SSH-2.0"),
        "expected an SSH banner, got {banner:?}"
    );

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
    assert!(
        result.is_err(),
        "a closed forward must refuse new connections"
    );

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

    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();

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
    assert_eq!(
        resp[1], 0x00,
        "CONNECT must succeed, got status {}",
        resp[1]
    );

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
    let result =
        ssh_core::forward_local(session, "127.0.0.1:1".into(), "127.0.0.1".into(), 2222).await;
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

/// End-to-end `-R` against the real server: register a remote forward on port
/// 0 so the server picks the bound port, and prove the caller learns which port
/// it chose. A full byte-flow round trip is not attempted here because the
/// `-R` listener lives inside the container, which needs a `docker exec`
/// round-trip (see report%).
#[tokio::test]
async fn remote_forward_port_zero_resolves_to_the_server_assigned_port() {
    require_server!();
    let session = connected_session("fwd-remote").await;

    // Leave `local_port` pointing at nothing valid on purpose: forwarding to a
    // missing host side is fine, we only need the server to bind and report.
    let id = ssh_core::forward_remote(session, "127.0.0.1".into(), 0, "127.0.0.1".into(), 1)
        .await
        .expect("start remote forward");
    let assigned = ssh_core::forward_bound_port(id).await.expect("bound port");
    assert_ne!(
        assigned, 0,
        "port 0 must resolve to the server-assigned port"
    );
    assert!(
        (1..=u16::MAX).contains(&assigned),
        "assigned port out of range: {assigned}"
    );

    ssh_core::close_forward(id).await.expect("close forward");
    ssh_core::disconnect(session).await.unwrap();
}
