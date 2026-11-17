#![allow(clippy::unwrap_used, clippy::disallowed_methods)] // test code
//! Backup, restore and anchors against a real Postgres (`node scripts/test-vx.mjs`). Without `VX_TEST_DATABASE_URL` these
//! tests print "skipped" and pass, so a plain `cargo test` proves nothing about them.

use serde_json::json;
use sqlx::PgPool;
use vx_audit::Event;
use vx_keys::Keyring;
use vx_recover::{anchor, backup, check_anchor, restore, AnchorProblem, RecoverError};
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

const MARKER: &str = "MARKER-secret-name-visible-in-metadata";

fn ring() -> Keyring {
    Keyring::new(Keyring::generate_root()).unwrap()
}

async fn event(pool: &PgPool, chain: &str, n: usize) {
    let mut tx = pool.begin().await.unwrap();
    vx_audit::append(&mut tx, Event::new(chain, "user:alice", "secret.write", &format!("{MARKER}-{n}"), "applied").with_detail(json!({ "n": n }))).await.unwrap();
    tx.commit().await.unwrap();
}

/// Audit events on two chains, a data key, and a job run (a row whose id comes from a sequence).
async fn seed(pool: &PgPool, ring: &Keyring) {
    for n in 0..5 {
        event(pool, "proj-a", n).await;
    }
    for n in 0..3 {
        event(pool, "proj-b", n).await;
    }
    let mut tx = pool.begin().await.unwrap();
    vx_keys::current_or_create(&mut tx, ring, "project:proj-a").await.unwrap();
    sqlx::query("INSERT INTO vx_operate_job_runs (job_id, kind, attempt, started_at, outcome) VALUES (gen_random_uuid(), 'demo', 1, now(), 'succeeded')").execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
}

async fn count(pool: &PgPool, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT count(*) FROM {table}")).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn a_backup_restores_into_a_fresh_database_with_everything_intact() {
    vx_store::testing::budget("a_backup_restores_into_a_fresh_database_with_everything_intact", 300, a_backup_restores_into_a_fresh_database_with_everything_intact_body()).await
}

async fn a_backup_restores_into_a_fresh_database_with_everything_intact_body() {
    let (source, target) = (db_or_skip!(), db_or_skip!());
    let ring = ring();
    seed(&source.pool, &ring).await;
    let file = backup(&source.pool, &ring).await.unwrap();

    let manifest = restore(&target.pool, &ring, &file).await.unwrap();
    assert_eq!(manifest.heads.len(), 2);
    for table in ["vx_operate_audit_events", "vx_operate_audit_heads", "vx_kms_keys", "vx_operate_job_runs"] {
        assert_eq!(count(&target.pool, table).await, count(&source.pool, table).await, "{table}");
    }
    assert_eq!(vx_audit::verify(&target.pool, "proj-a").await.unwrap(), 5);
    assert_eq!(vx_audit::verify(&target.pool, "proj-b").await.unwrap(), 3);

    // the restored data key is the same one: a different keyring cannot open it, this one can
    let mut conn = target.pool.acquire().await.unwrap();
    assert!(vx_keys::unwrap_stored(&mut conn, &ring, "project:proj-a", 1).await.is_ok());

    // a sequence continues after the restored rows, it does not restart and collide
    sqlx::query("INSERT INTO vx_operate_job_runs (job_id, kind, attempt, started_at, outcome) VALUES (gen_random_uuid(), 'after', 1, now(), 'succeeded')").execute(&target.pool).await.unwrap();
    assert_eq!(count(&target.pool, "vx_operate_job_runs").await, 2);

    // and the restored instance can keep appending to the same chain
    event(&target.pool, "proj-a", 99).await;
    assert_eq!(vx_audit::verify(&target.pool, "proj-a").await.unwrap(), 6);
    source.finish().await;
    target.finish().await;
}

