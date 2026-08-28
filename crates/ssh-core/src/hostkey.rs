use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::error::{SshError, SshResult};

/// Stores trusted host fingerprints in an OpenSSH-shaped file, local to this
/// device. Deliberately never synced (see spec §5): a synced known_hosts would
/// let one compromised device install a forged key everywhere.
///
/// Lines are `<pattern> <algo> <fingerprint>`. We store the fingerprint rather
/// than the base64 key because that is what we show the user and compare.
pub struct KnownHosts {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl KnownHosts {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            write_lock: Mutex::new(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn host_pattern(host: &str, port: u16) -> String {
        if port == 22 {
            host.to_string()
        } else {
            format!("[{host}]:{port}")
        }
    }

    fn read_lines(&self) -> SshResult<Vec<String>> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => Ok(text.lines().map(str::to_string).collect()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.into()),
        }
    }

    fn find(&self, pattern: &str, algo: &str) -> SshResult<Option<String>> {
        for line in self.read_lines()? {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut parts = line.split_whitespace();
            let (p, a, fp) = (parts.next(), parts.next(), parts.next());
            if let (Some(p), Some(a), Some(fp)) = (p, a, fp) {
                if p == pattern && a == algo {
                    return Ok(Some(fp.to_string()));
                }
            }
        }
        Ok(None)
    }

    pub fn verify(&self, host: &str, port: u16, algo: &str, fingerprint: &str) -> SshResult<()> {
        let pattern = Self::host_pattern(host, port);
        match self.find(&pattern, algo)? {
            Some(known) if known == fingerprint => Ok(()),
            Some(known) => Err(SshError::HostKeyMismatch {
                host: pattern,
                expected: known,
                got: fingerprint.to_string(),
            }),
            None => Err(SshError::HostKeyUnknown {
                host: pattern,
                fingerprint: fingerprint.to_string(),
                algo: algo.to_string(),
            }),
        }
    }

    pub fn trust(&self, host: &str, port: u16, algo: &str, fingerprint: &str) -> SshResult<()> {
        let _guard = self.write_lock.lock().expect("known_hosts write lock");
        let pattern = Self::host_pattern(host, port);

        // Rewrite without any prior entry for this host+algo, then append.
        let mut kept: Vec<String> = Vec::new();
        for line in self.read_lines()? {
            let trimmed = line.trim();
            let is_same_entry = {
                let mut parts = trimmed.split_whitespace();
                matches!((parts.next(), parts.next()), (Some(p), Some(a)) if p == pattern && a == algo)
            };
            if !is_same_entry {
                kept.push(line);
            }
        }
        kept.push(format!("{pattern} {algo} {fingerprint}"));

        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut f = std::fs::File::create(&self.path)?;
        for line in kept {
            if line.trim().is_empty() {
                continue;
            }
            writeln!(f, "{line}")?;
        }
        f.sync_all()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("termif-test-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn unknown_host_reports_unknown() {
        let kh = KnownHosts::new(temp_path("unknown"));
        let err = kh
            .verify("example.com", 22, "ssh-ed25519", "SHA256:aaa")
            .expect_err("a fresh file trusts nothing");
        assert_eq!(err.code(), "host_key_unknown");
    }

    #[test]
    fn trusted_host_verifies() {
        let kh = KnownHosts::new(temp_path("trusted"));
        kh.trust("example.com", 22, "ssh-ed25519", "SHA256:aaa")
            .unwrap();
        kh.verify("example.com", 22, "ssh-ed25519", "SHA256:aaa")
            .unwrap();
    }

    #[test]
    fn different_fingerprint_reports_mismatch_not_unknown() {
        let kh = KnownHosts::new(temp_path("mismatch"));
        kh.trust("example.com", 22, "ssh-ed25519", "SHA256:aaa")
            .unwrap();
        let err = kh
            .verify("example.com", 22, "ssh-ed25519", "SHA256:bbb")
            .expect_err("a changed key must not verify");
        match err {
            SshError::HostKeyMismatch { expected, got, .. } => {
                assert_eq!(expected, "SHA256:aaa");
                assert_eq!(got, "SHA256:bbb");
            }
            other => panic!("expected mismatch, got {other:?}"),
        }
    }

    #[test]
    fn non_default_port_is_bracketed_like_openssh() {
        assert_eq!(KnownHosts::host_pattern("example.com", 22), "example.com");
        assert_eq!(
            KnownHosts::host_pattern("example.com", 2222),
            "[example.com]:2222"
        );
    }

    #[test]
    fn same_host_on_two_ports_are_separate_entries() {
        let kh = KnownHosts::new(temp_path("ports"));
        kh.trust("example.com", 22, "ssh-ed25519", "SHA256:aaa")
            .unwrap();
        let err = kh
            .verify("example.com", 2222, "ssh-ed25519", "SHA256:aaa")
            .expect_err("port 2222 is a different host entry");
        assert_eq!(err.code(), "host_key_unknown");
    }

    #[test]
    fn trust_replaces_an_existing_entry_for_the_same_algo() {
        let kh = KnownHosts::new(temp_path("replace"));
        kh.trust("example.com", 22, "ssh-ed25519", "SHA256:aaa")
            .unwrap();
        kh.trust("example.com", 22, "ssh-ed25519", "SHA256:bbb")
            .unwrap();
        kh.verify("example.com", 22, "ssh-ed25519", "SHA256:bbb")
            .unwrap();

        let text = std::fs::read_to_string(kh.path()).unwrap();
        assert_eq!(
            text.lines().filter(|l| l.contains("example.com")).count(),
            1
        );
    }

    #[test]
    fn comments_and_blank_lines_are_ignored() {
        let path = temp_path("comments");
        std::fs::write(&path, "# a comment\n\nexample.com ssh-ed25519 SHA256:aaa\n").unwrap();
        let kh = KnownHosts::new(path);
        kh.verify("example.com", 22, "ssh-ed25519", "SHA256:aaa")
            .unwrap();
    }
}
