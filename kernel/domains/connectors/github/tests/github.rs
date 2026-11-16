#![allow(clippy::unwrap_used, clippy::disallowed_methods)] // tests read values to compare them
//! The GitHub connector against a fake GitHub (tests/fake.rs), driven through the real sync engine.

mod fake;
use fake::*;
use serde_json::json;
use std::sync::Mutex;
use std::time::Duration;
use vx_connector_github::{ApiBase, Auth, GitHub, Target, Visibility};
use vx_connectors::{sync, AuditSink, Connector, ErrorKind, Fingerprinter, KeySchema, PlanOptions, RetryPolicy, SyncError, SyncRequest};
use vx_secret::Secret;

const CANARY: &str = "CANARY-gh-value-71c0-do-not-leak";
const REPO: &str = "/repos/acme/web/actions/secrets";

#[derive(Default)]
struct Events(Mutex<Vec<vx_audit::Event>>);
impl AuditSink for Events {
    async fn record(&self, event: vx_audit::Event) -> Result<(), vx_audit::AuditError> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}

fn pat_auth() -> Auth {
    Auth::parse(&Secret::from_string(json!({ "method": "pat", "token": PAT }).to_string())).unwrap()
}

fn app_auth(private_key: &str) -> Auth {
    Auth::parse(&Secret::from_string(json!({ "method": "app", "appId": APP_ID, "installationId": INSTALLATION_ID, "privateKey": private_key }).to_string())).unwrap()
}

fn repo() -> Target {
    Target::Repository { owner: "acme".into(), repo: "web".into() }
}

fn github(auth: Auth, target: Target, port: u16) -> GitHub {
    GitHub::new(auth, target, ApiBase::loopback(port)).unwrap()
}

fn values(pairs: &[(&str, &str)]) -> Vec<(String, Secret)> {
    pairs.iter().map(|(k, v)| ((*k).to_string(), Secret::from_string((*v).to_string()))).collect()
}

fn request(schema: &str, keep_removed: bool, attempts: u32) -> SyncRequest<'static> {
    SyncRequest {
        chain: "proj",
        actor: "user:alice",
        connection: "conn-1",
        options: PlanOptions { environment: "prod".into(), schema: KeySchema::parse(schema).unwrap(), keep_removed },
        retry: RetryPolicy { attempts, base: Duration::ZERO },
    }
}

async fn run(connector: &GitHub, set: &[(&str, &str)]) -> Result<vx_connectors::Report, SyncError> {
    sync(connector, &Events::default(), &Fingerprinter::new(b"k"), &request("{{secretKey}}", false, 3), &values(set)).await
}

// ---- both authentication methods, end to end ----

#[tokio::test]
async fn a_personal_access_token_syncs_secrets_that_arrive_decrypted_and_upper_cased() {
    let (fake, port) = start(100).await;
    let report = run(&github(pat_auth(), repo(), port), &[("db_url", CANARY), ("api_key", "second-value")]).await.unwrap();
    assert!(report.ok(), "{report:?}");
    assert_eq!(report.put, 2);
    let stored = fake.values(REPO);
    assert_eq!(stored.get("DB_URL").map(String::as_str), Some(CANARY), "the destination decrypted exactly the value");
    assert_eq!(stored.get("API_KEY").map(String::as_str), Some("second-value"));
    assert_eq!(fake.tokens_minted.load(std::sync::atomic::Ordering::SeqCst), 0, "a token needs no installation token");
}

#[tokio::test]
async fn a_github_app_signs_a_jwt_mints_one_installation_token_and_reuses_it() {
    let (fake, port) = start(100).await;
    let report = run(&github(app_auth(&app_keys().0), repo(), port), &[("a", CANARY), ("b", CANARY), ("c", CANARY)]).await.unwrap();
    assert!(report.ok(), "{report:?}");
    assert_eq!(fake.values(REPO).len(), 3);
    assert_eq!(fake.tokens_minted.load(std::sync::atomic::Ordering::SeqCst), 1, "the fake verified the RS256 signature, the issuer and the 10 minute window, once");
    assert!(fake.request_count("access_tokens") == 1);
}

