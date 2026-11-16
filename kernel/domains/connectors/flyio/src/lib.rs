//! The Fly.io connector (docs/0139): an app's secrets, written through Fly's GraphQL API, and an optional redeploy of the app's
//! machines so they start with the new release.
//!
//! * All writes are one call each (`setSecrets`, `unsetSecrets`), because Fly makes a release per call. Writing secrets one
//!   at a time would be a release, and with redeploy a restart, per secret.
//! * Fly's API has no way to send a value sealed: it travels in the request body over TLS and nowhere else. It is never in a
//!   URL, a log line, an error or an audit row.
//! * Fly reports GraphQL failures as HTTP 200 with an `errors` array. That text is read only to choose a code and is dropped.
//! * One fixed pair of hosts, no redirects, failures as a kind and a fixed code.

use reqwest::header::{HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::{redirect::Policy, Client, Method, Response, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use vx_connectors::{Connector, ConnectorError, Entry, ErrorKind, Fingerprinter};
use vx_secret::Secret;
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("the credentials are not a valid Fly.io credential document")]
    Credentials,
    #[error("the access token is empty")]
    EmptyToken,
    #[error("the app id is not valid")]
    AppId,
    #[error("the HTTP client could not be built")]
    Client,
}

/// The two API hosts. Fixed at construction; nothing a response says can change them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlyBase {
    graphql: String,
    machines: String,
}

impl FlyBase {
    pub fn fly_io() -> Self {
        Self { graphql: "https://api.fly.io/graphql".into(), machines: "https://api.machines.dev/v1".into() }
    }

