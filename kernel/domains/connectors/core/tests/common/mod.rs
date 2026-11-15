#![allow(dead_code, clippy::unwrap_used)] // shared by several test binaries; each uses a subset
//! The sync engine against an in-memory destination.
//!
//! The two promises that matter most are proven here: no secret value appears in any report, error, log line or audit row
//! (a canary value is pushed through every path, including the failing ones), and a sync whose plan cannot be recorded
//! changes nothing in the destination.

use std::collections::{BTreeMap, VecDeque};
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tracing_subscriber::fmt::MakeWriter;
use vx_audit::{AuditError, Event};
use vx_connectors::{AuditSink, Connector, ConnectorError, Entry, ErrorKind, Fingerprinter, KeySchema, PlanOptions, RetryPolicy, SyncRequest};
use vx_secret::Secret;

pub const KEY: &[u8] = b"fingerprint-key-for-tests";
pub const CANARY: &str = "CANARY-9f3c1e7a-do-not-leak";

pub type Log = Arc<Mutex<Vec<String>>>;

/// A destination that keeps fingerprints (it is the test's stand-in for "the value is now there"), and can be told to fail.
pub struct Memory {
    pub store: Mutex<BTreeMap<String, [u8; 32]>>,
    pub readable: bool,
    pub fingerprints: Fingerprinter,
    pub failures: Mutex<BTreeMap<String, VecDeque<ConnectorError>>>,
    pub after_sync_error: Option<ConnectorError>,
    pub log: Log,
}

impl Memory {
    pub fn new(log: &Log) -> Self {
        Self { store: Mutex::default(), readable: true, fingerprints: Fingerprinter::new(KEY), failures: Mutex::default(), after_sync_error: None, log: log.clone() }
    }
    pub fn fail(self, name: &str, errors: &[ConnectorError]) -> Self {
        self.failures.lock().unwrap().insert(name.into(), errors.iter().copied().collect());
        self
    }
    pub fn seed(self, name: &str, value: &str) -> Self {
        self.store.lock().unwrap().insert(name.into(), self.fingerprints.of(&Secret::from_string(value.into())));
        self
    }
    pub fn calls(&self, prefix: &str) -> usize {
        self.log.lock().unwrap().iter().filter(|l| l.starts_with(prefix)).count()
    }
}

impl Connector for Memory {
    fn id(&self) -> &'static str {
        "memory"
    }
    async fn list(&self, _: &Fingerprinter) -> Result<Vec<Entry>, ConnectorError> {
        self.log.lock().unwrap().push("list".into());
        Ok(self.store.lock().unwrap().iter().map(|(name, fp)| Entry { name: name.clone(), fingerprint: self.readable.then_some(*fp) }).collect())
    }
    async fn put(&self, name: &str, value: &Secret) -> Result<(), ConnectorError> {
        self.log.lock().unwrap().push(format!("put:{name}"));
        if let Some(error) = self.failures.lock().unwrap().get_mut(name).and_then(VecDeque::pop_front) {
            return Err(error);
        }
        self.store.lock().unwrap().insert(name.into(), self.fingerprints.of(value));
        Ok(())
    }
    async fn delete(&self, name: &str) -> Result<(), ConnectorError> {
        self.log.lock().unwrap().push(format!("delete:{name}"));
        self.store.lock().unwrap().remove(name);
        Ok(())
    }
    async fn after_sync(&self) -> Result<(), ConnectorError> {
        self.log.lock().unwrap().push("after_sync".into());
        self.after_sync_error.map_or(Ok(()), Err)
    }
}

/// Records events, and can be made to refuse the Nth one (1-based).
pub struct Audit {
    pub events: Mutex<Vec<Event>>,
    pub fail_at: Option<usize>,
    pub log: Log,
}

impl Audit {
    pub fn new(log: &Log) -> Self {
        Self { events: Mutex::default(), fail_at: None, log: log.clone() }
    }
    pub fn failing_at(mut self, n: usize) -> Self {
        self.fail_at = Some(n);
        self
    }
}

impl AuditSink for Audit {
    async fn record(&self, event: Event) -> Result<(), AuditError> {
        self.log.lock().unwrap().push(format!("audit:{}", event.action));
        let n = self.events.lock().unwrap().len() + 1;
        if self.fail_at == Some(n) {
            return Err(AuditError::SecretLikeKey("simulated failure".into()));
        }
        self.events.lock().unwrap().push(event);
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct Capture(pub Arc<Mutex<Vec<u8>>>);
impl Write for Capture {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl<'a> MakeWriter<'a> for Capture {
    type Writer = Capture;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

pub fn request(schema: &str, keep_removed: bool, attempts: u32) -> SyncRequest<'static> {
    SyncRequest {
        chain: "proj-1",
        actor: "user:alice",
        connection: "conn-1",
        options: PlanOptions { environment: "prod".into(), schema: KeySchema::parse(schema).unwrap(), keep_removed },
        retry: RetryPolicy { attempts, base: Duration::ZERO },
    }
}

pub fn values(pairs: &[(&str, &str)]) -> Vec<(String, Secret)> {
    pairs.iter().map(|(k, v)| ((*k).to_string(), Secret::from_string((*v).to_string()))).collect()
}

pub fn new_log() -> Log {
    Arc::new(Mutex::new(Vec::new()))
}

pub fn fp(value: &str) -> [u8; 32] {
    Fingerprinter::new(KEY).of(&Secret::from_string(value.into()))
}

pub const TRANSIENT: ConnectorError = ConnectorError::new(ErrorKind::Transient, "rate_limited");
pub const REJECTED: ConnectorError = ConnectorError::new(ErrorKind::Rejected, "name_not_allowed");

