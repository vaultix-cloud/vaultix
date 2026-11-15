//! The OpenAPI 3.1 document for `/api/vx/v1`, generated from the contract types and the annotated
//! handlers. `vaultixd openapi` prints it; `kernel/contracts/v1/openapi.json` is that output, checked in,
//! and a test fails when the two differ.

use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};
use vx_contract as c;

struct Bearer;

impl Modify for Bearer {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer",
                SecurityScheme::Http(HttpBuilder::new().scheme(HttpAuthScheme::Bearer).description(Some("A bootstrap token until the identity domain exists (docs/0136).")).build()),
            );
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Vaultix API",
        version = "0.5.0-alpha",
        description = "The one Vaultix API. During the 0.5 alpha the contract can still change, and when it does this document, the generated validators, the server and the contract tests change in the same commit. There are no older versions."
    ),
    servers((url = "/")),
    paths(
        crate::app::status,
        crate::app::jobs,
        crate::app::schedules,
        crate::app::retry,
        crate::app::audit_verify,
        crate::app::audit_events,
        crate::secrets::write,
        crate::secrets::list,
        crate::secrets::request_value,
        crate::secrets::create_injection,
        crate::secrets::redeem,
    ),
    components(schemas(
        c::ErrorBody, c::DatabaseState, c::StatusResponse, c::SecretAddress, c::PutSecretRequest, c::PutOutcome, c::PutSecretResponse,
        c::SecretMeta, c::ListSecretsResponse, c::ValueRequest, c::RequestOutcome, c::ValueRequestResponse, c::InjectionRequest,
        c::InjectionResponse, c::ValueEncoding, c::RedeemedValue, c::RedeemResponse, c::JobStatus, c::JobRow, c::JobsResponse,
        c::ScheduleRow, c::SchedulesResponse, c::RetryOutcome, c::RetryResponse, c::AuditVerifyResponse, c::AuditEvent, c::AuditEventsResponse
    )),
    modifiers(&Bearer),
    tags(
        (name = "status", description = "Whether the instance is up and unsealed"),
        (name = "secrets", description = "Store a secret, list metadata, and read a value only by redeeming a handle"),
        (name = "operate", description = "Background work and the audit trail")
    )
)]
pub struct ApiDoc;

/// The document as pretty JSON with a trailing newline, exactly as it is checked in.
pub fn document() -> String {
    let mut text = ApiDoc::openapi().to_pretty_json().unwrap_or_default();
    text.push('\n');
    text
}
