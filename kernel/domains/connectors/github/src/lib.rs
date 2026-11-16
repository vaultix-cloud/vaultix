//! The GitHub connector (docs/0139): Actions secrets for a repository, a repository environment or an organisation,
//! authenticated by a personal access token or by a GitHub App installation.

mod credentials;
mod provider;

pub use credentials::{Auth, CredentialError};
pub use provider::{ApiBase, ConfigError, GitHub, Target, Visibility};
