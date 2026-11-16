//! The GitHub Actions secrets connector: repository, repository environment and organisation scopes.
//!
//! * Values are sealed to the destination's public key (libsodium `crypto_box_seal`, which GitHub requires) before they
//!   leave this process, so the request body never holds a value in the clear.
//! * Every request goes to one base URL fixed at construction: `https://api.github.com`, an Enterprise Server host over
//!   https, or a loopback address for tests. Redirects are not followed, so a credential cannot be sent elsewhere.
//! * Failures are a kind and a fixed code. A rate limit carries the wait GitHub asked for. Response bodies are never read
//!   into an error.

use crate::credentials::Auth;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use crypto_box::{aead::OsRng, PublicKey};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, ACCEPT, USER_AGENT};
use reqwest::{redirect::Policy, Client, Method, Response, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::Mutex;
use vx_connectors::{Connector, ConnectorError, Entry, ErrorKind, Fingerprinter};
use vx_secret::Secret;

const MAX_VALUE_BYTES: usize = 48 * 1024;
const MAX_PAGES: u32 = 1000;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("the API host is not valid")]
    Host,
    #[error("plain http is only allowed for a loopback address")]
    InsecureUrl,
    #[error("{0}")]
    Target(&'static str),
    #[error("the HTTP client could not be built")]
    Client,
}

/// Where requests go. Fixed at construction; nothing a secret or a response says can change it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiBase(String);

impl ApiBase {
    pub fn github_com() -> Self {
        Self("https://api.github.com".into())
    }

