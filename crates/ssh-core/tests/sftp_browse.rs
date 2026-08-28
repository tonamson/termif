mod common;

use serial_test::serial;
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
#[serial]
async fn mkdir_list_rename_remove_round_trip() {
    require_server!();
    let session = connected_session("sftp-crud").await;
    let dir = format!("termif-test-{}", std::process::id());
    let renamed = format!("{dir}-renamed");

    ssh_core::sftp_mkdir(session, dir.clone())
        .await
        .expect("mkdir");

    let entries = ssh_core::sftp_list(session, ".".into())
        .await
        .expect("list");
    let found = entries
        .iter()
        .find(|e| e.name == dir)
        .expect("new dir must be listed");
    assert!(found.is_dir, "mkdir must produce a directory");

    ssh_core::sftp_rename(session, dir.clone(), renamed.clone())
        .await
        .expect("rename");

    let entries = ssh_core::sftp_list(session, ".".into()).await.unwrap();
    assert!(
        entries.iter().any(|e| e.name == renamed),
        "renamed dir must appear"
    );
    assert!(
        !entries.iter().any(|e| e.name == dir),
        "old name must be gone"
    );

    ssh_core::sftp_remove(session, renamed.clone(), false)
        .await
        .expect("remove");
    let entries = ssh_core::sftp_list(session, ".".into()).await.unwrap();
    assert!(
        !entries.iter().any(|e| e.name == renamed),
        "removed dir must be gone"
    );

    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
#[serial]
async fn stat_reports_size_for_a_known_file() {
    require_server!();
    let session = connected_session("sftp-stat").await;
    let path = format!("termif-stat-{}.txt", std::process::id());

    // Create a file of a known size through the shell, then stat it.
    let channel = ssh_core::open_shell(session, ssh_core::PtySize::default())
        .await
        .unwrap();
    ssh_core::write(
        channel,
        format!("printf '0123456789' > {path}\n").into_bytes(),
    )
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
#[serial]
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
#[serial]
async fn read_range_returns_the_requested_slice() {
    require_server!();
    let session = connected_session("sftp-range").await;
    let path = format!("termif-range-{}.txt", std::process::id());

    let channel = ssh_core::open_shell(session, ssh_core::PtySize::default())
        .await
        .unwrap();
    ssh_core::write(
        channel,
        format!("printf 'ABCDEFGHIJ' > {path}\n").into_bytes(),
    )
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
    assert_eq!(
        slice.expect("read_range must return 3 bytes"),
        b"CDE".to_vec()
    );

    ssh_core::sftp_remove(session, path, false).await.ok();
    ssh_core::close_channel(channel).await.ok();
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
#[serial]
async fn read_range_rejects_an_oversized_request() {
    require_server!();
    let session = connected_session("sftp-range-cap").await;
    let err = ssh_core::sftp_read_range(
        session,
        "whatever".into(),
        0,
        ssh_core::SFTP_READ_RANGE_MAX + 1,
    )
    .await
    .expect_err("read_range must cap its length");
    assert_eq!(err.code(), "sftp");
    ssh_core::disconnect(session).await.unwrap();
}
