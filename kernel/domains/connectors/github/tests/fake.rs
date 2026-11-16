#![allow(dead_code, clippy::unwrap_used, clippy::disallowed_methods)] // test support; shared by several test binaries
//! A GitHub stand-in on a loopback port. It does what matters about the real API for these tests: it decrypts sealed-box
//! values with its own key (so a wrong or missing encryption is caught), verifies the App's RS256 JWT, insists on upper-case
//! names, paginates, and can be told to fail a request.

use axum::body::{to_bytes, Body};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::Router;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use crypto_box::{aead::OsRng, SecretKey};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub const PAT: &str = "ghp_test-personal-access-token";
pub const APP_ID: &str = "424242";
pub const INSTALLATION_ID: &str = "777";

pub struct Failure {
    pub path_contains: String,
    pub status: u16,
    pub headers: Vec<(String, String)>,
}

pub struct Fake {
    pub seal_secret: SecretKey,
    pub key_id: String,
    pub app_public_pem: String,
    pub installation_token: Mutex<String>,
    pub tokens_minted: AtomicUsize,
    pub page_cap: usize,
    /// scope path (up to `/secrets`) -> NAME -> decrypted value
    pub secrets: Mutex<BTreeMap<String, BTreeMap<String, String>>>,
    /// (scope, NAME) -> the extra JSON fields of the last PUT (visibility and so on)
    pub meta: Mutex<BTreeMap<(String, String), Value>>,
    /// "METHOD path?query"
    pub requests: Mutex<Vec<String>>,
    /// every request body, as text
    pub bodies: Mutex<Vec<String>>,
    pub failures: Mutex<VecDeque<Failure>>,
}

impl Fake {
    pub fn seed(&self, scope: &str, name: &str, value: &str) {
        self.secrets.lock().unwrap().entry(scope.into()).or_default().insert(name.into(), value.into());
    }
    pub fn values(&self, scope: &str) -> BTreeMap<String, String> {
        self.secrets.lock().unwrap().get(scope).cloned().unwrap_or_default()
    }
    pub fn fail_next(&self, path_contains: &str, status: u16, headers: &[(&str, &str)]) {
        self.failures.lock().unwrap().push_back(Failure { path_contains: path_contains.into(), status, headers: headers.iter().map(|(k, v)| ((*k).into(), (*v).into())).collect() });
    }
    pub fn request_count(&self, needle: &str) -> usize {
        self.requests.lock().unwrap().iter().filter(|r| r.contains(needle)).count()
    }
}

/// A 2048-bit key generated once per test binary (ring refuses smaller). Returns (private PKCS#1 PEM, public PKCS#1 PEM).
pub fn app_keys() -> &'static (String, String) {
    static KEYS: OnceLock<(String, String)> = OnceLock::new();
    KEYS.get_or_init(|| {
        use rsa::pkcs1::{EncodeRsaPrivateKey, EncodeRsaPublicKey, LineEnding};
        let private = rsa::RsaPrivateKey::new(&mut OsRng, 2048).unwrap();
        let public = rsa::RsaPublicKey::from(&private);
        (private.to_pkcs1_pem(LineEnding::LF).unwrap().to_string(), public.to_pkcs1_pem(LineEnding::LF).unwrap())
    })
}

pub fn other_private_key() -> String {
    use rsa::pkcs1::{EncodeRsaPrivateKey, LineEnding};
    rsa::RsaPrivateKey::new(&mut OsRng, 2048).unwrap().to_pkcs1_pem(LineEnding::LF).unwrap().to_string()
}

pub async fn start(page_cap: usize) -> (Arc<Fake>, u16) {
    let fake = Arc::new(Fake {
        seal_secret: SecretKey::generate(&mut OsRng),
        key_id: "key-1".into(),
        app_public_pem: app_keys().1.clone(),
        installation_token: Mutex::new("ghs_installation-token-1".into()),
        tokens_minted: AtomicUsize::new(0),
        page_cap,
        secrets: Mutex::default(),
        meta: Mutex::default(),
        requests: Mutex::default(),
        bodies: Mutex::default(),
        failures: Mutex::default(),
    });
    let app = Router::new().fallback(handle).with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (fake, port)
}

fn reply(status: u16, body: Value) -> Response {
    Response::builder().status(status).header("content-type", "application/json").body(Body::from(body.to_string())).unwrap()
}

fn bearer(headers: &HeaderMap) -> String {
    headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("").to_string()
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_') && !name.starts_with("GITHUB_") && !name.as_bytes()[0].is_ascii_digit()
}

