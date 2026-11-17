//! The HTTP surface, `/api/vx/v1`. Every request and response is a type from `vx-contract`, and every
//! operation is annotated so the OpenAPI document is generated from this code. Errors are
//! `{"code": "...", "error": "..."}`: a stable code and a plain message. Every JSON answer passes the
//! output gate before it leaves, except a redeem, which is the value path.

use crate::extract::{ApiPath, ApiQuery};
use axum::extract::{Request, State as AxumState};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use subtle::ConstantTimeEq;
use utoipa::IntoParams;
use vx_contract as c;
use vx_gate::Gate;
use vx_keys::Keyring;

pub struct Inner {
    pub(crate) pool: PgPool,
    pub(crate) keyring: Option<Arc<Keyring>>,
    bootstrap_token: Option<String>,
    gate: Gate,
}

pub type State = Arc<Inner>;

impl Inner {
    pub fn new(pool: PgPool, keyring: Option<Arc<Keyring>>, bootstrap_token: Option<String>) -> State {
        Arc::new(Self { pool, keyring, bootstrap_token, gate: Gate::new() })
    }
}

/// Read the root key from a file holding it as 64 hex characters or as the recovery key.
pub fn load_keyring(path: &str) -> Result<Keyring, Box<dyn std::error::Error>> {
    let text = std::fs::read_to_string(path).map_err(|_| "the root key file cannot be read")?;
    let root = vx_keys::parse_recovery(text.trim())?;
    Ok(Keyring::new(root)?)
}

pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    pub(crate) fn new(status: StatusCode, code: &'static str, message: &str) -> Self {
        Self { status, code, message: message.to_string() }
    }
    pub(crate) fn internal(error: impl std::fmt::Display) -> Self {
        tracing::error!(%error, "request failed");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", "Something went wrong on the server. It has been logged.")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(c::ErrorBody { code: self.code.to_string(), error: self.message })).into_response()
    }
}

/// Answer with a contract type after the output gate has checked it. A blocked answer is replaced, never sent.
pub(crate) fn answer<T: Serialize>(state: &State, body: &T) -> Result<Json<serde_json::Value>, ApiError> {
    let value = serde_json::to_value(body).map_err(ApiError::internal)?;
    match state.gate.check_json(&value) {
        Ok(()) => Ok(Json(value)),
        Err(blocked) => {
            tracing::error!(rule = blocked.rule, "an answer was blocked by the output gate");
            Err(ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "output_blocked", "The answer was withheld because it matched a credential rule."))
        }
    }
}

pub fn router(state: State) -> Router {
    let operate = Router::new()
        .route("/jobs", get(jobs))
        .route("/jobs/{id}/retry", post(retry))
        .route("/schedules", get(schedules))
        .route("/audit/verify", get(audit_verify))
        .route("/audit/events", get(audit_events))
        .layer(middleware::from_fn_with_state(state.clone(), require_bootstrap_token));
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(readyz))
        .route("/api/vx/v1/status", get(status))
        .nest("/api/vx/v1/operate", operate)
        .nest("/api/vx/v1/secrets", crate::secrets::router(state.clone()))
        .with_state(state)
}

/// Is the instance ready to serve, and if not, why: a fixed set of codes, never text that could carry a value. Public, and not
/// part of `/api/vx/v1`: it is for load balancers and the operator.
async fn readyz(AxumState(state): AxumState<State>) -> (StatusCode, Json<serde_json::Value>) {
    let mut reasons: Vec<&str> = Vec::new();
    if state.keyring.is_none() {
        reasons.push("sealed");
    }
    match sqlx::query_scalar::<_, f64>("SELECT extract(epoch FROM now())::float8").fetch_one(&state.pool).await {
        Err(_) => reasons.push("database_unavailable"),
        Ok(database_seconds) => {
            let host_seconds = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64());
            let allowed: f64 = std::env::var("VX_CLOCK_SKEW_SECONDS").ok().and_then(|v| v.parse().ok()).unwrap_or(5.0);
            if (database_seconds - host_seconds).abs() > allowed {
                reasons.push("clock_skew");
            }
            if sqlx::query("SELECT 1 FROM vx_operate_audit_heads LIMIT 1").execute(&state.pool).await.is_err() {
                reasons.push("audit_unavailable");
            }
            let applied: Result<i64, _> = sqlx::query_scalar("SELECT count(*) FROM vx_operate_migrations").fetch_one(&state.pool).await;
            if applied.map_or(true, |n| (n as usize) < vx_store::migration_count()) {
                reasons.push("migrations_behind");
            }
        }
    }
    let ready = reasons.is_empty();
    (if ready { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE }, Json(serde_json::json!({ "ready": ready, "reasons": reasons })))
}