#[tokio::test]
async fn the_file_shows_nothing_without_the_key_and_a_wrong_key_or_damage_is_refused_the_same_way() {
    vx_store::testing::budget("the_file_shows_nothing_without_the_key_and_a_wrong_key_or_damage_is_refused_the_same_way", 300, the_file_shows_nothing_without_the_key_and_a_wrong_key_or_damage_is_refused_the_same_way_body()).await
}

async fn the_file_shows_nothing_without_the_key_and_a_wrong_key_or_damage_is_refused_the_same_way_body() {
    let (source, target) = (db_or_skip!(), db_or_skip!());
    let ring = ring();
    seed(&source.pool, &ring).await;
    let file = backup(&source.pool, &ring).await.unwrap();
    assert!(file.starts_with(b"VXBK1\n"));
    let text = String::from_utf8_lossy(&file);
    assert!(!text.contains("MARKER") && !text.contains("proj-a") && !text.contains("secret.write"), "names and audit metadata are in the clear in the file");

    let wrong = restore(&target.pool, &self::ring(), &file).await.unwrap_err();
    assert!(matches!(wrong, RecoverError::WrongKeyOrCorrupt), "{wrong}");
    let mut flipped = file.clone();
    let middle = flipped.len() / 2;
    flipped[middle] ^= 0x01;
    assert!(matches!(restore(&target.pool, &ring, &flipped).await.unwrap_err(), RecoverError::WrongKeyOrCorrupt));
    assert!(matches!(restore(&target.pool, &ring, &file[..file.len() - 40]).await.unwrap_err(), RecoverError::WrongKeyOrCorrupt), "truncated");
    assert!(matches!(restore(&target.pool, &ring, b"garbage").await.unwrap_err(), RecoverError::NotArchive));
    assert!(matches!(restore(&target.pool, &ring, b"").await.unwrap_err(), RecoverError::NotArchive));
    assert_eq!(count(&target.pool, "vx_operate_audit_events").await, 0, "every refusal left the target empty");
    source.finish().await;
    target.finish().await;
}

#[tokio::test]
async fn a_target_that_already_holds_data_is_refused_and_left_exactly_as_it_was() {
    vx_store::testing::budget("a_target_that_already_holds_data_is_refused_and_left_exactly_as_it_was", 300, a_target_that_already_holds_data_is_refused_and_left_exactly_as_it_was_body()).await
}

async fn a_target_that_already_holds_data_is_refused_and_left_exactly_as_it_was_body() {
    let (source, target) = (db_or_skip!(), db_or_skip!());
    let ring = ring();
    seed(&source.pool, &ring).await;
    let file = backup(&source.pool, &ring).await.unwrap();
    event(&target.pool, "other", 1).await;
    let error = restore(&target.pool, &ring, &file).await.unwrap_err();
    assert!(matches!(error, RecoverError::NotEmpty(_)), "{error}");
    assert_eq!(count(&target.pool, "vx_operate_audit_events").await, 1);
    assert_eq!(count(&target.pool, "vx_operate_job_runs").await, 0);
    source.finish().await;
    target.finish().await;
}

#[tokio::test]
async fn a_backup_from_a_different_schema_is_refused() {
    vx_store::testing::budget("a_backup_from_a_different_schema_is_refused", 300, a_backup_from_a_different_schema_is_refused_body()).await
}

async fn a_backup_from_a_different_schema_is_refused_body() {
    let (source, target) = (db_or_skip!(), db_or_skip!());
    let ring = ring();
    seed(&source.pool, &ring).await;
    let file = backup(&source.pool, &ring).await.unwrap();
    sqlx::query("INSERT INTO vx_operate_migrations (version, name) VALUES (999, 'from_the_future')").execute(&target.pool).await.unwrap();
    let error = restore(&target.pool, &ring, &file).await.unwrap_err();
    assert!(matches!(error, RecoverError::SchemaMismatch(_)), "{error}");
    source.finish().await;
    target.finish().await;
}

