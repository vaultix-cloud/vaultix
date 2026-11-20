#![allow(clippy::print_stdout, clippy::print_stderr)] // test output: skip notices and the drill summary
#![allow(clippy::unwrap_used, clippy::disallowed_methods)] // test code; the drills read values to compare them
//! Failure drills against the real `vaultixd` process (docs/0140, section 8). Run them with `node scripts/test-vx.mjs`; without
//! `VX_TEST_DATABASE_URL` each prints "skipped" and passes, so a plain `cargo test` proves nothing about them.
//!
//! * readiness names every reason it can give, and recovers when the cause is fixed;
//! * killing the process at random moments never loses an acknowledged write, never leaves a write without its audit record,
//!   and never puts a value in a log or in the database in the clear;
//! * a whole instance is rebuilt from a backup and the recovery key alone, using the real commands.

use serde_json::{json, Value};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vx_store::testing::{database, TestDb};

mod support;
use support::TOKEN;
const CANARY: &str = "CANARY-drill-value-9d41-do-not-leak";

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

struct Server {
    child: Child,
    base: String,
    log: std::path::PathBuf,
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        vx_store::testing::untrack(self.child.id());
    }
}

fn temp(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("vx-drills-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

/// A root key file in the recovery-key form, the way `vaultixd init` writes it.
fn key_file(name: &str) -> std::path::PathBuf {
    let path = temp(name);
    let _ = std::fs::remove_file(&path);
    std::fs::write(&path, format!("{}\n", vx_keys::recovery_string(&vx_keys::Keyring::generate_root()))).unwrap();
    path
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

async fn database_url(db: &TestDb) -> String {
    let admin = std::env::var("VX_TEST_DATABASE_URL").unwrap();
    let name: String = sqlx::query_scalar("SELECT current_database()").fetch_one(&db.pool).await.unwrap();
    format!("{}/{name}", admin.rsplit_once('/').unwrap().0)
}

async fn start(url: &str, key: Option<&std::path::Path>, extra: &[(&str, &str)]) -> Server {
    let pool=vx_store::open(url,2).await.unwrap();
    support::seed(&pool,"drill","prod").await;
    pool.close().await;
    let port = free_port();
    let log = temp(&format!("server-{port}.log"));
    let mut command = Command::new(env!("CARGO_BIN_EXE_vaultixd"));
    command.env("VX_DATABASE_URL", url).env("VX_LISTEN", format!("127.0.0.1:{port}")).stdout(Stdio::null()).stderr(Stdio::from(std::fs::File::create(&log).unwrap()));
    if let Some(key) = key {
        command.env("VX_ROOT_KEY_FILE", key);
    }
    for (k, v) in extra {
        command.env(k, v);
    }
    let child = command.spawn().unwrap();
    vx_store::testing::track(child.id()); // so the watchdog can stop it if the test blocks where a timeout cannot reach
    let server = Server { child, base: format!("127.0.0.1:{port}"), log };
    for _ in 0..150 {
        if tokio::net::TcpStream::connect(&server.base).await.is_ok() {
            return server;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("vaultixd did not start");
}

async fn call(base: &str, method: &str, path: &str, body: Option<&Value>, actor: &str) -> std::io::Result<(u16, Value)> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let payload = body.map(Value::to_string).unwrap_or_default();
    let request = format!("{method} {path} HTTP/1.1\r\nHost: {base}\r\nConnection: close\r\nAuthorization: Bearer {TOKEN}\r\nX-Vx-Actor: {actor}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{payload}", payload.len());
    // A server that accepts and then says nothing must fail this call, not wait: the whole exchange has a limit.
    let exchange = async {
        let mut stream = tokio::net::TcpStream::connect(base).await?;
        stream.write_all(request.as_bytes()).await?;
        let mut buffer = String::new();
        stream.read_to_string(&mut buffer).await?;
        Ok::<String, std::io::Error>(buffer)
    };
    let buffer = tokio::time::timeout(Duration::from_secs(20), exchange).await.map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, format!("{method} {path}: no answer within 20s")))??;
    let status: u16 = buffer.split_whitespace().nth(1).and_then(|s| s.parse().ok()).ok_or_else(|| std::io::Error::other("no status"))?;
    let text = buffer.split("\r\n\r\n").nth(1).unwrap_or("");
    Ok((status, serde_json::from_str(text).unwrap_or(Value::Null)))
}

async fn put(base: &str, name: &str) -> std::io::Result<u16> {
    Ok(call(base, "PUT", "/api/vx/v1/secrets", Some(&json!({ "project": "drill", "environment": "prod", "name": name, "value": CANARY })), "drill").await?.0)
}

async fn ready(base: &str) -> (u16, Vec<String>) {
    let (status, body) = call(base, "GET", "/readyz", None, "probe").await.unwrap();
    (status, body["reasons"].as_array().unwrap().iter().map(|r| r.as_str().unwrap().to_string()).collect())
}

/// Run `vaultixd <args>` with the given database and key, and return (exit success, stdout + stderr).
fn command(url: &str, key: &std::path::Path, args: &[&str]) -> (bool, String) {
    // Polled against a deadline, so a command that stalls (a lock it never gets) is stopped and fails the test.
    let mut child = Command::new(env!("CARGO_BIN_EXE_vaultixd")).args(args).env("VX_DATABASE_URL", url).env("VX_ROOT_KEY_FILE", key).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    vx_store::testing::track(child.id());
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            vx_store::testing::untrack(child.id());
            panic!("`vaultixd {}` did not finish within 120s", args.first().copied().unwrap_or(""));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    vx_store::testing::untrack(child.id());
    let output = child.wait_with_output().unwrap();
    (status.success(), format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr)))
}

