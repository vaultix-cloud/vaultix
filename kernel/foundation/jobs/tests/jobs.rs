#![allow(clippy::unwrap_used)] // test helpers
//! Behaviour tests against a real Postgres. Run with `node scripts/test-vx.mjs`.

use serde_json::json;
use sqlx::PgPool;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use vx_jobs::{enqueue, list, register, requeue, schedules, Config, Job, JobError, NewJob, Schedule, Worker};
use vx_store::testing::{database, TestDb};

macro_rules! db_or_skip {
    () => {
        match database().await {
            Some(db) => db,
            None => {
                eprintln!("skipped: VX_TEST_DATABASE_URL is not set");
                return;
            }
        }
    };
}

fn fast() -> Config {
    let mut config = Config::new();
    config.lease = Duration::from_millis(900);
    config.backoff_base = Duration::from_millis(40);
    config.backoff_max = Duration::from_millis(200);
    config.safety_wake = Duration::from_secs(30);
    config
}

fn start(worker: Worker) -> (CancellationToken, JoinHandle<()>) {
    let stop = CancellationToken::new();
    let token = stop.clone();
    let task = tokio::spawn(async move {
        worker.run(token).await.expect("worker ends cleanly");
    });
    (stop, task)
}

async fn stop(handle: (CancellationToken, JoinHandle<()>)) {
    handle.0.cancel();
    handle.1.await.expect("worker task");
}

