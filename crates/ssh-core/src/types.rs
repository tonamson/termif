macro_rules! handle {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(u64);

        impl $name {
            pub fn from_raw(v: u64) -> Self {
                Self(v)
            }
            pub fn raw(&self) -> u64 {
                self.0
            }
        }
    };
}

handle!(SessionId);
handle!(ChannelId);
handle!(TransferId);
handle!(ForwardId);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtySize {
    pub cols: u16,
    pub rows: u16,
    pub pixel_width: u16,
    pub pixel_height: u16,
}

impl Default for PtySize {
    fn default() -> Self {
        Self {
            cols: 80,
            rows: 24,
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

/// Passed in at connect time and dropped when the connection is established.
/// ssh-core never persists a credential.
#[derive(Clone)]
pub enum Credential {
    Password {
        password: String,
    },
    Key {
        pem: String,
        passphrase: Option<String>,
    },
}

impl std::fmt::Debug for Credential {
    /// Manual impl so a credential can never be logged by accident.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Credential::Password { .. } => f.write_str("Credential::Password(redacted)"),
            Credential::Key { .. } => f.write_str("Credential::Key(redacted)"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub credential: Credential,
    pub connect_timeout_ms: u32,
    pub keepalive_secs: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub mode: u32,
    pub modified_unix: i64,
}
