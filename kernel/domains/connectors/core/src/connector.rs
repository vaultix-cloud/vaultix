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
    /// How long the destination asked us to wait before trying again (a rate limit's `Retry-After`). A number, not text.
    pub retry_after_secs: Option<u32>,
}

impl ConnectorError {
    pub const fn new(kind: ErrorKind, code: &'static str) -> Self {
        Self { kind, code, retry_after_secs: None }
    }

    pub const fn retry_after(mut self, seconds: u32) -> Self {
        self.retry_after_secs = Some(seconds);
        self
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

    /// The destination's own spelling of a name. GitHub, for instance, upper-cases secret names, so `db_url` and `DB_URL` are
    /// one secret there. The engine compares and writes names after this, and refuses a sync in which two Vaultix names would
    /// become one (otherwise one secret silently overwrites the other).
    fn fold(&self, name: &str) -> String {
        name.to_string()
    }

    /// What the destination holds now. If it can return a value, fingerprint it with `fingerprints`; if it cannot, leave the
    /// fingerprint empty and the engine will write the secret.
    fn list(&self, fingerprints: &Fingerprinter) -> impl Future<Output = Result<Vec<Entry>, ConnectorError>> + Send;

    /// Write one secret under its destination name. The value is borrowed for this call only.
    fn put(&self, name: &str, value: &Secret) -> impl Future<Output = Result<(), ConnectorError>> + Send;

    fn delete(&self, name: &str) -> impl Future<Output = Result<(), ConnectorError>> + Send;

    /// Refuse a name before anything is sent, in the destination's spelling (after `fold`). The engine reports that one name as
    /// failed and carries on with the rest, so one bad name costs no request and hides no other secret.
    fn accepts_name(&self, _name: &str) -> Result<(), ConnectorError> {
        Ok(())
    }

    /// True if the destination takes all writes in one call, so the engine uses `put_batch` and `delete_batch` once each. Fly.io
    /// makes one release per call, so writing secrets one at a time would be a release per secret.
    fn batches_writes(&self) -> bool {
        false
    }

    /// Write all of these in one call. A batch succeeds or fails as a whole. The default writes them one at a time.
    fn put_batch(&self, items: &[(String, &Secret)]) -> impl Future<Output = Result<(), ConnectorError>> + Send {
        async move {
            for (name, value) in items {
                self.put(name, value).await?;
            }
            Ok(())
        }
    }

    fn delete_batch(&self, names: &[String]) -> impl Future<Output = Result<(), ConnectorError>> + Send {
        async move {
            for name in names {
                self.delete(name).await?;
            }
            Ok(())
        }
    }

    /// Runs once after a sync that changed something (for example, redeploy the machines that read the secrets).
    fn after_sync(&self) -> impl Future<Output = Result<(), ConnectorError>> + Send {
        async { Ok(()) }
    }
}
