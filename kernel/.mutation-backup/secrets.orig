//! Secrets: stored as ciphertext, listed as metadata, and read only by redeeming a single-use handle.
//!
//! * `put` seals a value under the project's data key with the value's identity (project,
//!   environment, path, name, version) bound in, and records the write, in one transaction.
//! * `list` returns names and versions. There is no function here that returns a value except `redeem`.
//! * A handle is a random token; only its hash is stored. It works once, for the identity that asked
//!   for it, before it expires. Unknown, used, expired and wrong-identity handles look the same.
//! * `redeem` marks the handle used, opens the values, and records a `secret.value.read` event with a
//!   keyed fingerprint of each value, all in one transaction: if the record cannot be written, no
//!   value is returned.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;
use vx_audit::Event;
use vx_keys::Keyring;
use vx_secret::Secret;

pub const HANDLE_PREFIX: &str = "vxh_";
const MAX_REFS: usize = 32;
const MAX_TTL_SECONDS: i64 = 300;

#[derive(Debug, thiserror::Error)]
pub enum SecretsError {
    #[error("{0}")]
    InvalidAddress(String),
    #[error("secret \"{0}\" does not exist")]
    NotFound(String),
    #[error("the handle is not valid: it may be unknown, already used, expired, or for another identity")]
    HandleInvalid,
    #[error("an injection can name between 1 and {MAX_REFS} secrets")]
    BadRefCount,
    #[error(transparent)]
    Key(#[from] vx_keys::KeyError),
    #[error(transparent)]
    Audit(#[from] vx_audit::AuditError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// Where a secret lives. Names are environment-variable safe so they can be injected as they are.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Address {
    pub project: String,
    pub environment: String,
    pub path: String,
    pub name: String,
}

fn slug_ok(text: &str) -> bool {
    let mut chars = text.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && text.len() <= 63
        && text.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn name_ok(text: &str) -> bool {
    let mut chars = text.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && text.len() <= 128
        && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn path_ok(text: &str) -> bool {
    text.starts_with('/')
        && text.len() <= 256
        && !text.contains("//")
        && !text.contains("..")
        && text.chars().all(|c| c.is_ascii_alphanumeric() || "/_.-".contains(c))
}

impl Address {
    pub fn parse(project: &str, environment: &str, path: Option<&str>, name: &str) -> Result<Self, SecretsError> {
        let path = path.unwrap_or("/");
        if !slug_ok(project) {
            return Err(SecretsError::InvalidAddress("a project is lowercase letters, digits and dashes, up to 63 characters".into()));
        }
        if !slug_ok(environment) {
            return Err(SecretsError::InvalidAddress("an environment is lowercase letters, digits and dashes, up to 63 characters".into()));
        }
        if !path_ok(path) {
            return Err(SecretsError::InvalidAddress("a path starts with / and holds letters, digits, / _ . and -".into()));
        }
        if !name_ok(name) {
            return Err(SecretsError::InvalidAddress("a name is letters, digits and underscores, not starting with a digit, up to 128 characters".into()));
        }
        Ok(Self { project: project.into(), environment: environment.into(), path: path.into(), name: name.into() })
    }

    fn display(&self) -> String {
        format!("{}/{}{}{}", self.project, self.environment, self.path, self.name)
    }

    fn context(&self, version: i32) -> String {
        format!("{}/v{version}", self.display())
    }

    fn scope(&self) -> String {
        format!("project:{}", self.project)
    }
}

/// What a person or tool sees of a secret: never the value.
#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub name: String,
    pub path: String,
    pub version: i32,
    pub updated_at: DateTime<Utc>,
    pub updated_by: String,
}

async fn unwrap_key(conn: &mut PgConnection, ring: &Keyring, scope: &str, version: i32) -> Result<Secret, SecretsError> {
    let wrapped = vx_keys::load_version(&mut *conn, scope, version).await?.ok_or(vx_keys::KeyError::Open)?;
    Ok(ring.unwrap_data_key(scope, version, &wrapped)?)
}

/// The current data key for a project, created the first time the project stores a secret.
async fn current_key(conn: &mut PgConnection, ring: &Keyring, scope: &str) -> Result<(i32, Secret), SecretsError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))").bind(scope).execute(&mut *conn).await?;
    if let Some((version, wrapped)) = vx_keys::load_current(&mut *conn, scope).await? {
        return Ok((version, ring.unwrap_data_key(scope, version, &wrapped)?));
    }
    let (key, wrapped) = ring.new_data_key(scope, 1)?;
    vx_keys::save_data_key(&mut *conn, scope, 1, &wrapped).await?;
    Ok((1, key))
}