#[tokio::test]
async fn a_backup_of_a_tampered_chain_is_refused_and_nothing_is_restored() {
    vx_store::testing::budget("a_backup_of_a_tampered_chain_is_refused_and_nothing_is_restored", 300, a_backup_of_a_tampered_chain_is_refused_and_nothing_is_restored_body()).await
}

async fn a_backup_of_a_tampered_chain_is_refused_and_nothing_is_restored_body() {
    let (source, target) = (db_or_skip!(), db_or_skip!());
    let ring = ring();
    seed(&source.pool, &ring).await;
    sqlx::query("UPDATE vx_operate_audit_events SET actor = 'user:mallory' WHERE chain = 'proj-a' AND seq = 3").execute(&source.pool).await.unwrap();
    let file = backup(&source.pool, &ring).await.unwrap(); // a backup does not hide the damage...
    let error = restore(&target.pool, &ring, &file).await.unwrap_err(); // ...and a restore will not accept it
    assert!(matches!(error, RecoverError::Verification(_)), "{error}");
    assert_eq!(count(&target.pool, "vx_operate_audit_events").await, 0);
    assert_eq!(count(&target.pool, "vx_kms_keys").await, 0, "the transaction rolled back as a whole");
    source.finish().await;
    target.finish().await;
}

#[tokio::test]
async fn a_backup_taken_while_writes_are_happening_is_one_consistent_moment() {
    vx_store::testing::budget("a_backup_taken_while_writes_are_happening_is_one_consistent_moment", 300, a_backup_taken_while_writes_are_happening_is_one_consistent_moment_body()).await
}

async fn a_backup_taken_while_writes_are_happening_is_one_consistent_moment_body() {
    let (source, target) = (db_or_skip!(), db_or_skip!());
    let ring = ring();
    seed(&source.pool, &ring).await;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;
    let (stop, written) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicUsize::new(0)));
    let writer = tokio::spawn({
        let (pool, stop, written) = (source.pool.clone(), stop.clone(), written.clone());
        async move {
            while !stop.load(Ordering::SeqCst) {
                event(&pool, "busy", written.load(Ordering::SeqCst)).await;
                written.fetch_add(1, Ordering::SeqCst);
            }
        }
    });
    while written.load(Ordering::SeqCst) < 20 {
        tokio::time::sleep(std::time::Duration::from_millis(5)).await; // some history exists before the backup starts
    }
    let file = backup(&source.pool, &ring).await.unwrap();
    // keep writing until the writer is provably past the moment of the snapshot, then stop it
    let at_end = written.load(Ordering::SeqCst);
    while written.load(Ordering::SeqCst) <= at_end {
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    stop.store(true, Ordering::SeqCst);
    writer.await.unwrap();
    let final_len = vx_audit::verify(&source.pool, "busy").await.unwrap();

    let manifest = restore(&target.pool, &ring, &file).await.unwrap();
    let busy = manifest.heads.iter().find(|h| h.chain == "busy").expect("the busy chain was captured");
    assert!(busy.seq >= 20 && busy.seq < final_len, "the snapshot is a moment inside a chain that kept growing: event {} of {final_len}", busy.seq);
    assert_eq!(vx_audit::verify(&target.pool, "busy").await.unwrap(), busy.seq, "and it is a whole, valid chain up to there");
    source.finish().await;
    target.finish().await;
}

// ---- anchors ----

#[tokio::test]
async fn an_anchor_accepts_the_same_database_and_one_that_has_moved_on() {
    vx_store::testing::budget("an_anchor_accepts_the_same_database_and_one_that_has_moved_on", 300, an_anchor_accepts_the_same_database_and_one_that_has_moved_on_body()).await
}

