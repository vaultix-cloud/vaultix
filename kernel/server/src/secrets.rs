//! `/api/vx/v1/secrets`: the human writes a value, anyone listed sees metadata, and a value leaves
//! only by redeeming a single-use handle. The redeem answer is the one response that skips the output
//! gate, because it is the value path, and it is marked `no-store`.

use crate::app::{answer, ApiError, State};
use crate::auth::{require_session, map as auth_error};
use crate::extract::{ApiJson, ApiPath, ApiQuery};
use axum::extract::State as AxumState;
use axum::http::{header, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{post, put};
use axum::{Json, Extension};
use vx_auth::Principal;
use axum::Router;
use serde::Deserialize;
use utoipa::IntoParams;
use vx_contract as c;
use vx_secrets::{Address, SecretsError};

const MAX_VALUE: usize = 64 * 1024;

pub fn router(state: State) -> Router<State> {
    Router::new()
        .route("/", put(write).get(list))
        .route("/requests", post(request_value))
        .route("/injections", post(create_injection))
        .route("/injections/{handle}/redeem", post(redeem))
        .layer(middleware::from_fn_with_state(state, require_session))
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

fn address(from: &c::SecretAddress) -> Result<Address, ApiError> {
    Address::parse(&from.project, &from.environment, from.path.as_deref(), &from.name).map_err(map)
}

/// Store a new version of a secret. This is the human's operation: the value is entered at a person's
/// own terminal with `vx set`, never through an AI client, and is never returned by any operation but a redeem.
#[utoipa::path(put, operation_id = "putSecret", path = "/api/vx/v1/secrets", tag = "secrets", security(("bearer" = [])),
    request_body = c::PutSecretRequest,
    responses((status = 200, body = c::PutSecretResponse), (status = 401, body = c::ErrorBody), (status = 422, body = c::ErrorBody), (status = 423, description = "The instance is sealed", body = c::ErrorBody), (status = 503, body = c::ErrorBody)))]
pub(crate) async fn write(AxumState(state): AxumState<State>, Extension(who): Extension<Principal>, ApiJson(body): ApiJson<c::PutSecretRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    let ring = unsealed(&state)?;
    let actor = who.actor();
    if body.value.0.is_empty() || body.value.0.len() > MAX_VALUE {
        return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_value", "A value must be between 1 byte and 64 KiB."));
    }
    let address = address(&body.address())?;
    vx_auth::authorize(&state.pool,&who,&address.project,&address.environment,"secrets.write").await.map_err(auth_error)?;
    let version = vx_secrets::put(&state.pool, &ring, &address, &body.value.0, &actor).await.map_err(map)?;
    answer(&state, &c::PutSecretResponse { outcome: c::PutOutcome::Applied, name: address.name, version })
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct ListQuery {
    project: String,
    environment: String,
}

/// The secrets in a project environment: names, paths, versions and who last changed them. Never values.
#[utoipa::path(get, operation_id = "listSecrets", path = "/api/vx/v1/secrets", tag = "secrets", params(ListQuery), security(("bearer" = [])),
    responses((status = 200, body = c::ListSecretsResponse), (status = 401, body = c::ErrorBody), (status = 422, body = c::ErrorBody), (status = 503, body = c::ErrorBody)))]
pub(crate) async fn list(AxumState(state): AxumState<State>, Extension(who): Extension<Principal>, ApiQuery(query): ApiQuery<ListQuery>) -> Result<Json<serde_json::Value>, ApiError> {
    Address::parse(&query.project, &query.environment, None, "X").map_err(map)?;
    vx_auth::authorize(&state.pool,&who,&query.project,&query.environment,"secrets.list").await.map_err(auth_error)?;
    let items = vx_secrets::list(&state.pool, &query.project, &query.environment).await.map_err(map)?;
    let secrets = items.into_iter().map(|m| c::SecretMeta { name: m.name, path: m.path, version: m.version, updated_at: m.updated_at, updated_by: m.updated_by }).collect();
    answer(&state, &c::ListSecretsResponse { secrets })
}