// ---- readiness ----

#[tokio::test]
async fn readiness_names_each_reason_and_recovers_when_it_is_fixed() {
    vx_store::testing::budget("readiness_names_each_reason_and_recovers_when_it_is_fixed", 300, readiness_names_each_reason_and_recovers_when_it_is_fixed_body()).await
}

async fn readiness_names_each_reason_and_recovers_when_it_is_fixed_body() {
    let db = db_or_skip!();
    let url = database_url(&db).await;
    let key = key_file("ready.key");

    let sealed = start(&url, None, &[]).await;
    assert_eq!(ready(&sealed.base).await, (503, vec!["sealed".to_string()]));
    drop(sealed);

    let open = start(&url, Some(&key), &[]).await;
    assert_eq!(ready(&open.base).await, (200, vec![]));
    drop(open);

    let skewed = start(&url, Some(&key), &[("VX_CLOCK_SKEW_SECONDS", "-1")]).await; // any difference is beyond a negative bound
    assert_eq!(ready(&skewed.base).await, (503, vec!["clock_skew".to_string()]));
    drop(skewed);

    let server = start(&url, Some(&key), &[]).await;
    vx_store::testing::within("rename the audit table away", 30, sqlx::query("ALTER TABLE vx_operate_audit_heads RENAME TO vx_operate_audit_heads_off").execute(&db.pool)).await.unwrap();
    assert_eq!(ready(&server.base).await, (503, vec!["audit_unavailable".to_string()]), "audit cannot record, so the instance says it is not ready");
    assert_eq!(put(&server.base, "BLOCKED").await.unwrap(), 500, "and a write is refused, not made without a record");
    vx_store::testing::within("rename the audit table back", 30, sqlx::query("ALTER TABLE vx_operate_audit_heads_off RENAME TO vx_operate_audit_heads").execute(&db.pool)).await.unwrap();
    assert_eq!(ready(&server.base).await, (200, vec![]), "fixing the cause is enough: no restart");
    let leftover: i64 = sqlx::query_scalar("SELECT count(*) FROM vx_secrets_secrets WHERE name = 'BLOCKED'").fetch_one(&db.pool).await.unwrap();
    assert_eq!(leftover, 0, "the refused write left nothing behind");

    // the database disappears under a running server
    let admin = vx_store::open(&std::env::var("VX_TEST_DATABASE_URL").unwrap(), 2).await.unwrap();
    let name: String = sqlx::query_scalar("SELECT current_database()").fetch_one(&db.pool).await.unwrap();
    vx_store::testing::within("drop the database under the running server", 30, sqlx::query(&format!("DROP DATABASE {name} WITH (FORCE)")).execute(&admin)).await.unwrap();
    assert_eq!(ready(&server.base).await, (503, vec!["database_unavailable".to_string()]));
    db.finish().await;
}

// ---- kill -9 ----

fn jitter(range_ms: u64) -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos() as u64 % range_ms
}

#[tokio::test]
async fn killing_the_server_at_random_moments_never_loses_an_acknowledged_write() {
    vx_store::testing::budget("killing_the_server_at_random_moments_never_loses_an_acknowledged_write", 120 + 25 * std::env::var("VX_DRILL_CYCLES").ok().and_then(|v| v.parse::<u64>().ok()).unwrap_or(12), killing_the_server_at_random_moments_never_loses_an_acknowledged_write_body()).await
}

