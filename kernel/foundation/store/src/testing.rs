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
    let admin = within("connect to the test server", 60, crate::open(&admin_url, 2)).await.expect("admin connection");
    let name = format!("vx_test_{:012x}", rand::thread_rng().gen::<u64>() & 0xffff_ffff_ffff);
    within("create the test database", 60, sqlx::query(&format!("CREATE DATABASE {name}")).execute(&admin)).await.expect("create database");
    let (base, _) = admin_url.rsplit_once('/').expect("database URL has a path");
    let pool = crate::open(&format!("{base}/{name}"), 8).await.expect("test connection");
    within("migrate the test database", 120, crate::migrate(&pool)).await.expect("migrate");
    Some(TestDb { pool, admin, name })
}

impl TestDb {
    /// Drop the database. Tests call this at the end; a failed test leaves it for the disposable server to discard.
    pub async fn finish(self) {
        self.pool.close().await;
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {} WITH (FORCE)", self.name)).execute(&self.admin).await;
    }
}

// ---- time limits ----
//
// A test that waits forever is worse than one that fails: it hides the failure and holds a machine. (A drill once waited 17
// hours.) Every database or process test runs under `budget`, and a step that talks to something that can stall runs under
// `within`. Two layers, because a timeout inside async code cannot interrupt a thread that is blocked:
//   1. `budget` / `within` give up with a message that names the step, dropping the test's futures, which stops the servers
//      they started (their `Drop` kills the child);
//   2. a watchdog thread, `budget`'s last resort, stops every process the test registered with `track` and ends the test
//      process with a message, if the test is still running a grace period after its budget (a blocked thread).

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

static CHILDREN: Mutex<Vec<u32>> = Mutex::new(Vec::new());

/// Register a child process the test started, so the watchdog can stop it. Pair with `untrack` when it is stopped.
pub fn track(pid: u32) {
    CHILDREN.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).push(pid);
}

pub fn untrack(pid: u32) {
    CHILDREN.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).retain(|tracked| *tracked != pid);
}

fn stop_tracked() {
    let pids: Vec<u32> = CHILDREN.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone();
    for pid in pids {
        let _ = if cfg!(windows) {
            std::process::Command::new("taskkill").args(["/PID", &pid.to_string(), "/F", "/T"]).output()
        } else {
            std::process::Command::new("kill").args(["-9", &pid.to_string()]).output()
        };
    }
}

/// The budget in seconds: `VX_TEST_BUDGET_SECONDS` when set (a slow machine), otherwise the test's own default.
fn seconds_for(default: u64) -> u64 {
    std::env::var("VX_TEST_BUDGET_SECONDS").ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

/// Run a whole test under a time limit. When it runs out the test fails, naming itself; it never waits.
pub async fn budget<T>(name: &str, default_seconds: u64, body: impl Future<Output = T>) -> T {
    let seconds = seconds_for(default_seconds);
    let done = Arc::new(AtomicBool::new(false));
    let watching = done.clone();
    let label = name.to_string();
    let grace = 20;
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(seconds + grace);
        while std::time::Instant::now() < deadline {
            if watching.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        stop_tracked();
        // The watchdog's last words, written to the stream directly: the test process is about to end.
        let _ = std::io::Write::write_fmt(&mut std::io::stderr(), format_args!("watchdog: test `{label}` was still running {grace}s after its {seconds}s budget, blocked where a timeout cannot reach; its servers were stopped and the test process is ending\n"));
        std::process::exit(101);
    });
    let outcome = tokio::time::timeout(Duration::from_secs(seconds), body).await;
    done.store(true, Ordering::SeqCst);
    match outcome {
        Ok(value) => value,
        Err(_) => panic!("test `{name}` did not finish within its {seconds}s budget (VX_TEST_BUDGET_SECONDS changes it); a step is waiting on something that is not answering"),
    }
}

/// Run one step that can stall (a lock wait, a server that accepted and went quiet) under its own limit.
pub async fn within<T>(what: &str, seconds: u64, step: impl Future<Output = T>) -> T {
    match tokio::time::timeout(Duration::from_secs(seconds), step).await {
        Ok(value) => value,
        Err(_) => panic!("step `{what}` did not finish within {seconds}s"),
    }
}