/// Store a new version of a value. Returns the version number.
pub async fn put(pool: &PgPool, ring: &Keyring, address: &Address, value: &Secret, actor: &str) -> Result<i32, SecretsError> {
    let mut tx = pool.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO vx_secrets_secrets (project, environment, path, name) VALUES ($1, $2, $3, $4)
         ON CONFLICT (project, environment, path, name) DO UPDATE SET name = EXCLUDED.name RETURNING id",
    )
    .bind(&address.project)
    .bind(&address.environment)
    .bind(&address.path)
    .bind(&address.name)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("SELECT 1 FROM vx_secrets_secrets WHERE id = $1 FOR UPDATE").bind(id).execute(&mut *tx).await?;
    let version: i32 = sqlx::query_scalar("SELECT coalesce(max(version), 0) + 1 FROM vx_secrets_versions WHERE secret_id = $1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let (key_version, key) = current_key(&mut tx, ring, &address.scope()).await?;
    let sealed = vx_keys::seal(&key, &address.context(version), value)?;
    sqlx::query("INSERT INTO vx_secrets_versions (secret_id, version, key_version, sealed, created_by) VALUES ($1, $2, $3, $4, $5)")
        .bind(id)
        .bind(version)
        .bind(key_version)
        .bind(&sealed)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    vx_audit::append(
        &mut tx,
        Event::new(&address.project, actor, "secret.write", &address.display(), "applied").with_detail(json!({ "version": version, "keyVersion": key_version })),
    )
    .await?;
    tx.commit().await?;
    Ok(version)
}

/// Names and versions in one project environment. Never values.
pub async fn list(pool: &PgPool, project: &str, environment: &str) -> Result<Vec<Meta>, SecretsError> {
    Ok(sqlx::query_as::<_, Meta>(
        "SELECT s.name, s.path, v.version, v.created_at AS updated_at, v.created_by AS updated_by
         FROM vx_secrets_secrets s
         JOIN LATERAL (SELECT version, created_at, created_by FROM vx_secrets_versions WHERE secret_id = s.id ORDER BY version DESC LIMIT 1) v ON true
         WHERE s.project = $1 AND s.environment = $2 ORDER BY s.path, s.name",
    )
    .bind(project)
    .bind(environment)
    .fetch_all(pool)
    .await?)
}

/// Record that someone asked a person to supply a value. Nothing is stored but the request.
pub async fn record_request(pool: &PgPool, address: &Address, purpose: &str, actor: &str) -> Result<(), SecretsError> {
    let mut conn = pool.acquire().await?;
    vx_audit::append(
        &mut conn,
        Event::new(&address.project, actor, "secret.value.requested", &address.display(), "requested").with_detail(json!({ "purpose": purpose.chars().take(200).collect::<String>() })),
    )
    .await?;
    Ok(())
}

