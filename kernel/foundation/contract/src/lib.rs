//! The v1 contract: every request and response of `/api/vx/v1` as a typed Rust struct. The server
//! builds its answers from these types, the OpenAPI document is generated from them, and the
//! TypeScript validators are generated from that document. There is one definition of each shape.
//!
//! JSON is camelCase. Errors are always `{ "code", "error" }`: a stable code and a plain message.
//! No type here can carry a secret value except `PutSecretRequest.value` (in) and
//! `RedeemedValue.value` (out of a redeem), which are marked write-only and read-only in the schema.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use utoipa::openapi::schema::{ObjectBuilder, SchemaFormat, SchemaType, Type};
use utoipa::openapi::{KnownFormat, RefOr, Schema};
use utoipa::{PartialSchema, ToSchema};
use uuid::Uuid;
use vx_secret::Secret;

/// A value arriving in a request body: it goes straight into a `Secret`, never into a plain `String`
/// field. In the schema it is a write-only password string.
pub struct SecretText(pub Secret);

impl<'de> Deserialize<'de> for SecretText {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self(Secret::from_string(String::deserialize(deserializer)?)))
    }
}

impl PartialSchema for SecretText {
    fn schema() -> RefOr<Schema> {
        ObjectBuilder::new()
            .schema_type(SchemaType::Type(Type::String))
            .format(Some(SchemaFormat::KnownFormat(KnownFormat::Password)))
            .min_length(Some(1))
            .max_length(Some(65536))
            .write_only(Some(true))
            .description(Some("The secret value. Accepted here and never returned by any other operation."))
            .into()
    }
}
impl ToSchema for SecretText {}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ErrorBody {
    /// A stable, machine-readable code such as `unauthorized` or `handle_invalid`.
    pub code: String,
    /// A plain sentence for a person.
    pub error: String,
}

// ---- status ---------------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseState {
    Ok,
    Unavailable,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    #[schema(example = "Vaultix")]
    pub product: String,
    pub version: String,
    /// True until a root key is supplied; a sealed instance stores and reads no secrets.
    pub sealed: bool,
    pub database: DatabaseState,
}

// ---- secrets --------------------------------------------------------------------------------

/// Where a secret lives. Names are environment-variable safe so they can be injected as they are.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SecretAddress {
    #[schema(pattern = "^[a-z0-9][a-z0-9-]{0,62}$", example = "payments")]
    pub project: String,
    #[schema(pattern = "^[a-z0-9][a-z0-9-]{0,62}$", example = "prod")]
    pub environment: String,
    /// Starts with `/`; defaults to `/`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(example = "/")]
    pub path: Option<String>,
    #[schema(pattern = "^[A-Za-z_][A-Za-z0-9_]{0,127}$", example = "API_TOKEN")]
    pub name: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PutSecretRequest {
    #[schema(pattern = "^[a-z0-9][a-z0-9-]{0,62}$", example = "payments")]
    pub project: String,
    #[schema(pattern = "^[a-z0-9][a-z0-9-]{0,62}$", example = "prod")]
    pub environment: String,
    /// Starts with `/`; defaults to `/`.
    #[serde(default)]
    pub path: Option<String>,
    #[schema(pattern = "^[A-Za-z_][A-Za-z0-9_]{0,127}$", example = "API_TOKEN")]
    pub name: String,
    pub value: SecretText,
}

impl PutSecretRequest {
    pub fn address(&self) -> SecretAddress {
        SecretAddress { project: self.project.clone(), environment: self.environment.clone(), path: self.path.clone(), name: self.name.clone() }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PutOutcome {
    Applied,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutSecretResponse {
    pub outcome: PutOutcome,
    pub name: String,
    pub version: i32,
}

/// What anyone sees of a secret: never the value.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SecretMeta {
    pub name: String,
    pub path: String,
    pub version: i32,
    pub updated_at: DateTime<Utc>,
    pub updated_by: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ListSecretsResponse {
    pub secrets: Vec<SecretMeta>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValueRequest {
    #[schema(pattern = "^[a-z0-9][a-z0-9-]{0,62}$", example = "payments")]
    pub project: String,
    #[schema(pattern = "^[a-z0-9][a-z0-9-]{0,62}$", example = "prod")]
    pub environment: String,
    #[serde(default)]
    pub path: Option<String>,
    #[schema(pattern = "^[A-Za-z_][A-Za-z0-9_]{0,127}$", example = "API_TOKEN")]
    pub name: String,
    /// Why the value is needed; recorded, up to 200 characters.
    pub purpose: String,
}

impl ValueRequest {
    pub fn address(&self) -> SecretAddress {
        SecretAddress { project: self.project.clone(), environment: self.environment.clone(), path: self.path.clone(), name: self.name.clone() }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum RequestOutcome {
    Requested,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ValueRequestResponse {
    pub outcome: RequestOutcome,
    pub name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InjectionRequest {
    pub purpose: String,
    #[schema(min_items = 1, max_items = 32)]
    pub secrets: Vec<SecretAddress>,
    /// Seconds the handle stays valid; clamped to 5 to 300, default 60.
    #[serde(default)]
    pub ttl_seconds: Option<i64>,
}

/// A permission to read named secrets once, for the identity that asked. It is not a value.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InjectionResponse {
    pub handle: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ValueEncoding {
    Utf8,
    Base64url,
}

/// One redeemed value. This is the only response in the API that carries a secret value; it goes to
/// the trusted client that redeemed the handle and is sent `Cache-Control: no-store`.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RedeemedValue {
    pub name: String,
    pub path: String,
    #[schema(read_only)]
    pub value: String,
    pub encoding: ValueEncoding,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RedeemResponse {
    pub values: Vec<RedeemedValue>,
}

// ---- operate --------------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Dead,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobRow {
    pub id: Uuid,
    pub kind: String,
    pub subject: String,
    pub status: JobStatus,
    pub attempts: i32,
    pub max_attempts: i32,
    pub run_at: DateTime<Utc>,
    pub last_error: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct JobsResponse {
    pub jobs: Vec<JobRow>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRow {
    pub name: String,
    pub kind: String,
    /// A five-field cron expression (UTC) or `@every 5m`.
    pub spec: String,
    pub description: String,
    pub enabled: bool,
    pub next_due: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_result: String,
    pub last_error: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SchedulesResponse {
    pub schedules: Vec<ScheduleRow>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum RetryOutcome {
    Requeued,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RetryResponse {
    pub outcome: RetryOutcome,
    pub id: Uuid,
}

/// The result of re-computing an audit chain. When it is intact `events` is the number of events;
/// when it is not, `firstAlteredEvent` is the first sequence number that does not verify.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditVerifyResponse {
    pub chain: String,
    pub intact: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub events: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_altered_event: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    pub chain: String,
    pub seq: i64,
    pub at: DateTime<Utc>,
    pub actor: String,
    pub action: String,
    pub object_ref: String,
    pub outcome: String,
    #[schema(value_type = Object)]
    pub detail: Value,
    /// True when the event carries a keyed fingerprint of a value; the fingerprint itself is never shown.
    pub has_value_fingerprint: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AuditEventsResponse {
    pub chain: String,
    pub events: Vec<AuditEvent>,
}
