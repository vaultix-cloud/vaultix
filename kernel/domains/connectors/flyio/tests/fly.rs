#![allow(clippy::unwrap_used, clippy::disallowed_methods)] // tests read values to compare them
//! The Fly.io connector against a fake Fly (GraphQL, the Machines API, release numbers), through the real sync engine.

use axum::body::{to_bytes, Body};
use axum::extract::{Request, State};
use axum::http::Method;
use axum::response::Response;
use axum::Router;
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vx_connector_flyio::{Fly, FlyBase};
use vx_connectors::{sync, AuditSink, ErrorKind, Fingerprinter, KeySchema, PlanOptions, RetryPolicy, SyncError, SyncRequest};
use vx_secret::Secret;

const TOKEN: &str = "fo1_test-access-token";
const CANARY: &str = "CANARY-fly-value-c3a9-do-not-leak";
const APP: &str = "my-app";

type HttpFailure = (String, u16, Vec<(String, String)>);

struct Machine {
    id: String,
    state: String,
    stuck: bool,
    min_secrets_version: Option<u64>,
    updated: bool,
}

#[derive(Default)]
struct App {
    secrets: BTreeMap<String, String>,
    release: u64,
    machines: Vec<Machine>,
}

#[derive(Default)]
struct FakeFly {
    app: Mutex<App>,
    requests: Mutex<Vec<String>>,
    bodies: Mutex<Vec<String>>,
    /// (operation or path contains, graphql error message)
    graphql_failures: Mutex<VecDeque<(String, String)>>,
    /// (path contains, status, headers)
    http_failures: Mutex<VecDeque<HttpFailure>>,
}

impl FakeFly {
    fn count(&self, needle: &str) -> usize {
        self.requests.lock().unwrap().iter().filter(|r| r.contains(needle)).count()
    }
    fn secrets(&self) -> BTreeMap<String, String> {
        self.app.lock().unwrap().secrets.clone()
    }
    fn machine(&self, id: &str) -> (Option<u64>, bool) {
        let app = self.app.lock().unwrap();
        let m = app.machines.iter().find(|m| m.id == id).unwrap();
        (m.min_secrets_version, m.updated)
    }
}

fn json_reply(status: u16, body: Value) -> Response {
    Response::builder().status(status).header("content-type", "application/json").body(Body::from(body.to_string())).unwrap()
}

async fn handle(State(fake): State<Arc<FakeFly>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let text = String::from_utf8_lossy(&to_bytes(body, 1 << 20).await.unwrap()).to_string();
    let path = parts.uri.path().to_string();
    let query = parts.uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    fake.requests.lock().unwrap().push(format!("{} {path}{query}", parts.method));
    fake.bodies.lock().unwrap().push(text.clone());

    let authorised = parts.headers.get("authorization").and_then(|v| v.to_str().ok()) == Some(&format!("Bearer {TOKEN}"));
    {
        let mut failures = fake.http_failures.lock().unwrap();
        if let Some(i) = failures.iter().position(|(needle, _, _)| path.contains(needle)) {
            let (_, status, headers) = failures.remove(i).unwrap();
            let mut builder = Response::builder().status(status);
            for (k, v) in headers {
                builder = builder.header(k, v);
            }
            return builder.body(Body::from("{\"error\":\"injected\"}")).unwrap();
        }
    }

    if path == "/graphql" && parts.method == Method::POST {
        let request: Value = serde_json::from_str(&text).unwrap();
        let query = request["query"].as_str().unwrap_or("");
        let vars = &request["variables"];
        if !authorised {
            // Fly answers an unknown token to the viewer query with null data, and refuses the rest
            return if query.contains("viewer") { json_reply(200, json!({ "data": { "viewer": null } })) } else { json_reply(401, json!({})) };
        }
        {
            let mut failures = fake.graphql_failures.lock().unwrap();
            if let Some(i) = failures.iter().position(|(op, _)| query.contains(op.as_str())) {
                let (_, message) = failures.remove(i).unwrap();
                return json_reply(200, json!({ "data": null, "errors": [{ "message": message }] }));
            }
        }
        let known = vars["appId"].as_str().is_none_or(|id| id == APP);
        if !known {
            return json_reply(200, json!({ "data": null, "errors": [{ "message": "Could not find App \"nope\"" }] }));
        }
        let mut app = fake.app.lock().unwrap();
        return json_reply(
            200,
            if query.contains("viewer") {
                json!({ "data": { "viewer": { "id": "u1", "email": "a@b.co" } } })
            } else if query.contains("GetAppName") {
                json!({ "data": { "app": { "name": APP } } })
            } else if query.contains("GetAppSecrets") {
                json!({ "data": { "app": { "secrets": app.secrets.keys().map(|k| json!({ "name": k })).collect::<Vec<_>>() } } })
            } else if query.contains("SetAppSecrets") {
                for s in vars["secrets"].as_array().unwrap() {
                    app.secrets.insert(s["key"].as_str().unwrap().into(), s["value"].as_str().unwrap().into());
                }
                app.release += 1;
                json!({ "data": { "setSecrets": { "release": { "version": app.release } } } })
            } else if query.contains("UnsetAppSecrets") {
                for k in vars["keys"].as_array().unwrap() {
                    app.secrets.remove(k.as_str().unwrap());
                }
                app.release += 1;
                json!({ "data": { "unsetSecrets": { "release": { "version": app.release } } } })
            } else {
                json!({ "errors": [{ "message": "unknown operation" }] })
            },
        );
    }

    if !authorised {
        return json_reply(401, json!({}));
    }
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    let mut app = fake.app.lock().unwrap();
    match (&parts.method, segments.as_slice()) {
        (&Method::GET, ["v1", "apps", _, "machines"]) => json_reply(200, json!(app.machines.iter().map(|m| json!({ "id": m.id, "state": m.state, "region": "ams", "config": { "env": { "KEEP": "me" } } })).collect::<Vec<_>>())),
        (&Method::POST, ["v1", "apps", _, "machines", id]) => {
            let body: Value = serde_json::from_str(&text).unwrap();
            let machine = app.machines.iter_mut().find(|m| m.id == *id).unwrap();
            if machine.stuck {
                return json_reply(422, json!({ "error": "machine cannot be updated" }));
            }
            assert_eq!(body["config"], json!({ "env": { "KEEP": "me" } }), "the machine's own config is sent back unchanged");
            machine.min_secrets_version = body["min_secrets_version"].as_u64();
            machine.updated = true;
            json_reply(200, json!({ "id": id }))
        }
        (&Method::GET, ["v1", "apps", _, "machines", _, "wait"]) => json_reply(200, json!({ "ok": true })),
        _ => json_reply(404, json!({})),
    }
}

