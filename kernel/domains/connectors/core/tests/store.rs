#![allow(clippy::unwrap_used, clippy::disallowed_methods)] // test helpers; tests read values to compare them
//! Connections, syncs and the audit sink against a real Postgres (`node scripts/test-vx.mjs` provides one).
//! Without `VX_TEST_DATABASE_URL` these tests print "skipped" and pass, so a plain `cargo test` proves nothing about them.

mod common;
use common::*;
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;
use vx_connectors::*;
use vx_keys::Keyring;
use vx_secret::Secret;
use vx_store::testing::database;

macro_rules! db_or_skip {
    () => {
        match database().await {
            Some(db) => db,
            None => {
                eprintln!("skipped: VX_TEST_DATABASE_URL is not set");
                return;
            }
        }
    };
}

const CREDENTIAL_CANARY: &str = "ghp_CANARY-credential-5b1d-do-not-store-in-plain";

fn ring() -> Keyring {
    Keyring::new(Keyring::generate_root()).unwrap()
}

fn credentials() -> Secret {
    Secret::from_string(json!({ "token": CREDENTIAL_CANARY }).to_string())
}

fn text_of(secret: &Secret) -> String {
    String::from_utf8(secret.expose().to_vec()).unwrap()
}

/// Every row of every table, as text, so a plaintext copy anywhere in the database is found.
async fn whole_database_as_text(pool: &PgPool) -> String {
    let tables: Vec<String> = sqlx::query_scalar("SELECT tablename::text FROM pg_tables WHERE schemaname = 'public'").fetch_all(pool).await.unwrap();
    let mut all = String::new();
    for table in tables {
        let rows = sqlx::query(&format!("SELECT t::text AS row FROM \"{table}\" t")).fetch_all(pool).await.unwrap();
        for row in rows {
            all.push_str(&row.get::<String, _>("row"));
            all.push('\n');
        }
    }
    all
}

#[tokio::test]
async fn credentials_are_sealed_never_listed_and_never_in_the_database_in_the_clear() {
    let db = db_or_skip!();
    let ring = ring();
    let id = create_connection(&db.pool, &ring, "proj", "github", "ci", &credentials(), "user:alice").await.unwrap();

    let listed = list_connections(&db.pool, "proj").await.unwrap();
    assert_eq!(listed.len(), 1);
    let rendered = format!("{listed:?} {}", serde_json::to_string(&listed).unwrap());
    assert!(!rendered.contains("CANARY"), "a listing carried the credentials");
    assert!(!format!("{:?}", get_connection(&db.pool, "proj", id).await.unwrap()).contains("CANARY"));

    let everything = whole_database_as_text(&db.pool).await;
    assert!(everything.contains("connector.connection.created"), "the scan did read the audit rows");
    assert!(!everything.contains("CANARY"), "the credential reached a table in the clear");
    assert!(!everything.contains(&CREDENTIAL_CANARY[..12]));
    db.finish().await;
}

#[tokio::test]
async fn opening_returns_exactly_what_was_stored_and_is_recorded_without_the_value() {
    let db = db_or_skip!();
    let ring = ring();
    let id = create_connection(&db.pool, &ring, "proj", "github", "ci", &credentials(), "user:alice").await.unwrap();
    let opened = open_credentials(&db.pool, &ring, "proj", id, "sync:daily", "sync").await.unwrap();
    assert_eq!(text_of(&opened), json!({ "token": CREDENTIAL_CANARY }).to_string());

    let events = vx_audit::list(&db.pool, "proj", 50).await.unwrap();
    let read = events.iter().find(|e| e.action == "connector.credentials.opened").expect("the read was recorded");
    assert!(read.has_value_fingerprint, "the read carries a keyed fingerprint, so 'this was read' is provable");
    assert_eq!(read.actor, "sync:daily");
    assert!(!format!("{events:?}").contains("CANARY"));
    assert_eq!(vx_audit::verify(&db.pool, "proj").await.unwrap(), events.len() as i64, "the chain verifies");
    db.finish().await;
}

