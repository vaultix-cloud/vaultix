use serde_json::json;
use vx_audit::{append, list, verify, AuditError, Event};
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

#[tokio::test]
async fn events_form_a_verifiable_chain() {
    let db = db_or_skip!();
    for n in 0..5 {
        let mut conn = db.pool.acquire().await.unwrap();
        let seq = append(&mut conn, Event::new("org-1", "user:ada", "secret.update", &format!("secret:{n}"), "applied").with_detail(json!({"version": n}))).await.unwrap();
        assert_eq!(seq, n + 1);
    }
    assert_eq!(verify(&db.pool, "org-1").await.unwrap(), 5);
    assert_eq!(verify(&db.pool, "org-without-events").await.unwrap(), 0);
    db.finish().await;
}

#[tokio::test]
async fn editing_or_deleting_an_event_is_detected() {
    let db = db_or_skip!();
    for n in 0..4 {
        let mut conn = db.pool.acquire().await.unwrap();
        append(&mut conn, Event::new("org-1", "user:ada", "secret.read", &format!("secret:{n}"), "applied")).await.unwrap();
    }
    sqlx::query("UPDATE vx_operate_audit_events SET actor = 'user:mallory' WHERE chain = 'org-1' AND seq = 2").execute(&db.pool).await.unwrap();
    assert!(matches!(verify(&db.pool, "org-1").await, Err(AuditError::Tampered { seq: 2, .. })));
    sqlx::query("UPDATE vx_operate_audit_events SET actor = 'user:ada' WHERE chain = 'org-1' AND seq = 2").execute(&db.pool).await.unwrap();
    assert_eq!(verify(&db.pool, "org-1").await.unwrap(), 4);

    sqlx::query("DELETE FROM vx_operate_audit_events WHERE chain = 'org-1' AND seq = 3").execute(&db.pool).await.unwrap();
    assert!(verify(&db.pool, "org-1").await.is_err(), "a removed event breaks the chain");
    db.finish().await;
}

#[tokio::test]
async fn when_the_action_rolls_back_so_does_its_record() {
    let db = db_or_skip!();
    let mut tx = db.pool.begin().await.unwrap();
    append(&mut tx, Event::new("org-1", "user:ada", "secret.delete", "secret:1", "applied")).await.unwrap();
    tx.rollback().await.unwrap();
    assert!(list(&db.pool, "org-1", 10).await.unwrap().is_empty(), "no record of an action that did not happen");
    assert_eq!(verify(&db.pool, "org-1").await.unwrap(), 0);

    // And the other way: if the record cannot be written, the action's own transaction must fail.
    let mut tx = db.pool.begin().await.unwrap();
    let refused = append(&mut tx, Event::new("org-1", "user:ada", "secret.delete", "secret:1", "applied").with_detail(json!({"secretValue": "x"}))).await;
    assert!(matches!(refused, Err(AuditError::SecretLikeKey(_))));
    db.finish().await;
}

#[tokio::test]
async fn concurrent_writers_leave_no_gaps() {
    let db = db_or_skip!();
    let mut tasks = Vec::new();
    for writer in 0..4 {
        let pool = db.pool.clone();
        tasks.push(tokio::spawn(async move {
            for n in 0..10 {
                let mut tx = pool.begin().await.unwrap();
                append(&mut tx, Event::new("org-1", &format!("user:{writer}"), "secret.read", &format!("secret:{n}"), "applied")).await.unwrap();
                tx.commit().await.unwrap();
            }
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }
    assert_eq!(verify(&db.pool, "org-1").await.unwrap(), 40);
    db.finish().await;
}

#[tokio::test]
async fn a_value_read_is_recorded_without_the_value() {
    let db = db_or_skip!();
    let canary = "canary-9f3a-never-store-me";
    let secret = Secret::from_string(canary.into());
    let mut conn = db.pool.acquire().await.unwrap();
    append(&mut conn, Event::new("org-1", "identity:ci", "secret.value.read", "secret:db-url", "redeemed").with_value(&secret, b"instance-audit-key")).await.unwrap();
    let stored: String = sqlx::query_scalar("SELECT row_to_json(e)::text FROM vx_operate_audit_events e LIMIT 1").fetch_one(&db.pool).await.unwrap();
    assert!(!stored.contains(canary), "the row must not contain the value");
    let rows = list(&db.pool, "org-1", 10).await.unwrap();
    assert!(rows[0].has_value_fingerprint);
    assert!(!serde_json::to_string(&rows).unwrap().contains(canary));
    assert_eq!(verify(&db.pool, "org-1").await.unwrap(), 1);
    db.finish().await;
}
