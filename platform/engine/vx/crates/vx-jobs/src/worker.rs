use crate::schedule::fire_due;
use crate::{clip, Job, JobError, JobsError, CHANNEL};
use chrono::{DateTime, Utc};
use rand::Rng;
use sqlx::postgres::PgListener;
use sqlx::PgPool;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Notify, Semaphore};
use tokio_util::sync::CancellationToken;

type Claimed = (uuid::Uuid, String, String, serde_json::Value, i32, i32, Option<String>);

/// Does the work for one kind of job.
pub type Handler = Arc<dyn Fn(Job, CancellationToken) -> Pin<Box<dyn Future<Output = Result<(), JobError>> + Send>> + Send + Sync>;

/// Tuning for a worker; `Config::new` applies the defaults.
#[derive(Clone)]
pub struct Config {
    pub concurrency: usize,
    /// A running job extends its lease while it works; a vanished worker's job is reclaimed after this.
    pub lease: Duration,
    pub backoff_base: Duration,
    pub backoff_max: Duration,
    /// The longest an idle worker sleeps. A safety net for a missed announcement, not polling.
    pub safety_wake: Duration,
    pub worker_id: String,
}

impl Config {
    pub fn new() -> Self {
        Self {
            concurrency: 4,
            lease: Duration::from_secs(120),
            backoff_base: Duration::from_secs(5),
            backoff_max: Duration::from_secs(900),
            safety_wake: Duration::from_secs(900),
            worker_id: format!("worker-{:08x}", rand::thread_rng().gen::<u32>()),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self::new()
    }
}

pub struct Worker {
    pool: PgPool,
    config: Config,
    handlers: HashMap<String, Handler>,
}

impl Worker {
    pub fn new(pool: PgPool, config: Config) -> Self {
        Self { pool, config, handlers: HashMap::new() }
    }

    /// Register the handler for a kind of job.
    pub fn handle<F, Fut>(&mut self, kind: &str, handler: F)
    where
        F: Fn(Job, CancellationToken) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<(), JobError>> + Send + 'static,
    {
        self.handlers.insert(kind.to_string(), Arc::new(move |job, cancel| Box::pin(handler(job, cancel))));
    }

