#![allow(clippy::unwrap_used)] // test helpers
use vx_keys::{load_current, save_data_key, Keyring};
use vx_store::testing::database;

#[tokio::test]
async fn wrapped_keys_survive_in_the_database_and_unwrap_after_a_restart() {
    let Some(db) = database().await else {
        eprintln!("skipped: VX_TEST_DATABASE_URL is not set");
        return;
    };
    let root = Keyring::generate_root();
    let recovery = vx_keys::recovery_string(&root);
    let ring = Keyring::new(root).unwrap();
    let (key, wrapped) = ring.new_data_key("project:p1", 1).unwrap();
    save_data_key(&db.pool, "project:p1", 1, &wrapped).await.unwrap();
    let (_, wrapped2) = ring.new_data_key("project:p1", 2).unwrap();
    save_data_key(&db.pool, "project:p1", 2, &wrapped2).await.unwrap();

    // A restart: the instance is sealed until the recovery key is supplied again.
    let reopened = Keyring::new(vx_keys::parse_recovery(&recovery).unwrap()).unwrap();
    let (version, stored) = load_current(&db.pool, "project:p1").await.unwrap().unwrap();
    assert_eq!(version, 2);
    assert!(reopened.unwrap_data_key("project:p1", 2, &stored).is_ok());
    let first = sqlx_first(&db.pool).await;
    assert_eq!(reopened.unwrap_data_key("project:p1", 1, &first).unwrap().len(), key.len());
    // The store holds only ciphertext: no row equals the data key.
    let plain: i64 = sqlx::query_scalar("SELECT count(*) FROM vx_kms_keys WHERE wrapped = $1").bind(vx_secret_bytes(&key)).fetch_one(&db.pool).await.unwrap();
    assert_eq!(plain, 0);
    db.finish().await;
}

async fn sqlx_first(pool: &sqlx::PgPool) -> Vec<u8> {
    sqlx::query_scalar("SELECT wrapped FROM vx_kms_keys WHERE version = 1").fetch_one(pool).await.unwrap()
}

#[allow(clippy::disallowed_methods)] // a test proving the database never holds the plain key
fn vx_secret_bytes(key: &vx_secret::Secret) -> Vec<u8> {
    key.expose().to_vec()
}