#[tokio::test]
async fn another_project_cannot_see_or_open_a_connection_and_looks_the_same_as_a_missing_one() {
    let db = db_or_skip!();
    let ring = ring();
    let id = create_connection(&db.pool, &ring, "proj-a", "github", "ci", &credentials(), "user:alice").await.unwrap();
    assert!(list_connections(&db.pool, "proj-b").await.unwrap().is_empty());
    let other = open_credentials(&db.pool, &ring, "proj-b", id, "x", "sync").await.unwrap_err();
    let missing = open_credentials(&db.pool, &ring, "proj-b", Uuid::new_v4(), "x", "sync").await.unwrap_err();
    assert!(matches!(other, StoreError::NotFound) && matches!(missing, StoreError::NotFound));
    assert_eq!(other.to_string(), missing.to_string());
    db.finish().await;
}

#[tokio::test]
async fn a_sealed_document_copied_to_another_connection_will_not_open() {
    let db = db_or_skip!();
    let ring = ring();
    let a = create_connection(&db.pool, &ring, "proj", "github", "a", &credentials(), "u").await.unwrap();
    let b = create_connection(&db.pool, &ring, "proj", "github", "b", &Secret::from_string("{\"token\":\"other\"}".into()), "u").await.unwrap();
    sqlx::query("UPDATE vx_connectors_connections SET sealed = (SELECT sealed FROM vx_connectors_connections WHERE id = $1) WHERE id = $2").bind(a).bind(b).execute(&db.pool).await.unwrap();
    assert!(open_credentials(&db.pool, &ring, "proj", b, "x", "sync").await.is_err(), "the ciphertext is bound to its own connection");
    assert!(open_credentials(&db.pool, &ring, "proj", a, "x", "sync").await.is_ok());
    db.finish().await;
}

#[tokio::test]
async fn a_different_root_key_cannot_open_anything() {
    let db = db_or_skip!();
    let id = create_connection(&db.pool, &ring(), "proj", "github", "ci", &credentials(), "u").await.unwrap();
    assert!(open_credentials(&db.pool, &ring(), "proj", id, "x", "sync").await.is_err());
    db.finish().await;
}

#[tokio::test]
async fn bad_input_and_duplicates_are_refused_with_a_reason() {
    let db = db_or_skip!();
    let ring = ring();
    create_connection(&db.pool, &ring, "proj", "github", "ci", &credentials(), "u").await.unwrap();
    let duplicate = create_connection(&db.pool, &ring, "proj", "github", "ci", &credentials(), "u").await.unwrap_err();
    assert!(matches!(duplicate, StoreError::Invalid(m) if m.contains("already exists")));
    for (kind, name) in [("", "n"), ("bad kind", "n"), ("github", ""), ("github", "has space")] {
        assert!(matches!(create_connection(&db.pool, &ring, "proj", kind, name, &credentials(), "u").await, Err(StoreError::Invalid(_))), "{kind:?} {name:?}");
    }
    assert!(matches!(create_connection(&db.pool, &ring, "proj", "github", "empty", &Secret::from_string(String::new()), "u").await, Err(StoreError::Invalid(_))));
    db.finish().await;
}

#[tokio::test]
async fn a_sync_with_a_schema_the_grammar_refuses_is_refused_when_saved() {
    let db = db_or_skip!();
    let ring = ring();
    let connection = create_connection(&db.pool, &ring, "proj", "github", "ci", &credentials(), "u").await.unwrap();
    let new = |schema: &'static str, project: &'static str| NewSync { project, connection_id: connection, environment: "prod", path: "/", destination: json!({ "repo": "a/b" }), key_schema: schema, keep_removed: false };
    assert!(create_sync(&db.pool, new("{{secretKey}}", "proj"), "u").await.is_ok());
    for bad in ["plain", "{{{secretKey}}}", "{{upper secretKey}}", "{{secretKey}}{{secretKey}}"] {
        assert!(matches!(create_sync(&db.pool, new(bad, "proj"), "u").await, Err(StoreError::Invalid(_))), "{bad}");
    }
    assert!(matches!(create_sync(&db.pool, new("{{secretKey}}", "other-project"), "u").await, Err(StoreError::NotFound)), "a connection from another project cannot be used");
    assert_eq!(list_syncs(&db.pool, "proj").await.unwrap().len(), 1);
    db.finish().await;
}

