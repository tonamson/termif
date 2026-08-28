use russh_sftp::client::SftpSession;

use crate::error::{SshError, SshResult};
use crate::events::Event;
use crate::session::{core, events, session_of};
use crate::types::{DirEntry, SessionId, TransferId};
use tokio_util::sync::CancellationToken;

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
    let channel = sess
        .handle
        .lock()
        .await
        .channel_open_session()
        .await
        .map_err(sftp_err)?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(sftp_err)?;
    SftpSession::new(channel.into_stream())
        .await
        .map_err(sftp_err)
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
        out.push(to_dir_entry(name, &entry.metadata()));
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
                remove_inner(
                    sftp,
                    format!("{}/{}", path.trim_end_matches('/'), name),
                    true,
                )
                .await?;
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
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(sftp_err)?;

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
    let queue = events()?;
    let cancel = CancellationToken::new();
    let id_raw = core.transfers.insert(TransferEntry {
        cancel: cancel.clone(),
    });
    let id = TransferId::from_raw(id_raw);

    core.runtime.spawn(async move {
        let result = upload_inner(session, &local, &remote, id, &queue, &cancel).await;
        let error = result.err().map(|e| e.to_string());
        queue.push(Event::TransferDone {
            transfer_id: id,
            error,
        });
        core.transfers.remove(id.raw());
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
            return Err(SshError::Sftp {
                msg: "transfer cancelled".into(),
            });
        }
        let n = src.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).await.map_err(sftp_err)?;
        done += n as u64;

        if last_report.elapsed() >= PROGRESS_INTERVAL {
            queue.push(Event::TransferProgress {
                transfer_id: id,
                done,
                total,
            });
            last_report = std::time::Instant::now();
        }
    }

    dst.sync_all().await.map_err(sftp_err)?;
    dst.shutdown().await.map_err(sftp_err)?;
    sftp.close().await.ok();

    queue.push(Event::TransferProgress {
        transfer_id: id,
        done,
        total,
    });
    Ok(())
}

pub async fn sftp_download(
    session: SessionId,
    remote: String,
    local: String,
) -> SshResult<TransferId> {
    let core = core()?;
    let queue = events()?;
    let cancel = CancellationToken::new();
    let id_raw = core.transfers.insert(TransferEntry {
        cancel: cancel.clone(),
    });
    let id = TransferId::from_raw(id_raw);

    core.runtime.spawn(async move {
        let result = download_inner(session, &remote, &local, id, &queue, &cancel).await;
        let error = result.err().map(|e| e.to_string());
        queue.push(Event::TransferDone {
            transfer_id: id,
            error,
        });
        core.transfers.remove(id.raw());
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

    let result = async {
        loop {
            if cancel.is_cancelled() {
                return Err(SshError::Sftp {
                    msg: "transfer cancelled".into(),
                });
            }
            let n = src.read(&mut buf).await.map_err(sftp_err)?;
            if n == 0 {
                break;
            }
            dst.write_all(&buf[..n]).await?;
            done += n as u64;

            if last_report.elapsed() >= PROGRESS_INTERVAL {
                queue.push(Event::TransferProgress {
                    transfer_id: id,
                    done,
                    total,
                });
                last_report = std::time::Instant::now();
            }
        }
        dst.flush().await?;
        dst.sync_all().await?;
        Ok(())
    }
    .await;

    // Close the temp handle before renaming/removing; on any failure remove the
    // `.part` temp and always close the sftp session so nothing is orphaned.
    drop(dst);
    match result {
        Ok(()) => match tokio::fs::rename(&tmp, local).await {
            Ok(()) => {
                sftp.close().await.ok();
                queue.push(Event::TransferProgress {
                    transfer_id: id,
                    done,
                    total,
                });
                Ok(())
            }
            Err(e) => {
                tokio::fs::remove_file(&tmp).await.ok();
                sftp.close().await.ok();
                Err(e.into())
            }
        },
        Err(e) => {
            tokio::fs::remove_file(&tmp).await.ok();
            sftp.close().await.ok();
            Err(e)
        }
    }
}

pub async fn cancel_transfer(id: TransferId) -> SshResult<()> {
    let entry = core()?
        .transfers
        .get(id.raw())
        .ok_or(SshError::NoSuchTransfer)?;
    entry.cancel.cancel();
    Ok(())
}
