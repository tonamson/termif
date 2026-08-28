#![allow(dead_code)]

use std::time::Duration;

pub struct TestServer {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl TestServer {
    /// The compose file publishes the container's 2222 on the host's 22022.
    pub fn from_env() -> Self {
        Self {
            host: std::env::var("TERMIF_TEST_SSH_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            port: std::env::var("TERMIF_TEST_SSH_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(22022),
            username: std::env::var("TERMIF_TEST_SSH_USER").unwrap_or_else(|_| "termif".into()),
            password: std::env::var("TERMIF_TEST_SSH_PASSWORD")
                .unwrap_or_else(|_| "termif-test-pw".into()),
        }
    }

    /// True when something is accepting TCP on the fixture port.
    pub fn is_available() -> bool {
        let s = Self::from_env();
        std::net::TcpStream::connect_timeout(
            &format!("{}:{}", s.host, s.port)
                .parse()
                .expect("fixture address"),
            Duration::from_millis(700),
        )
        .is_ok()
    }
}

/// Skips the test (rather than failing) when the Docker fixture is not up, so
/// a developer without Docker still gets a green unit-test run. CI always has
/// it, and the CI job asserts availability separately.
#[macro_export]
macro_rules! require_server {
    () => {
        if !$crate::common::TestServer::is_available() {
            eprintln!("SKIP: sshd fixture not reachable; run `docker compose -f docker-compose.test.yml up -d`");
            return;
        }
    };
}
