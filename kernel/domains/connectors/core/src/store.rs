//! Connections and syncs in Postgres, and the audit sink that appends to the hash chain.
//!
//! A connection's credentials are one sealed document, bound to the project and the connection's id, so a ciphertext
//! copied to another row or project will not open. `list` and `get` return metadata only. The one function that returns the
//! credentials, `open_credentials`, records the read in the same transaction: if the record cannot be written, nothing is
//! returned.

use crate::engine::AuditSink;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;
use vx_audit::{AuditError, Event};
use vx_keys::{KeyError, Keyring};
use vx_secret::Secret;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    Invalid(&'static str),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Key(#[from] KeyError),
    #[error(transparent)]
    Audit(#[from] AuditError),
}

/// What a person or tool sees of a connection: never the credentials.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Connection {
    pub id: Uuid,
    pub project: String,
    pub kind: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SyncRow {
    pub id: Uuid,
    pub project: String,
    pub connection_id: Uuid,
    pub environment: String,
    pub path: String,
    pub destination: Value,
    pub key_schema: String,
    pub keep_removed: bool,
    pub last_status: Option<String>,
    pub last_run_at: Option<DateTime<Utc>>,
}

fn scope(project: &str) -> String {
    format!("project:{project}")
}

fn context(project: &str, id: Uuid) -> String {
    format!("connection/{project}/{id}")
}

fn word(text: &str, max: usize) -> bool {
    !text.is_empty() && text.len() <= max && text.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Store a connection. `credentials` is the destination's credential document (JSON text), sealed before it is written.
pub async fn create_connection(pool: &PgPool, ring: &Keyring, project: &str, kind: &str, name: &str, credentials: &Secret, actor: &str) -> Result<Uuid, StoreError> {
    if !word(kind, 40) {
        return Err(StoreError::Invalid("kind must be 1 to 40 letters, digits, dashes, underscores or dots"));
    }
    if !word(name, 100) {
        return Err(StoreError::Invalid("name must be 1 to 100 letters, digits, dashes, underscores or dots"));
    }
    if credentials.is_empty() {
        return Err(StoreError::Invalid("credentials are empty"));
    }
    let id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    let (key_version, key) = vx_keys::current_or_create(&mut tx, ring, &scope(project)).await?;
    let sealed = vx_keys::seal(&key, &context(project, id), credentials)?;
    let inserted = sqlx::query("INSERT INTO vx_connectors_connections (id, project, kind, name, key_version, sealed, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(id)
        .bind(project)
        .bind(kind)
        .bind(name)
        .bind(key_version)
        .bind(&sealed)
        .bind(actor)
        .execute(&mut *tx)
        .await;
    if let Err(sqlx::Error::Database(error)) = &inserted {
        if error.is_unique_violation() {
            return Err(StoreError::Invalid("a connection with this name already exists in the project"));
        }
    }
    inserted?;
    vx_audit::append(&mut tx, Event::new(project, actor, "connector.connection.created", &id.to_string(), "created").with_detail(json!({ "kind": kind, "name": name, "keyVersion": key_version }))).await?;
    tx.commit().await?;
    Ok(id)
}

pub async fn list_connections(pool: &PgPool, project: &str) -> Result<Vec<Connection>, StoreError> {
    Ok(sqlx::query_as("SELECT id, project, kind, name, created_at, created_by FROM vx_connectors_connections WHERE project = $1 ORDER BY name")
        .bind(project)
        .fetch_all(pool)
        .await?)
}

pub async fn get_connection(pool: &PgPool, project: &str, id: Uuid) -> Result<Connection, StoreError> {
    sqlx::query_as("SELECT id, project, kind, name, created_at, created_by FROM vx_connectors_connections WHERE id = $1 AND project = $2")
        .bind(id)
        .bind(project)
        .fetch_optional(pool)
        .await?
        .ok_or(StoreError::NotFound)
}

/// Open a connection's credentials for one purpose. The read is recorded, with a keyed fingerprint of the document and
/// never the document, in the same transaction. A connection in another project is indistinguishable from a missing one.
pub async fn open_credentials(pool: &PgPool, ring: &Keyring, project: &str, id: Uuid, actor: &str, purpose: &str) -> Result<Secret, StoreError> {
    let mut tx = pool.begin().await?;
    let row: Option<(String, i32, Vec<u8>)> = sqlx::query_as("SELECT kind, key_version, sealed FROM vx_connectors_connections WHERE id = $1 AND project = $2")
        .bind(id)
        .bind(project)
        .fetch_optional(&mut *tx)
        .await?;
    let (kind, key_version, sealed) = row.ok_or(StoreError::NotFound)?;
    let key = vx_keys::unwrap_stored(&mut tx, ring, &scope(project), key_version).await?;
    let credentials = vx_keys::open(&key, &context(project, id), &sealed)?;
    let audit_key = ring.derive("audit-fingerprint");
    vx_audit::append(
        &mut tx,
        Event::new(project, actor, "connector.credentials.opened", &id.to_string(), "opened")
            .with_detail(json!({ "kind": kind, "purpose": purpose.chars().take(64).collect::<String>() }))
            .with_value(&credentials, &*audit_key),
    )
    .await?;
    tx.commit().await?;
    Ok(credentials)
}

pub async fn delete_connection(pool: &PgPool, project: &str, id: Uuid, actor: &str) -> Result<(), StoreError> {
    let mut tx = pool.begin().await?;
    let removed = sqlx::query("DELETE FROM vx_connectors_connections WHERE id = $1 AND project = $2").bind(id).bind(project).execute(&mut *tx).await?;
    if removed.rows_affected() == 0 {
        return Err(StoreError::NotFound);
    }
    vx_audit::append(&mut tx, Event::new(project, actor, "connector.connection.deleted", &id.to_string(), "deleted")).await?;
    tx.commit().await?;
    Ok(())
}

pub struct NewSync<'a> {
    pub project: &'a str,
    pub connection_id: Uuid,
    pub environment: &'a str,
    pub path: &'a str,
    pub destination: Value,
    pub key_schema: &'a str,
    pub keep_removed: bool,
}

/// Save a sync. The key schema is parsed here, so a schema the grammar refuses is refused when it is saved, not on the first run.
pub async fn create_sync(pool: &PgPool, new: NewSync<'_>, actor: &str) -> Result<Uuid, StoreError> {
    if crate::KeySchema::parse(new.key_schema).is_err() {
        return Err(StoreError::Invalid("the key schema is not valid: it needs exactly one {{secretKey}}, and may use {{environment}}"));
    }
    if !new.destination.is_object() {
        return Err(StoreError::Invalid("destination must be an object"));
    }
    let mut tx = pool.begin().await?;
    get_in_project(&mut tx, new.project, new.connection_id).await?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO vx_connectors_syncs (project, connection_id, environment, path, destination, key_schema, keep_removed, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
    )
    .bind(new.project)
    .bind(new.connection_id)
    .bind(new.environment)
    .bind(new.path)
    .bind(&new.destination)
    .bind(new.key_schema)
    .bind(new.keep_removed)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    vx_audit::append(
        &mut tx,
        Event::new(new.project, actor, "connector.sync.created", &id.to_string(), "created")
            .with_detail(json!({ "connection": new.connection_id, "environment": new.environment, "path": new.path, "keySchema": new.key_schema })),
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

async fn get_in_project(conn: &mut sqlx::PgConnection, project: &str, id: Uuid) -> Result<(), StoreError> {
    let found: Option<Uuid> = sqlx::query_scalar("SELECT id FROM vx_connectors_connections WHERE id = $1 AND project = $2").bind(id).bind(project).fetch_optional(&mut *conn).await?;
    found.map(|_| ()).ok_or(StoreError::NotFound)
}

pub async fn list_syncs(pool: &PgPool, project: &str) -> Result<Vec<SyncRow>, StoreError> {
    Ok(sqlx::query_as(
        "SELECT id, project, connection_id, environment, path, destination, key_schema, keep_removed, last_status, last_run_at
         FROM vx_connectors_syncs WHERE project = $1 ORDER BY created_at",
    )
    .bind(project)
    .fetch_all(pool)
    .await?)
}

pub async fn record_run(pool: &PgPool, project: &str, id: Uuid, status: &str) -> Result<(), StoreError> {
    sqlx::query("UPDATE vx_connectors_syncs SET last_status = $3, last_run_at = now() WHERE id = $1 AND project = $2").bind(id).bind(project).bind(status).execute(pool).await?;
    Ok(())
}

/// The production audit sink: each event is appended to the hash chain in its own transaction.
pub struct PgAudit {
    pool: PgPool,
}

impl PgAudit {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AuditSink for PgAudit {
    async fn record(&self, event: Event) -> Result<(), AuditError> {
        let mut tx = self.pool.begin().await?;
        vx_audit::append(&mut tx, event).await?;
        tx.commit().await?;
        Ok(())
    }
}
