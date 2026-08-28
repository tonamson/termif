use russh::ChannelMsg;
use tokio::sync::Mutex;

use crate::error::{SshError, SshResult};
use crate::events::Event;
use crate::session::{core, events, session_of};
use crate::types::{ChannelId, PtySize, SessionId};

/// A live shell channel. The read half is owned by a spawned pump task that
/// turns SSH messages into queue events; the write half stays here behind a
/// mutex so concurrent writes from the UI serialise.
pub(crate) struct ChannelEntry {
    writer: Mutex<russh::ChannelWriteHalf<russh::client::Msg>>,
    pub(crate) session_id: SessionId,
}

pub async fn open_shell(session: SessionId, pty: PtySize) -> SshResult<ChannelId> {
    let core = core()?;
    let sess = session_of(session)?;

    let channel = sess
        .handle
        .channel_open_session()
        .await
        .map_err(|e| SshError::Connect {
            msg: format!("open channel: {e}"),
        })?;

    channel
        .request_pty(
            false,
            "xterm-256color",
            pty.cols as u32,
            pty.rows as u32,
            pty.pixel_width as u32,
            pty.pixel_height as u32,
            &[],
        )
        .await
        .map_err(|e| SshError::Connect {
            msg: format!("request pty: {e}"),
        })?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| SshError::Connect {
            msg: format!("request shell: {e}"),
        })?;

    let (mut reader, writer) = channel.split();
    let id_raw = core.channels.insert(ChannelEntry {
        writer: Mutex::new(writer),
        session_id: session,
    });
    let id = ChannelId::from_raw(id_raw);

    // One pump task per channel. It is the only producer of this channel's
    // data events, which is what keeps per-channel ordering intact.
    let queue = events()?;
    core.runtime.spawn(async move {
        let mut exit_status: Option<u32> = None;
        while let Some(msg) = reader.wait().await {
            match msg {
                ChannelMsg::Data { data } => {
                    queue.push(Event::ChannelData {
                        channel_id: id,
                        bytes: data.to_vec(),
                    });
                }
                // stderr on a PTY channel: surface it in the same stream, the
                // way a terminal does.
                ChannelMsg::ExtendedData { data, .. } => {
                    queue.push(Event::ChannelData {
                        channel_id: id,
                        bytes: data.to_vec(),
                    });
                }
                ChannelMsg::ExitStatus { exit_status: code } => {
                    exit_status = Some(code);
                }
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        queue.push(Event::ChannelClosed {
            channel_id: id,
            exit_status,
        });
        core.channels.remove(id.raw());
    });

    Ok(id)
}

fn entry(channel: ChannelId) -> SshResult<std::sync::Arc<ChannelEntry>> {
    core()?
        .channels
        .get(channel.raw())
        .ok_or(SshError::NoSuchChannel)
}

pub async fn write(channel: ChannelId, data: Vec<u8>) -> SshResult<()> {
    let entry = entry(channel)?;
    let writer = entry.writer.lock().await;
    writer.data(&data[..]).await.map_err(|e| SshError::Io {
        msg: format!("channel write: {e}"),
    })
}

pub async fn resize(channel: ChannelId, pty: PtySize) -> SshResult<()> {
    let entry = entry(channel)?;
    let writer = entry.writer.lock().await;
    writer
        .window_change(
            pty.cols as u32,
            pty.rows as u32,
            pty.pixel_width as u32,
            pty.pixel_height as u32,
        )
        .await
        .map_err(|e| SshError::Io {
            msg: format!("window change: {e}"),
        })
}

pub async fn close_channel(channel: ChannelId) -> SshResult<()> {
    let entry = core()?
        .channels
        .remove(channel.raw())
        .ok_or(SshError::NoSuchChannel)?;
    let writer = entry.writer.lock().await;
    writer.eof().await.ok();
    writer.close().await.ok();
    Ok(())
}