#[tokio::test]
async fn deleting_a_connection_removes_its_syncs_and_is_recorded() {
    let db = db_or_skip!();
    let ring = ring();
    let connection = create_connection(&db.pool, &ring, "proj", "github", "ci", &credentials(), "u").await.unwrap();
    create_sync(&db.pool, NewSync { project: "proj", connection_id: connection, environment: "prod", path: "/", destination: json!({}), key_schema: "{{secretKey}}", keep_removed: false }, "u").await.unwrap();
    delete_connection(&db.pool, "proj", connection, "u").await.unwrap();
    assert!(list_connections(&db.pool, "proj").await.unwrap().is_empty());
    assert!(list_syncs(&db.pool, "proj").await.unwrap().is_empty());
    assert!(matches!(delete_connection(&db.pool, "proj", connection, "u").await, Err(StoreError::NotFound)));
    let events = vx_audit::list(&db.pool, "proj", 50).await.unwrap();
    assert!(events.iter().any(|e| e.action == "connector.connection.deleted"));
    db.finish().await;
}

#[tokio::test]
async fn if_the_audit_record_cannot_be_written_nothing_is_created_and_nothing_is_returned() {
    let db = db_or_skip!();
    let ring = ring();
    let id = create_connection(&db.pool, &ring, "proj", "github", "ci", &credentials(), "u").await.unwrap();
    sqlx::query("ALTER TABLE vx_operate_audit_events RENAME TO vx_operate_audit_events_off").execute(&db.pool).await.unwrap();

    assert!(open_credentials(&db.pool, &ring, "proj", id, "x", "sync").await.is_err(), "no credentials without a record of the read");
    assert!(create_connection(&db.pool, &ring, "proj", "github", "second", &credentials(), "u").await.is_err());
    assert!(delete_connection(&db.pool, "proj", id, "u").await.is_err());

    sqlx::query("ALTER TABLE vx_operate_audit_events_off RENAME TO vx_operate_audit_events").execute(&db.pool).await.unwrap();
    let names: Vec<String> = list_connections(&db.pool, "proj").await.unwrap().into_iter().map(|c| c.name).collect();
    assert_eq!(names, ["ci"], "the failed create left no row, and the failed delete left the connection");
    db.finish().await;
}

#[tokio::test]
async fn a_real_sync_is_recorded_in_the_hash_chain_without_any_value() {
    let db = db_or_skip!();
    let log = new_log();
    let dest = Memory::new(&log).seed("prod_STALE", CANARY);
    let audit = PgAudit::new(db.pool.clone());
    let set = values(&[("A", CANARY), ("B", CANARY)]);
    let report = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{environment}}_{{secretKey}}", false, 2), &set).await.unwrap();
    assert_eq!((report.put, report.deleted), (2, 1));

    let mut events = vx_audit::list(&db.pool, "proj-1", 50).await.unwrap();
    events.sort_by_key(|e| e.seq); // list returns newest first
    let actions: Vec<&str> = events.iter().map(|e| e.action.as_str()).collect();
    assert_eq!(actions, ["connector.sync.planned", "connector.sync.finished"]);
    assert_eq!(vx_audit::verify(&db.pool, "proj-1").await.unwrap(), 2);
    let everything = whole_database_as_text(&db.pool).await;
    assert!(everything.contains("connector.sync.planned"));
    assert!(!everything.contains("CANARY"), "a value reached the database through the audit sink");
    db.finish().await;
}

#[tokio::test]
async fn if_the_real_audit_sink_is_down_the_sync_changes_nothing() {
    let db = db_or_skip!();
    let log = new_log();
    let dest = Memory::new(&log).seed("prod_STALE", "old");
    let audit = PgAudit::new(db.pool.clone());
    db.pool.close().await;
    let error = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{environment}}_{{secretKey}}", false, 2), &values(&[("A", "one")])).await.unwrap_err();
    assert!(matches!(error, SyncError::NotRecorded(_)), "{error}");
    assert_eq!(dest.calls("put:"), 0);
    assert_eq!(dest.calls("delete:"), 0);
    assert_eq!(dest.store.lock().unwrap().keys().collect::<Vec<_>>(), ["prod_STALE"]);
    db.finish().await;
}
