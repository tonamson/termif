use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::Notify;

use crate::types::{ChannelId, ForwardId, SessionId, TransferId};

#[derive(Debug, Clone)]
pub enum Event {
    ChannelData {
        channel_id: ChannelId,
        bytes: Vec<u8>,
    },
    ChannelClosed {
        channel_id: ChannelId,
        exit_status: Option<u32>,
    },
    SessionClosed {
        session_id: SessionId,
        reason: String,
    },
    TransferProgress {
        transfer_id: TransferId,
        done: u64,
        total: u64,
    },
    TransferDone {
        transfer_id: TransferId,
        error: Option<String>,
    },
    ForwardAccepted {
        forward_id: ForwardId,
        peer: String,
    },
    Log {
        level: String,
        msg: String,
    },
}

/// Single upward channel. Producers (session tasks) push; the TypeScript side
/// runs exactly one `drain` loop. `drain` returns as soon as anything is
/// available, otherwise after `timeout` with an empty vector — so the caller
/// polls without spinning.
pub struct EventQueue {
    inner: Mutex<VecDeque<Event>>,
    notify: Notify,
}

impl EventQueue {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(VecDeque::new()),
            notify: Notify::new(),
        }
    }

    pub fn push(&self, event: Event) {
        self.inner
            .lock()
            .expect("event queue mutex")
            .push_back(event);
        self.notify.notify_one();
    }

    pub async fn drain(&self, timeout: Duration) -> Vec<Event> {
        {
            let mut guard = self.inner.lock().expect("event queue mutex");
            if !guard.is_empty() {
                return guard.drain(..).collect();
            }
        }

        // Nothing queued: wait for a producer or for the timeout.
        let _ = tokio::time::timeout(timeout, self.notify.notified()).await;

        let mut guard = self.inner.lock().expect("event queue mutex");
        guard.drain(..).collect()
    }
}

impl Default for EventQueue {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ChannelId;
    use std::time::{Duration, Instant};

    fn data_event(n: u8) -> Event {
        Event::ChannelData {
            channel_id: ChannelId::from_raw(1),
            bytes: vec![n],
        }
    }

    #[tokio::test]
    async fn drain_returns_all_queued_events_immediately() {
        let q = EventQueue::new();
        q.push(data_event(1));
        q.push(data_event(2));

        let started = Instant::now();
        let events = q.drain(Duration::from_secs(5)).await;

        assert_eq!(events.len(), 2);
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "must not wait for the timeout when events are ready"
        );
    }

    #[tokio::test]
    async fn drain_returns_empty_after_timeout_when_idle() {
        let q = EventQueue::new();
        let events = q.drain(Duration::from_millis(100)).await;
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn drain_wakes_when_an_event_arrives_later() {
        let q = std::sync::Arc::new(EventQueue::new());
        let pusher = q.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            pusher.push(data_event(7));
        });

        let events = q.drain(Duration::from_secs(5)).await;
        assert_eq!(events.len(), 1);
    }

    #[tokio::test]
    async fn events_keep_fifo_order() {
        let q = EventQueue::new();
        for n in 0..5u8 {
            q.push(data_event(n));
        }
        let events = q.drain(Duration::from_millis(50)).await;
        let bytes: Vec<u8> = events
            .into_iter()
            .map(|e| match e {
                Event::ChannelData { bytes, .. } => bytes[0],
                _ => panic!("unexpected event"),
            })
            .collect();
        assert_eq!(bytes, vec![0, 1, 2, 3, 4]);
    }
}