#[tokio::test]
async fn an_app_key_that_does_not_match_the_app_is_refused_by_github_and_reported_as_auth() {
    let (fake, port) = start(100).await;
    let error = run(&github(app_auth(&other_private_key()), repo(), port), &[("a", "v")]).await.unwrap_err();
    // the first request is the listing, so the sync stops there: nothing is planned and nothing is written
    assert!(matches!(error, SyncError::List(e) if e.kind == ErrorKind::Auth && e.code == "bad_credentials"), "{error:?}");
    assert!(fake.values(REPO).is_empty());
    assert_eq!(fake.request_count("PUT"), 0);
}

#[tokio::test]
async fn an_unreadable_private_key_is_reported_without_quoting_it() {
    let (_, port) = start(100).await;
    let error = run(&github(app_auth("-----BEGIN RSA PRIVATE KEY-----\nPRIVATE-CANARY\n-----END RSA PRIVATE KEY-----"), repo(), port), &[("a", "v")]).await.unwrap_err();
    assert!(matches!(&error, SyncError::List(e) if e.code == "private_key_not_usable"), "{error:?}");
    assert!(!format!("{error:?} {error}").contains("CANARY"));
}

#[tokio::test]
async fn a_revoked_installation_token_is_replaced_and_the_sync_still_completes() {
    let (fake, port) = start(100).await;
    let connector = github(app_auth(&app_keys().0), repo(), port);
    assert!(run(&connector, &[("a", "one")]).await.unwrap().ok());
    *fake.installation_token.lock().unwrap() = "ghs_installation-token-2".into(); // GitHub revoked the cached one
    let report = run(&connector, &[("a", "two")]).await.unwrap();
    assert!(report.ok(), "{report:?}");
    assert_eq!(fake.tokens_minted.load(std::sync::atomic::Ordering::SeqCst), 2);
    assert_eq!(fake.values(REPO)["A"], "two");
}

// ---- the three scopes ----

#[tokio::test]
async fn a_repository_environment_has_its_own_path() {
    let (fake, port) = start(100).await;
    let target = Target::Environment { owner: "acme".into(), repo: "web".into(), environment: "production".into() };
    assert!(run(&github(pat_auth(), target, port), &[("token", "v")]).await.unwrap().ok());
    assert_eq!(fake.values("/repos/acme/web/environments/production/secrets")["TOKEN"], "v");
    assert!(fake.values(REPO).is_empty());
}

#[tokio::test]
async fn an_organisation_secret_carries_its_visibility_and_selected_repositories() {
    let (fake, port) = start(100).await;
    let org = |visibility| Target::Organization { org: "acme".into(), visibility };
    run(&github(pat_auth(), org(Visibility::All), port), &[("a", "v")]).await.unwrap();
    run(&github(pat_auth(), org(Visibility::Private), port), &[("b", "v")]).await.unwrap();
    run(&github(pat_auth(), org(Visibility::Selected(vec![11, 22])), port), &[("c", "v")]).await.unwrap();
    let meta = fake.meta.lock().unwrap().clone();
    let scope = "/orgs/acme/actions/secrets".to_string();
    assert_eq!(meta[&(scope.clone(), "A".into())], json!({ "key_id": "key-1", "visibility": "all" }));
    assert_eq!(meta[&(scope.clone(), "B".into())]["visibility"], "private");
    assert_eq!(meta[&(scope, "C".into())], json!({ "key_id": "key-1", "visibility": "selected", "selected_repository_ids": [11, 22] }));
}

// ---- sync semantics ----

