//! Owned built-in identity. Credentials never implement Debug/Serialize here. Authority is read
//! from durable sessions and grants on each request; the caller cannot supply its actor identity.
use argon2::{password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use chrono::{DateTime, Utc};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use subtle::ConstantTimeEq;
use uuid::Uuid;
use vx_audit::Event;
use vx_secret::Secret;

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("The credentials or session are not valid.")]
    Unauthorized,
    #[error("This identity is not allowed to perform that action in this scope.")]
    Forbidden,
    #[error("The first owner has already been created.")]
    Initialized,
    #[error("The setup code is invalid or expired.")]
    SetupInvalid,
    #[error("Use a valid email, a password of 15 to 128 bytes, and an organization name of 1 to 80 characters.")]
    InvalidInput,
    #[error("Too many authentication attempts. Try again in a minute.")]
    RateLimited,
    #[error("Authentication is temporarily unavailable.")]
    Unavailable,
}

// Do not surface SQL parameters, stored password hashes or library input through errors/logs.
impl From<sqlx::Error> for AuthError { fn from(_: sqlx::Error) -> Self { Self::Unavailable } }
impl From<vx_audit::AuditError> for AuthError { fn from(_: vx_audit::AuditError) -> Self { Self::Unavailable } }

#[derive(Clone, sqlx::FromRow)]
pub struct Principal {
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub organization_id: Uuid,
    pub is_owner: bool,
}
impl Principal {
    pub fn actor(&self) -> String { format!("user:{}", self.user_id) }
    pub fn handle_identity(&self) -> String { format!("session:{}", self.session_id) }
}

pub struct Session {
    pub bearer: String,
    pub expires_at: DateTime<Utc>,
    pub principal: Principal,
}

fn digest(text: &str) -> Vec<u8> { Sha256::digest(text.as_bytes()).to_vec() }
fn random(prefix: &str) -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    format!("{prefix}{}", hex::encode(bytes))
}

/// Operator-only command. Expiry is persisted and never extended by a server restart.
pub async fn issue_setup(pool: &PgPool) -> Result<String, AuthError> {
    let code = random("vxc_");
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO vx_auth_instance (singleton) VALUES (true) ON CONFLICT DO NOTHING").execute(&mut *tx).await?;
    let updated = sqlx::query("UPDATE vx_auth_instance SET setup_hash=$1, setup_expires_at=now()+interval '15 minutes' WHERE singleton AND NOT initialized")
        .bind(digest(&code)).execute(&mut *tx).await?;
    if updated.rows_affected() != 1 { return Err(AuthError::Initialized); }
    vx_audit::append(&mut tx, Event::new("auth:instance", "operator", "auth.setup.issued", "instance", "issued")).await?;
    tx.commit().await?;
    Ok(code)
}

fn email(text: &str) -> Result<String, AuthError> {
    let text = text.trim().to_ascii_lowercase();
    let Some((local, domain)) = text.split_once('@') else { return Err(AuthError::InvalidInput) };
    if text.len()>254 || local.is_empty() || !domain.contains('.') || domain.contains('@') || text.chars().any(|c| c.is_whitespace() || c.is_control()) { return Err(AuthError::InvalidInput); }
    Ok(text)
}

#[allow(clippy::disallowed_methods)] // credential boundary: hash the password; never serialize it
async fn hash(password: Secret) -> Result<String, AuthError> {
    tokio::task::spawn_blocking(move || {
        Argon2::default().hash_password(password.expose(), &SaltString::generate(&mut OsRng))
            .map(|h| h.to_string()).map_err(|_| AuthError::Unavailable)
    }).await.map_err(|_| AuthError::Unavailable)?
}

#[allow(clippy::disallowed_methods)] // credential boundary: verify supplied password without emitting it
async fn verify(password: Secret, stored: Option<String>) -> Result<bool, AuthError> {
    tokio::task::spawn_blocking(move || {
        // Equal-cost verification for unknown accounts. This fixed dummy hash is public, never a credential.
        static DUMMY: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        let dummy = DUMMY.get_or_init(|| Argon2::default().hash_password(b"not-an-account-password", &SaltString::generate(&mut OsRng)).expect("valid static Argon2 parameters").to_string());
        let parsed = PasswordHash::new(stored.as_deref().unwrap_or(dummy)).map_err(|_| AuthError::Unavailable)?;
        Ok(Argon2::default().verify_password(password.expose(), &parsed).is_ok() && stored.is_some())
    }).await.map_err(|_| AuthError::Unavailable)?
}

/// Bounded, shared budget across replicas, including unknown emails and setup attempts. No unbounded
/// attacker-controlled keys. Auth-only throttling cannot exhaust metadata/secret operations.
pub async fn throttle(pool: &PgPool) -> Result<(), AuthError> {
    let count: Option<i32> = sqlx::query_scalar("UPDATE vx_auth_instance SET attempts=CASE WHEN window_at < now()-interval '1 minute' THEN 1 ELSE attempts+1 END, window_at=CASE WHEN window_at < now()-interval '1 minute' THEN now() ELSE window_at END WHERE singleton AND (window_at < now()-interval '1 minute' OR attempts < 30) RETURNING attempts")
        .fetch_optional(pool).await?;
    if count.is_none() { return Err(AuthError::RateLimited); }
    Ok(())
}