    /// A server on this machine, over plain http, for tests.
    pub fn loopback(port: u16) -> Self {
        Self { graphql: format!("http://127.0.0.1:{port}/graphql"), machines: format!("http://127.0.0.1:{port}/v1") }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCredentials {
    #[serde(rename = "accessToken")]
    access_token: Zeroizing<String>,
}

fn plain_name(text: &str) -> bool {
    !text.is_empty() && text.len() <= 100 && text.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// A name Fly accepts as an environment variable.
fn valid_secret_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_') && name.len() <= 255 && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub struct Fly {
    http: Client,
    base: FlyBase,
    authorization: HeaderValue,
    app_id: String,
    redeploy: bool,
    /// The newest release number Fly returned from a write; machines are redeployed to at least this one. Zero means none.
    release: AtomicU64,
}

impl Fly {
    /// `credentials` is `{"accessToken":"..."}`. This is a value path: it reads the secret to parse it.
    #[allow(clippy::disallowed_methods)] // parsing the credential document is the point of this function
    pub fn new(credentials: &Secret, app_id: &str, redeploy: bool, base: FlyBase) -> Result<Self, ConfigError> {
        let raw: RawCredentials = serde_json::from_slice(credentials.expose()).map_err(|_| ConfigError::Credentials)?;
        if raw.access_token.trim().is_empty() {
            return Err(ConfigError::EmptyToken);
        }
        if !plain_name(app_id) {
            return Err(ConfigError::AppId);
        }
        let mut authorization = HeaderValue::from_str(&format!("Bearer {}", raw.access_token.as_str())).map_err(|_| ConfigError::Credentials)?;
        authorization.set_sensitive(true);
        let http = Client::builder().redirect(Policy::none()).timeout(Duration::from_secs(30)).build().map_err(|_| ConfigError::Client)?;
        Ok(Self { http, base, authorization, app_id: app_id.to_string(), redeploy, release: AtomicU64::new(0) })
    }

    async fn send(&self, method: Method, url: &str, body: Option<Value>, timeout: Option<Duration>) -> Result<Response, ConnectorError> {
        let mut request = self.http.request(method, url).header(AUTHORIZATION, self.authorization.clone()).header(ACCEPT, "application/json").header(USER_AGENT, "vaultix-connector");
        if let Some(json) = body {
            request = request.json(&json);
        }
        if let Some(timeout) = timeout {
            request = request.timeout(timeout);
        }
        let response = request.send().await.map_err(|error| if error.is_timeout() || error.is_connect() { ConnectorError::new(ErrorKind::Transient, "network") } else { ConnectorError::new(ErrorKind::Rejected, "request_failed") })?;
        let status = response.status();
        if status.is_success() { Ok(response) } else { Err(classify_status(status, response.headers())) }
    }

    /// One GraphQL call. Returns `data`; turns an `errors` array into a code and drops its text.
    async fn graphql(&self, query: &str, variables: Value) -> Result<Value, ConnectorError> {
        let response = self.send(Method::POST, &self.base.graphql, Some(json!({ "query": query, "variables": variables })), None).await?;
        let body: Value = response.json().await.map_err(|_| ConnectorError::new(ErrorKind::Rejected, "unexpected_response"))?;
        if let Some(errors) = body["errors"].as_array().filter(|e| !e.is_empty()) {
            return Err(classify_graphql(errors));
        }
        Ok(body["data"].clone())
    }

    fn remember_release(&self, data: &Value, mutation: &str) {
        if let Some(version) = data[mutation]["release"]["version"].as_u64() {
            self.release.fetch_max(version, Ordering::SeqCst);
        }
    }

    /// Is the token good? Used by the screen's "test connection".
    pub async fn check(&self) -> Result<(), ConnectorError> {
        let data = self.graphql("query { viewer { id email } }", json!({})).await?;
        if data["viewer"].is_null() {
            return Err(ConnectorError::new(ErrorKind::Auth, "bad_credentials"));
        }
        Ok(())
    }

    async fn machine_calls(&self) -> Result<(), ConnectorError> {
        let data = self.graphql("query GetAppName($appId: String!) { app(id: $appId) { name } }", json!({ "appId": self.app_id })).await?;
        let name = data["app"]["name"].as_str().ok_or(ConnectorError::new(ErrorKind::NotFound, "target_not_found"))?.to_string();
        if !plain_name(&name) {
            return Err(ConnectorError::new(ErrorKind::Rejected, "unexpected_response"));
        }
        let machines_url = format!("{}/apps/{name}/machines", self.base.machines);
        let list: Value = self.send(Method::GET, &machines_url, None, None).await?.json().await.map_err(|_| ConnectorError::new(ErrorKind::Rejected, "unexpected_response"))?;
        let release = self.release.load(Ordering::SeqCst);
        let mut failures = 0;
        for machine in list.as_array().cloned().unwrap_or_default() {
            let state = machine["state"].as_str().unwrap_or("");
            let (Some(id), Some(region)) = (machine["id"].as_str(), machine["region"].as_str()) else { continue };
            if matches!(state, "destroyed" | "destroying") || machine["config"].is_null() || !plain_name(id) {
                continue;
            }
            let mut body = json!({ "config": machine["config"], "region": region, "skip_launch": false });
            if release > 0 {
                body["min_secrets_version"] = json!(release);
            }
            let updated = self.send(Method::POST, &format!("{machines_url}/{id}"), Some(body), None).await;
            let waited = match updated {
                Ok(_) => self.send(Method::GET, &format!("{machines_url}/{id}/wait?state=started&timeout=60"), None, Some(Duration::from_secs(90))).await.map(|_| ()),
                Err(error) => Err(error),
            };
            if waited.is_err() {
                failures += 1; // keep going: one stuck machine must not leave the others on the old release
            }
        }
        if failures > 0 { Err(ConnectorError::new(ErrorKind::Rejected, "redeploy_partial")) } else { Ok(()) }
    }
}

fn classify_status(status: StatusCode, headers: &reqwest::header::HeaderMap) -> ConnectorError {
    let retry_after = headers.get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u32>().ok()).map(|s| s.min(3600));
    let transient = |code: &'static str| {
        let error = ConnectorError::new(ErrorKind::Transient, code);
        retry_after.map_or(error, |s| error.retry_after(s))
    };
    match status {
        StatusCode::UNAUTHORIZED => ConnectorError::new(ErrorKind::Auth, "bad_credentials"),
        StatusCode::FORBIDDEN => ConnectorError::new(ErrorKind::Auth, "forbidden"),
        StatusCode::NOT_FOUND => ConnectorError::new(ErrorKind::NotFound, "target_not_found"),
        StatusCode::TOO_MANY_REQUESTS => transient("rate_limited"),
        StatusCode::REQUEST_TIMEOUT => transient("timeout"),
        s if s.is_server_error() => transient("server_error"),
        s if s.is_redirection() => ConnectorError::new(ErrorKind::Rejected, "unexpected_redirect"),
        _ => ConnectorError::new(ErrorKind::Rejected, "unexpected_status"),
    }
}

/// Fly reports GraphQL failures in the body of a 200. The messages are read only to pick a code, then dropped.
fn classify_graphql(errors: &[Value]) -> ConnectorError {
    let text = errors.iter().filter_map(|e| e["message"].as_str()).collect::<Vec<_>>().join(" ").to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| text.contains(n));
    if has(&["rate limit", "too many requests"]) {
        ConnectorError::new(ErrorKind::Transient, "rate_limited")
    } else if has(&["unauthorized", "not authorized", "unauthenticated", "permission", "access denied", "forbidden", "invalid token"]) {
        ConnectorError::new(ErrorKind::Auth, "forbidden")
    } else if has(&["could not find", "not found"]) {
        ConnectorError::new(ErrorKind::NotFound, "target_not_found")
    } else {
        ConnectorError::new(ErrorKind::Rejected, "graphql_error")
    }
}