async fn handle(State(fake): State<Arc<Fake>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, 1 << 20).await.unwrap();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let path = parts.uri.path().to_string();
    let query = parts.uri.query().unwrap_or("").to_string();
    fake.requests.lock().unwrap().push(format!("{} {}{}", parts.method, path, if query.is_empty() { String::new() } else { format!("?{query}") }));
    fake.bodies.lock().unwrap().push(text.clone());

    {
        let mut failures = fake.failures.lock().unwrap();
        if let Some(i) = failures.iter().position(|f| path.contains(&f.path_contains)) {
            let failure = failures.remove(i).unwrap();
            let mut builder = Response::builder().status(failure.status);
            for (k, v) in failure.headers {
                builder = builder.header(k, v);
            }
            return builder.body(Body::from("{\"message\":\"injected failure that mentions the request body\"}")).unwrap();
        }
    }

    let token = bearer(&parts.headers);
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();

    // an App asks for an installation token with a JWT
    if parts.method == Method::POST && segments.len() == 4 && segments[0] == "app" && segments[1] == "installations" && segments[3] == "access_tokens" {
        let key = jsonwebtoken::DecodingKey::from_rsa_pem(fake.app_public_pem.as_bytes()).unwrap();
        let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
        validation.set_required_spec_claims(&["exp", "iss"]);
        validation.set_issuer(&[APP_ID]);
        let Ok(decoded) = jsonwebtoken::decode::<Value>(&token, &key, &validation) else { return reply(401, json!({ "message": "bad jwt" })) };
        let (iat, exp) = (decoded.claims["iat"].as_i64().unwrap(), decoded.claims["exp"].as_i64().unwrap());
        if exp - iat > 600 || segments[2] != INSTALLATION_ID {
            return reply(401, json!({ "message": "jwt window too long, or wrong installation" }));
        }
        fake.tokens_minted.fetch_add(1, Ordering::SeqCst);
        let expires = (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339();
        return reply(201, json!({ "token": fake.installation_token.lock().unwrap().clone(), "expires_at": expires }));
    }

    if token != PAT && token != *fake.installation_token.lock().unwrap() {
        return reply(401, json!({ "message": "Bad credentials" }));
    }

    // .../secrets[/public-key | /NAME]
    if segments.get(2) == Some(&"gone") {
        return reply(404, json!({ "message": "Not Found" }));
    }
    let Some(at) = segments.iter().position(|s| *s == "secrets") else { return reply(404, json!({})) };
    let scope = format!("/{}", segments[..=at].join("/"));
    let tail = &segments[at + 1..];
    let is_org = segments[0] == "orgs";
    match (&parts.method, tail) {
        (&Method::GET, ["public-key"]) => reply(200, json!({ "key_id": fake.key_id, "key": STANDARD.encode(fake.seal_secret.public_key().as_bytes()) })),
        (&Method::GET, []) => {
            let param = |name: &str| query.split('&').find_map(|kv| kv.strip_prefix(&format!("{name}="))).and_then(|v| v.parse::<usize>().ok());
            let (per_page, page) = (param("per_page").unwrap_or(30).min(fake.page_cap), param("page").unwrap_or(1));
            let all = fake.values(&scope);
            let names: Vec<_> = all.keys().cloned().collect();
            let slice: Vec<Value> = names.iter().skip((page - 1) * per_page).take(per_page).map(|n| json!({ "name": n, "created_at": "2026-01-01T00:00:00Z" })).collect();
            reply(200, json!({ "total_count": names.len(), "secrets": slice }))
        }
        (&Method::PUT, [name]) => {
            if !valid_name(name) {
                return reply(422, json!({ "message": "invalid secret name (must be upper case)" }));
            }
            let Ok(body) = serde_json::from_str::<Value>(&text) else { return reply(422, json!({})) };
            if body["key_id"] != json!(fake.key_id) {
                return reply(422, json!({ "message": "wrong key id" }));
            }
            if is_org && body["visibility"].is_null() {
                return reply(422, json!({ "message": "visibility required" }));
            }
            let Some(sealed) = body["encrypted_value"].as_str().and_then(|s| STANDARD.decode(s).ok()) else { return reply(422, json!({})) };
            let Ok(plain) = fake.seal_secret.unseal(&sealed) else { return reply(422, json!({ "message": "could not decrypt" })) };
            let existed = fake.secrets.lock().unwrap().get(&scope).is_some_and(|m| m.contains_key(*name));
            fake.seed(&scope, name, &String::from_utf8(plain).unwrap());
            let mut extra = body.clone();
            extra.as_object_mut().unwrap().remove("encrypted_value");
            fake.meta.lock().unwrap().insert((scope, (*name).into()), extra);
            reply(if existed { 204 } else { 201 }, json!({}))
        }
        (&Method::DELETE, [name]) => {
            let removed = fake.secrets.lock().unwrap().get_mut(&scope).and_then(|m| m.remove(*name)).is_some();
            reply(if removed { 204 } else { 404 }, json!({}))
        }
        _ => reply(404, json!({})),
    }
}

pub fn status(code: u16) -> StatusCode {
    StatusCode::from_u16(code).unwrap()
}