    /// Work until `stop` is cancelled, then wait for running jobs to finish.
    pub async fn run(self, stop: CancellationToken) -> Result<(), JobsError> {
        let worker = Arc::new(self);
        let wake = Arc::new(Notify::new());
        let capacity = Arc::new(Semaphore::new(worker.config.concurrency));

        let mut listener = PgListener::connect_with(&worker.pool).await?;
        listener.listen(CHANNEL).await?;
        let announcer = {
            let wake = wake.clone();
            let stop = stop.clone();
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = stop.cancelled() => return,
                        received = listener.recv() => match received {
                            Ok(_) => wake.notify_one(),
                            Err(_) => tokio::time::sleep(Duration::from_secs(1)).await,
                        },
                    }
                }
            })
        };

        let mut running = tokio::task::JoinSet::new();
        while !stop.is_cancelled() {
            if let Err(error) = fire_due(&worker.pool, Utc::now()).await {
                tracing::error!(%error, "schedules could not be fired");
            }
            if let Err(error) = worker.reclaim_expired().await {
                tracing::error!(%error, "expired leases could not be reclaimed");
            }
            loop {
                let free = capacity.available_permits();
                if free == 0 {
                    break;
                }
                let claimed = match worker.claim(free as i64).await {
                    Ok(jobs) => jobs,
                    Err(error) => {
                        tracing::error!(%error, "claim failed");
                        break;
                    }
                };
                if claimed.is_empty() {
                    break;
                }
                for job in claimed {
                    let Ok(permit) = capacity.clone().acquire_owned().await else { break };
                    let (worker, wake, stop) = (worker.clone(), wake.clone(), stop.clone());
                    running.spawn(async move {
                        worker.execute(job, stop).await;
                        drop(permit);
                        wake.notify_one();
                    });
                }
            }
            while running.try_join_next().is_some() {}

            let sleep = if capacity.available_permits() > 0 {
                match worker.next_wake().await {
                    Ok(Some(at)) => (at - Utc::now()).to_std().unwrap_or_default().min(worker.config.safety_wake),
                    _ => worker.config.safety_wake,
                }
            } else {
                worker.config.safety_wake
            };
            tokio::select! {
                _ = stop.cancelled() => {}
                _ = wake.notified() => {}
                _ = tokio::time::sleep(sleep) => {}
            }
        }
        while running.join_next().await.is_some() {}
        announcer.abort();
        Ok(())
    }

    /// The one query an idle worker makes: when is anything next due?
    async fn next_wake(&self) -> Result<Option<DateTime<Utc>>, JobsError> {
        Ok(sqlx::query_scalar(
            "SELECT least(
               (SELECT min(run_at) FROM vx_operate_jobs WHERE status = 'queued'),
               (SELECT min(locked_until) FROM vx_operate_jobs WHERE status = 'running'),
               (SELECT min(next_due) FROM vx_operate_schedules WHERE enabled))",
        )
        .fetch_one(&self.pool)
        .await?)
    }

    async fn claim(&self, limit: i64) -> Result<Vec<Job>, JobsError> {
        let rows: Vec<Claimed> = sqlx::query_as(
            "UPDATE vx_operate_jobs SET status = 'running', attempts = attempts + 1, locked_by = $1,
               locked_until = now() + make_interval(secs => $2::float8)
             WHERE id IN (SELECT id FROM vx_operate_jobs WHERE status = 'queued' AND run_at <= now()
                          ORDER BY run_at LIMIT $3 FOR UPDATE SKIP LOCKED)
             RETURNING id, kind, subject, payload, attempts, max_attempts, schedule",
        )
        .bind(&self.config.worker_id)
        .bind(self.config.lease.as_secs_f64())
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, kind, subject, payload, attempt, max_attempts, schedule)| Job { id, kind, subject, payload, attempt, max_attempts, schedule })
            .collect())
    }

    /// A job whose worker vanished counts as a failed attempt, so a crash never strands work.
    async fn reclaim_expired(&self) -> Result<(), JobsError> {
        sqlx::query(
            "WITH expired AS (
               UPDATE vx_operate_jobs SET
                 status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
                 run_at = CASE WHEN attempts >= max_attempts THEN run_at ELSE now() END,
                 finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
                 last_error = 'the worker stopped before finishing; the lease expired',
                 locked_by = NULL, locked_until = NULL
               WHERE status = 'running' AND locked_until < now()
               RETURNING id, kind, attempts, created_at)
             INSERT INTO vx_operate_job_runs (job_id, kind, attempt, started_at, outcome, error)
             SELECT id, kind, attempts, created_at, 'lease_expired', 'the worker stopped before finishing' FROM expired",
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    fn backoff(&self, attempt: i32) -> Duration {
        let mut delay = self.config.backoff_base;
        for _ in 1..attempt {
            if delay >= self.config.backoff_max {
                break;
            }
            delay *= 2;
        }
        let delay = delay.min(self.config.backoff_max);
        delay.mul_f64(0.8 + rand::thread_rng().gen::<f64>() * 0.4)
    }

    async fn execute(&self, job: Job, stop: CancellationToken) {
        let started = Utc::now();
        let cancel = stop.child_token();
        let beat = tokio::spawn(self.heartbeat(job.id, cancel.clone()));
        let result = match self.handlers.get(&job.kind) {
            None => Err(JobError::Permanent(format!("no handler is registered for kind \"{}\"", job.kind))),
            Some(handler) => {
                let work = tokio::spawn(handler(job.clone(), cancel.clone()));
                match work.await {
                    Ok(result) => result,
                    Err(joined) => Err(JobError::Retry(format!("the handler panicked: {joined}"))),
                }
            }
        };
        cancel.cancel();
        beat.abort();
        if let Err(error) = self.finish(&job, started, result).await {
            tracing::error!(job = %job.id, kind = %job.kind, %error, "the job outcome could not be recorded");
        }
    }

    fn heartbeat(&self, id: uuid::Uuid, cancel: CancellationToken) -> impl Future<Output = ()> + Send + 'static {
        let (pool, worker_id, lease) = (self.pool.clone(), self.config.worker_id.clone(), self.config.lease);
        async move {
            let mut ticker = tokio::time::interval(lease / 3);
            ticker.tick().await;
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => return,
                    _ = ticker.tick() => {
                        let renewed = sqlx::query(
                            "UPDATE vx_operate_jobs SET locked_until = now() + make_interval(secs => $3::float8)
                             WHERE id = $1 AND locked_by = $2 AND status = 'running'",
                        )
                        .bind(id).bind(&worker_id).bind(lease.as_secs_f64())
                        .execute(&pool).await;
                        if matches!(renewed, Ok(done) if done.rows_affected() == 0) {
                            cancel.cancel(); // the lease was lost; stop the handler
                            return;
                        }
                    }
                }
            }
        }
    }

    async fn finish(&self, job: &Job, started: DateTime<Utc>, result: Result<(), JobError>) -> Result<(), JobsError> {
        let (outcome, status, message, run_at): (&str, &str, String, Option<DateTime<Utc>>) = match result {
            Ok(()) => ("succeeded", "succeeded", String::new(), None),
            Err(JobError::Permanent(text)) => ("dead", "dead", clip(&text), None),
            Err(JobError::Retry(text)) if job.attempt >= job.max_attempts => ("dead", "dead", clip(&text), None),
            Err(JobError::Retry(text)) => {
                let delay = chrono::Duration::from_std(self.backoff(job.attempt)).unwrap_or_default();
                ("retry", "queued", clip(&text), Some(Utc::now() + delay))
            }
        };
        let mut tx = self.pool.begin().await?;
        let updated = sqlx::query(
            "UPDATE vx_operate_jobs SET status = $2, last_error = $3, run_at = coalesce($4, run_at),
               locked_by = NULL, locked_until = NULL,
               finished_at = CASE WHEN $2 IN ('succeeded', 'dead') THEN now() ELSE NULL END
             WHERE id = $1 AND locked_by = $5 AND status = 'running'",
        )
        .bind(job.id).bind(status).bind(&message).bind(run_at).bind(&self.config.worker_id)
        .execute(&mut *tx).await?;
        if updated.rows_affected() == 0 {
            return Ok(()); // the lease was reclaimed; that outcome is already recorded
        }
        sqlx::query(
            "INSERT INTO vx_operate_job_runs (job_id, kind, attempt, started_at, outcome, error, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(job.id).bind(&job.kind).bind(job.attempt).bind(started).bind(outcome).bind(&message)
        .bind((Utc::now() - started).num_milliseconds() as i32)
        .execute(&mut *tx).await?;
        if let (Some(name), true) = (&job.schedule, outcome != "retry") {
            sqlx::query("UPDATE vx_operate_schedules SET last_run_at = now(), last_result = $2, last_error = $3 WHERE name = $1")
                .bind(name).bind(outcome).bind(&message).execute(&mut *tx).await?;
        }
        if outcome == "retry" {
            sqlx::query("SELECT pg_notify($1, '')").bind(CHANNEL).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }
}

/// Remove succeeded jobs older than `keep` and run history older than `keep_runs`. Dead jobs stay
/// until a person retries or clears them.
pub async fn prune(pool: &PgPool, keep: Duration, keep_runs: Duration) -> Result<u64, JobsError> {
    let jobs = sqlx::query("DELETE FROM vx_operate_jobs WHERE status = 'succeeded' AND finished_at < now() - make_interval(secs => $1::float8)")
        .bind(keep.as_secs_f64())
        .execute(pool)
        .await?
        .rows_affected();
    let runs = sqlx::query("DELETE FROM vx_operate_job_runs WHERE finished_at < now() - make_interval(secs => $1::float8)")
        .bind(keep_runs.as_secs_f64())
        .execute(pool)
        .await?
        .rows_affected();
    Ok(jobs + runs)
}