async fn start(machines: &[(&str, &str, bool)]) -> (Arc<FakeFly>, u16) {
    let fake = Arc::new(FakeFly::default());
    fake.app.lock().unwrap().machines = machines.iter().map(|(id, state, stuck)| Machine { id: (*id).into(), state: (*state).into(), stuck: *stuck, min_secrets_version: None, updated: false }).collect();
    let app = Router::new().fallback(handle).with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (fake, port)
}

#[derive(Default)]
struct Events(Mutex<Vec<vx_audit::Event>>);
impl AuditSink for Events {
    async fn record(&self, event: vx_audit::Event) -> Result<(), vx_audit::AuditError> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}

fn creds(token: &str) -> Secret {
    Secret::from_string(json!({ "accessToken": token }).to_string())
}

fn fly(port: u16, redeploy: bool) -> Fly {
    Fly::new(&creds(TOKEN), APP, redeploy, FlyBase::loopback(port)).unwrap()
}

fn values(pairs: &[(&str, &str)]) -> Vec<(String, Secret)> {
    pairs.iter().map(|(k, v)| ((*k).to_string(), Secret::from_string((*v).to_string()))).collect()
}

fn request(schema: &str, attempts: u32) -> SyncRequest<'static> {
    SyncRequest {
        chain: "proj",
        actor: "user:alice",
        connection: "conn-1",
        options: PlanOptions { environment: "prod".into(), schema: KeySchema::parse(schema).unwrap(), keep_removed: false },
        retry: RetryPolicy { attempts, base: Duration::ZERO },
    }
}

async fn run(connector: &Fly, schema: &str, set: &[(&str, &str)]) -> Result<vx_connectors::Report, SyncError> {
    sync(connector, &Events::default(), &Fingerprinter::new(b"k"), &request(schema, 3), &values(set)).await
}

// ---- writes ----

#[tokio::test]
async fn all_secrets_are_set_in_one_mutation_and_names_keep_their_case() {
    let (fake, port) = start(&[]).await;
    let report = run(&fly(port, false), "{{secretKey}}", &[("db_url", CANARY), ("ApiKey", "two"), ("TOKEN", "three")]).await.unwrap();
    assert!(report.ok(), "{report:?}");
    assert_eq!(report.put, 3);
    assert_eq!(fake.count("POST /graphql"), 2, "one listing, one setSecrets, nothing else");
    assert_eq!(fake.bodies.lock().unwrap().iter().filter(|b| b.contains("SetAppSecrets")).count(), 1, "one release for three secrets");
    let stored = fake.secrets();
    assert_eq!((stored["db_url"].as_str(), stored["ApiKey"].as_str(), stored["TOKEN"].as_str()), (CANARY, "two", "three"));
    assert_eq!(fake.app.lock().unwrap().release, 1);
}