    /// GitHub Enterprise Server: `https://<host>/api/v3`.
    pub fn enterprise(host: &str) -> Result<Self, ConfigError> {
        let valid = !host.is_empty() && host.len() <= 253 && host.split('.').all(|label| !label.is_empty() && label.len() <= 63 && !label.starts_with('-') && !label.ends_with('-') && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
        if !valid || host.eq_ignore_ascii_case("localhost") {
            return Err(ConfigError::Host);
        }
        Ok(Self(format!("https://{}/api/v3", host.to_ascii_lowercase())))
    }

    /// A server on this machine, over plain http, for tests. Any other host is refused.
    pub fn loopback(port: u16) -> Self {
        Self(format!("http://127.0.0.1:{port}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Visibility {
    All,
    Private,
    Selected(Vec<u64>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Repository { owner: String, repo: String },
    Environment { owner: String, repo: String, environment: String },
    Organization { org: String, visibility: Visibility },
}

fn plain_name(text: &str) -> bool {
    !text.is_empty() && text.len() <= 100 && text.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

impl Target {
    pub fn validate(&self) -> Result<(), ConfigError> {
        match self {
            Target::Repository { owner, repo } if plain_name(owner) && plain_name(repo) => Ok(()),
            Target::Repository { .. } => Err(ConfigError::Target("owner and repository must be 1 to 100 letters, digits, dashes, underscores or dots")),
            Target::Environment { owner, repo, environment } if plain_name(owner) && plain_name(repo) && !environment.is_empty() && environment.len() <= 255 => Ok(()),
            Target::Environment { .. } => Err(ConfigError::Target("owner, repository and a non-empty environment name are required")),
            Target::Organization { org, visibility } if plain_name(org) => match visibility {
                Visibility::Selected(ids) if ids.is_empty() => Err(ConfigError::Target("select at least one repository")),
                _ => Ok(()),
            },
            Target::Organization { .. } => Err(ConfigError::Target("the organisation name is not valid")),
        }
    }

    fn secrets_path(&self) -> String {
        match self {
            Target::Repository { owner, repo } => format!("/repos/{}/{}/actions/secrets", enc(owner), enc(repo)),
            Target::Environment { owner, repo, environment } => format!("/repos/{}/{}/environments/{}/secrets", enc(owner), enc(repo), enc(environment)),
            Target::Organization { org, .. } => format!("/orgs/{}/actions/secrets", enc(org)),
        }
    }
}

/// Percent-encode one path segment.
fn enc(text: &str) -> String {
    text.bytes().map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// A name GitHub accepts: letters, digits and underscores, not starting with a digit or `GITHUB_`, already upper-cased by `fold`.
fn valid_secret_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 255 && name.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_') && !name.as_bytes()[0].is_ascii_digit() && !name.starts_with("GITHUB_")
}

#[derive(Deserialize)]
struct Page {
    #[serde(default)]
    total_count: usize,
    #[serde(default)]
    secrets: Vec<PageSecret>,
}

#[derive(Deserialize)]
struct PageSecret {
    name: String,
}

#[derive(Deserialize)]
struct PublicKeyResponse {
    key_id: String,
    key: String,
}

#[derive(Deserialize)]
struct InstallationToken {
    token: String,
    expires_at: String,
}

struct Cached<T> {
    value: T,
    until: DateTime<Utc>,
}

pub struct GitHub {
    http: Client,
    base: ApiBase,
    auth: Auth,
    target: Target,
    bearer: Mutex<Option<Cached<HeaderValue>>>,
    public_key: Mutex<Option<(String, PublicKey)>>,
}

impl GitHub {
    pub fn new(auth: Auth, target: Target, base: ApiBase) -> Result<Self, ConfigError> {
        target.validate()?;
        let http = Client::builder().redirect(Policy::none()).timeout(Duration::from_secs(30)).build().map_err(|_| ConfigError::Client)?;
        Ok(Self { http, base, auth, target, bearer: Mutex::new(None), public_key: Mutex::new(None) })
    }

    fn url(&self, path_and_query: &str) -> String {
        format!("{}{}", self.base.as_str(), path_and_query)
    }

    fn sensitive(value: &str) -> Result<HeaderValue, ConnectorError> {
        let mut header = HeaderValue::from_str(value).map_err(|_| ConnectorError::new(ErrorKind::Rejected, "credential_not_usable"))?;
        header.set_sensitive(true);
        Ok(header)
    }

    /// The Authorization header: the token itself, or an installation token minted from the App's private key.
    async fn bearer(&self) -> Result<HeaderValue, ConnectorError> {
        match &self.auth {
            Auth::Pat { token } => Self::sensitive(&format!("Bearer {}", token.as_str())),
            Auth::App { app_id, installation_id, private_key } => {
                let mut cache = self.bearer.lock().await;
                if let Some(cached) = cache.as_ref() {
                    if cached.until > Utc::now() + ChronoDuration::minutes(2) {
                        return Ok(cached.value.clone());
                    }
                }
                let now = Utc::now().timestamp();
                let claims = json!({ "iat": now - 60, "exp": now + 9 * 60, "iss": app_id });
                #[allow(clippy::disallowed_methods)] // signing the App JWT is a value path
                let key = jsonwebtoken::EncodingKey::from_rsa_pem(private_key.as_bytes()).map_err(|_| ConnectorError::new(ErrorKind::Auth, "private_key_not_usable"))?;
                let jwt = jsonwebtoken::encode(&jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256), &claims, &key).map_err(|_| ConnectorError::new(ErrorKind::Auth, "private_key_not_usable"))?;
                let response = self.send(Method::POST, &format!("/app/installations/{installation_id}/access_tokens"), Some(Self::sensitive(&format!("Bearer {jwt}"))?), None).await?;
                let minted: InstallationToken = response.json().await.map_err(|_| ConnectorError::new(ErrorKind::Rejected, "unexpected_response"))?;
                let until = DateTime::parse_from_rfc3339(&minted.expires_at).map_or_else(|_| Utc::now() + ChronoDuration::minutes(30), |t| t.with_timezone(&Utc));
                let value = Self::sensitive(&format!("Bearer {}", minted.token))?;
                *cache = Some(Cached { value: value.clone(), until });
                Ok(value)
            }
        }
    }

    /// One request, with the status turned into a kind and a fixed code. The body of a failure is never read.
    async fn send(&self, method: Method, path_and_query: &str, authorization: Option<HeaderValue>, body: Option<Value>) -> Result<Response, ConnectorError> {
        let mut request = self.http.request(method, self.url(path_and_query)).header(ACCEPT, "application/vnd.github+json").header(USER_AGENT, "vaultix-connector").header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(value) = authorization {
            request = request.header(AUTHORIZATION, value);
        }
        if let Some(json) = body {
            request = request.json(&json);
        }
        let response = request.send().await.map_err(|error| if error.is_timeout() || error.is_connect() { ConnectorError::new(ErrorKind::Transient, "network") } else { ConnectorError::new(ErrorKind::Rejected, "request_failed") })?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        Err(classify(status, response.headers()))
    }

    async fn call(&self, method: Method, path_and_query: &str, body: Option<Value>) -> Result<Response, ConnectorError> {
        let authorization = self.bearer().await?;
        let result = self.send(method, path_and_query, Some(authorization), body).await;
        if let Err(error) = &result {
            if error.code == "bad_credentials" && matches!(self.auth, Auth::App { .. }) {
                // an installation token can be revoked or expire early: forget it, and the retry mints a new one
                *self.bearer.lock().await = None;
                return Err(ConnectorError::new(ErrorKind::Transient, "token_refresh"));
            }
        }
        result
    }

    /// Is the credential good and the target reachable? Used by the screen's "test connection".
    pub async fn check(&self) -> Result<(), ConnectorError> {
        self.call(Method::GET, &format!("{}/public-key", self.target.secrets_path()), None).await.map(|_| ())
    }

    async fn seal_key(&self) -> Result<(String, PublicKey), ConnectorError> {
        let mut cached = self.public_key.lock().await;
        if let Some((id, key)) = cached.as_ref() {
            return Ok((id.clone(), key.clone()));
        }
        let response = self.call(Method::GET, &format!("{}/public-key", self.target.secrets_path()), None).await?;
        let parsed: PublicKeyResponse = response.json().await.map_err(|_| ConnectorError::new(ErrorKind::Rejected, "unexpected_response"))?;
        let bytes: [u8; 32] = STANDARD.decode(&parsed.key).ok().and_then(|b| b.try_into().ok()).ok_or(ConnectorError::new(ErrorKind::Rejected, "bad_public_key"))?;
        let key = PublicKey::from(bytes);
        *cached = Some((parsed.key_id.clone(), key.clone()));
        Ok((parsed.key_id, key))
    }
}

fn classify(status: StatusCode, headers: &HeaderMap) -> ConnectorError {
    let number = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<i64>().ok());
    let retry_after = number("retry-after").map(|s| s.clamp(0, 3600) as u32).or_else(|| number("x-ratelimit-reset").map(|reset| (reset - Utc::now().timestamp()).clamp(0, 3600) as u32));
    let limited = headers.get("x-ratelimit-remaining").and_then(|v| v.to_str().ok()) == Some("0") || headers.contains_key("retry-after");
    let rate_limited = || {
        let error = ConnectorError::new(ErrorKind::Transient, "rate_limited");
        retry_after.map_or(error, |s| error.retry_after(s))
    };
    match status {
        StatusCode::UNAUTHORIZED => ConnectorError::new(ErrorKind::Auth, "bad_credentials"),
        StatusCode::FORBIDDEN if limited => rate_limited(),
        StatusCode::FORBIDDEN => ConnectorError::new(ErrorKind::Auth, "forbidden"),
        StatusCode::TOO_MANY_REQUESTS => rate_limited(),
        StatusCode::NOT_FOUND => ConnectorError::new(ErrorKind::NotFound, "target_not_found"),
        StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY => ConnectorError::new(ErrorKind::Rejected, "unprocessable"),
        s if s.is_redirection() => ConnectorError::new(ErrorKind::Rejected, "unexpected_redirect"),
        s if s.is_server_error() => ConnectorError::new(ErrorKind::Transient, "server_error"),
        _ => ConnectorError::new(ErrorKind::Rejected, "unexpected_status"),
    }
}

impl Connector for GitHub {
    fn id(&self) -> &'static str {
        "github"
    }

    /// GitHub upper-cases secret names, so `db_url` and `DB_URL` are one secret there.
    fn fold(&self, name: &str) -> String {
        name.to_ascii_uppercase()
    }

    fn accepts_name(&self, name: &str) -> Result<(), ConnectorError> {
        if valid_secret_name(name) { Ok(()) } else { Err(ConnectorError::new(ErrorKind::Rejected, "invalid_secret_name")) }
    }

    async fn list(&self, _: &Fingerprinter) -> Result<Vec<Entry>, ConnectorError> {
        let mut entries = Vec::new();
        for page in 1..=MAX_PAGES {
            let response = self.call(Method::GET, &format!("{}?per_page=100&page={page}", self.target.secrets_path()), None).await?;
            let parsed: Page = response.json().await.map_err(|_| ConnectorError::new(ErrorKind::Rejected, "unexpected_response"))?;
            let received = parsed.secrets.len();
            // GitHub never returns a value, so there is no fingerprint: every secret is rewritten on every sync
            entries.extend(parsed.secrets.into_iter().map(|s| Entry { name: s.name, fingerprint: None }));
            if received == 0 || entries.len() >= parsed.total_count {
                return Ok(entries);
            }
        }
        Err(ConnectorError::new(ErrorKind::Rejected, "too_many_secrets"))
    }

    async fn put(&self, name: &str, value: &Secret) -> Result<(), ConnectorError> {
        if !valid_secret_name(name) {
            return Err(ConnectorError::new(ErrorKind::Rejected, "invalid_secret_name"));
        }
        if value.len() > MAX_VALUE_BYTES {
            return Err(ConnectorError::new(ErrorKind::Rejected, "value_too_large"));
        }
        let (key_id, key) = self.seal_key().await?;
        #[allow(clippy::disallowed_methods)] // sealing to the destination's key is the value path out of this process
        let sealed = key.seal(&mut OsRng, value.expose()).map_err(|_| ConnectorError::new(ErrorKind::Rejected, "seal_failed"))?;
        let mut body = json!({ "encrypted_value": STANDARD.encode(sealed), "key_id": key_id });
        if let Target::Organization { visibility, .. } = &self.target {
            match visibility {
                Visibility::All => body["visibility"] = json!("all"),
                Visibility::Private => body["visibility"] = json!("private"),
                Visibility::Selected(ids) => {
                    body["visibility"] = json!("selected");
                    body["selected_repository_ids"] = json!(ids);
                }
            }
        }
        let result = self.call(Method::PUT, &format!("{}/{name}", self.target.secrets_path()), Some(body)).await;
        if result.is_err() {
            // the key may have rotated: fetch it again on the next attempt
            *self.public_key.lock().await = None;
        }
        result.map(|_| ())
    }

    async fn delete(&self, name: &str) -> Result<(), ConnectorError> {
        match self.call(Method::DELETE, &format!("{}/{}", self.target.secrets_path(), enc(name)), None).await {
            Ok(_) => Ok(()),
            // already gone is the state we wanted
            Err(error) if error.kind == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_follow_githubs_rules() {
        for ok in ["A", "DB_URL", "A1", "_X"] {
            assert!(valid_secret_name(ok), "{ok}");
        }
        for bad in ["", "1A", "GITHUB_TOKEN", "A-B", "a", "A B", "A.B"] {
            assert!(!valid_secret_name(bad), "{bad}");
        }
    }

    #[test]
    fn fold_makes_case_variants_one_name() {
        let github = GitHub::new(Auth::Pat { token: "t".to_string().into() }, Target::Repository { owner: "o".into(), repo: "r".into() }, ApiBase::github_com()).unwrap();
        assert_eq!(github.fold("db_Url"), "DB_URL");
    }

    #[test]
    fn the_api_base_is_fixed_and_checked() {
        assert_eq!(ApiBase::github_com().as_str(), "https://api.github.com");
        assert_eq!(ApiBase::enterprise("Git.Example.com").unwrap().as_str(), "https://git.example.com/api/v3");
        for bad in ["", "localhost", "a b", "evil.com/path", "evil.com:8080", "-x.com", "a..b", "x@y.com", "http://x.com"] {
            assert_eq!(ApiBase::enterprise(bad), Err(ConfigError::Host), "{bad:?}");
        }
    }

    #[test]
    fn targets_are_validated_when_built() {
        let pat = || Auth::Pat { token: "t".to_string().into() };
        let org = |visibility| Target::Organization { org: "acme".into(), visibility };
        assert!(GitHub::new(pat(), org(Visibility::Selected(vec![1])), ApiBase::github_com()).is_ok());
        assert!(GitHub::new(pat(), org(Visibility::Selected(vec![])), ApiBase::github_com()).is_err(), "selected needs at least one repository");
        assert!(GitHub::new(pat(), Target::Repository { owner: "a/b".into(), repo: "r".into() }, ApiBase::github_com()).is_err());
        assert!(GitHub::new(pat(), Target::Environment { owner: "o".into(), repo: "r".into(), environment: String::new() }, ApiBase::github_com()).is_err());
    }

    #[test]
    fn path_segments_are_encoded() {
        let t = Target::Environment { owner: "o".into(), repo: "r".into(), environment: "prod/eu west".into() };
        assert_eq!(t.secrets_path(), "/repos/o/r/environments/prod%2Feu%20west/secrets");
    }

    #[test]
    fn statuses_become_kinds_and_codes_and_never_text() {
        let none = HeaderMap::new();
        assert_eq!(classify(StatusCode::UNAUTHORIZED, &none), ConnectorError::new(ErrorKind::Auth, "bad_credentials"));
        assert_eq!(classify(StatusCode::FORBIDDEN, &none), ConnectorError::new(ErrorKind::Auth, "forbidden"));
        assert_eq!(classify(StatusCode::NOT_FOUND, &none).kind, ErrorKind::NotFound);
        assert_eq!(classify(StatusCode::BAD_GATEWAY, &none), ConnectorError::new(ErrorKind::Transient, "server_error"));
        let mut limited = HeaderMap::new();
        limited.insert("retry-after", HeaderValue::from_static("7"));
        assert_eq!(classify(StatusCode::TOO_MANY_REQUESTS, &limited), ConnectorError::new(ErrorKind::Transient, "rate_limited").retry_after(7));
        let mut exhausted = HeaderMap::new();
        exhausted.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
        assert_eq!(classify(StatusCode::FORBIDDEN, &exhausted).code, "rate_limited", "a 403 with no quota left is a rate limit, not a permission error");
        assert!(classify(StatusCode::FOUND, &none).code == "unexpected_redirect");
    }
}
