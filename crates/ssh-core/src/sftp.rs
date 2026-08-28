use russh_sftp::client::SftpSession;

use crate::error::{SshError, SshResult};
use crate::session::session_of;
use crate::types::{DirEntry, SessionId};

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
    let channel = sess.handle.channel_open_session().await.map_err(sftp_err)?;
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
