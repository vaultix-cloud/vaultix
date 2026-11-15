//! Connectors: how Vaultix writes secrets into other systems (docs/0139).
//!
//! This crate holds the parts every destination shares and that need no network: the key schema and the sync plan.
//! Neither ever sees a secret value. The planner works on keyed fingerprints, so a bug here cannot leak one.

mod plan;
mod schema;

pub use plan::{plan, Entry, Plan, PlanOptions};
pub use schema::{KeySchema, SchemaError};