#[tokio::test]
async fn stale_names_the_schema_owns_are_removed_in_one_mutation_and_others_are_left_alone() {
    let (fake, port) = start(&[]).await;
    {
        let mut app = fake.app.lock().unwrap();
        for k in ["app_old1", "app_old2", "OTHER", "App_Mixed"] {
            app.secrets.insert(k.into(), "x".into());
        }
    }
    let report = run(&fly(port, false), "app_{{secretKey}}", &[("new", "v")]).await.unwrap();
    assert_eq!((report.put, report.deleted), (1, 2));
    let names: Vec<String> = fake.secrets().keys().cloned().collect();
    assert_eq!(names, ["App_Mixed", "OTHER", "app_new"], "Fly names are case-sensitive: App_Mixed is not app_*");
    assert_eq!(fake.bodies.lock().unwrap().iter().filter(|b| b.contains("UnsetAppSecrets")).count(), 1);
}

#[tokio::test]
async fn names_fly_will_not_accept_fail_alone_and_are_not_sent() {
    let (fake, port) = start(&[]).await;
    let report = run(&fly(port, false), "{{secretKey}}", &[("bad-name", "v"), ("1st", "v"), ("good", "v")]).await.unwrap();
    assert_eq!(report.put, 1);
    let mut failed: Vec<_> = report.failed.iter().map(|f| (f.name.as_str(), f.code)).collect();
    failed.sort_unstable();
    assert_eq!(failed, [("1st", "invalid_secret_name"), ("bad-name", "invalid_secret_name")]);
    assert_eq!(fake.secrets().keys().collect::<Vec<_>>(), ["good"]);
    assert!(!fake.bodies.lock().unwrap().iter().any(|b| b.contains("bad-name")), "a refused name never reached Fly");
}

// ---- redeploy ----

#[tokio::test]
async fn redeploy_updates_each_live_machine_to_the_latest_release_and_skips_destroyed_ones() {
    let (fake, port) = start(&[("m1", "started", false), ("m2", "destroyed", false), ("m3", "stopped", false), ("m4", "destroying", false)]).await;
    fake.app.lock().unwrap().secrets.insert("app_old".into(), "x".into());
    let report = run(&fly(port, true), "app_{{secretKey}}", &[("new", "v")]).await.unwrap();
    assert!(report.ok(), "{report:?}");
    let release = fake.app.lock().unwrap().release;
    assert_eq!(release, 2, "one release for the delete and one for the write");
    assert_eq!(fake.machine("m1"), (Some(2), true), "machines must start with at least the release the write made");
    assert_eq!(fake.machine("m3"), (Some(2), true));
    assert_eq!(fake.machine("m2"), (None, false));
    assert_eq!(fake.machine("m4"), (None, false));
    assert_eq!(fake.count("/wait?state=started&timeout=60"), 2, "each updated machine was waited for");
}

#[tokio::test]
async fn without_redeploy_no_machine_is_touched_and_with_nothing_to_change_none_is_either() {
    let (fake, port) = start(&[("m1", "started", false)]).await;
    run(&fly(port, false), "{{secretKey}}", &[("a", "v")]).await.unwrap();
    assert_eq!(fake.count("/v1/"), 0, "redeploy is off");
    // nothing desired and nothing stale: nothing changed, so even with redeploy on the machines are left alone
    let report = run(&fly(port, true), "zz_{{secretKey}}", &[]).await.unwrap();
    assert_eq!((report.put, report.deleted), (0, 0));
    assert_eq!(fake.count("/v1/"), 0);
    assert_eq!(fake.count("GetAppName"), 0);
}

#[tokio::test]
async fn one_stuck_machine_is_reported_and_the_others_are_still_updated() {
    let (fake, port) = start(&[("m1", "started", false), ("m2", "started", true), ("m3", "started", false)]).await;
    let report = run(&fly(port, true), "{{secretKey}}", &[("a", "v")]).await.unwrap();
    assert_eq!(report.put, 1, "the secrets were written");
    assert_eq!(report.after_sync_failed.as_ref().map(|f| f.code), Some("redeploy_partial"));
    assert!(!report.ok());
    assert!(fake.machine("m1").1 && fake.machine("m3").1, "the machines after the stuck one were still updated");
    assert!(!fake.machine("m2").1);
}

// ---- failures ----

