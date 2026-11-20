//! The credential boundary: setup/login receive credentials; only login returns a bearer, with
//! no-store. All identity elsewhere comes from the durable session, never an actor header.
use crate::app::{answer, ApiError, State};
use crate::extract::ApiJson;
use axum::{extract::{State as AxumState, Request}, http::{header,StatusCode}, middleware::Next, response::{IntoResponse,Response}, Extension, Json};
use vx_auth::{AuthError,Principal};
use vx_contract as c;

pub(crate) fn map(error:AuthError)->ApiError {
    let (status,code)=match error {
        AuthError::Unauthorized=>(StatusCode::UNAUTHORIZED,"unauthorized"),
        AuthError::Forbidden=>(StatusCode::FORBIDDEN,"forbidden"),
        AuthError::Initialized=>(StatusCode::CONFLICT,"already_initialized"),
        AuthError::SetupInvalid=>(StatusCode::FORBIDDEN,"setup_invalid"),
        AuthError::InvalidInput=>(StatusCode::UNPROCESSABLE_ENTITY,"invalid_credentials"),
        AuthError::RateLimited=>(StatusCode::TOO_MANY_REQUESTS,"rate_limited"),
        AuthError::Unavailable=>(StatusCode::SERVICE_UNAVAILABLE,"auth_unavailable"),
    };
    ApiError::new(status,code,&error.to_string())
}

pub(crate) async fn require_session(AxumState(state):AxumState<State>,mut request:Request,next:Next)->Result<Response,ApiError> {
    let token=request.headers().get(header::AUTHORIZATION).and_then(|h|h.to_str().ok()).and_then(|h|h.strip_prefix("Bearer ")).unwrap_or("");
    let who=vx_auth::authenticate(&state.pool,token).await.map_err(map)?;
    request.extensions_mut().insert(who);
    Ok(no_store(next.run(request).await))
}

pub(crate) async fn require_owner(Extension(who):Extension<Principal>,request:Request,next:Next)->Result<Response,ApiError> {
    if !who.is_owner { return Err(map(AuthError::Forbidden)); }
    Ok(next.run(request).await)
}

pub(crate) fn no_store(mut response:Response)->Response {
    response.headers_mut().insert(header::CACHE_CONTROL,header::HeaderValue::from_static("no-store"));
    response
}

#[utoipa::path(post,operation_id="setupOwner",path="/api/vx/v1/auth/setup",tag="auth",request_body=c::SetupOwnerRequest,
 responses((status=200,body=c::OwnerResponse),(status=403,body=c::ErrorBody),(status=409,body=c::ErrorBody),(status=422,body=c::ErrorBody),(status=429,body=c::ErrorBody),(status=503,body=c::ErrorBody)))]
pub(crate) async fn setup(AxumState(state):AxumState<State>,ApiJson(body):ApiJson<c::SetupOwnerRequest>)->Result<Response,ApiError> {
    let _permit=state.auth_limit.try_acquire().map_err(|_|map(AuthError::RateLimited))?;
    vx_auth::throttle(&state.pool).await.map_err(map)?;
    vx_secrets::Address::parse(&body.project,&body.environment,None,"X").map_err(|_|ApiError::new(StatusCode::UNPROCESSABLE_ENTITY,"invalid_scope","Choose a valid project and environment."))?;
    let user_id=vx_auth::setup(&state.pool,&body.setup_code,&body.email,body.password.0,&body.organization_name,&body.project,&body.environment).await.map_err(map)?;
    Ok(no_store(answer(&state,&c::OwnerResponse{user_id})?.into_response()))
}

#[utoipa::path(post,operation_id="createSession",path="/api/vx/v1/auth/sessions",tag="auth",request_body=c::LoginRequest,
 responses((status=200,body=c::SessionResponse),(status=401,body=c::ErrorBody),(status=422,body=c::ErrorBody),(status=429,body=c::ErrorBody),(status=503,body=c::ErrorBody)))]
pub(crate) async fn login(AxumState(state):AxumState<State>,ApiJson(body):ApiJson<c::LoginRequest>)->Result<Response,ApiError> {
    let _permit=state.auth_limit.try_acquire().map_err(|_|map(AuthError::RateLimited))?;
    vx_auth::throttle(&state.pool).await.map_err(map)?;
    let session=vx_auth::login(&state.pool,&body.email,body.password.0).await.map_err(map)?;
    // Explicit credential output, only to the authenticating client. No general output-gate bypass.
    Ok(no_store(Json(c::SessionResponse{bearer:session.bearer,expires_at:session.expires_at,user_id:session.principal.user_id,organization_id:session.principal.organization_id}).into_response()))
}

#[utoipa::path(post,operation_id="revokeSession",path="/api/vx/v1/auth/logout",tag="auth",security(("bearer"=[])),
 responses((status=200,body=c::LogoutResponse),(status=401,body=c::ErrorBody),(status=503,body=c::ErrorBody)))]
pub(crate) async fn logout(AxumState(state):AxumState<State>,Extension(who):Extension<Principal>)->Result<Json<serde_json::Value>,ApiError> {
    vx_auth::logout(&state.pool,&who).await.map_err(map)?;
    answer(&state,&c::LogoutResponse{revoked:true})
}