async fn an_anchor_accepts_the_same_database_and_one_that_has_moved_on_body() {
    let db = db_or_skip!();
    let ring = ring();
    seed(&db.pool, &ring).await;
    let a = anchor(&db.pool, &ring).await.unwrap();
    assert_eq!(check_anchor(&db.pool, &ring, &a).await, Ok(()));
    event(&db.pool, "proj-a", 50).await;
    assert_eq!(check_anchor(&db.pool, &ring, &a).await, Ok(()), "a chain that grew since the anchor still contains it");
    let json = serde_json::to_string(&a).unwrap();
    let parsed: vx_recover::Anchor = serde_json::from_str(&json).unwrap();
    assert_eq!(check_anchor(&db.pool, &ring, &parsed).await, Ok(()), "an anchor survives being written to a file");
    db.finish().await;
}

#[tokio::test]
async fn an_old_backup_restored_over_a_newer_instance_is_caught_by_the_newest_anchor() {
    vx_store::testing::budget("an_old_backup_restored_over_a_newer_instance_is_caught_by_the_newest_anchor", 300, an_old_backup_restored_over_a_newer_instance_is_caught_by_the_newest_anchor_body()).await
}

async fn an_old_backup_restored_over_a_newer_instance_is_caught_by_the_newest_anchor_body() {
    let (source, target) = (db_or_skip!(), db_or_skip!());
    let ring = ring();
    seed(&source.pool, &ring).await;
    let old_backup = backup(&source.pool, &ring).await.unwrap();
    event(&source.pool, "proj-a", 6).await;
    event(&source.pool, "proj-a", 7).await;
    let newest_anchor = anchor(&source.pool, &ring).await.unwrap();
    assert_eq!(check_anchor(&source.pool, &ring, &newest_anchor).await, Ok(()));

    // the rollback attack: the instance is replaced by the older backup
    restore(&target.pool, &ring, &old_backup).await.unwrap();
    assert_eq!(vx_audit::verify(&target.pool, "proj-a").await.unwrap(), 5, "the rolled-back chain is internally valid");
    let problem = check_anchor(&target.pool, &ring, &newest_anchor).await.unwrap_err();
    assert_eq!(problem, AnchorProblem::Rollback { chain: "proj-a".into(), anchored: 7, found: 5 });
    source.finish().await;
    target.finish().await;
}

#[tokio::test]
async fn a_rewritten_chain_is_caught_even_when_it_is_internally_valid_and_as_long() {
    vx_store::testing::budget("a_rewritten_chain_is_caught_even_when_it_is_internally_valid_and_as_long", 300, a_rewritten_chain_is_caught_even_when_it_is_internally_valid_and_as_long_body()).await
}

async fn a_rewritten_chain_is_caught_even_when_it_is_internally_valid_and_as_long_body() {
    let (source, other) = (db_or_skip!(), db_or_skip!());
    let ring = ring();
    seed(&source.pool, &ring).await;
    let a = anchor(&source.pool, &ring).await.unwrap();
    // an attacker builds a different history of the same length on another database and puts it in place
    for n in 0..5 {
        event(&other.pool, "proj-a", 1000 + n).await;
    }
    for n in 0..3 {
        event(&other.pool, "proj-b", 1000 + n).await;
    }
    assert_eq!(vx_audit::verify(&other.pool, "proj-a").await.unwrap(), 5);
    let problem = check_anchor(&other.pool, &ring, &a).await.unwrap_err();
    assert!(matches!(problem, AnchorProblem::Fork { ref chain, seq: 5 } if chain == "proj-a"), "{problem:?}");
    source.finish().await;
    other.finish().await;
}

#[tokio::test]
async fn an_anchor_that_was_altered_or_signed_by_another_instance_is_refused() {
    vx_store::testing::budget("an_anchor_that_was_altered_or_signed_by_another_instance_is_refused", 300, an_anchor_that_was_altered_or_signed_by_another_instance_is_refused_body()).await
}