#[tokio::test]
async fn graphql_errors_in_a_200_are_failures_with_codes_and_a_rejection_is_not_retried() {
    let (fake, port) = start(&[]).await;
    // a write the account may not make fails every name in the batch, once
    fake.graphql_failures.lock().unwrap().push_back(("SetAppSecrets".into(), "Not authorized to set secrets".into()));
    let report = run(&fly(port, false), "{{secretKey}}", &[("a", "v"), ("b", "v")]).await.unwrap();
    assert_eq!(report.put, 0);
    assert_eq!(report.failed.len(), 2);
    assert!(report.failed.iter().all(|f| (f.kind, f.code) == (ErrorKind::Auth, "forbidden")));
    assert_eq!(fake.count("POST /graphql"), 2, "one listing and one write: not retried");
    assert!(fake.secrets().is_empty());
}

#[tokio::test]
async fn a_rate_limit_message_and_a_502_are_retried_and_then_succeed() {
    let (fake, port) = start(&[]).await;
    fake.graphql_failures.lock().unwrap().push_back(("SetAppSecrets".into(), "Rate limit exceeded, slow down".into()));
    fake.http_failures.lock().unwrap().push_back(("/graphql".into(), 502, vec![]));
    let report = run(&fly(port, false), "{{secretKey}}", &[("a", "v")]).await.unwrap();
    assert!(report.ok(), "{report:?}");
    assert_eq!(fake.secrets().get("a").map(String::as_str), Some("v"));
}

#[tokio::test]
async fn an_unknown_app_stops_the_sync_at_the_listing() {
    let (fake, port) = start(&[]).await;
    let connector = Fly::new(&creds(TOKEN), "nope", false, FlyBase::loopback(port)).unwrap();
    let error = run(&connector, "{{secretKey}}", &[("a", "v")]).await.unwrap_err();
    assert!(matches!(error, SyncError::List(e) if e.kind == ErrorKind::NotFound && e.code == "target_not_found"), "{error:?}");
    assert!(fake.secrets().is_empty());
    assert_eq!(fake.count("SetAppSecrets"), 0);
}

#[tokio::test]
async fn check_tells_a_good_token_from_a_bad_one() {
    let (_, port) = start(&[]).await;
    assert!(fly(port, false).check().await.is_ok());
    let bad = Fly::new(&creds("wrong"), APP, false, FlyBase::loopback(port)).unwrap();
    let error = bad.check().await.unwrap_err();
    assert_eq!((error.kind, error.code), (ErrorKind::Auth, "bad_credentials"));
    // and a bad token on any other call is a 401
    let report_error = run(&bad, "{{secretKey}}", &[("a", "v")]).await.unwrap_err();
    assert!(matches!(report_error, SyncError::List(e) if e.code == "bad_credentials"));
}

#[tokio::test]
async fn a_redirect_is_never_followed() {
    let (elsewhere, elsewhere_port) = start(&[]).await;
    let (fake, port) = start(&[]).await;
    fake.http_failures.lock().unwrap().push_back(("/graphql".into(), 302, vec![("location".into(), format!("http://127.0.0.1:{elsewhere_port}/graphql"))]));
    let error = fly(port, false).check().await.unwrap_err();
    assert_eq!(error.code, "unexpected_redirect");
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(elsewhere.requests.lock().unwrap().is_empty(), "the token was not sent to the redirect target");
}

// ---- nothing leaks ----

#[tokio::test]
async fn a_value_is_in_one_request_body_and_nowhere_else() {
    let (fake, port) = start(&[("m1", "started", false)]).await;
    fake.graphql_failures.lock().unwrap().push_back(("SetAppSecrets".into(), format!("Rate limit exceeded while setting {CANARY}")));
    let events = Events::default();
    let result = sync(&fly(port, true), &events, &Fingerprinter::new(b"k"), &request("{{secretKey}}", 3), &values(&[("a", CANARY), ("b", CANARY)])).await;
    let mut seen = format!("{result:?}\n");
    for event in events.0.lock().unwrap().iter() {
        seen.push_str(&format!("{event:?} {}\n", serde_json::to_string(event).unwrap()));
    }
    seen.push_str(&fake.requests.lock().unwrap().join("\n"));
    assert!(!seen.contains("CANARY"), "a value (or an error that quoted it) reached a URL, the report, an error or an audit row: {seen}");

    // the second attempt succeeded: the value is in exactly the setSecrets bodies, and in no other request body
    assert_eq!(fake.secrets().get("a").map(String::as_str), Some(CANARY));
    let bodies = fake.bodies.lock().unwrap();
    let holding: Vec<&String> = bodies.iter().filter(|b| b.contains("CANARY")).collect();
    assert!(!holding.is_empty() && holding.iter().all(|b| b.contains("SetAppSecrets")), "the value travels only in the write itself");
}