impl Connector for Fly {
    fn id(&self) -> &'static str {
        "flyio"
    }

    fn accepts_name(&self, name: &str) -> Result<(), ConnectorError> {
        if valid_secret_name(name) { Ok(()) } else { Err(ConnectorError::new(ErrorKind::Rejected, "invalid_secret_name")) }
    }

    fn batches_writes(&self) -> bool {
        true
    }

    async fn list(&self, _: &Fingerprinter) -> Result<Vec<Entry>, ConnectorError> {
        // Fly's REST machines list can return an empty array in some cases; the GraphQL listing is the reliable one.
        let data = self.graphql("query GetAppSecrets($appId: String!) { app(id: $appId) { secrets { name } } }", json!({ "appId": self.app_id })).await?;
        let secrets = data["app"]["secrets"].as_array().ok_or(ConnectorError::new(ErrorKind::NotFound, "target_not_found"))?;
        // Fly never returns a value, so there is no fingerprint: every secret is rewritten on every sync
        Ok(secrets.iter().filter_map(|s| s["name"].as_str()).map(|name| Entry { name: name.to_string(), fingerprint: None }).collect())
    }

    async fn put(&self, name: &str, value: &Secret) -> Result<(), ConnectorError> {
        self.put_batch(&[(name.to_string(), value)]).await
    }

    async fn delete(&self, name: &str) -> Result<(), ConnectorError> {
        self.delete_batch(&[name.to_string()]).await
    }

    #[allow(clippy::disallowed_methods)] // the one place a value leaves this process: the setSecrets request body
    async fn put_batch(&self, items: &[(String, &Secret)]) -> Result<(), ConnectorError> {
        let mut secrets = Vec::with_capacity(items.len());
        for (name, value) in items {
            let text = std::str::from_utf8(value.expose()).map_err(|_| ConnectorError::new(ErrorKind::Rejected, "value_not_text"))?;
            secrets.push(json!({ "key": name, "value": text }));
        }
        let query = "mutation SetAppSecrets($appId: ID!, $secrets: [SecretInput!]!) { setSecrets(input: { appId: $appId, secrets: $secrets }) { release { version } } }";
        let data = self.graphql(query, json!({ "appId": self.app_id, "secrets": secrets })).await?;
        self.remember_release(&data, "setSecrets");
        Ok(())
    }

    async fn delete_batch(&self, names: &[String]) -> Result<(), ConnectorError> {
        // keys go in the body, not the URL, so no name needs encoding
        let query = "mutation UnsetAppSecrets($appId: ID!, $keys: [String!]!) { unsetSecrets(input: { appId: $appId, keys: $keys }) { release { version } } }";
        let data = self.graphql(query, json!({ "appId": self.app_id, "keys": names })).await?;
        self.remember_release(&data, "unsetSecrets");
        Ok(())
    }

    async fn after_sync(&self) -> Result<(), ConnectorError> {
        if self.redeploy { self.machine_calls().await } else { Ok(()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(text: &str) -> Secret {
        Secret::from_string(text.to_string())
    }

    #[test]
    fn credentials_and_app_ids_are_checked_when_built() {
        assert!(Fly::new(&doc(r#"{"accessToken":"fo1_x"}"#), "my-app", false, FlyBase::fly_io()).is_ok());
        let cases = [
            (r#"{"accessToken":"  "}"#, "my-app", ConfigError::EmptyToken),
            (r#"{"accessToken":"t","extra":1}"#, "my-app", ConfigError::Credentials),
            (r#"{"token":"t"}"#, "my-app", ConfigError::Credentials),
            ("nope", "my-app", ConfigError::Credentials),
            (r#"{"accessToken":"t"}"#, "my app", ConfigError::AppId),
            (r#"{"accessToken":"t"}"#, "", ConfigError::AppId),
        ];
        for (credentials, app, expected) in cases {
            assert_eq!(Fly::new(&doc(credentials), app, false, FlyBase::fly_io()).err(), Some(expected), "{credentials} {app}");
        }
    }

    #[test]
    fn names_are_environment_variable_names() {
        for ok in ["A", "db_url", "_x", "A1", "mixedCase"] {
            assert!(valid_secret_name(ok), "{ok}");
        }
        for bad in ["", "1A", "A-B", "A B", "A.B", "é"] {
            assert!(!valid_secret_name(bad), "{bad}");
        }
    }

    #[test]
    fn graphql_errors_become_codes_and_the_text_is_dropped() {
        let one = |message: &str| classify_graphql(&[json!({ "message": message })]);
        assert_eq!(one("Could not find App \"x\""), ConnectorError::new(ErrorKind::NotFound, "target_not_found"));
        assert_eq!(one("Not authorized to access this app"), ConnectorError::new(ErrorKind::Auth, "forbidden"));
        assert_eq!(one("Rate limit exceeded"), ConnectorError::new(ErrorKind::Transient, "rate_limited"));
        assert_eq!(one("secret value CANARY is too long"), ConnectorError::new(ErrorKind::Rejected, "graphql_error"));
    }
}