pub(crate) async fn require_bootstrap_token(AxumState(state): AxumState<State>, headers: HeaderMap, request: Request, next: Next) -> Result<Response, ApiError> {
    let Some(expected) = &state.bootstrap_token else {
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "not_configured", "These routes are off until a bootstrap token is set (VX_BOOTSTRAP_TOKEN)."));
    };
    let presented = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    if presented.as_bytes().ct_eq(expected.as_bytes()).unwrap_u8() != 1 {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized", "A valid bearer token is required."));
    }
    Ok(next.run(request).await)
}

/// The instance's state: whether it is sealed and whether its database answers. Public.
#[utoipa::path(get, operation_id = "getStatus", path = "/api/vx/v1/status", tag = "status",
    responses((status = 200, description = "The instance state", body = c::StatusResponse)))]
pub(crate) async fn status(AxumState(state): AxumState<State>) -> Result<Json<serde_json::Value>, ApiError> {
    let database = if sqlx::query("SELECT 1").execute(&state.pool).await.is_ok() { c::DatabaseState::Ok } else { c::DatabaseState::Unavailable };
    answer(&state, &c::StatusResponse { product: "Vaultix".into(), version: env!("CARGO_PKG_VERSION").into(), sealed: state.keyring.is_none(), database })
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct JobsQuery {
    /// Only jobs in this state.
    #[param(value_type = Option<c::JobStatus>, inline)]
    status: Option<String>,
    /// At most this many, newest first; 1 to 500, default 100.
    limit: Option<i64>,
}

/// Background jobs, newest first. A failed job stays here, with its reason, until a person retries it.
#[utoipa::path(get, operation_id = "listJobs", path = "/api/vx/v1/operate/jobs", tag = "operate", params(JobsQuery), security(("bearer" = [])),
    responses((status = 200, body = c::JobsResponse), (status = 401, body = c::ErrorBody), (status = 422, body = c::ErrorBody), (status = 503, body = c::ErrorBody)))]
pub(crate) async fn jobs(AxumState(state): AxumState<State>, ApiQuery(query): ApiQuery<JobsQuery>) -> Result<Json<serde_json::Value>, ApiError> {
    if let Some(status) = &query.status {
        if !["queued", "running", "succeeded", "dead"].contains(&status.as_str()) {
            return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_status", "status must be queued, running, succeeded or dead."));
        }
    }
    let rows = vx_jobs::list(&state.pool, query.status.as_deref(), query.limit.unwrap_or(100)).await.map_err(ApiError::internal)?;
    let jobs = rows
        .into_iter()
        .filter_map(|row| {
            let status = match row.status.as_str() {
                "queued" => c::JobStatus::Queued,
                "running" => c::JobStatus::Running,
                "succeeded" => c::JobStatus::Succeeded,
                "dead" => c::JobStatus::Dead,
                _ => return None,
            };
            Some(c::JobRow { id: row.id, kind: row.kind, subject: row.subject, status, attempts: row.attempts, max_attempts: row.max_attempts, run_at: row.run_at, last_error: row.last_error, schedule: row.schedule, finished_at: row.finished_at })
        })
        .collect();
    answer(&state, &c::JobsResponse { jobs })
}

/// Every recurring job: when it runs next, and the result of its last run.
#[utoipa::path(get, operation_id = "listSchedules", path = "/api/vx/v1/operate/schedules", tag = "operate", security(("bearer" = [])),
    responses((status = 200, body = c::SchedulesResponse), (status = 401, body = c::ErrorBody), (status = 503, body = c::ErrorBody)))]
