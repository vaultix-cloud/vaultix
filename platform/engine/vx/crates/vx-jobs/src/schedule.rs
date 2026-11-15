use crate::{enqueue, JobsError, NewJob};
use chrono::{DateTime, Duration, Utc};
use croner::Cron;
use serde::Serialize;
use sqlx::PgPool;

/// Recurring work. `spec` is a standard five-field cron expression (UTC) or `@every 5m`.
/// A schedule missed while the instance was off runs once on the next start, never in a burst.
#[derive(Debug, Clone)]
pub struct Schedule {
    pub name: String,
    pub kind: String,
    pub spec: String,
    pub description: String,
}

/// The first time after `from` that `spec` fires.
pub fn next_after(spec: &str, from: DateTime<Utc>) -> Result<DateTime<Utc>, JobsError> {
    if let Some(every) = spec.strip_prefix("@every ") {
        let seconds = parse_every(every.trim()).ok_or_else(|| JobsError::BadSchedule(spec.to_string()))?;
        return Ok(from + Duration::seconds(seconds));
    }
    let cron = Cron::new(spec).parse().map_err(|_| JobsError::BadSchedule(spec.to_string()))?;
    cron.find_next_occurrence(&from, false).map_err(|_| JobsError::BadSchedule(spec.to_string()))
}

fn parse_every(text: &str) -> Option<i64> {
    let (digits, unit) = text.split_at(text.find(|c: char| !c.is_ascii_digit())?);
    let amount: i64 = digits.parse().ok().filter(|n| *n > 0)?;
    let factor = match unit {
        "s" => 1,
        "m" => 60,
        "h" => 3600,
        "d" => 86_400,
        _ => return None,
    };
    Some(amount * factor)
}

/// Record a schedule. It keeps the stored next due time when the spec is unchanged, so a restart
/// neither skips nor repeats a run.
pub async fn register(pool: &PgPool, schedule: &Schedule) -> Result<(), JobsError> {
    let next = next_after(&schedule.spec, Utc::now())?;
    sqlx::query(
        "INSERT INTO vx_operate_schedules (name, kind, spec, description, next_due) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name) DO UPDATE SET kind = EXCLUDED.kind, description = EXCLUDED.description,
           next_due = CASE WHEN vx_operate_schedules.spec = EXCLUDED.spec THEN vx_operate_schedules.next_due ELSE EXCLUDED.next_due END,
           spec = EXCLUDED.spec",
    )
    .bind(&schedule.name)
    .bind(&schedule.kind)
    .bind(&schedule.spec)
    .bind(&schedule.description)
    .bind(next)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_enabled(pool: &PgPool, name: &str, enabled: bool) -> Result<(), JobsError> {
    sqlx::query("UPDATE vx_operate_schedules SET enabled = $2 WHERE name = $1").bind(name).bind(enabled).execute(pool).await?;
    Ok(())
}

/// A schedule as the "Background work" page shows it.
#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRow {
    pub name: String,
    pub kind: String,
    pub spec: String,
    pub description: String,
    pub enabled: bool,
    pub next_due: DateTime<Utc>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_result: String,
    pub last_error: String,
}

pub async fn schedules(pool: &PgPool) -> Result<Vec<ScheduleRow>, JobsError> {
    Ok(sqlx::query_as::<_, ScheduleRow>(
        "SELECT name, kind, spec, description, enabled, next_due, last_run_at, last_result, last_error
         FROM vx_operate_schedules ORDER BY name",
    )
    .fetch_all(pool)
    .await?)
}

/// Turn every due schedule into one job and move it to its next time, in one transaction.
pub(crate) async fn fire_due(pool: &PgPool, now: DateTime<Utc>) -> Result<usize, JobsError> {
    let mut tx = pool.begin().await?;
    let due: Vec<(String, String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT name, kind, spec, next_due FROM vx_operate_schedules
         WHERE enabled AND next_due <= $1 ORDER BY next_due LIMIT 50 FOR UPDATE SKIP LOCKED",
    )
    .bind(now)
    .fetch_all(&mut *tx)
    .await?;
    for (name, kind, spec, at) in &due {
        let next = next_after(spec, now).unwrap_or(now + Duration::hours(24));
        let key = format!("schedule:{name}:{}", at.timestamp());
        enqueue(&mut tx, NewJob { kind: kind.clone(), subject: name.clone(), dedupe_key: Some(key.clone()), max_attempts: Some(3), ..NewJob::default() })
            .await?;
        sqlx::query("UPDATE vx_operate_jobs SET schedule = $1 WHERE dedupe_key = $2").bind(name).bind(&key).execute(&mut *tx).await?;
        sqlx::query("UPDATE vx_operate_schedules SET next_due = $2 WHERE name = $1").bind(name).bind(next).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(due.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_and_cron_specs_resolve() {
        let from: DateTime<Utc> = "2026-11-15T10:00:00Z".parse().unwrap();
        assert_eq!(next_after("@every 5m", from).unwrap(), from + Duration::minutes(5));
        assert_eq!(next_after("30 3 * * *", from).unwrap(), "2026-11-16T03:30:00Z".parse::<DateTime<Utc>>().unwrap());
        assert!(next_after("@every 0m", from).is_err());
        assert!(next_after("not a schedule", from).is_err());
    }
}
