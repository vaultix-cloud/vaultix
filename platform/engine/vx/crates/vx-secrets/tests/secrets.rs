#![allow(clippy::unwrap_used, clippy::disallowed_methods)] // test helpers; tests read values to compare them
use vx_keys::Keyring;
use vx_secret::Secret;
use vx_secrets::{create_handle, list, put, redeem, Address, SecretsError};
use vx_store::testing::database;

const CANARY: &str = "canary-live-4f7a91-do-not-store-in-plain";

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

fn ring() -> Keyring {
    Keyring::new(Keyring::generate_root()).unwrap()
}

fn address(name: &str) -> Address {
    Address::parse("payments", "prod", None, name).unwrap()
}

async fn everything_stored(pool: &sqlx::PgPool) -> String {
    let mut all = String::new();
    for table in ["vx_secrets_secrets", "vx_secrets_versions", "vx_secrets_handles", "vx_kms_keys", "vx_operate_audit_events", "vx_operate_jobs"] {
        let rows: Vec<String> = sqlx::query_scalar(&format!("SELECT row_to_json(t)::text FROM {table} t")).fetch_all(pool).await.unwrap();
        all.push_str(&rows.join("\n"));
    }
    all
}

#[tokio::test]
async fn a_value_is_stored_as_ciphertext_and_listing_shows_only_metadata() {
    let db = db_or_skip!();
    let ring = ring();
    let value = Secret::from_string(CANARY.into());
    assert_eq!(put(&db.pool, &ring, &address("API_TOKEN"), &value, "human:ada").await.unwrap(), 1);
    assert_eq!(put(&db.pool, &ring, &address("API_TOKEN"), &Secret::from_string("second".into()), "human:ada").await.unwrap(), 2);
    let items = list(&db.pool, "payments", "prod").await.unwrap();
    assert_eq!((items.len(), items[0].name.as_str(), items[0].version, items[0].updated_by.as_str()), (1, "API_TOKEN", 2, "human:ada"));
    assert!(!serde_json::to_string(&items).unwrap().contains(CANARY));
    let stored = everything_stored(&db.pool).await;
    assert!(!stored.contains(CANARY), "no table may hold the value");
    for form in [hex_of(CANARY), b64_of(CANARY)] {
        assert!(!stored.contains(&form), "nor an encoding of it");
    }
    assert_eq!(vx_audit::verify(&db.pool, "payments").await.unwrap(), 2, "each write is on the audit chain");
    db.finish().await;
}

fn hex_of(text: &str) -> String {
    text.bytes().map(|b| format!("{b:02x}")).collect()
}
fn b64_of(text: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(text)
}

#[tokio::test]
async fn a_handle_returns_the_value_once_to_the_identity_it_was_made_for() {
    let db = db_or_skip!();
    let ring = ring();
    put(&db.pool, &ring, &address("API_TOKEN"), &Secret::from_string(CANARY.into()), "human:ada").await.unwrap();
    let injection = create_handle(&db.pool, "mcp:claude", "deploy check", &[address("API_TOKEN")], 60).await.unwrap();

    assert!(matches!(redeem(&db.pool, &ring, "mcp:someone-else", &injection.handle).await, Err(SecretsError::HandleInvalid)), "another identity");
    let values = redeem(&db.pool, &ring, "mcp:claude", &injection.handle).await.unwrap();
    assert_eq!(values[0].0.name, "API_TOKEN");
    assert_eq!(values[0].1.expose(), CANARY.as_bytes());
    assert!(matches!(redeem(&db.pool, &ring, "mcp:claude", &injection.handle).await, Err(SecretsError::HandleInvalid)), "a second use");

    let stored = everything_stored(&db.pool).await;
    assert!(!stored.contains(&injection.handle), "the handle itself is never stored");
    assert!(!stored.contains(CANARY));
    let events = vx_audit::list(&db.pool, "payments", 10).await.unwrap();
    let read = events.iter().find(|e| e.action == "secret.value.read").expect("the read is recorded");
    assert!((read.actor.as_str(), read.has_value_fingerprint) == ("mcp:claude", true));
    assert!(events.iter().any(|e| e.action == "secret.injection.created"));
    assert_eq!(vx_audit::verify(&db.pool, "payments").await.unwrap(), 3);
    db.finish().await;
}

