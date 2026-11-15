//! Test support: each test gets its own freshly migrated database on a disposable Postgres.
//! Set `VX_TEST_DATABASE_URL` to an admin URL (`node scripts/test-vx.mjs` does); without it a test
//! that asks for a database returns `None` and the caller should skip.

use rand::Rng;
use sqlx::PgPool;

pub struct TestDb {
    pub pool: PgPool,
    admin: PgPool,
    name: String,
}

/// Create and migrate a database, or `None` when no test server is configured.
pub async fn database() -> Option<TestDb> {
    let admin_url = std::env::var("VX_TEST_DATABASE_URL").ok()?;
    let admin = crate::open(&admin_url, 2).await.expect("admin connection");
    let name = format!("vx_test_{:012x}", rand::thread_rng().gen::<u64>() & 0xffff_ffff_ffff);
    sqlx::query(&format!("CREATE DATABASE {name}")).execute(&admin).await.expect("create database");
    let (base, _) = admin_url.rsplit_once('/').expect("database URL has a path");
    let pool = crate::open(&format!("{base}/{name}"), 8).await.expect("test connection");
    crate::migrate(&pool).await.expect("migrate");
    Some(TestDb { pool, admin, name })
}

impl TestDb {
    /// Drop the database. Tests call this at the end; a failed test leaves it for the disposable server to discard.
    pub async fn finish(self) {
        self.pool.close().await;
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {} WITH (FORCE)", self.name)).execute(&self.admin).await;
    }
}
