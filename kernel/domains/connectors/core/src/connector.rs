//! What a destination must do, and the only ways it may fail.

use crate::plan::Entry;
use std::future::Future;
use vx_secret::Secret;

/// How a call failed. The engine retries `Transient` and nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// Network, rate limit, 5xx: worth trying again.
    Transient,
    /// The credential was refused.
    Auth,
    /// The destination refused this request and will keep refusing it.
    Rejected,
    /// The thing is not there.
    NotFound,
}

/// A connector's failure: a kind and a fixed code, and nothing else.
///
/// There is no message field on purpose. Upstream APIs echo request bodies in their error text, and a free-text error would
/// carry a secret value into a log or an audit row. A connector that wants to explain itself picks a code (`"rate_limited"`,
/// `"app_not_found"`); the screen maps codes to words.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectorError {
    pub kind: ErrorKind,
    pub code: &'static str,
}

impl ConnectorError {
    pub const fn new(kind: ErrorKind, code: &'static str) -> Self {
        Self { kind, code }
    }
}

impl std::fmt::Display for ConnectorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.code)
    }
}

impl std::error::Error for ConnectorError {}

/// Turns a value a destination returned into a keyed fingerprint, so the engine can tell "unchanged" without holding the value.
pub struct Fingerprinter {
    key: Vec<u8>,
}

impl Fingerprinter {
    pub fn new(key: &[u8]) -> Self {
        Self { key: key.to_vec() }
    }

    pub fn of(&self, value: &Secret) -> [u8; 32] {
        value.fingerprint(&self.key)
    }
}

/// One destination: a repository's secrets, a cloud's parameter store, a deploy target.
///
/// Native async methods; the engine is generic over the connector, so no boxing is needed.
pub trait Connector: Send + Sync {
    /// A stable identifier for audit and the screen, such as `github`.
    fn id(&self) -> &'static str;

    /// What the destination holds now. If it can return a value, fingerprint it with `fingerprints`; if it cannot, leave the
    /// fingerprint empty and the engine will write the secret.
    fn list(&self, fingerprints: &Fingerprinter) -> impl Future<Output = Result<Vec<Entry>, ConnectorError>> + Send;

    /// Write one secret under its destination name. The value is borrowed for this call only.
    fn put(&self, name: &str, value: &Secret) -> impl Future<Output = Result<(), ConnectorError>> + Send;

    fn delete(&self, name: &str) -> impl Future<Output = Result<(), ConnectorError>> + Send;

    /// Runs once after a sync that changed something (for example, redeploy the machines that read the secrets).
    fn after_sync(&self) -> impl Future<Output = Result<(), ConnectorError>> + Send {
        async { Ok(()) }
    }
}
