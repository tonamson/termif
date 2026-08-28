mod common;

use serial_test::serial;
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
#[serial]
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
    assert!(
        progress_count > 0,
        "an upload of this size must report progress"
    );

    let meta = ssh_core::sftp_stat(session, remote.clone())
        .await
        .expect("stat uploaded file");
    assert_eq!(
        meta.size as usize,
        original.len(),
        "uploaded size must match"
    );

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
    assert_eq!(
        round_tripped, original,
        "round trip must be byte-for-byte identical"
    );

    ssh_core::sftp_remove(session, remote, false).await.ok();
    let _ = std::fs::remove_file(&local_up);
    let _ = std::fs::remove_file(&local_down);
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
#[serial]
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
#[serial]
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

    // Let it get going, then cancel. We cancel as soon as the first progress
    // event shows the transfer is demonstrably in-flight — a fixed wall-clock
    // wait is racy, because a fast fixture can finish 40 MiB inside it.
    let started = Instant::now();
    loop {
        let events = ssh_core::next_events(200).await;
        if events
            .iter()
            .any(|e| matches!(e, Event::TransferProgress { transfer_id, .. } if *transfer_id == id))
        {
            break;
        }
        if started.elapsed() > Duration::from_secs(30) {
            panic!("transfer never started within 30s");
        }
    }
    ssh_core::cancel_transfer(id).await.expect("cancel");

    let (error, _) = await_transfer(id, Duration::from_secs(60)).await;
    assert!(
        error.is_some(),
        "a cancelled transfer must not report success"
    );
    assert!(
        error
            .as_deref()
            .unwrap_or("")
            .to_lowercase()
            .contains("cancel"),
        "the error should say it was cancelled, got {error:?}"
    );

    ssh_core::sftp_remove(session, remote, false).await.ok();
    let _ = std::fs::remove_file(&local_up);
    ssh_core::disconnect(session).await.unwrap();
}

#[tokio::test]
#[serial]
async fn cancelling_an_unknown_transfer_errors() {
    let mut p = std::env::temp_dir();
    p.push(format!("termif-kh-{}-noxfer", std::process::id()));
    ssh_core::init(p).unwrap();
    let err = ssh_core::cancel_transfer(TransferId::from_raw(999_999))
        .await
        .expect_err("stale transfer handles must not resolve");
    assert_eq!(err.code(), "no_such_transfer");
}