/// Record that a person is asked to supply a missing value. Nothing is stored but the request.
#[utoipa::path(post, operation_id = "requestSecretValue", path = "/api/vx/v1/secrets/requests", tag = "secrets", security(("bearer" = [])),
    request_body = c::ValueRequest,
    responses((status = 200, body = c::ValueRequestResponse), (status = 401, body = c::ErrorBody), (status = 422, body = c::ErrorBody), (status = 503, body = c::ErrorBody)))]
pub(crate) async fn request_value(AxumState(state): AxumState<State>, Extension(who): Extension<Principal>, ApiJson(body): ApiJson<c::ValueRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    let address = address(&body.address())?;
    vx_auth::authorize(&state.pool,&who,&address.project,&address.environment,"secrets.request").await.map_err(auth_error)?;
    vx_secrets::record_request(&state.pool, &address, &body.purpose, &who.actor()).await.map_err(map)?;
    answer(&state, &c::ValueRequestResponse { outcome: c::RequestOutcome::Requested, name: address.name })
}

/// Ask for a handle that lets the caller read the named secrets once. The handle is a permission, not a
/// value: single use, short lived and bound to the identity that asked.
#[utoipa::path(post, operation_id = "createInjection", path = "/api/vx/v1/secrets/injections", tag = "secrets", security(("bearer" = [])),
    request_body = c::InjectionRequest,
    responses((status = 200, body = c::InjectionResponse), (status = 401, body = c::ErrorBody), (status = 404, description = "A named secret does not exist", body = c::ErrorBody), (status = 422, body = c::ErrorBody), (status = 503, body = c::ErrorBody)))]
pub(crate) async fn create_injection(AxumState(state): AxumState<State>, Extension(who): Extension<Principal>, ApiJson(body): ApiJson<c::InjectionRequest>) -> Result<Response, ApiError> {
    let addresses = body.secrets.iter().map(address).collect::<Result<Vec<_>, _>>()?;
    if addresses.is_empty() || addresses.len()>32 { return Err(map(SecretsError::BadRefCount)); }
    for a in &addresses { vx_auth::authorize(&state.pool,&who,&a.project,&a.environment,"secrets.inject").await.map_err(auth_error)?; }
    let injection = vx_secrets::create_handle(&state.pool, &who.handle_identity(), &body.purpose, &addresses, body.ttl_seconds.unwrap_or(60)).await.map_err(map)?;
    // The handle is a permission for the trusted caller that asked, so this answer skips the gate's handle rule.
    Ok(no_store(Json(c::InjectionResponse { handle: injection.handle, expires_at: injection.expires_at }).into_response()))
}

/// Redeem a handle: once, for the identity it was made for. The only operation that returns a value.
/// An unknown, used, expired or wrong-identity handle all answer the same way.
#[utoipa::path(post, operation_id = "redeemInjection", path = "/api/vx/v1/secrets/injections/{handle}/redeem", tag = "secrets", security(("bearer" = [])),
    params(("handle" = String, Path, description = "The handle from `POST /secrets/injections`; bound to the issuing session")),
    responses((status = 200, description = "The values, sent with Cache-Control: no-store", body = c::RedeemResponse), (status = 401, body = c::ErrorBody), (status = 410, description = "The handle is not valid", body = c::ErrorBody), (status = 423, body = c::ErrorBody), (status = 503, body = c::ErrorBody)))]
pub(crate) async fn redeem(AxumState(state): AxumState<State>, Extension(who): Extension<Principal>, ApiPath(handle): ApiPath<String>) -> Result<Response, ApiError> {
    let ring = unsealed(&state)?;
    let identity=who.handle_identity();
    for a in vx_secrets::handle_addresses(&state.pool,&identity,&handle).await.map_err(map)? {
        vx_auth::authorize(&state.pool,&who,&a.project,&a.environment,"secrets.inject").await.map_err(auth_error)?;
    }
    let values = vx_secrets::redeem(&state.pool, &ring, &identity, &handle).await.map_err(map)?;
    Ok(no_store(Json(vx_secrets::render_for_trusted_client(&values)).into_response()))
}

fn no_store(mut response: Response) -> Response {
    response.headers_mut().insert(header::CACHE_CONTROL, header::HeaderValue::from_static("no-store"));
    response
}