async fn wait_for<F, Fut>(what: &str, mut check: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    for _ in 0..200 {
        if check().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("timed out waiting for: {what}");
}

async fn enqueue_one(pool: &PgPool, job: NewJob) -> Option<uuid::Uuid> {
    let mut conn = pool.acquire().await.unwrap();
    enqueue(&mut conn, job).await.unwrap()
}

async fn status_of(pool: &PgPool, id: uuid::Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM vx_operate_jobs WHERE id = $1").bind(id).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn a_job_runs_once_and_is_recorded() {
    let db = db_or_skip!();
    let runs = Arc::new(AtomicUsize::new(0));
    let mut worker = Worker::new(db.pool.clone(), fast());
    let counter = runs.clone();
    worker.handle("demo", move |_job: Job, _cancel| {
        let counter = counter.clone();
        async move {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    });
    let handle = start(worker);
    let id = enqueue_one(&db.pool, NewJob { kind: "demo".into(), subject: "project-1".into(), payload: Some(json!({"projectId": "p1"})), ..NewJob::default() })
        .await
        .unwrap();
    wait_for("the job to succeed", || async { status_of(&db.pool, id).await == "succeeded" }).await;
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    let history: (String, i32) = sqlx::query_as("SELECT outcome, attempt FROM vx_operate_job_runs WHERE job_id = $1").bind(id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(history, ("succeeded".to_string(), 1));
    stop(handle).await;
    db.finish().await;
}

#[tokio::test]
async fn failures_retry_then_stay_visible_and_can_be_retried_by_a_person() {
    let db = db_or_skip!();
    let attempts = Arc::new(AtomicUsize::new(0));
    let mut worker = Worker::new(db.pool.clone(), fast());
    let seen = attempts.clone();
    worker.handle("flaky", move |_job, _cancel| {
        let seen = seen.clone();
        async move {
            seen.fetch_add(1, Ordering::SeqCst);
            Err(JobError::Retry("the provider answered 503".into()))
        }
    });
    let handle = start(worker);
    let id = enqueue_one(&db.pool, NewJob { kind: "flaky".into(), max_attempts: Some(3), ..NewJob::default() }).await.unwrap();
    wait_for("the job to die", || async { status_of(&db.pool, id).await == "dead" }).await;
    assert_eq!(attempts.load(Ordering::SeqCst), 3);
    let row = &list(&db.pool, Some("dead"), 10).await.unwrap()[0];
    assert_eq!(row.last_error, "the provider answered 503", "a failed job keeps its reason");
    let outcomes: Vec<String> = sqlx::query_scalar("SELECT outcome FROM vx_operate_job_runs WHERE job_id = $1 ORDER BY id").bind(id).fetch_all(&db.pool).await.unwrap();
    assert_eq!(outcomes, ["retry", "retry", "dead"]);

    assert!(requeue(&db.pool, id).await.unwrap());
    wait_for("the retried job to die again", || async { attempts.load(Ordering::SeqCst) == 6 }).await;
    stop(handle).await;
    db.finish().await;
}

#[tokio::test]
async fn a_permanent_error_and_an_unknown_kind_do_not_retry() {
    let db = db_or_skip!();
    let mut worker = Worker::new(db.pool.clone(), fast());
    worker.handle("bad-input", |_job, _cancel| async { Err(JobError::Permanent("the connection no longer exists".into())) });
    let handle = start(worker);
    let permanent = enqueue_one(&db.pool, NewJob { kind: "bad-input".into(), ..NewJob::default() }).await.unwrap();
    let unknown = enqueue_one(&db.pool, NewJob { kind: "nobody-handles-this".into(), ..NewJob::default() }).await.unwrap();
    wait_for("both to die", || async { status_of(&db.pool, permanent).await == "dead" && status_of(&db.pool, unknown).await == "dead" }).await;
    let attempts: i32 = sqlx::query_scalar("SELECT attempts FROM vx_operate_jobs WHERE id = $1").bind(permanent).fetch_one(&db.pool).await.unwrap();
    assert_eq!(attempts, 1);
    stop(handle).await;
    db.finish().await;
}

#[tokio::test]
async fn a_payload_cannot_carry_a_secret() {
    let db = db_or_skip!();
    let mut conn = db.pool.acquire().await.unwrap();
    for key in ["password", "apiKey", "secretValue", "accessToken", "nested"] {
        let payload = if key == "nested" { json!({"outer": [{"clientSecret": "x"}]}) } else { json!({ key: "x" }) };
        let refused = enqueue(&mut conn, NewJob { kind: "demo".into(), payload: Some(payload), ..NewJob::default() }).await;
        assert!(refused.is_err(), "{key} must be refused");
    }
    let too_big = enqueue(&mut conn, NewJob { kind: "demo".into(), payload: Some(json!({"ids": "x".repeat(5000)})), ..NewJob::default() }).await;
    assert!(too_big.is_err());
    assert!(enqueue(&mut conn, NewJob { kind: "demo".into(), payload: Some(json!({"projectId": "p1", "count": 3})), ..NewJob::default() }).await.unwrap().is_some());
    drop(conn);
    db.finish().await;
}

#[tokio::test]
async fn a_dedupe_key_allows_one_live_job() {
    let db = db_or_skip!();
    let first = enqueue_one(&db.pool, NewJob { kind: "sync".into(), dedupe_key: Some("sync:conn-1".into()), ..NewJob::default() }).await;
    let second = enqueue_one(&db.pool, NewJob { kind: "sync".into(), dedupe_key: Some("sync:conn-1".into()), ..NewJob::default() }).await;
    assert!(first.is_some() && second.is_none());
    db.finish().await;
}

#[tokio::test]
async fn a_crashed_worker_does_not_strand_its_job() {
    let db = db_or_skip!();
    // A job a vanished worker left running, with its lease already expired.
    let id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO vx_operate_jobs (kind, status, attempts, locked_by, locked_until) VALUES ('demo', 'running', 1, 'dead-worker', now() - interval '1 minute') RETURNING id",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    let runs = Arc::new(AtomicUsize::new(0));
    let mut worker = Worker::new(db.pool.clone(), fast());
    let counter = runs.clone();
    worker.handle("demo", move |_job, _cancel| {
        let counter = counter.clone();
        async move {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    });
    let handle = start(worker);
    wait_for("the stranded job to finish", || async { status_of(&db.pool, id).await == "succeeded" }).await;
    let outcomes: Vec<String> = sqlx::query_scalar("SELECT outcome FROM vx_operate_job_runs WHERE job_id = $1 ORDER BY id").bind(id).fetch_all(&db.pool).await.unwrap();
    assert_eq!(outcomes, ["lease_expired", "succeeded"]);
    stop(handle).await;
    db.finish().await;
}

#[tokio::test]
async fn two_workers_never_run_the_same_job_twice() {
    let db = db_or_skip!();
    let seen = Arc::new(std::sync::Mutex::new(Vec::<uuid::Uuid>::new()));
    let mut handles = Vec::new();
    for _ in 0..2 {
        let mut worker = Worker::new(db.pool.clone(), fast());
        let seen = seen.clone();
        worker.handle("count", move |job, _cancel| {
            let seen = seen.clone();
            async move {
                seen.lock().unwrap().push(job.id);
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok(())
            }
        });
        handles.push(start(worker));
    }
    let mut ids = Vec::new();
    for n in 0..40 {
        ids.push(enqueue_one(&db.pool, NewJob { kind: "count".into(), subject: format!("n{n}"), ..NewJob::default() }).await.unwrap());
    }
    wait_for("all 40 to finish", || async {
        let done: i64 = sqlx::query_scalar("SELECT count(*) FROM vx_operate_jobs WHERE status = 'succeeded'").fetch_one(&db.pool).await.unwrap();
        done == 40
    })
    .await;
    let mut ran = seen.lock().unwrap().clone();
    ran.sort();
    let total = ran.len();
    ran.dedup();
    // A job runs twice only if its lease expired while it ran and another worker reclaimed it. Say so in the failure, so a double run
    // is told apart from a broken claim.
    let expired: i64 = sqlx::query_scalar("SELECT count(*) FROM vx_operate_job_runs WHERE outcome = 'lease_expired'").fetch_one(&db.pool).await.unwrap();
    assert_eq!((total, ran.len()), (40, 40), "every job ran exactly once ({expired} leases expired during the run)");
    for handle in handles {
        stop(handle).await;
    }
    db.finish().await;
}

#[tokio::test]
async fn a_schedule_fires_once_after_being_missed_and_records_its_result() {
    let db = db_or_skip!();
    register(&db.pool, &Schedule { name: "nightly-cleanup".into(), kind: "cleanup".into(), spec: "@every 1h".into(), description: "Remove expired items".into() }).await.unwrap();
    // The instance was off for a day: the schedule is far overdue.
    sqlx::query("UPDATE vx_operate_schedules SET next_due = now() - interval '25 hours'").execute(&db.pool).await.unwrap();
    let runs = Arc::new(AtomicUsize::new(0));
    let mut worker = Worker::new(db.pool.clone(), fast());
    let counter = runs.clone();
    worker.handle("cleanup", move |_job, _cancel| {
        let counter = counter.clone();
        async move {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    });
    let handle = start(worker);
    wait_for("the schedule to report", || async { schedules(&db.pool).await.unwrap()[0].last_result == "succeeded" }).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(runs.load(Ordering::SeqCst), 1, "a missed schedule runs once, not once per missed hour");
    let row = &schedules(&db.pool).await.unwrap()[0];
    assert!(row.next_due > chrono::Utc::now(), "the next run is in the future");
    stop(handle).await;
    db.finish().await;
}

#[tokio::test]
async fn an_idle_worker_makes_no_queries() {
    let db: TestDb = db_or_skip!();
    let mut worker = Worker::new(db.pool.clone(), fast());
    worker.handle("demo", |_job, _cancel| async { Ok(()) });
    // One connection is held back to watch with, so everything else belongs to the worker.
    let mut meter = db.pool.acquire().await.unwrap();
    let me: i32 = sqlx::query_scalar("SELECT pg_backend_pid()").fetch_one(&mut *meter).await.unwrap();
    let handle = start(worker);
    tokio::time::sleep(Duration::from_secs(2)).await; // start-up queries finish here
    let since: chrono::DateTime<chrono::Utc> = sqlx::query_scalar("SELECT clock_timestamp()").fetch_one(&mut *meter).await.unwrap();
    tokio::time::sleep(Duration::from_secs(8)).await;
    // Any statement the worker started in the quiet window would show as a newer query_start.
    let active: Vec<(i32, String)> = sqlx::query_as(
        "SELECT pid, left(query, 80) FROM pg_stat_activity
         WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> $1 AND query_start > $2",
    )
    .bind(me)
    .bind(since)
    .fetch_all(&mut *meter)
    .await
    .unwrap();
    assert!(active.is_empty(), "an idle worker ran statements in a quiet 8 seconds: {active:?}");
    drop(meter);
    stop(handle).await;
    db.finish().await;
}
