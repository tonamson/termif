use thiserror::Error;

#[derive(Debug, Clone, Error)]
pub enum SshError {
    #[error("connection failed: {msg}")]
    Connect { msg: String },
    #[error("authentication failed: {msg}")]
    Auth { msg: String },
    #[error("unknown host key for {host} fingerprint={fingerprint} algo={algo}")]
    HostKeyUnknown {
        host: String,
        fingerprint: String,
        algo: String,
    },
    #[error("host key mismatch for {host} expected={expected} got={got}")]
    HostKeyMismatch {
        host: String,
        expected: String,
        got: String,
    },
    #[error("no such session")]
    NoSuchSession,
    #[error("no such channel")]
    NoSuchChannel,
    #[error("no such transfer")]
    NoSuchTransfer,
    #[error("no such forward")]
    NoSuchForward,
    #[error("sftp error: {msg}")]
    Sftp { msg: String },
    #[error("forward error: {msg}")]
    Forward { msg: String },
    #[error("io error: {msg}")]
    Io { msg: String },
    #[error("timed out")]
    Timeout,
    #[error("internal error: {msg}")]
    Internal { msg: String },
}

impl SshError {
    /// Stable machine-readable discriminator. The TypeScript layer switches on
    /// this, so these strings are API and must not change.
    pub fn code(&self) -> &'static str {
        match self {
            SshError::Connect { .. } => "connect",
            SshError::Auth { .. } => "auth",
            SshError::HostKeyUnknown { .. } => "host_key_unknown",
            SshError::HostKeyMismatch { .. } => "host_key_mismatch",
            SshError::NoSuchSession => "no_such_session",
            SshError::NoSuchChannel => "no_such_channel",
            SshError::NoSuchTransfer => "no_such_transfer",
            SshError::NoSuchForward => "no_such_forward",
            SshError::Sftp { .. } => "sftp",
            SshError::Forward { .. } => "forward",
            SshError::Io { .. } => "io",
            SshError::Timeout => "timeout",
            SshError::Internal { .. } => "internal",
        }
    }
}

impl From<std::io::Error> for SshError {
    fn from(e: std::io::Error) -> Self {
        SshError::Io { msg: e.to_string() }
    }
}

impl From<russh::Error> for SshError {
    fn from(e: russh::Error) -> Self {
        SshError::Connect { msg: e.to_string() }
    }
}

pub type SshResult<T> = Result<T, SshError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn io_error_converts_and_keeps_message() {
        let io = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "refused");
        let err: SshError = io.into();
        match err {
            SshError::Io { ref msg } => assert!(msg.contains("refused")),
            other => panic!("expected Io, got {other:?}"),
        }
    }

    #[test]
    fn host_key_mismatch_is_distinct_from_unknown() {
        let a = SshError::HostKeyUnknown {
            host: "h".into(),
            fingerprint: "SHA256:aaa".into(),
            algo: "ssh-ed25519".into(),
        };
        let b = SshError::HostKeyMismatch {
            host: "h".into(),
            expected: "SHA256:aaa".into(),
            got: "SHA256:bbb".into(),
        };
        assert_ne!(a.code(), b.code());
        assert_eq!(a.code(), "host_key_unknown");
        assert_eq!(b.code(), "host_key_mismatch");
    }
}
