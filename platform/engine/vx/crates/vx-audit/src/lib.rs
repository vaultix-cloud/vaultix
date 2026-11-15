//! The audit chain. Every event is written inside the same database transaction as the action it
//! records, so the action and its record commit together or not at all: if audit cannot record, the
//! action does not happen (fail closed). Events are hash-chained per chain (a tenant), so any later
//! edit or deletion is detectable.
//!
//! An event never holds a secret value. A value read is recorded as a keyed fingerprint (an HMAC)
//! that can prove "this value was read" without revealing it.

use chrono::{DateTime, SubsecRound, Utc};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool};
use std::sync::OnceLock;
use vx_secret::Secret;

#[derive(Debug, thiserror::Error)]
pub enum AuditError {
    #[error("audit detail key \"{0}\" looks like a secret; record an identifier instead")]
    SecretLikeKey(String),
    #[error("the audit chain \"{chain}\" was altered at event {seq}")]
    Tampered { chain: String, seq: i64 },
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// What happened. `detail` holds identifiers and counts, never values.
#[derive(Debug, Clone, Serialize)]
pub struct Event {
    pub chain: String,
    pub actor: String,
    pub action: String,
    pub object_ref: String,
    pub outcome: String,
    pub detail: Value,
    #[serde(skip)]
    value_fingerprint: Option<[u8; 32]>,
}

impl Event {
    pub fn new(chain: &str, actor: &str, action: &str, object_ref: &str, outcome: &str) -> Self {
        Self {
            chain: chain.into(),
            actor: actor.into(),
            action: action.into(),
            object_ref: object_ref.into(),
            outcome: outcome.into(),
            detail: Value::Object(Default::default()),
            value_fingerprint: None,
        }
    }

    pub fn with_detail(mut self, detail: Value) -> Self {
        self.detail = detail;
        self
    }

    /// Record that a value was read, without recording the value: a keyed fingerprint only.
    pub fn with_value(mut self, value: &Secret, key: &[u8]) -> Self {
        self.value_fingerprint = Some(value.fingerprint(key));
        self
    }
}

fn forbidden_key() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)(password|passwd|secret|token|credential|private|apikey|api_key|value)").expect("static regex"))
}

fn check_detail(detail: &Value) -> Result<(), AuditError> {
    match detail {
        Value::Object(map) => {
            for (key, child) in map {
                if forbidden_key().is_match(key) {
                    return Err(AuditError::SecretLikeKey(key.clone()));
                }
                check_detail(child)?;
            }
        }
        Value::Array(items) => items.iter().try_for_each(check_detail)?,
        _ => {}
    }
    Ok(())
}

fn digest(prev: &[u8], seq: i64, at: &DateTime<Utc>, event: &Event, fingerprint: Option<&[u8]>) -> Vec<u8> {
    let mut hasher = Sha256::new();
    let mut field = |bytes: &[u8]| {
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    };
    field(prev);
    field(&seq.to_be_bytes());
    field(&at.timestamp_micros().to_be_bytes());
    field(event.chain.as_bytes());
    field(event.actor.as_bytes());
    field(event.action.as_bytes());
    field(event.object_ref.as_bytes());
    field(event.outcome.as_bytes());
    // serde_json maps are ordered by key, so the encoding is deterministic.
    field(event.detail.to_string().as_bytes());
    field(fingerprint.unwrap_or(&[]));
    hasher.finalize().to_vec()
}