#[tokio::test]
async fn expired_unknown_and_malformed_handles_are_refused_the_same_way() {
    let db = db_or_skip!();
    let ring = ring();
    put(&db.pool, &ring, &address("API_TOKEN"), &Secret::from_string(CANARY.into()), "human:ada").await.unwrap();
    let injection = create_handle(&db.pool, "mcp:claude", "x", &[address("API_TOKEN")], 60).await.unwrap();
    sqlx::query("UPDATE vx_secrets_handles SET expires_at = now() - interval '1 second'").execute(&db.pool).await.unwrap();
    for handle in [injection.handle.as_str(), "vxh_does-not-exist", "not-a-handle", ""] {
        assert!(matches!(redeem(&db.pool, &ring, "mcp:claude", handle).await, Err(SecretsError::HandleInvalid)), "{handle}");
    }
    db.finish().await;
}

#[tokio::test]
async fn naming_a_missing_secret_or_a_bad_address_is_refused() {
    let db = db_or_skip!();
    assert!(matches!(create_handle(&db.pool, "mcp:claude", "x", &[address("NOPE")], 60).await, Err(SecretsError::NotFound(_))));
    assert!(matches!(create_handle(&db.pool, "mcp:claude", "x", &[], 60).await, Err(SecretsError::BadRefCount)));
    for (project, environment, path, name) in [
        ("Payments", "prod", "/", "A"),
        ("payments", "pr od", "/", "A"),
        ("payments", "prod", "no-slash", "A"),
        ("payments", "prod", "/../etc/", "A"),
        ("payments", "prod", "/", "bad name"),
        ("payments", "prod", "/", "1STARTS_WITH_DIGIT"),
        ("payments", "prod", "/", "semi;colon"),
    ] {
        assert!(Address::parse(project, environment, Some(path), name).is_err(), "{project} {environment} {path} {name}");
    }
    db.finish().await;
}

#[tokio::test]
async fn a_ciphertext_moved_to_another_secret_will_not_open() {
    let db = db_or_skip!();
    let ring = ring();
    put(&db.pool, &ring, &address("API_TOKEN"), &Secret::from_string(CANARY.into()), "human:ada").await.unwrap();
    put(&db.pool, &ring, &address("OTHER"), &Secret::from_string("harmless".into()), "human:ada").await.unwrap();
    // An attacker with write access to the database copies one secret's ciphertext over another's.
    sqlx::query(
        "UPDATE vx_secrets_versions SET sealed = (SELECT sealed FROM vx_secrets_versions v JOIN vx_secrets_secrets s ON s.id = v.secret_id WHERE s.name = 'API_TOKEN')
         WHERE secret_id = (SELECT id FROM vx_secrets_secrets WHERE name = 'OTHER')",
    )
    .execute(&db.pool)
    .await
    .unwrap();
    let injection = create_handle(&db.pool, "mcp:claude", "x", &[address("OTHER")], 60).await.unwrap();
    assert!(redeem(&db.pool, &ring, "mcp:claude", &injection.handle).await.is_err(), "the swapped ciphertext must not decrypt as OTHER");
    db.finish().await;
}

#[tokio::test]
async fn first_writes_racing_in_one_project_create_exactly_one_key() {
    let db = db_or_skip!();
    let ring = std::sync::Arc::new(ring());
    let mut tasks = Vec::new();
    for n in 0..8 {
        let (pool, ring) = (db.pool.clone(), ring.clone());
        tasks.push(tokio::spawn(async move { put(&pool, &ring, &address(&format!("SECRET_{n}")), &Secret::from_string(format!("v{n}")), "human:ada").await.unwrap() }));
    }
    for task in tasks {
        task.await.unwrap();
    }
    let keys: i64 = sqlx::query_scalar("SELECT count(*) FROM vx_kms_keys WHERE scope = 'project:payments'").fetch_one(&db.pool).await.unwrap();
    assert_eq!(keys, 1);
    assert_eq!(list(&db.pool, "payments", "prod").await.unwrap().len(), 8);
    assert_eq!(vx_audit::verify(&db.pool, "payments").await.unwrap(), 8);
    db.finish().await;
}