#[tokio::test]
async fn it_lists_across_pages_and_deletes_only_what_the_schema_owns() {
    let (fake, port) = start(2).await; // two per page, so five secrets take three pages
    for name in ["APP_ONE", "APP_TWO", "APP_THREE", "OTHER_A", "OTHER_B"] {
        fake.seed(REPO, name, "x");
    }
    let report = sync(&github(pat_auth(), repo(), port), &Events::default(), &Fingerprinter::new(b"k"), &request("app_{{secretKey}}", false, 3), &values(&[("one", "new")])).await.unwrap();
    assert_eq!((report.put, report.deleted), (1, 2), "APP_TWO and APP_THREE are ours and gone from Vaultix; OTHER_* is not ours");
    let names: Vec<String> = fake.values(REPO).keys().cloned().collect();
    assert_eq!(names, ["APP_ONE", "OTHER_A", "OTHER_B"]);
    assert!(fake.request_count("page=3") >= 1, "all pages were read");
}

#[tokio::test]
async fn names_that_collide_after_github_upper_cases_them_are_refused_before_anything_is_sent() {
    let (fake, port) = start(100).await;
    let error = run(&github(pat_auth(), repo(), port), &[("db_url", "one"), ("DB_URL", "two")]).await.unwrap_err();
    assert!(matches!(error, SyncError::NameCollision(ref names) if names == &["DB_URL"]), "{error}");
    assert_eq!(fake.request_count("PUT") + fake.request_count("DELETE"), 0, "nothing was written or deleted (the destination was only listed)");
}

#[tokio::test]
async fn names_github_will_not_accept_fail_one_item_and_not_the_rest() {
    let (fake, port) = start(100).await;
    let report = run(&github(pat_auth(), repo(), port), &[("github_token", "v"), ("1st", "v"), ("has-dash", "v"), ("fine", "v")]).await.unwrap();
    assert_eq!(report.put, 1);
    let mut failed: Vec<_> = report.failed.iter().map(|f| (f.name.clone(), f.code)).collect();
    failed.sort();
    assert_eq!(failed, [("1st".to_string(), "invalid_secret_name"), ("github_token".to_string(), "invalid_secret_name"), ("has-dash".to_string(), "invalid_secret_name")]);
    assert_eq!(fake.values(REPO).keys().collect::<Vec<_>>(), ["FINE"]);
}

#[tokio::test]
async fn a_value_over_the_size_limit_is_refused_locally() {
    let (fake, port) = start(100).await;
    let big = "x".repeat(48 * 1024 + 1);
    let report = run(&github(pat_auth(), repo(), port), &[("big", &big)]).await.unwrap();
    assert_eq!(report.failed[0].code, "value_too_large");
    assert_eq!(fake.request_count("PUT"), 0);
}

// ---- failures ----

#[tokio::test]
async fn a_rate_limit_is_waited_out_using_what_github_said() {
    let (fake, port) = start(100).await;
    fake.fail_next("/secrets/A", 429, &[("retry-after", "1")]);
    let started = std::time::Instant::now();
    let report = run(&github(pat_auth(), repo(), port), &[("a", "v")]).await.unwrap();
    assert!(report.ok(), "{report:?}");
    assert!(started.elapsed() >= Duration::from_secs(1), "Retry-After was ignored");
    assert_eq!(fake.request_count("PUT /repos/acme/web/actions/secrets/A"), 2);
}

#[tokio::test]
async fn a_403_with_no_quota_left_is_a_rate_limit_but_a_plain_403_is_a_permission_error_and_is_not_retried() {
    let (fake, port) = start(100).await;
    fake.fail_next("/secrets/A", 403, &[("x-ratelimit-remaining", "0"), ("retry-after", "0")]);
    assert!(run(&github(pat_auth(), repo(), port), &[("a", "v")]).await.unwrap().ok());
    fake.fail_next("/secrets/B", 403, &[]);
    let report = run(&github(pat_auth(), repo(), port), &[("b", "v")]).await.unwrap();
    assert_eq!((report.failed[0].kind, report.failed[0].code), (ErrorKind::Auth, "forbidden"));
    assert_eq!(fake.request_count("PUT /repos/acme/web/actions/secrets/B"), 1, "a permission error is not retried");
}

