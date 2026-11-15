//! `/api/vx/v1/secrets`: the human writes a value, anyone listed sees metadata, and a value leaves
//! only by redeeming a single-use handle. The redeem answer is the one response that skips the output
//! gate, because it is the value path, and it is marked `no-store`.

use crate::app::{require_bootstrap_token, ApiError, State};
use axum::extract::{Path, Query, State as AxumState};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{post, put};
use axum::{Json, Router};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use vx_secret::Secret;
use vx_secrets::{Address, SecretsError};

const MAX_VALUE: usize = 64 * 1024;

pub fn router(state: State) -> Router<State> {
    Router::new()
        .route("/", put(write).get(list))
        .route("/requests", post(request_value))
        .route("/injections", post(create_injection))
        .route("/injections/{handle}/redeem", post(redeem))
        .layer(middleware::from_fn_with_state(state, require_bootstrap_token))
}

/// A value arriving in a request body goes straight into a `Secret`; it is never a plain `String` field.
struct SecretInput(Secret);

impl<'de> Deserialize<'de> for SecretInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self(Secret::from_string(String::deserialize(deserializer)?)))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteBody {
    project: String,
    environment: String,
    path: Option<String>,
    name: String,
    value: SecretInput,
}

fn actor(headers: &HeaderMap) -> Result<String, ApiError> {
    let given = headers.get("x-vx-actor").and_then(|v| v.to_str().ok()).unwrap_or("operator");
    let valid = !given.is_empty() && given.len() <= 64 && given.chars().all(|c| c.is_ascii_alphanumeric() || ":_.-".contains(c));
    if valid {
        Ok(given.to_string())
    } else {
        Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_actor", "X-Vx-Actor may hold letters, digits and : _ . - only, up to 64 characters."))
    }
}

fn map(error: SecretsError) -> ApiError {
    match error {
        SecretsError::InvalidAddress(message) => ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_address", &message),
        SecretsError::BadRefCount => ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "bad_ref_count", &error.to_string()),
        SecretsError::NotFound(name) => ApiError::new(StatusCode::NOT_FOUND, "not_found", &format!("Secret \"{name}\" does not exist in that project and environment.")),
        SecretsError::HandleInvalid => ApiError::new(StatusCode::GONE, "handle_invalid", &SecretsError::HandleInvalid.to_string()),
        other => ApiError::internal(other),
    }
}

fn unsealed(state: &State) -> Result<std::sync::Arc<vx_keys::Keyring>, ApiError> {
    state.keyring.clone().ok_or_else(|| ApiError::new(StatusCode::LOCKED, "sealed", "The instance is sealed. Start it with VX_ROOT_KEY_FILE to store or read secrets."))
}

async fn write(AxumState(state): AxumState<State>, headers: HeaderMap, Json(body): Json<WriteBody>) -> Result<Json<Value>, ApiError> {
    let ring = unsealed(&state)?;
    let actor = actor(&headers)?;
    if body.value.0.is_empty() || body.value.0.len() > MAX_VALUE {
        return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_value", "A value must be between 1 byte and 64 KiB."));
    }
    let address = Address::parse(&body.project, &body.environment, body.path.as_deref(), &body.name).map_err(map)?;
    let version = vx_secrets::put(&state.pool, &ring, &address, &body.value.0, &actor).await.map_err(map)?;
    Ok(Json(json!({ "outcome": "applied", "name": address.name, "version": version })))
}

#[derive(Deserialize)]
struct ListQuery {
    project: String,
    environment: String,
}

async fn list(AxumState(state): AxumState<State>, Query(query): Query<ListQuery>) -> Result<Json<Value>, ApiError> {
    Address::parse(&query.project, &query.environment, None, "X").map_err(map)?;
    let items = vx_secrets::list(&state.pool, &query.project, &query.environment).await.map_err(map)?;
    Ok(Json(json!({ "secrets": items })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddressBody {
    project: String,
    environment: String,
    path: Option<String>,
    name: String,
}

impl AddressBody {
    fn address(&self) -> Result<Address, ApiError> {
        Address::parse(&self.project, &self.environment, self.path.as_deref(), &self.name).map_err(map)
    }
}

#[derive(Deserialize)]
struct RequestBody {
    #[serde(flatten)]
    address: AddressBody,
    purpose: String,
}

async fn request_value(AxumState(state): AxumState<State>, headers: HeaderMap, Json(body): Json<RequestBody>) -> Result<Json<Value>, ApiError> {
    let address = body.address.address()?;
    vx_secrets::record_request(&state.pool, &address, &body.purpose, &actor(&headers)?).await.map_err(map)?;
    Ok(Json(json!({ "outcome": "requested", "name": address.name })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InjectionBody {
    purpose: String,
    secrets: Vec<AddressBody>,
    ttl_seconds: Option<i64>,
}

async fn create_injection(AxumState(state): AxumState<State>, headers: HeaderMap, Json(body): Json<InjectionBody>) -> Result<Response, ApiError> {
    let addresses = body.secrets.iter().map(AddressBody::address).collect::<Result<Vec<_>, _>>()?;
    let injection = vx_secrets::create_handle(&state.pool, &actor(&headers)?, &body.purpose, &addresses, body.ttl_seconds.unwrap_or(60)).await.map_err(map)?;
    // The handle is a permission for the trusted caller that asked, so this answer skips the gate's handle rule.
    Ok(no_store(Json(json!({ "handle": injection.handle, "expiresAt": injection.expires_at })).into_response()))
}

async fn redeem(AxumState(state): AxumState<State>, headers: HeaderMap, Path(handle): Path<String>) -> Result<Response, ApiError> {
    let ring = unsealed(&state)?;
    let values = vx_secrets::redeem(&state.pool, &ring, &actor(&headers)?, &handle).await.map_err(map)?;
    Ok(no_store(Json(vx_secrets::render_for_trusted_client(&values)).into_response()))
}

fn no_store(mut response: Response) -> Response {
    response.headers_mut().insert(header::CACHE_CONTROL, header::HeaderValue::from_static("no-store"));
    response
}
