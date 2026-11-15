//! Connectors: how Vaultix writes secrets into other systems (docs/0139).
//!
//! * `schema` and `plan` need no network and never see a value (names and keyed fingerprints only).
//! * `connector` is what a destination implements; its errors are a kind and a fixed code, never text.
//! * `engine` is the one sync path: record the plan first (fail closed), apply with retries, record the outcome.

mod connector;
mod engine;
mod plan;
mod schema;
mod store;

pub use connector::{Connector, ConnectorError, ErrorKind, Fingerprinter};
pub use engine::{sync, AuditSink, Failure, Report, RetryPolicy, SyncError, SyncRequest};
pub use plan::{plan, Entry, Plan, PlanOptions};
pub use schema::{KeySchema, SchemaError};
pub use store::{create_connection, create_sync, delete_connection, get_connection, list_connections, list_syncs, open_credentials, record_run, Connection, NewSync, PgAudit, StoreError, SyncRow};