async fn an_anchor_that_was_altered_or_signed_by_another_instance_is_refused_body() {
    let db = db_or_skip!();
    let ring = ring();
    seed(&db.pool, &ring).await;
    let a = anchor(&db.pool, &ring).await.unwrap();
    let mut lowered = a.clone();
    lowered.heads[0].seq = 1; // an attacker lowering the bar so a rollback would pass
    assert_eq!(check_anchor(&db.pool, &ring, &lowered).await, Err(AnchorProblem::BadSignature));
    assert_eq!(check_anchor(&db.pool, &self::ring(), &a).await, Err(AnchorProblem::BadSignature), "another instance's key");
    sqlx::query("DELETE FROM vx_operate_audit_heads WHERE chain = 'proj-b'").execute(&db.pool).await.unwrap();
    assert_eq!(check_anchor(&db.pool, &ring, &a).await, Err(AnchorProblem::Missing { chain: "proj-b".into() }));
    db.finish().await;
}

/// Open a backup with the key, let `edit` change its manifest, and seal it again: a stand-in for a bug in whatever wrote the file.
fn forge(file: &[u8], ring: &Keyring, edit: impl Fn(&mut serde_json::Value)) -> Vec<u8> {
    use vx_secret::Secret;
    let key = Secret::from_vec(ring.derive("backup-v1").to_vec());
    let opened = vx_keys::open(&key, "vx-backup-v1", file.strip_prefix(b"VXBK1\n").unwrap()).unwrap();
    let bytes = opened.expose();
    let length = u32::from_be_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let mut manifest: serde_json::Value = serde_json::from_slice(&bytes[8..8 + length]).unwrap();
    edit(&mut manifest);
    let manifest = serde_json::to_vec(&manifest).unwrap();
    let mut archive = b"VXBA".to_vec();
    archive.extend_from_slice(&(manifest.len() as u32).to_be_bytes());
    archive.extend_from_slice(&manifest);
    archive.extend_from_slice(&bytes[8 + length..]);
    let mut forged = b"VXBK1\n".to_vec();
    forged.extend_from_slice(&vx_keys::seal(&key, "vx-backup-v1", &Secret::from_vec(archive)).unwrap());
    forged
}

#[tokio::test]
async fn a_backup_whose_manifest_disagrees_with_its_data_is_refused_before_anything_is_committed() {
    vx_store::testing::budget("a_backup_whose_manifest_disagrees_with_its_data_is_refused_before_anything_is_committed", 300, a_backup_whose_manifest_disagrees_with_its_data_is_refused_before_anything_is_committed_body()).await
}

async fn a_backup_whose_manifest_disagrees_with_its_data_is_refused_before_anything_is_committed_body() {
    let (source, target) = (db_or_skip!(), db_or_skip!());
    let ring = ring();
    seed(&source.pool, &ring).await;
    let file = backup(&source.pool, &ring).await.unwrap();
    // sanity: the forging helper alone does not break a valid file
    let untouched = forge(&file, &ring, |_| {});
    assert!(restore(&target.pool, &ring, &untouched).await.is_ok());
    target.finish().await;

    for (what, edit) in [
        ("a row count", Box::new(|m: &mut serde_json::Value| { m["tables"].as_array_mut().unwrap().iter_mut().find(|t| t["name"] == "vx_operate_audit_events").unwrap()["rows"] = serde_json::json!(999); }) as Box<dyn Fn(&mut serde_json::Value)>),
        ("a chain head", Box::new(|m: &mut serde_json::Value| { m["heads"][0]["seq"] = serde_json::json!(77); })),
    ] {
        let fresh = db_or_skip!();
        let error = restore(&fresh.pool, &ring, &forge(&file, &ring, edit)).await.unwrap_err();
        assert!(matches!(error, RecoverError::Verification(_)), "{what}: {error}");
        assert_eq!(count(&fresh.pool, "vx_operate_audit_events").await, 0, "{what}: nothing was committed");
        fresh.finish().await;
    }
    source.finish().await;
}