fn hash_handle(handle: &str) -> Vec<u8> {
    Sha256::digest(handle.as_bytes()).to_vec()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Injection {
    pub handle: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
struct Ref {
    id: Uuid,
    version: i32,
    address: Address,
}

/// Create a handle that lets `identity` read the named secrets once. The caller learns names and a
/// handle; the handle is a permission, not a value.
pub async fn create_handle(pool: &PgPool, identity: &str, purpose: &str, addresses: &[Address], ttl_seconds: i64) -> Result<Injection, SecretsError> {
    if addresses.is_empty() || addresses.len() > MAX_REFS {
        return Err(SecretsError::BadRefCount);
    }
    let ttl = ttl_seconds.clamp(5, MAX_TTL_SECONDS);
    let mut tx = pool.begin().await?;
    let mut refs = Vec::with_capacity(addresses.len());
    for address in addresses {
        let found: Option<(Uuid, i32)> = sqlx::query_as(
            "SELECT s.id, max(v.version) FROM vx_secrets_secrets s JOIN vx_secrets_versions v ON v.secret_id = s.id
             WHERE s.project = $1 AND s.environment = $2 AND s.path = $3 AND s.name = $4 GROUP BY s.id",
        )
        .bind(&address.project)
        .bind(&address.environment)
        .bind(&address.path)
        .bind(&address.name)
        .fetch_optional(&mut *tx)
        .await?;
        let (id, version) = found.ok_or_else(|| SecretsError::NotFound(address.name.clone()))?;
        refs.push(Ref { id, version, address: address.clone() });
    }
    let mut raw = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut raw);
    let handle = format!("{HANDLE_PREFIX}{}", URL_SAFE_NO_PAD.encode(raw));
    let expires_at = Utc::now() + Duration::seconds(ttl);
    sqlx::query("INSERT INTO vx_secrets_handles (handle_hash, identity, purpose, refs, expires_at) VALUES ($1, $2, $3, $4, $5)")
        .bind(hash_handle(&handle))
        .bind(identity)
        .bind(purpose.chars().take(200).collect::<String>())
        .bind(serde_json::to_value(&refs).unwrap_or_default())
        .bind(expires_at)
        .execute(&mut *tx)
        .await?;
    let mut projects: Vec<&str> = addresses.iter().map(|a| a.project.as_str()).collect();
    projects.sort_unstable();
    projects.dedup();
    for project in projects {
        let names: Vec<String> = addresses.iter().filter(|a| a.project == project).map(Address::display).collect();
        vx_audit::append(
            &mut tx,
            Event::new(project, identity, "secret.injection.created", &names.join(","), "created")
                .with_detail(json!({ "purpose": purpose.chars().take(200).collect::<String>(), "ttlSeconds": ttl, "count": names.len() })),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(Injection { handle, expires_at })
}

/// Render redeemed values for the one trusted caller that redeemed them (the delivery client, never a
/// model). This is the value path: it is the only function here that reads a value to send it out.
#[allow(clippy::disallowed_methods)] // value path: the redeeming client receives its own values
pub fn render_for_trusted_client(values: &[(Address, Secret)]) -> serde_json::Value {
    let items: Vec<serde_json::Value> = values
        .iter()
        .map(|(address, value)| match std::str::from_utf8(value.expose()) {
            Ok(text) => json!({ "name": address.name, "path": address.path, "value": text, "encoding": "utf8" }),
            Err(_) => json!({ "name": address.name, "path": address.path, "value": URL_SAFE_NO_PAD.encode(value.expose()), "encoding": "base64url" }),
        })
        .collect();
    json!({ "values": items })
}

/// Redeem a handle: once, for the identity it was made for. This is the only way a value leaves.
pub async fn redeem(pool: &PgPool, ring: &Keyring, identity: &str, handle: &str) -> Result<Vec<(Address, Secret)>, SecretsError> {
    if !handle.starts_with(HANDLE_PREFIX) {
        return Err(SecretsError::HandleInvalid);
    }
    let mut tx = pool.begin().await?;
    let refs: Option<serde_json::Value> = sqlx::query_scalar(
        "UPDATE vx_secrets_handles SET used_at = now()
         WHERE handle_hash = $1 AND used_at IS NULL AND expires_at > now() AND identity = $2 RETURNING refs",
    )
    .bind(hash_handle(handle))
    .bind(identity)
    .fetch_optional(&mut *tx)
    .await?;
    let refs: Vec<Ref> = serde_json::from_value(refs.ok_or(SecretsError::HandleInvalid)?).map_err(|_| SecretsError::HandleInvalid)?;
    let audit_key = ring.derive("audit-fingerprint");
    let mut out = Vec::with_capacity(refs.len());
    for reference in refs {
        let (key_version, sealed): (i32, Vec<u8>) = sqlx::query_as("SELECT key_version, sealed FROM vx_secrets_versions WHERE secret_id = $1 AND version = $2")
            .bind(reference.id)
            .bind(reference.version)
            .fetch_one(&mut *tx)
            .await?;
        let key = unwrap_key(&mut tx, ring, &reference.address.scope(), key_version).await?;
        let value = vx_keys::open(&key, &reference.address.context(reference.version), &sealed)?;
        vx_audit::append(
            &mut tx,
            Event::new(&reference.address.project, identity, "secret.value.read", &reference.address.display(), "redeemed")
                .with_detail(json!({ "version": reference.version }))
                .with_value(&value, &*audit_key),
        )
        .await?;
        out.push((reference.address, value));
    }
    tx.commit().await?;
    Ok(out)
}
