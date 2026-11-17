//! Signed audit chain heads, kept outside the database.
//!
//! The hash chain proves an event was not altered inside it, but someone who can restore an older backup, or rewrite the
//! whole chain, produces a chain that is internally valid. An anchor is the head of each chain at a moment, signed with a key
//! derived from the root key and stored somewhere the database administrator cannot reach (object storage, a laptop, the control
//! plane). Checking a database against its newest anchor shows a rollback or a rewrite.

use crate::RecoverError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool};
use vx_keys::Keyring;
use vx_secret::Secret;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Head {
    pub chain: String,
    pub seq: i64,
    /// Hex of the head hash.
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Anchor {
    pub format: u32,
    pub at: DateTime<Utc>,
    pub heads: Vec<Head>,
    /// Hex of an HMAC over the rest, with a key derived from the root key.
    pub mac: String,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum AnchorProblem {
    #[error("the anchor's signature is not valid: it was altered, or it belongs to another instance")]
    BadSignature,
    #[error("the chain \"{chain}\" is missing from the database")]
    Missing { chain: String },
    #[error("the chain \"{chain}\" is behind its anchor (anchored at event {anchored}, the database stops at {found}): the database was rolled back")]
    Rollback { chain: String, anchored: i64, found: i64 },
    #[error("the chain \"{chain}\" does not contain the anchored event {seq}: its history was rewritten")]
    Fork { chain: String, seq: i64 },
    #[error("the anchor could not be checked: {0}")]
    Unchecked(String),
}

/// The head of every chain, ordered by chain name.
pub async fn heads(conn: &mut PgConnection) -> Result<Vec<Head>, sqlx::Error> {
    let rows: Vec<(String, i64, Vec<u8>)> = sqlx::query_as("SELECT chain, last_seq, last_hash FROM vx_operate_audit_heads ORDER BY chain").fetch_all(&mut *conn).await?;
    Ok(rows.into_iter().map(|(chain, seq, hash)| Head { chain, seq, hash: hex::encode(hash) }).collect())
}

fn mac(ring: &Keyring, format: u32, at: &DateTime<Utc>, heads: &[Head]) -> String {
    let body = serde_json::to_vec(&(format, at, heads)).unwrap_or_default();
    hex::encode(Secret::from_vec(body).fingerprint(&*ring.derive("anchor-v1")))
}

/// Sign the current chain heads.
pub async fn anchor(pool: &PgPool, ring: &Keyring) -> Result<Anchor, RecoverError> {
    let mut conn = pool.acquire().await?;
    let heads = heads(&mut conn).await?;
    let at = Utc::now();
    let mac = mac(ring, 1, &at, &heads);
    Ok(Anchor { format: 1, at, heads, mac })
}

/// Check the database against an anchor taken earlier. A chain that has moved on past its anchor is fine, as long as it still
/// contains the anchored event.
pub async fn check_anchor(pool: &PgPool, ring: &Keyring, anchor: &Anchor) -> Result<(), AnchorProblem> {
    if anchor.format != 1 || mac(ring, anchor.format, &anchor.at, &anchor.heads) != anchor.mac {
        return Err(AnchorProblem::BadSignature);
    }
    let unchecked = |e: sqlx::Error| AnchorProblem::Unchecked(e.to_string());
    for head in &anchor.heads {
        let current: Option<(i64, Vec<u8>)> = sqlx::query_as("SELECT last_seq, last_hash FROM vx_operate_audit_heads WHERE chain = $1").bind(&head.chain).fetch_optional(pool).await.map_err(unchecked)?;
        let Some((seq, _)) = current else { return Err(AnchorProblem::Missing { chain: head.chain.clone() }) };
        if seq < head.seq {
            return Err(AnchorProblem::Rollback { chain: head.chain.clone(), anchored: head.seq, found: seq });
        }
        let stored: Option<Vec<u8>> = sqlx::query_scalar("SELECT hash FROM vx_operate_audit_events WHERE chain = $1 AND seq = $2").bind(&head.chain).bind(head.seq).fetch_optional(pool).await.map_err(unchecked)?;
        if stored.map(hex::encode).as_deref() != Some(head.hash.as_str()) {
            return Err(AnchorProblem::Fork { chain: head.chain.clone(), seq: head.seq });
        }
    }
    Ok(())
}
