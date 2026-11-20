#![allow(clippy::print_stdout, clippy::print_stderr)] // test output: skip notices and the drill summary
#![allow(clippy::unwrap_used)] // test helpers
//! The HTTP surface against a real database. The router is private to the binary crate, so these
//! tests start the compiled binary and talk to it over a socket.

use std::process::{Child, Command, Stdio};
use std::time::Duration;
use vx_store::testing::database;
mod support;

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

async fn get(url: &str, token: Option<&str>) -> (u16, serde_json::Value) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let without_scheme = url.strip_prefix("http://").unwrap();
    let (host, path) = without_scheme.split_once('/').map_or((without_scheme, "/".to_string()), |(h, p)| (h, format!("/{p}")));
    let authorization = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
    let request = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n{authorization}\r\n");
    let mut stream = tokio::net::TcpStream::connect(host).await.unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut buffer = String::new();
    stream.read_to_string(&mut buffer).await.unwrap();
    let status: u16 = buffer.split_whitespace().nth(1).unwrap().parse().unwrap();
    let body = buffer.split("\r\n\r\n").nth(1).unwrap_or("");
    (status, serde_json::from_str(body).unwrap_or(serde_json::Value::Null))
}

async fn start(db_url: &str) -> (Server, String) {
    let port = free_port();
    let mut command = Command::new(env!("CARGO_BIN_EXE_vaultixd"));
    command.env("VX_DATABASE_URL", db_url).env("VX_LISTEN", format!("127.0.0.1:{port}")).stdout(Stdio::null()).stderr(Stdio::null());
    let server = Server(command.spawn().unwrap());
    let base = format!("http://127.0.0.1:{port}");
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")).await.is_ok() {
            return (server, base);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("vaultixd did not start");
}

async fn database_url(pool: &sqlx::PgPool) -> String {
    let admin = std::env::var("VX_TEST_DATABASE_URL").unwrap();
    let name: String = sqlx::query_scalar("SELECT current_database()").fetch_one(pool).await.unwrap();
    let (base, _) = admin.rsplit_once('/').unwrap();
    format!("{base}/{name}")
}

#[tokio::test]
async fn the_core_starts_sealed_and_guards_its_operate_routes() {
    vx_store::testing::budget("the_core_starts_sealed_and_guards_its_operate_routes", 300, the_core_starts_sealed_and_guards_its_operate_routes_body()).await
}

async fn the_core_starts_sealed_and_guards_its_operate_routes_body() {
    let Some(db) = database().await else {
        eprintln!("skipped: VX_TEST_DATABASE_URL is not set");
        return;
    };
    support::seed(&db.pool,"api","dev").await;
    let (_server, root) = start(&database_url(&db.pool).await).await;

    let (health, _) = get(&format!("{root}/healthz"), None).await;
    assert_eq!(health, 200);
    let (status, body) = get(&format!("{root}/api/vx/v1/status"), None).await;
    assert_eq!((status, &body["product"], &body["sealed"], &body["database"]), (200, &"Vaultix".into(), &true.into(), &"ok".into()));

    let (denied, error) = get(&format!("{root}/api/vx/v1/operate/jobs"), None).await;
    assert_eq!((denied, error["code"].as_str()), (401, Some("unauthorized")));
    let (wrong, _) = get(&format!("{root}/api/vx/v1/operate/jobs"), Some("not-the-token")).await;
    assert_eq!(wrong, 401);
    let (ok, jobs) = get(&format!("{root}/api/vx/v1/operate/jobs"), Some(support::TOKEN)).await;
    assert_eq!(ok, 200);
    assert!(jobs["jobs"].is_array());
    let (_, schedules) = get(&format!("{root}/api/vx/v1/operate/schedules"), Some(support::TOKEN)).await;
    assert_eq!(schedules["schedules"][0]["name"], "operate.prune", "the built-in maintenance job is named and visible");
    let (bad, error) = get(&format!("{root}/api/vx/v1/operate/jobs?status=bogus"), Some(support::TOKEN)).await;
    assert_eq!((bad, error["code"].as_str()), (422, Some("invalid_status")));
    db.finish().await;
}

#[tokio::test]
async fn without_a_session_the_operate_routes_are_denied() {
    vx_store::testing::budget("without_a_session_the_operate_routes_are_denied", 300, without_a_session_the_operate_routes_are_denied_body()).await
}

async fn without_a_session_the_operate_routes_are_denied_body() {
    let Some(db) = database().await else {
        eprintln!("skipped: VX_TEST_DATABASE_URL is not set");
        return;
    };
    let (_server, root) = start(&database_url(&db.pool).await).await;
    let (code, body) = get(&format!("{root}/api/vx/v1/operate/jobs"), Some("anything")).await;
    assert_eq!((code, body["code"].as_str()), (401, Some("unauthorized")));
    db.finish().await;
}
