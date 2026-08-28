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

/// Drain events until `pred` is satisfied by the accumulated shell output, or
/// the deadline passes. Returns everything collected.
async fn read_until(deadline: Duration, pred: impl Fn(&str) -> bool) -> String {
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
    assert!(
        out.contains("termif-marker-42"),
        "shell output was: {out:?}"
    );

    ssh_core::close_channel(channel).await.expect("close");
    ssh_core::disconnect(session).await.expect("disconnect");
}

#[tokio::test]
async fn pty_size_is_applied_and_resize_takes_effect() {
    require_server!();
    let session = connected_session("shell-resize").await;

    let channel = ssh_core::open_shell(
        session,
        PtySize {
            cols: 100,
            rows: 40,
            pixel_width: 0,
            pixel_height: 0,
        },
    )
    .await
    .expect("open shell");

    ssh_core::write(channel, b"tput cols\n".to_vec())
        .await
        .unwrap();
    let out = read_until(Duration::from_secs(10), |s| s.contains("100")).await;
    assert!(
        out.contains("100"),
        "expected 100 columns, output was: {out:?}"
    );

    ssh_core::resize(
        channel,
        PtySize {
            cols: 132,
            rows: 43,
            pixel_width: 0,
            pixel_height: 0,
        },
    )
    .await
    .expect("resize");

    ssh_core::write(channel, b"tput cols\n".to_vec())
        .await
        .unwrap();
    let out = read_until(Duration::from_secs(10), |s| s.contains("132")).await;
    assert!(
        out.contains("132"),
        "expected 132 columns after resize, output was: {out:?}"
    );

    ssh_core::close_channel(channel).await.unwrap();
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn two_channels_on_one_session_are_independent() {
    require_server!();
    let session = connected_session("shell-two").await;

    let a = ssh_core::open_shell(session, PtySize::default())
        .await
        .unwrap();
    let b = ssh_core::open_shell(session, PtySize::default())
        .await
        .unwrap();
    assert_ne!(a.raw(), b.raw());

    ssh_core::write(a, b"echo from-tab-a\n".to_vec())
        .await
        .unwrap();
    ssh_core::write(b, b"echo from-tab-b\n".to_vec())
        .await
        .unwrap();

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
    assert!(
        !from_a.contains("from-tab-b"),
        "channel a leaked b's output"
    );

    ssh_core::close_channel(a).await.unwrap();
    ssh_core::close_channel(b).await.unwrap();
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
async fn closing_a_channel_emits_channel_closed() {
    require_server!();
    let session = connected_session("shell-closed").await;
    let channel = ssh_core::open_shell(session, PtySize::default())
        .await
        .unwrap();

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
