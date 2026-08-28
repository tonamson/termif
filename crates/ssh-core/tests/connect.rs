mod common;

use ssh_core::{ConnectConfig, Credential};

/// `host` is an explicit parameter so the two fixture tests can use distinct
/// host names. Both resolve to the same sshd fixture but produce separate
/// known_hosts entries, so one test trusting the key cannot leak into the
/// other test's "must be unknown" first connect (they share the process-wide
/// `KnownHosts` held by the once-only `init`).
fn config(server: &common::TestServer, host: &str, password: &str) -> ConnectConfig {
    ConnectConfig {
        host: host.to_string(),
        port: server.port,
        username: server.username.clone(),
        credential: Credential::Password {
            password: password.to_string(),
        },
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
    let err = ssh_core::connect(config(&server, &server.host, &server.password))
        .await
        .expect_err("an unknown host key must not be trusted automatically");

    let (host, fingerprint, algo) = match err {
        ssh_core::SshError::HostKeyUnknown {
            host,
            fingerprint,
            algo,
        } => (host, fingerprint, algo),
        other => panic!("expected HostKeyUnknown, got {other:?}"),
    };
    assert!(fingerprint.starts_with("SHA256:"), "got {fingerprint}");
    assert!(!host.is_empty());

    ssh_core::trust_host_key(server.host.clone(), server.port, algo, fingerprint)
        .await
        .expect("trust");

    // Second attempt: now it connects.
    let session = ssh_core::connect(config(&server, &server.host, &server.password))
        .await
        .expect("connect after trusting the key");
    ssh_core::disconnect(session).await.expect("disconnect");
}

#[tokio::test]
async fn wrong_password_fails_with_auth_error() {
    require_server!();
    let server = common::TestServer::from_env();
    init_with_empty_known_hosts("auth");

    // Trust the key first so the failure we observe is authentication. Use a
    // distinct host alias (`localhost`) so this test's trust does not collide
    // with `unknown_host_key_*`, which runs concurrently against the same
    // server through the shared `KnownHosts`.
    let host = "localhost";
    let err = ssh_core::connect(config(&server, host, "definitely-wrong"))
        .await
        .expect_err("unknown key");
    if let ssh_core::SshError::HostKeyUnknown {
        fingerprint, algo, ..
    } = err
    {
        ssh_core::trust_host_key(host.into(), server.port, algo, fingerprint)
            .await
            .unwrap();
    }

    let err = ssh_core::connect(config(&server, host, "definitely-wrong"))
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
        credential: Credential::Password {
            password: "x".into(),
        },
        connect_timeout_ms: 2_000,
        keepalive_secs: 30,
    };
    let err = ssh_core::connect(cfg)
        .await
        .expect_err("port 1 is not listening");
    assert!(
        matches!(err.code(), "connect" | "io" | "timeout"),
        "got {}",
        err.code()
    );
}

#[tokio::test]
async fn disconnecting_an_unknown_session_errors() {
    init_with_empty_known_hosts("nosession");
    let err = ssh_core::disconnect(ssh_core::SessionId::from_raw(999_999))
        .await
        .expect_err("stale handles must not resolve");
    assert_eq!(err.code(), "no_such_session");
}