pub async fn setup(pool: &PgPool, code: &str, login: &str, password: Secret, organization: &str, project: &str, environment: &str) -> Result<Uuid, AuthError> {
    let login = email(login)?;
    if !(15..=128).contains(&password.len()) || organization.trim().is_empty() || organization.chars().count()>80 || organization.chars().any(char::is_control) { return Err(AuthError::InvalidInput); }
    let mut tx = pool.begin().await?;
    let row: Option<(bool, Option<Vec<u8>>, bool, Uuid)> = sqlx::query_as("SELECT initialized, setup_hash, coalesce(setup_expires_at>now(),false), organization_id FROM vx_auth_instance WHERE singleton FOR UPDATE")
        .fetch_optional(&mut *tx).await?;
    let (initialized, expected, live, org_id) = row.ok_or(AuthError::SetupInvalid)?;
    if initialized { return Err(AuthError::Initialized); }
    if !live || expected.as_deref().unwrap_or(&[]).ct_eq(&digest(code)).unwrap_u8()!=1 { return Err(AuthError::SetupInvalid); }
    let hashed = hash(password).await?;
    let user_id: Uuid = sqlx::query_scalar("INSERT INTO vx_auth_users (organization_id,email,password_hash,is_owner) VALUES ($1,$2,$3,true) RETURNING id")
        .bind(org_id).bind(login).bind(hashed).fetch_one(&mut *tx).await?;
    for action in ["secrets.list","secrets.write","secrets.request","secrets.inject"] {
        sqlx::query("INSERT INTO vx_auth_scope_grants (user_id,project,environment,action) VALUES ($1,$2,$3,$4)")
            .bind(user_id).bind(project).bind(environment).bind(action).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE vx_auth_instance SET initialized=true, setup_hash=NULL, setup_expires_at=NULL, organization_name=$1 WHERE singleton")
        .bind(organization.trim()).execute(&mut *tx).await?;
    vx_audit::append(&mut tx, Event::new("auth:instance", &format!("user:{user_id}"), "auth.owner.created", &user_id.to_string(), "created")).await?;
    tx.commit().await?;
    Ok(user_id)
}

pub async fn login(pool: &PgPool, login: &str, password: Secret) -> Result<Session, AuthError> {
    let login = email(login).map_err(|_| AuthError::Unauthorized)?;
    if password.is_empty() || password.len()>128 { return Err(AuthError::Unauthorized); }
    let user: Option<(Uuid,String)> = sqlx::query_as("SELECT id,password_hash FROM vx_auth_users WHERE email=$1").bind(login).fetch_optional(pool).await?;
    if !verify(password, user.as_ref().map(|u| u.1.clone())).await? { return Err(AuthError::Unauthorized); }
    let user_id = user.ok_or(AuthError::Unauthorized)?.0;
    let bearer = random("vxs_");
    let mut tx = pool.begin().await?;
    let row: Option<(Uuid,bool)> = sqlx::query_as("SELECT organization_id,is_owner FROM vx_auth_users WHERE id=$1 AND active FOR SHARE")
        .bind(user_id).fetch_optional(&mut *tx).await?;
    let (organization_id,is_owner) = row.ok_or(AuthError::Unauthorized)?;
    let (session_id,expires_at): (Uuid,DateTime<Utc>) = sqlx::query_as("INSERT INTO vx_auth_sessions (user_id,bearer_hash,method,expires_at) VALUES ($1,$2,'password',now()+interval '15 minutes') RETURNING id,expires_at")
        .bind(user_id).bind(digest(&bearer)).fetch_one(&mut *tx).await?;
    vx_audit::append(&mut tx,Event::new("auth:instance", &format!("user:{user_id}"), "auth.session.created", &session_id.to_string(), "created")).await?;
    tx.commit().await?;
    Ok(Session { bearer,expires_at,principal:Principal{user_id,session_id,organization_id,is_owner} })
}

pub async fn authenticate(pool:&PgPool, bearer:&str)->Result<Principal,AuthError> {
    if bearer.len()!=68 || !bearer.starts_with("vxs_") { return Err(AuthError::Unauthorized); }
    sqlx::query_as("SELECT u.id AS user_id,s.id AS session_id,u.organization_id,u.is_owner FROM vx_auth_sessions s JOIN vx_auth_users u ON u.id=s.user_id WHERE s.bearer_hash=$1 AND s.expires_at>now() AND u.active")
        .bind(digest(bearer)).fetch_optional(pool).await?.ok_or(AuthError::Unauthorized)
}

pub async fn authorize(pool:&PgPool, who:&Principal, project:&str, environment:&str, action:&str)->Result<(),AuthError> {
    let allowed:bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM vx_auth_scope_grants g JOIN vx_auth_users u ON u.id=g.user_id JOIN vx_auth_sessions s ON s.user_id=u.id WHERE u.active AND s.id=$1 AND s.expires_at>now() AND g.project=$2 AND g.environment=$3 AND g.action=$4)")
        .bind(who.session_id).bind(project).bind(environment).bind(action).fetch_one(pool).await?;
    if allowed { Ok(()) } else { Err(AuthError::Forbidden) }
}

pub async fn logout(pool:&PgPool, who:&Principal)->Result<(),AuthError> {
    let mut tx = pool.begin().await?;
    let deleted=sqlx::query("DELETE FROM vx_auth_sessions WHERE id=$1 AND user_id=$2").bind(who.session_id).bind(who.user_id).execute(&mut *tx).await?;
    if deleted.rows_affected()>0 { vx_audit::append(&mut tx,Event::new("auth:instance",&who.actor(),"auth.session.revoked",&who.session_id.to_string(),"revoked")).await?; }
    tx.commit().await?;
    Ok(())
}
