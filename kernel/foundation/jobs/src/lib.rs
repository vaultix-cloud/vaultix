//! The one background-work system: a Postgres table, claimed with `SKIP LOCKED` and woken by
//! `LISTEN/NOTIFY`. A worker with nothing to do runs no queries; it sleeps until the next job,
//! lease or schedule is due, or until a new job is announced.
//!
//! Payloads carry identifiers and counts only. A payload key that looks like a secret is refused at
//! enqueue, so work that needs a credential receives a reference and fetches it by redeeming a handle.

mod schedule;
mod worker;

pub use schedule::{next_after, register, schedules, set_enabled, Schedule, ScheduleRow};
pub use worker::{prune, Config, Handler, Worker};

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
use std::sync::OnceLock;
use uuid::Uuid;

pub(crate) const CHANNEL: &str = "vx_jobs";
const MAX_PAYLOAD: usize = 4096;
const MAX_ERROR: usize = 500;

#[derive(Debug, thiserror::Error)]
pub enum JobsError {
    #[error("a job needs a kind")]
    MissingKind,
    #[error("the payload is larger than 4 KiB; pass identifiers, not data")]
    PayloadTooLarge,
    #[error("payload key \"{0}\" looks like a secret; pass an identifier instead")]
    SecretLikeKey(String),
    #[error("schedule \"{0}\" is not valid")]
    BadSchedule(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// How a handler fails. `Retry` backs off and tries again until attempts run out; `Permanent` goes
/// straight to dead, where it stays visible and can be retried by a person.
#[derive(Debug)]
pub enum JobError {
    Retry(String),
    Permanent(String),
}

#[derive(Debug, Clone)]
pub struct Job {
    pub id: Uuid,
    pub kind: String,
    pub subject: String,
    pub payload: Value,
    /// 1 for the first run.
    pub attempt: i32,
    pub max_attempts: i32,
    pub schedule: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct NewJob {
    pub kind: String,
    pub subject: String,
    pub payload: Option<Value>,
    pub run_at: Option<DateTime<Utc>>,
    pub max_attempts: Option<i32>,
    /// Unique while a job with the key is queued or running.
    pub dedupe_key: Option<String>,
}

fn forbidden_key() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)(password|passwd|secret|token|credential|private|apikey|api_key|value)").expect("static regex"))
}

fn check_payload(payload: &Value) -> Result<(), JobsError> {
    if payload.to_string().len() > MAX_PAYLOAD {
        return Err(JobsError::PayloadTooLarge);
    }
    match payload {
        Value::Object(map) => {
            for (key, child) in map {
                if forbidden_key().is_match(key) {
                    return Err(JobsError::SecretLikeKey(key.clone()));
                }
                check_payload(child)?;
            }
        }
        Value::Array(items) => {
            for child in items {
                check_payload(child)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Insert a job on the caller's connection or transaction and announce it; the announcement is
/// delivered when that transaction commits. Returns `None` when a job with the same dedupe key is
/// already queued or running.
pub async fn enqueue(conn: &mut PgConnection, job: NewJob) -> Result<Option<Uuid>, JobsError> {
    if job.kind.trim().is_empty() {
        return Err(JobsError::MissingKind);
    }
    let payload = job.payload.unwrap_or_else(|| Value::Object(Default::default()));
    check_payload(&payload)?;
    let row: Option<(Uuid,)> = sqlx::query_as(
        "WITH inserted AS (
           INSERT INTO vx_operate_jobs (kind, subject, payload, run_at, max_attempts, dedupe_key)
           VALUES ($1, $2, $3, coalesce($4, now()), $5, $6) ON CONFLICT DO NOTHING RETURNING id)
         SELECT id FROM inserted, LATERAL (SELECT pg_notify($7, '')) AS announced",
    )
    .bind(&job.kind)
    .bind(&job.subject)
    .bind(&payload)
    .bind(job.run_at)
    .bind(job.max_attempts.unwrap_or(5))
    .bind(&job.dedupe_key)
    .bind(CHANNEL)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.map(|(id,)| id))
}

/// Give a dead job another full set of attempts: the Retry button.
pub async fn requeue(pool: &PgPool, id: Uuid) -> Result<bool, JobsError> {
    let changed = sqlx::query(
        "UPDATE vx_operate_jobs SET status = 'queued', attempts = 0, run_at = now(), locked_by = NULL,
           locked_until = NULL, finished_at = NULL WHERE id = $1 AND status = 'dead'",
    )
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected()
        == 1;
    if changed {
        sqlx::query("SELECT pg_notify($1, '')").bind(CHANNEL).execute(pool).await?;
    }
    Ok(changed)
}

/// A job as the "Background work" page shows it.
#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: Uuid,
    pub kind: String,
    pub subject: String,
    pub status: String,
    pub attempts: i32,
    pub max_attempts: i32,
    pub run_at: DateTime<Utc>,
    pub last_error: String,
    pub schedule: Option<String>,
    pub finished_at: Option<DateTime<Utc>>,
}

/// Recent jobs, newest first, optionally filtered by status.
pub async fn list(pool: &PgPool, status: Option<&str>, limit: i64) -> Result<Vec<Row>, JobsError> {
    let limit = if (1..=500).contains(&limit) { limit } else { 100 };
    Ok(sqlx::query_as::<_, Row>(
        "SELECT id, kind, subject, status, attempts, max_attempts, run_at, last_error, schedule, finished_at
         FROM vx_operate_jobs WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2",
    )
    .bind(status)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

pub(crate) fn clip(text: &str) -> String {
    text.chars().take(MAX_ERROR).collect()
}