#[tokio::test]
async fn server_errors_are_retried_and_a_missing_target_is_not() {
    let (fake, port) = start(100).await;
    fake.fail_next("/secrets/A", 502, &[]);
    assert!(run(&github(pat_auth(), repo(), port), &[("a", "v")]).await.unwrap().ok());
    let missing = github(pat_auth(), Target::Repository { owner: "acme".into(), repo: "gone".into() }, port);
    let error = run(&missing, &[("a", "v")]).await;
    // the listing itself is refused: the target does not exist, so nothing is planned
    assert!(matches!(error, Err(SyncError::List(e)) if e.kind == ErrorKind::NotFound && e.code == "target_not_found"), "{error:?}");
    assert_eq!(fake.request_count("GET /repos/acme/gone"), 1, "a missing target is not retried");
}

#[tokio::test]
async fn a_bad_token_is_an_auth_error_and_check_reports_it() {
    let (_, port) = start(100).await;
    let bad = Auth::parse(&Secret::from_string(json!({ "method": "pat", "token": "wrong" }).to_string())).unwrap();
    let connector = github(bad, repo(), port);
    let error = connector.check().await.unwrap_err();
    assert_eq!((error.kind, error.code), (ErrorKind::Auth, "bad_credentials"));
    assert!(github(pat_auth(), repo(), port).check().await.is_ok());
}

#[tokio::test]
async fn deleting_something_already_gone_is_success() {
    let (fake, port) = start(100).await;
    let connector = github(pat_auth(), repo(), port);
    fake.seed(REPO, "GONE", "x");
    assert!(connector.delete("GONE").await.is_ok());
    assert!(connector.delete("GONE").await.is_ok(), "a second delete finds nothing and that is fine");
}

#[tokio::test]
async fn a_redirect_is_never_followed_so_a_credential_cannot_be_sent_elsewhere() {
    let (elsewhere, elsewhere_port) = start(100).await;
    let (fake, port) = start(100).await;
    fake.fail_next("/secrets/public-key", 302, &[("location", &format!("http://127.0.0.1:{elsewhere_port}/stolen"))]);
    let error = github(pat_auth(), repo(), port).check().await.unwrap_err();
    assert_eq!(error.code, "unexpected_redirect");
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(elsewhere.requests.lock().unwrap().is_empty(), "the other host received nothing, so the credential was not sent to it");
}

// ---- nothing leaks ----

#[tokio::test]
async fn no_value_is_in_any_url_request_body_report_error_or_audit_row() {
    let (fake, port) = start(100).await;
    fake.fail_next("/secrets/B", 500, &[]);
    fake.fail_next("/secrets/C", 422, &[]);
    let events = Events::default();
    let result = sync(&github(app_auth(&app_keys().0), repo(), port), &events, &Fingerprinter::new(b"k"), &request("{{secretKey}}", false, 3), &values(&[("a", CANARY), ("b", CANARY), ("c", CANARY)])).await;
    let report = result.as_ref().unwrap();
    assert_eq!(report.put, 2);
    assert_eq!(report.failed.len(), 1);

    let mut seen = format!("{result:?}\n");
    for event in events.0.lock().unwrap().iter() {
        seen.push_str(&format!("{event:?} {}\n", serde_json::to_string(event).unwrap()));
    }
    seen.push_str(&fake.requests.lock().unwrap().join("\n"));
    for body in fake.bodies.lock().unwrap().iter() {
        seen.push_str(body);
    }
    assert!(fake.values(REPO).values().all(|v| v == CANARY), "the values did arrive, decrypted, at the destination");
    assert!(!seen.contains("CANARY"), "a value reached a URL, a request body, the report or an audit row");
    assert!(seen.contains("encrypted_value"), "the bodies were inspected, and they hold only the sealed value");
}
