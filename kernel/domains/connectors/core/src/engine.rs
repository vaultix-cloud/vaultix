//! The sync engine: one path for every connector.
//!
//! Order matters, and each step is the safe one:
//!
//! 1. list the destination, and plan from fingerprints (no value is involved);
//! 2. **record the plan first.** If the audit record cannot be written, nothing is changed in the destination (fail closed);
//! 3. apply the plan, retrying transient failures, and keep going past a failed item so one bad name does not hide the rest;
//! 4. record the outcome. The destination cannot be rolled back, so if this record fails the caller gets `Unrecorded` with
//!    the report, loudly, and never a success.
//!
//! Neither the report, an error, a log line nor an audit row ever holds a value: names, counts, kinds and fixed codes only.

use crate::connector::{Connector, ConnectorError, ErrorKind, Fingerprinter};
use crate::plan::{plan_with, Entry, PlanOptions};
use serde_json::json;
use std::future::Future;
use std::time::Duration;
use vx_audit::{AuditError, Event};
use vx_secret::Secret;

/// Where audit events go. The production sink appends to the hash chain; tests use memory.
pub trait AuditSink: Send + Sync {
    fn record(&self, event: Event) -> impl Future<Output = Result<(), AuditError>> + Send;
}

#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub attempts: u32,
    pub base: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self { attempts: 4, base: Duration::from_millis(250) }
    }
}

pub struct SyncRequest<'a> {
    /// The audit chain (the tenant or project).
    pub chain: &'a str,
    pub actor: &'a str,
    /// The connection being synced, as an identifier.
    pub connection: &'a str,
    pub options: PlanOptions,
    pub retry: RetryPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub name: String,
    pub kind: ErrorKind,
    pub code: &'static str,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Report {
    pub put: usize,
    pub deleted: usize,
    pub unchanged: usize,
    pub failed: Vec<Failure>,
    /// True if the after-sync step ran and failed.
    pub after_sync_failed: Option<Failure>,
}

