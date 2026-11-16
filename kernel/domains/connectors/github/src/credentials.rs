//! GitHub credentials: a personal access token, or a GitHub App.
//!
//! The credential document is the JSON a connection stores sealed (`vx_connectors::open_credentials`):
//!
//! ```json
//! { "method": "pat", "token": "ghp_..." }
//! { "method": "app", "appId": "123456", "installationId": "78901234", "privateKey": "-----BEGIN RSA PRIVATE KEY-----..." }
//! ```
//!
//! Strings parsed out of it are held in `Zeroizing`, so they are wiped when dropped. Nothing here prints one.

use serde::Deserialize;
use vx_secret::Secret;
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CredentialError {
    #[error("the credentials are not a valid GitHub credential document")]
    Malformed,
    #[error("the credential method must be \"pat\" or \"app\"")]
    UnknownMethod,
    #[error("a required credential field is empty")]
    Empty,
    #[error("appId and installationId must be numbers")]
    NotNumeric,
}

#[derive(Deserialize)]
#[serde(tag = "method", rename_all = "lowercase", deny_unknown_fields)]
enum Raw {
    Pat {
        token: Zeroizing<String>,
    },
    App {
        #[serde(rename = "appId")]
        app_id: Zeroizing<String>,
        #[serde(rename = "installationId")]
        installation_id: Zeroizing<String>,
        #[serde(rename = "privateKey")]
        private_key: Zeroizing<String>,
    },
}

pub enum Auth {
    Pat { token: Zeroizing<String> },
    App { app_id: String, installation_id: String, private_key: Zeroizing<String> },
}

impl std::fmt::Debug for Auth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Auth::Pat { .. } => f.write_str("Auth::Pat(**redacted**)"),
            Auth::App { app_id, installation_id, .. } => write!(f, "Auth::App(app {app_id}, installation {installation_id}, key **redacted**)"),
        }
    }
}

impl Auth {
    /// Read a credential document. This is a value path: it reads the secret to parse it.
    #[allow(clippy::disallowed_methods)] // parsing the credential document is the point of this function
    pub fn parse(document: &Secret) -> Result<Self, CredentialError> {
        let raw: Raw = serde_json::from_slice(document.expose()).map_err(|error| {
            // serde's message can quote the input; say only which kind of failure it was.
            if error.to_string().contains("unknown variant") || error.to_string().contains("missing field `method`") {
                CredentialError::UnknownMethod
            } else {
                CredentialError::Malformed
            }
        })?;
        match raw {
            Raw::Pat { token } => {
                if token.trim().is_empty() {
                    return Err(CredentialError::Empty);
                }
                Ok(Auth::Pat { token })
            }
            Raw::App { app_id, installation_id, private_key } => {
                if app_id.trim().is_empty() || installation_id.trim().is_empty() || private_key.trim().is_empty() {
                    return Err(CredentialError::Empty);
                }
                if !app_id.chars().all(|c| c.is_ascii_digit()) || !installation_id.chars().all(|c| c.is_ascii_digit()) {
                    return Err(CredentialError::NotNumeric);
                }
                Ok(Auth::App { app_id: app_id.to_string(), installation_id: installation_id.to_string(), private_key })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(text: &str) -> Secret {
        Secret::from_string(text.to_string())
    }

    #[test]
    fn both_methods_parse() {
        assert!(matches!(Auth::parse(&doc(r#"{"method":"pat","token":"ghp_x"}"#)), Ok(Auth::Pat { .. })));
        let app = r#"{"method":"app","appId":"12","installationId":"34","privateKey":"-----BEGIN RSA PRIVATE KEY-----"}"#;
        assert!(matches!(Auth::parse(&doc(app)), Ok(Auth::App { .. })));
    }

    #[test]
    fn refusals_say_why_without_quoting_the_input() {
        let secret_text = "CANARY-should-not-be-echoed";
        let cases = [
            (format!(r#"{{"method":"oauth","token":"{secret_text}"}}"#), CredentialError::UnknownMethod),
            (format!(r#"{{"token":"{secret_text}"}}"#), CredentialError::UnknownMethod),
            (format!(r#"{{"method":"pat","token":"{secret_text}","extra":1}}"#), CredentialError::Malformed),
            (r#"{"method":"pat","token":"  "}"#.to_string(), CredentialError::Empty),
            (r#"{"method":"app","appId":"x1","installationId":"2","privateKey":"k"}"#.to_string(), CredentialError::NotNumeric),
            (r#"{"method":"app","appId":"1","installationId":"","privateKey":"k"}"#.to_string(), CredentialError::Empty),
            ("not json".to_string(), CredentialError::Malformed),
        ];
        for (text, expected) in cases {
            let error = Auth::parse(&doc(&text)).unwrap_err();
            assert_eq!(error, expected, "{text}");
            assert!(!format!("{error} {error:?}").contains("CANARY"));
        }
    }

    #[test]
    fn debug_never_prints_a_credential() {
        let auth = Auth::parse(&doc(r#"{"method":"pat","token":"ghp_CANARY"}"#)).unwrap();
        assert!(!format!("{auth:?}").contains("CANARY"));
        let app = Auth::parse(&doc(r#"{"method":"app","appId":"1","installationId":"2","privateKey":"PRIVATE-CANARY"}"#)).unwrap();
        assert!(!format!("{app:?}").contains("CANARY"));
    }
}