/// Append an event on the caller's transaction and return its sequence number. Appends to one
/// chain are serialised by a row lock on the chain head, so sequence numbers have no gaps.
pub async fn append(conn: &mut PgConnection, event: Event) -> Result<i64, AuditError> {
    check_detail(&event.detail)?;
    sqlx::query("INSERT INTO vx_operate_audit_heads (chain, last_seq, last_hash) VALUES ($1, 0, '\\x'::bytea) ON CONFLICT DO NOTHING")
        .bind(&event.chain)
        .execute(&mut *conn)
        .await?;
    let (last_seq, last_hash): (i64, Vec<u8>) = sqlx::query_as("SELECT last_seq, last_hash FROM vx_operate_audit_heads WHERE chain = $1 FOR UPDATE")
        .bind(&event.chain)
        .fetch_one(&mut *conn)
        .await?;
    let seq = last_seq + 1;
    let at = Utc::now().trunc_subsecs(6);
    let fingerprint = event.value_fingerprint.as_ref().map(|f| f.as_slice());
    let hash = digest(&last_hash, seq, &at, &event, fingerprint);
    sqlx::query(
        "INSERT INTO vx_operate_audit_events (chain, seq, at, actor, action, object_ref, outcome, detail, value_hmac, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(&event.chain)
    .bind(seq)
    .bind(at)
    .bind(&event.actor)
    .bind(&event.action)
    .bind(&event.object_ref)
    .bind(&event.outcome)
    .bind(&event.detail)
    .bind(fingerprint)
    .bind(&last_hash)
    .bind(&hash)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE vx_operate_audit_heads SET last_seq = $2, last_hash = $3 WHERE chain = $1")
        .bind(&event.chain)
        .bind(seq)
        .bind(&hash)
        .execute(&mut *conn)
        .await?;
    Ok(seq)
}

/// Re-compute a whole chain and return how many events it holds, or the first altered event.
pub async fn verify(pool: &PgPool, chain: &str) -> Result<i64, AuditError> {
    type Stored = (i64, DateTime<Utc>, String, String, String, String, Value, Option<Vec<u8>>, Vec<u8>, Vec<u8>);
    let rows: Vec<Stored> = sqlx::query_as(
        "SELECT seq, at, actor, action, object_ref, outcome, detail, value_hmac, prev_hash, hash
         FROM vx_operate_audit_events WHERE chain = $1 ORDER BY seq",
    )
    .bind(chain)
    .fetch_all(pool)
    .await?;
    let mut previous: Vec<u8> = Vec::new();
    let mut expected = 1;
    for (seq, at, actor, action, object_ref, outcome, detail, fingerprint, prev_hash, hash) in rows {
        let tampered = || AuditError::Tampered { chain: chain.to_string(), seq };
        if seq != expected || prev_hash != previous {
            return Err(tampered());
        }
        let event = Event { chain: chain.into(), actor, action, object_ref, outcome, detail, value_fingerprint: None };
        if digest(&prev_hash, seq, &at, &event, fingerprint.as_deref()) != hash {
            return Err(tampered());
        }
        previous = hash;
        expected += 1;
    }
    let head: Option<(i64, Vec<u8>)> = sqlx::query_as("SELECT last_seq, last_hash FROM vx_operate_audit_heads WHERE chain = $1")
        .bind(chain)
        .fetch_optional(pool)
        .await?;
    match head {
        Some((last_seq, last_hash)) if last_seq != expected - 1 || last_hash != previous => {
            Err(AuditError::Tampered { chain: chain.to_string(), seq: expected })
        }
        None if expected > 1 => Err(AuditError::Tampered { chain: chain.to_string(), seq: expected }),
        _ => Ok(expected - 1),
    }
}

/// An event as the audit page shows it: metadata only.
#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub chain: String,
    pub seq: i64,
    pub at: DateTime<Utc>,
    pub actor: String,
    pub action: String,
    pub object_ref: String,
    pub outcome: String,
    pub detail: Value,
    pub has_value_fingerprint: bool,
}

pub async fn list(pool: &PgPool, chain: &str, limit: i64) -> Result<Vec<Row>, AuditError> {
    let limit = if (1..=500).contains(&limit) { limit } else { 100 };
    Ok(sqlx::query_as::<_, Row>(
        "SELECT chain, seq, at, actor, action, object_ref, outcome, detail, value_hmac IS NOT NULL AS has_value_fingerprint
         FROM vx_operate_audit_events WHERE chain = $1 ORDER BY seq DESC LIMIT $2",
    )
    .bind(chain)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}
