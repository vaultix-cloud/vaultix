//! The Postgres store and its forward-only migrations. The core is Postgres only: no cache and no
//! queue service is required, which is what keeps an idle instance idle.

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{Executor, PgPool};
use std::str::FromStr;
use std::time::Duration;

#[cfg(feature = "testing")]
pub mod testing;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("the database URL is not valid")]
    InvalidUrl,
    #[error("the database is not reachable: {0}")]
    Connect(#[source] sqlx::Error),
    #[error("migration {name} failed: {source}")]
    Migration {
        name: &'static str,
        #[source]
        source: sqlx::Error,
    },
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// Every migration, in order. Forward only: a released migration is never edited.
const MIGRATIONS: &[(i32, &str, &str)] = &[
    (1, "0001_operate", include_str!("../migrations/0001_operate.sql")),
    (2, "0002_secrets", include_str!("../migrations/0002_secrets.sql")),
    (3, "0003_connectors", include_str!("../migrations/0003_connectors.sql")),
];

/// Connect with a pool sized for a small instance.
pub async fn open(url: &str, max_connections: u32) -> Result<PgPool, StoreError> {
    let options = PgConnectOptions::from_str(url).map_err(|_| StoreError::InvalidUrl)?;
    PgPoolOptions::new()
        .max_connections(max_connections.clamp(2, 20))
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await
        .map_err(StoreError::Connect)
}

/// Apply every migration not yet recorded, each in its own transaction, under an advisory lock so
/// two instances starting together cannot both run one. Returns the names applied.
pub async fn migrate(pool: &PgPool) -> Result<Vec<&'static str>, StoreError> {
    let mut conn = pool.acquire().await?;
    conn.execute("SELECT pg_advisory_lock(7761005)").await?;
    let result = apply(&mut conn).await;
    let _ = conn.execute("SELECT pg_advisory_unlock(7761005)").await;
    result
}

async fn apply(conn: &mut sqlx::PgConnection) -> Result<Vec<&'static str>, StoreError> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS vx_operate_migrations (
           version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    )
    .await?;
    let mut applied = Vec::new();
    for (version, name, sql) in MIGRATIONS {
        let done: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM vx_operate_migrations WHERE version = $1)")
            .bind(version)
            .fetch_one(&mut *conn)
            .await?;
        if done {
            continue;
        }
        let mut tx = sqlx::Connection::begin(&mut *conn).await?;
        tx.execute(*sql).await.map_err(|source| StoreError::Migration { name, source })?;
        sqlx::query("INSERT INTO vx_operate_migrations (version, name) VALUES ($1, $2)")
            .bind(version)
            .bind(name)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        applied.push(*name);
    }
    Ok(applied)
}
