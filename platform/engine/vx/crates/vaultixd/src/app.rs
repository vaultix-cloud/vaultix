//! The HTTP surface, `/api/vx/v1`. Errors are `{"code": "...", "error": "..."}`: a stable code and a
//! plain message. Every JSON answer passes the output gate before it leaves.

use axum::extract::{Path, Query, Request, State as AxumState};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::Arc;
use subtle::ConstantTimeEq;
use vx_gate::Gate;
use vx_keys::Keyring;

pub struct Inner {
    pool: PgPool,
    keyring: Option<Arc<Keyring>>,
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
    fn new(status: StatusCode, code: &'static str, message: &str) -> Self {
        Self { status, code, message: message.to_string() }
    }
    fn internal(error: impl std::fmt::Display) -> Self {
        tracing::error!(%error, "request failed");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", "Something went wrong on the server. It has been logged.")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "code": self.code, "error": self.message }))).into_response()
    }
}

/// Answer with JSON after the output gate has checked it. A blocked answer is replaced, never sent.
fn answer(state: &State, value: Value) -> Result<Json<Value>, ApiError> {
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
        .layer(middleware::from_fn_with_state(state.clone(), require_bootstrap_token));
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/vx/v1/status", get(status))
        .nest("/api/vx/v1/operate", operate)
        .with_state(state)
}

async fn require_bootstrap_token(AxumState(state): AxumState<State>, headers: HeaderMap, request: Request, next: Next) -> Result<Response, ApiError> {
    let Some(expected) = &state.bootstrap_token else {
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "not_configured", "These routes are off until a bootstrap token is set (VX_BOOTSTRAP_TOKEN)."));
    };
    let presented = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    if presented.as_bytes().ct_eq(expected.as_bytes()).unwrap_u8() != 1 {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized", "A valid bearer token is required."));
    }
    Ok(next.run(request).await)
}

async fn status(AxumState(state): AxumState<State>) -> Result<Json<Value>, ApiError> {
    let database = if sqlx::query("SELECT 1").execute(&state.pool).await.is_ok() { "ok" } else { "unavailable" };
    answer(&state, json!({ "product": "Vaultix", "version": env!("CARGO_PKG_VERSION"), "sealed": state.keyring.is_none(), "database": database }))
}

#[derive(Deserialize)]
struct JobsQuery {
    status: Option<String>,
    limit: Option<i64>,
}

async fn jobs(AxumState(state): AxumState<State>, Query(query): Query<JobsQuery>) -> Result<Json<Value>, ApiError> {
    if let Some(status) = &query.status {
        if !["queued", "running", "succeeded", "dead"].contains(&status.as_str()) {
            return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_status", "status must be queued, running, succeeded or dead."));
        }
    }
    let rows = vx_jobs::list(&state.pool, query.status.as_deref(), query.limit.unwrap_or(100)).await.map_err(ApiError::internal)?;
    answer(&state, json!({ "jobs": rows }))
}

async fn schedules(AxumState(state): AxumState<State>) -> Result<Json<Value>, ApiError> {
    let rows = vx_jobs::schedules(&state.pool).await.map_err(ApiError::internal)?;
    answer(&state, json!({ "schedules": rows }))
}

async fn retry(AxumState(state): AxumState<State>, Path(id): Path<uuid::Uuid>) -> Result<Json<Value>, ApiError> {
    if vx_jobs::requeue(&state.pool, id).await.map_err(ApiError::internal)? {
        answer(&state, json!({ "outcome": "requeued", "id": id }))
    } else {
        Err(ApiError::new(StatusCode::CONFLICT, "not_dead", "Only a dead job can be retried, and this one is not dead or does not exist."))
    }
}

#[derive(Deserialize)]
struct ChainQuery {
    chain: String,
}

async fn audit_verify(AxumState(state): AxumState<State>, Query(query): Query<ChainQuery>) -> Result<Json<Value>, ApiError> {
    match vx_audit::verify(&state.pool, &query.chain).await {
        Ok(events) => answer(&state, json!({ "chain": query.chain, "events": events, "intact": true })),
        Err(vx_audit::AuditError::Tampered { seq, .. }) => answer(&state, json!({ "chain": query.chain, "intact": false, "firstAlteredEvent": seq })),
        Err(error) => Err(ApiError::internal(error)),
    }
}