pub(crate) async fn schedules(AxumState(state): AxumState<State>) -> Result<Json<serde_json::Value>, ApiError> {
    let rows = vx_jobs::schedules(&state.pool).await.map_err(ApiError::internal)?;
    let schedules = rows
        .into_iter()
        .map(|r| c::ScheduleRow { name: r.name, kind: r.kind, spec: r.spec, description: r.description, enabled: r.enabled, next_due: r.next_due, last_run_at: r.last_run_at, last_result: r.last_result, last_error: r.last_error })
        .collect();
    answer(&state, &c::SchedulesResponse { schedules })
}

/// Give a dead job another full set of attempts.
#[utoipa::path(post, operation_id = "retryJob", path = "/api/vx/v1/operate/jobs/{id}/retry", tag = "operate", security(("bearer" = [])),
    params(("id" = uuid::Uuid, Path, description = "The job to retry")),
    responses((status = 200, body = c::RetryResponse), (status = 401, body = c::ErrorBody), (status = 409, description = "Only a dead job can be retried", body = c::ErrorBody), (status = 422, body = c::ErrorBody), (status = 503, body = c::ErrorBody)))]
pub(crate) async fn retry(AxumState(state): AxumState<State>, ApiPath(id): ApiPath<uuid::Uuid>) -> Result<Json<serde_json::Value>, ApiError> {
    if vx_jobs::requeue(&state.pool, id).await.map_err(ApiError::internal)? {
        answer(&state, &c::RetryResponse { outcome: c::RetryOutcome::Requeued, id })
    } else {
        Err(ApiError::new(StatusCode::CONFLICT, "not_dead", "Only a dead job can be retried, and this one is not dead or does not exist."))
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ChainQuery {
    /// The audit chain, one per project.
    chain: String,
}

/// Re-compute a whole audit chain and report whether it is intact.
#[utoipa::path(get, operation_id = "verifyAuditChain", path = "/api/vx/v1/operate/audit/verify", tag = "operate", params(ChainQuery), security(("bearer" = [])),
    responses((status = 200, body = c::AuditVerifyResponse), (status = 401, body = c::ErrorBody), (status = 422, body = c::ErrorBody), (status = 503, body = c::ErrorBody)))]
pub(crate) async fn audit_verify(AxumState(state): AxumState<State>, ApiQuery(query): ApiQuery<ChainQuery>) -> Result<Json<serde_json::Value>, ApiError> {
    match vx_audit::verify(&state.pool, &query.chain).await {
        Ok(events) => answer(&state, &c::AuditVerifyResponse { chain: query.chain, intact: true, events: Some(events), first_altered_event: None }),
        Err(vx_audit::AuditError::Tampered { seq, .. }) => answer(&state, &c::AuditVerifyResponse { chain: query.chain, intact: false, events: None, first_altered_event: Some(seq) }),
        Err(error) => Err(ApiError::internal(error)),
    }
}

/// The audit events of a chain, newest first (up to 500). Metadata only: no value, no fingerprint.
#[utoipa::path(get, operation_id = "listAuditEvents", path = "/api/vx/v1/operate/audit/events", tag = "operate", params(ChainQuery), security(("bearer" = [])),
    responses((status = 200, body = c::AuditEventsResponse), (status = 401, body = c::ErrorBody), (status = 422, body = c::ErrorBody), (status = 503, body = c::ErrorBody)))]
pub(crate) async fn audit_events(AxumState(state): AxumState<State>, ApiQuery(query): ApiQuery<ChainQuery>) -> Result<Json<serde_json::Value>, ApiError> {
    let rows = vx_audit::list(&state.pool, &query.chain, 500).await.map_err(ApiError::internal)?;
    let events = rows
        .into_iter()
        .map(|r| c::AuditEvent { chain: r.chain, seq: r.seq, at: r.at, actor: r.actor, action: r.action, object_ref: r.object_ref, outcome: r.outcome, detail: r.detail, has_value_fingerprint: r.has_value_fingerprint })
        .collect();
    answer(&state, &c::AuditEventsResponse { chain: query.chain, events })
}