impl Report {
    pub fn ok(&self) -> bool {
        self.failed.is_empty() && self.after_sync_failed.is_none()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    /// The destination could not be read, so nothing was planned and nothing was changed.
    #[error("the destination could not be listed ({0})")]
    List(ConnectorError),
    /// Two Vaultix names would become one name in the destination, so nothing was changed. The names are the destination's.
    #[error("these names would collide in the destination: {0:?}")]
    NameCollision(Vec<String>),
    /// The plan could not be recorded, so nothing was changed.
    #[error("the sync was not started because it could not be recorded: {0}")]
    NotRecorded(AuditError),
    /// The destination was changed but the outcome could not be recorded. Treat the destination as changed.
    #[error("the sync ran but its outcome could not be recorded: {error}")]
    Unrecorded { error: AuditError, report: Box<Report> },
}

async fn with_retry<T, F, Fut>(policy: RetryPolicy, mut call: F) -> Result<T, ConnectorError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, ConnectorError>>,
{
    let mut attempt = 0;
    loop {
        match call().await {
            Ok(value) => return Ok(value),
            Err(error) if error.kind == ErrorKind::Transient && attempt + 1 < policy.attempts => {
                attempt += 1;
                tracing::debug!(code = error.code, attempt, "connector call failed, retrying");
                let backoff = policy.base * 2u32.saturating_pow(attempt - 1);
                // Honour the destination's own wait, but never longer than a minute: a sync is not a place to sleep for an hour.
                let asked = Duration::from_secs(u64::from(error.retry_after_secs.unwrap_or(0).min(60)));
                tokio::time::sleep(backoff.max(asked)).await;
            }
            Err(error) => return Err(error),
        }
    }
}

/// Sync `desired` (Vaultix name and value) into the connector's destination.
pub async fn sync<C: Connector, A: AuditSink>(
    connector: &C,
    audit: &A,
    fingerprints: &Fingerprinter,
    request: &SyncRequest<'_>,
    desired: &[(String, Secret)],
) -> Result<Report, SyncError> {
    let remote = with_retry(request.retry, || connector.list(fingerprints)).await.map_err(SyncError::List)?;
    let desired_entries: Vec<Entry> = desired.iter().map(|(name, value)| Entry { name: name.clone(), fingerprint: Some(fingerprints.of(value)) }).collect();
    let plan = plan_with(&desired_entries, &remote, &request.options, &|name| connector.fold(name));
    if !plan.conflicts.is_empty() {
        return Err(SyncError::NameCollision(plan.conflicts));
    }

    audit
        .record(
            Event::new(request.chain, request.actor, "connector.sync.planned", request.connection, "planned").with_detail(json!({
                "connector": connector.id(),
                "put": plan.put,
                "delete": plan.delete,
                "unchanged": plan.unchanged.len(),
            })),
        )
        .await
        .map_err(SyncError::NotRecorded)?;

    let mut report = Report { unchanged: plan.unchanged.len(), ..Report::default() };
    let schema = &request.options.schema;
    let environment = &request.options.environment;

    // A name the destination will not accept fails by itself and is never sent.
    let mut puts: Vec<(String, String, &Secret)> = Vec::new();
    for name in &plan.put {
        let Some((_, value)) = desired.iter().find(|(n, _)| n == name) else { continue };
        let destination_name = connector.fold(&schema.apply(name, environment));
        match connector.accepts_name(&destination_name) {
            Ok(()) => puts.push((name.clone(), destination_name, value)),
            Err(error) => report.failed.push(Failure { name: name.clone(), kind: error.kind, code: error.code }),
        }
    }

    if connector.batches_writes() {
        if !plan.delete.is_empty() {
            match with_retry(request.retry, || connector.delete_batch(&plan.delete)).await {
                Ok(()) => report.deleted += plan.delete.len(),
                Err(error) => report.failed.extend(plan.delete.iter().map(|name| Failure { name: name.clone(), kind: error.kind, code: error.code })),
            }
        }
        if !puts.is_empty() {
            let items: Vec<(String, &Secret)> = puts.iter().map(|(_, destination_name, value)| (destination_name.clone(), *value)).collect();
            match with_retry(request.retry, || connector.put_batch(&items)).await {
                Ok(()) => report.put += puts.len(),
                Err(error) => report.failed.extend(puts.iter().map(|(name, _, _)| Failure { name: name.clone(), kind: error.kind, code: error.code })),
            }
        }
    } else {
        for name in &plan.delete {
            match with_retry(request.retry, || connector.delete(name)).await {
                Ok(()) => report.deleted += 1,
                Err(error) => report.failed.push(Failure { name: name.clone(), kind: error.kind, code: error.code }),
            }
        }
        for (name, destination_name, value) in &puts {
            match with_retry(request.retry, || connector.put(destination_name, value)).await {
                Ok(()) => report.put += 1,
                Err(error) => report.failed.push(Failure { name: name.clone(), kind: error.kind, code: error.code }),
            }
        }
    }

    if report.put + report.deleted > 0 {
        if let Err(error) = with_retry(request.retry, || connector.after_sync()).await {
            report.after_sync_failed = Some(Failure { name: "after_sync".into(), kind: error.kind, code: error.code });
        }
    }

    let outcome = if report.ok() { "completed" } else { "completed_with_failures" };
    let failed: Vec<_> = report.failed.iter().map(|f| json!({ "name": f.name, "kind": format!("{:?}", f.kind), "code": f.code })).collect();
    let recorded = audit
        .record(
            Event::new(request.chain, request.actor, "connector.sync.finished", request.connection, outcome).with_detail(json!({
                "connector": connector.id(),
                "put": report.put,
                "deleted": report.deleted,
                "unchanged": report.unchanged,
                "failed": failed,
                "afterSyncFailed": report.after_sync_failed.is_some(),
            })),
        )
        .await;
    tracing::info!(connector = connector.id(), put = report.put, deleted = report.deleted, failed = report.failed.len(), "sync finished");
    match recorded {
        Ok(()) => Ok(report),
        Err(error) => Err(SyncError::Unrecorded { error, report: Box::new(report) }),
    }
}
