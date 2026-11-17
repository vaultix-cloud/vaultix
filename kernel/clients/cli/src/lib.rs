//! The client of the Vaultix API, shared by the `vx` command (a person) and `vx-mcp` (an AI client's
//! tool server). It is the trusted caller: the only place outside the server that a value is held,
//! and only inside a `Secret`.

use serde::de::{Deserialize, Deserializer};
use serde_json::{json, Value};
use std::time::Duration;
use vx_secret::Secret;

pub struct Client {
    base: String,
    token: String,
}

impl Drop for Client { fn drop(&mut self) { use zeroize::Zeroize; self.token.zeroize(); } }

#[derive(Debug)]
pub struct ApiFailure {
    pub status: u16,
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for ApiFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({}): {}", self.code, self.status, self.message)
    }
}

/// A value from a redeem answer, parsed straight into a `Secret`.
struct SecretText(Secret);

impl<'de> Deserialize<'de> for SecretText {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self(Secret::from_string(String::deserialize(deserializer)?)))
    }
}

#[derive(serde::Deserialize)]
struct Redeemed {
    values: Vec<RedeemedValue>,
}

#[derive(serde::Deserialize)]
struct RedeemedValue {
    name: String,
    value: SecretText,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct SecretRef {
    pub project: String,
    pub environment: String,
    #[serde(default)]
    pub path: Option<String>,
    pub name: String,
}

impl Client {
    /// Read an existing short-lived session from VX_TOKEN or VX_TOKEN_FILE. Actor is server-owned.
    pub fn from_env() -> Result<Self, String> {
        let token = match (std::env::var("VX_TOKEN"), std::env::var("VX_TOKEN_FILE")) {
            (Ok(token), _) => token,
            (_, Ok(path)) => std::fs::read_to_string(path).map_err(|_| "VX_TOKEN_FILE cannot be read".to_string())?.trim().to_string(),
            _ => return Err("set VX_TOKEN or VX_TOKEN_FILE".into()),
        };
        let mut client=Self::anonymous()?;
        client.token=token;
        Ok(client)
    }

    pub fn anonymous()->Result<Self,String> {
        let base=std::env::var("VX_URL").unwrap_or_else(|_|"http://127.0.0.1:8210".into());
        let parsed=url::Url::parse(&base).map_err(|_|"VX_URL is invalid")?;
        let local=parsed.host_str().is_some_and(|h| matches!(h,"localhost"|"127.0.0.1"|"[::1]"));
        if !(parsed.scheme()=="https" || (parsed.scheme()=="http" && local)) || !parsed.username().is_empty() || parsed.password().is_some() || parsed.query().is_some() || parsed.fragment().is_some() || parsed.path()!="/" {
            return Err("VX_URL must be an HTTPS origin, or loopback HTTP for local development".into());
        }
        Ok(Self{base:base.trim_end_matches('/').into(),token:String::new()})
    }

    #[allow(clippy::disallowed_methods)] // human credential boundary; never an MCP tool
    pub fn setup(&self,code:&str,email:&str,password:&Secret,organization:&str,project:&str,environment:&str)->Result<Value,ApiFailure> {
        self.call("POST","/api/vx/v1/auth/setup",Some(json!({"setupCode":code,"email":email,"password":String::from_utf8_lossy(password.expose()),"organizationName":organization,"project":project,"environment":environment})))
    }

    #[allow(clippy::disallowed_methods)] // human credential boundary; token retained only in this client
    pub fn login(mut self,email:&str,password:&Secret)->Result<Self,ApiFailure> {
        let body:Value=self.call("POST","/api/vx/v1/auth/sessions",Some(json!({"email":email,"password":String::from_utf8_lossy(password.expose())})))?;
        self.token=body["bearer"].as_str().ok_or(ApiFailure{status:502,code:"bad_answer".into(),message:"No session was returned.".into()})?.to_owned();
        Ok(self)
    }

    pub fn logout(&self)->Result<Value,ApiFailure> { self.call("POST","/api/vx/v1/auth/logout",None) }

    fn call<T: serde::de::DeserializeOwned>(&self, method: &str, path: &str, body: Option<Value>) -> Result<T, ApiFailure> {
        let request = ureq::AgentBuilder::new().redirects(0).build().request(method, &format!("{}{path}", self.base))
            .timeout(Duration::from_secs(20))
            .set("Authorization", &format!("Bearer {}", self.token));
        let result = match body {
            Some(body) => request.send_json(body),
            None => request.call(),
        };
        match result {
            Ok(response) => response.into_json().map_err(|_| ApiFailure { status: 502, code: "bad_answer".into(), message: "The server answered with something that is not JSON.".into() }),
            Err(ureq::Error::Status(status, response)) => {
                let body: Value = response.into_json().unwrap_or(Value::Null);
                Err(ApiFailure {
                    status,
                    code: body["code"].as_str().unwrap_or("error").to_string(),
                    message: body["error"].as_str().unwrap_or("The server refused the request.").to_string(),
                })
            }
            Err(_) => Err(ApiFailure { status: 0, code: "unreachable".into(), message: format!("Cannot reach Vaultix at {}.", self.base) }),
        }
    }

    /// Store a value. Only a person's command calls this; the MCP server has no way to.
    #[allow(clippy::disallowed_methods)] // value path: the human's own command sends the value it was given
    pub fn put(&self, reference: &SecretRef, value: &Secret) -> Result<Value, ApiFailure> {
        let text = String::from_utf8_lossy(value.expose()).into_owned();
        self.call("PUT", "/api/vx/v1/secrets", Some(json!({ "project": reference.project, "environment": reference.environment, "path": reference.path, "name": reference.name, "value": text })))
    }

    pub fn list(&self, project: &str, environment: &str) -> Result<Value, ApiFailure> {
        let query=url::form_urlencoded::Serializer::new(String::new()).append_pair("project",project).append_pair("environment",environment).finish();
        self.call("GET", &format!("/api/vx/v1/secrets?{query}"), None)
    }

    pub fn request_value(&self, reference: &SecretRef, purpose: &str) -> Result<Value, ApiFailure> {
        self.call("POST", "/api/vx/v1/secrets/requests", Some(json!({ "project": reference.project, "environment": reference.environment, "path": reference.path, "name": reference.name, "purpose": purpose })))
    }

    /// Ask for a handle and redeem it at once. The values come back as `Secret`s for the caller to inject.
    pub fn redeem(&self, references: &[SecretRef], purpose: &str) -> Result<Vec<(String, Secret)>, ApiFailure> {
        let secrets: Vec<Value> = references.iter().map(|r| json!({ "project": r.project, "environment": r.environment, "path": r.path, "name": r.name })).collect();
        let made: Value = self.call("POST", "/api/vx/v1/secrets/injections", Some(json!({ "purpose": purpose, "secrets": secrets, "ttlSeconds": 30 })))?;
        let handle = made["handle"].as_str().ok_or(ApiFailure { status: 502, code: "bad_answer".into(), message: "No handle came back.".into() })?;
        let parsed: Redeemed = self.call("POST", &format!("/api/vx/v1/secrets/injections/{handle}/redeem"), None)?;
        Ok(parsed.values.into_iter().map(|v| (v.name, v.value.0)).collect())
    }
}