async fn killing_the_server_at_random_moments_never_loses_an_acknowledged_write_body() {
    let db = db_or_skip!();
    let url = database_url(&db).await;
    let key = key_file("kill.key");
    let cycles: usize = std::env::var("VX_DRILL_CYCLES").ok().and_then(|v| v.parse().ok()).unwrap_or(12);
    let acknowledged: Arc<Mutex<Vec<String>>> = Arc::default();
    let mut logs = Vec::new();

    for cycle in 0..cycles {
        let server = start(&url, Some(&key), &[]).await;
        let mut writers = Vec::new();
        for task in 0..4 {
            let (base, acked) = (server.base.clone(), acknowledged.clone());
            writers.push(tokio::spawn(async move {
                for i in 0.. {
                    let name = format!("S_{cycle}_{task}_{i}");
                    match put(&base, &name).await {
                        Ok(200) => acked.lock().unwrap().push(name),
                        _ => return, // the server is gone: this write was never acknowledged
                    }
                }
            }));
        }
        // Do not kill until this cycle has an acknowledged write. A fixed pause is a guess about how fast the machine is: on a busy one
        // the server has answered nothing yet, the kill lands on an idle server, and the cycle proves nothing. Waiting for the first
        // acknowledgement means every kill lands while writes are in flight, whatever the load.
        let started_with = acknowledged.lock().unwrap().len();
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        while acknowledged.lock().unwrap().len() == started_with {
            assert!(std::time::Instant::now() < deadline, "cycle {cycle}: no write was acknowledged within 30s of the server starting");
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        tokio::time::sleep(Duration::from_millis(120 + jitter(500))).await;
        let mut server = server;
        server.child.kill().unwrap(); // an abrupt stop: no shutdown, no flush
        server.child.wait().unwrap();
        for writer in writers {
            writer.await.unwrap();
        }
        logs.push(server.log.clone());
    }

    // a fresh start on the same database must work, and must be ready
    let last = start(&url, Some(&key), &[]).await;
    assert_eq!(ready(&last.base).await, (200, vec![]));
    logs.push(last.log.clone());

    let acked = acknowledged.lock().unwrap().clone();
    assert!(acked.len() >= cycles, "the drill actually wrote: {} acknowledged over {cycles} cycles", acked.len());
    let stored: i64 = sqlx::query_scalar("SELECT count(*) FROM vx_secrets_secrets WHERE name = ANY($1)").bind(&acked).fetch_one(&db.pool).await.unwrap();
    assert_eq!(stored, acked.len() as i64, "every acknowledged write is in the store");
    let displays: Vec<String> = acked.iter().map(|n| format!("drill/prod/{n}")).collect();
    let recorded: i64 = sqlx::query_scalar("SELECT count(DISTINCT object_ref) FROM vx_operate_audit_events WHERE action = 'secret.write' AND object_ref = ANY($1)").bind(&displays).fetch_one(&db.pool).await.unwrap();
    assert_eq!(recorded, acked.len() as i64, "every acknowledged write has its audit record");

    let versions: i64 = sqlx::query_scalar("SELECT count(*) FROM vx_secrets_versions").fetch_one(&db.pool).await.unwrap();
    let events: i64 = sqlx::query_scalar("SELECT count(*) FROM vx_operate_audit_events WHERE action = 'secret.write'").fetch_one(&db.pool).await.unwrap();
    assert_eq!(versions, events, "no write without a record and no record without a write, including the ones that were cut off");
    assert_eq!(vx_audit::verify(&db.pool, "drill").await.unwrap(), events, "the chain is whole and verifies");

    for log in logs {
        let text = std::fs::read_to_string(&log).unwrap_or_default();
        assert!(!text.contains("CANARY"), "a value reached a server log: {}", log.display());
    }
    let everything: Vec<String> = sqlx::query_scalar("SELECT t::text FROM vx_secrets_versions t UNION ALL SELECT t::text FROM vx_operate_audit_events t").fetch_all(&db.pool).await.unwrap();
    assert!(everything.iter().all(|row| !row.contains("CANARY")), "a value is in the database in the clear");
    println!("# {} acknowledged writes survived {cycles} kills; {events} writes recorded", acked.len());
    db.finish().await;
}

// ---- rebuild from a backup ----

#[tokio::test]
async fn a_whole_instance_is_rebuilt_from_a_backup_and_the_recovery_key_alone() {
    vx_store::testing::budget("a_whole_instance_is_rebuilt_from_a_backup_and_the_recovery_key_alone", 300, a_whole_instance_is_rebuilt_from_a_backup_and_the_recovery_key_alone_body()).await
}

async fn a_whole_instance_is_rebuilt_from_a_backup_and_the_recovery_key_alone_body() {
    let (old, fresh, other) = (db_or_skip!(), db_or_skip!(), db_or_skip!());
    let (old_url, fresh_url, other_url) = (database_url(&old).await, database_url(&fresh).await, database_url(&other).await);
    let key = key_file("rebuild-old.key");
    let backup = temp("rebuild.vxbk");
    let anchor_file = temp("rebuild.anchor.json");
    for path in [&backup, &anchor_file] {
        let _ = std::fs::remove_file(path);
    }

    // the old instance holds a secret
    let server = start(&old_url, Some(&key), &[]).await;
    assert_eq!(put(&server.base, "DB_PASSWORD").await.unwrap(), 200);
    drop(server);

    // back it up with the real command, and anchor its audit chain somewhere else
    let (ok, out) = command(&old_url, &key, &["backup", "--out", backup.to_str().unwrap()]);
    assert!(ok, "{out}");
    assert!(!out.contains("DB_PASSWORD") && !out.contains("CANARY"));
    let (ok, out) = command(&old_url, &key, &["anchor", "--out", anchor_file.to_str().unwrap()]);
    assert!(ok, "{out}");
    assert!(!command(&old_url, &key, &["backup", "--out", backup.to_str().unwrap()]).0, "a backup never overwrites a file");

    // the host is gone. A new machine has an empty database and only the offline recovery key (copied, not the old file)
    let recovery = std::fs::read_to_string(&key).unwrap();
    let recovered = temp("rebuild-new.key");
    let _ = std::fs::remove_file(&recovered);
    std::fs::write(&recovered, recovery).unwrap();

    // a wrong key restores nothing and says so
    let wrong = key_file("rebuild-wrong.key");
    let (ok, out) = command(&other_url, &wrong, &["restore", "--in", backup.to_str().unwrap()]);
    assert!(!ok && out.contains("key is wrong, or the file is damaged"), "{out}");
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM vx_secrets_secrets").fetch_one(&other.pool).await.unwrap();
    assert_eq!(rows, 0);

    // the right key restores everything, verified
    let (ok, out) = command(&fresh_url, &recovered, &["restore", "--in", backup.to_str().unwrap()]);
    assert!(ok, "{out}");
    assert!(out.contains("each verified"), "{out}");
    let (ok, out) = command(&fresh_url, &recovered, &["check-anchor", "--in", anchor_file.to_str().unwrap()]);
    assert!(ok, "the rebuilt instance matches the anchor: {out}");

    // the rebuilt server is ready, lists the secret, and hands its value to the identity that asks, once
    let server = start(&fresh_url, Some(&recovered), &[]).await;
    assert_eq!(ready(&server.base).await, (200, vec![]));
    let (status, list) = call(&server.base, "GET", "/api/vx/v1/secrets?project=drill&environment=prod", None, "drill").await.unwrap();
    assert_eq!(status, 200);
    assert_eq!(list["secrets"][0]["name"], "DB_PASSWORD");
    let (status, injection) = call(&server.base, "POST", "/api/vx/v1/secrets/injections", Some(&json!({ "purpose": "rebuild drill", "secrets": [{ "project": "drill", "environment": "prod", "name": "DB_PASSWORD" }] })), "drill").await.unwrap();
    assert_eq!(status, 200, "{injection}");
    let handle = injection["handle"].as_str().unwrap().to_string();
    let (status, redeemed) = call(&server.base, "POST", &format!("/api/vx/v1/secrets/injections/{handle}/redeem"), None, "drill").await.unwrap();
    assert_eq!(status, 200, "{redeemed}");
    assert!(redeemed.to_string().contains(CANARY), "the rebuilt instance returned the original value: {redeemed}");
    assert_eq!(call(&server.base, "POST", &format!("/api/vx/v1/secrets/injections/{handle}/redeem"), None, "drill").await.unwrap().0, 410, "and the handle works once");
    drop(server);

    // the old instance moves on; the rebuilt one is now behind, and the newer anchor says so
    let server = start(&old_url, Some(&key), &[]).await;
    assert_eq!(put(&server.base, "LATER").await.unwrap(), 200);
    drop(server);
    let newer = temp("rebuild.anchor-newer.json");
    let _ = std::fs::remove_file(&newer);
    assert!(command(&old_url, &key, &["anchor", "--out", newer.to_str().unwrap()]).0);
    // a restore that has served nothing since is simply behind: a rollback (restored into the spare database, never started)
    assert!(command(&other_url, &recovered, &["restore", "--in", backup.to_str().unwrap()]).0, "the earlier wrong-key attempt left the spare database empty, so it restores");
    let (ok, out) = command(&other_url, &recovered, &["check-anchor", "--in", newer.to_str().unwrap()]);
    assert!(!ok && out.contains("rolled back"), "{out}");
    // the rebuilt instance has since written events of its own (the injection and the redeem), so its history has diverged
    // from the old instance's: that is a fork, and the check says so
    let (ok, out) = command(&fresh_url, &recovered, &["check-anchor", "--in", newer.to_str().unwrap()]);
    assert!(!ok && out.contains("rewritten"), "{out}");

    for db in [old, fresh, other] {
        db.finish().await;
    }
}
