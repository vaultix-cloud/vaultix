#![allow(clippy::unwrap_used)]
//! First-owner to logout acceptance. These tests start the real binary on a disposable database.
//! No inherited backend, fixture approval endpoint or bootstrap credential is involved.
use serde_json::{json,Value};
use std::{process::{Child,Command,Stdio},time::Duration,path::PathBuf,io::Write};
use vx_store::testing::{database,TestDb};

const PASSWORD:&str="test-only-password-39-long";
const CANARY:&str="vxcanary-auth-journey-8452";
const EMAIL:&str="owner@example.test";
struct Server {child:Child,base:String,log:PathBuf}
impl Drop for Server {fn drop(&mut self){let _=self.child.kill();let _=self.child.wait();}}

async fn db()->Option<TestDb>{let d=database().await;if d.is_none(){eprintln!("skipped: use scripts/test-vx.mjs with real Postgres");}d}
async fn url(db:&TestDb)->String{
    let admin=std::env::var("VX_TEST_DATABASE_URL").unwrap();
    let name:String=sqlx::query_scalar("SELECT current_database()").fetch_one(&db.pool).await.unwrap();
    format!("{}/{name}",admin.rsplit_once('/').unwrap().0)
}
fn issue(url:&str)->String {
    let out=Command::new(env!("CARGO_BIN_EXE_vaultixd")).arg("setup-code").env("VX_DATABASE_URL",url).output().unwrap();
    assert!(out.status.success(),"setup-code command succeeds");
    String::from_utf8(out.stdout).unwrap().trim().into()
}
async fn start(url:&str)->Server{
    let dir=std::env::temp_dir().join(format!("vx-auth-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&dir).unwrap();
    let key=dir.join("root.key");
    std::fs::write(&key,vx_keys::recovery_string(&vx_keys::Keyring::generate_root())).unwrap();
    let port=std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let log=dir.join("server.log");
    let child=Command::new(env!("CARGO_BIN_EXE_vaultixd")).env("VX_DATABASE_URL",url).env("VX_ROOT_KEY_FILE",key).env("VX_LISTEN",format!("127.0.0.1:{port}")).env("VX_BOOTSTRAP_TOKEN","obsolete-bootstrap-must-not-work")
        .stdout(Stdio::from(std::fs::File::create(&log).unwrap())).stderr(Stdio::null()).spawn().unwrap();
    let server=Server{child,base:format!("http://127.0.0.1:{port}"),log};
    for _ in 0..150 {if ureq::get(&format!("{}/healthz",server.base)).call().is_ok(){return server;}tokio::time::sleep(Duration::from_millis(100)).await;}
    panic!("server did not start");
}
fn request(base:&str,method:&str,path:&str,token:Option<&str>,body:Option<Value>)->(u16,Value){
    let req=ureq::request(method,&format!("{base}/api/vx/v1{path}")).timeout(Duration::from_secs(20)).set("X-Vx-Actor","forged:owner");
    let req=if let Some(t)=token{req.set("Authorization",&format!("Bearer {t}"))}else{req};
    let out=if let Some(body)=body{req.send_json(body)}else{req.call()};
    let response=match out{Ok(r)=>r,Err(ureq::Error::Status(_,r))=>r,Err(_)=>panic!("HTTP transport failed")};
    let status=response.status();
    if status==200 && path=="/auth/sessions" {assert_eq!(response.header("cache-control"),Some("no-store"));}
    (status,response.into_json().unwrap())
}
fn setup_body(code:&str)->Value{json!({"setupCode":code,"email":EMAIL,"password":PASSWORD,"organizationName":"Owned instance","project":"payments","environment":"prod"})}
fn login(base:&str)->String{let (s,b)=request(base,"POST","/auth/sessions",None,Some(json!({"email":EMAIL,"password":PASSWORD})));assert_eq!(s,200);b["bearer"].as_str().unwrap().into()}
const LIST:&str="/secrets?project=payments&environment=prod";

#[tokio::test]
async fn owner_signs_in_lists_metadata_logs_out_and_is_denied_after_restart(){
    let Some(db)=db().await else{return};let url=url(&db).await;let code=issue(&url);let server=start(&url).await;
    assert_eq!(request(&server.base,"GET",LIST,Some("obsolete-bootstrap-must-not-work"),None).0,401);
    assert_eq!(request(&server.base,"POST","/auth/setup",None,Some(setup_body("wrong"))).0,403);
    let (status,owner)=request(&server.base,"POST","/auth/setup",None,Some(setup_body(&code)));assert_eq!(status,200);
    assert_eq!(request(&server.base,"POST","/auth/setup",None,Some(setup_body(&code))).0,409);
    let init:bool=sqlx::query_scalar("SELECT initialized AND setup_hash IS NULL AND setup_expires_at IS NULL FROM vx_auth_instance").fetch_one(&db.pool).await.unwrap();assert!(init);
    for email in [EMAIL,"unknown@example.test"]{assert_eq!(request(&server.base,"POST","/auth/sessions",None,Some(json!({"email":email,"password":"wrong-test-password"}))).0,401);}
    let token=login(&server.base);let other=login(&server.base);
    let (s,empty)=request(&server.base,"GET",LIST,Some(&token),None);assert_eq!(s,200);assert_eq!(empty,json!({"secrets":[]}));
    assert_eq!(request(&server.base,"GET","/secrets?project=other-tenant&environment=prod",Some(&token),None).0,403);
    assert_eq!(request(&server.base,"GET","/secrets?project=payments&environment=dev",Some(&token),None).0,403);
    assert_eq!(request(&server.base,"PUT","/secrets",Some(&token),Some(json!({"project":"payments","environment":"prod","name":"API_TOKEN","value":CANARY}))).0,200);
    let (_,listed)=request(&server.base,"GET",LIST,Some(&token),None);
    assert_eq!(listed["secrets"][0]["updatedBy"],format!("user:{}",owner["userId"].as_str().unwrap()));
    assert!(!listed.to_string().contains(CANARY));
    let (_,made)=request(&server.base,"POST","/secrets/injections",Some(&token),Some(json!({"purpose":"auth test","secrets":[{"project":"payments","environment":"prod","name":"API_TOKEN"}]})));
    let path=format!("/secrets/injections/{}/redeem",made["handle"].as_str().unwrap());
    assert_eq!(request(&server.base,"POST",&path,Some(&other),None).0,410,"a different session cannot spoof identity with a header");
    assert_eq!(request(&server.base,"POST","/auth/logout",Some(&token),None).0,200);
    assert_eq!(request(&server.base,"GET",LIST,Some(&token),None).0,401);
    assert_eq!(request(&server.base,"POST",&path,Some(&token),None).0,401);
    let log=std::fs::read_to_string(&server.log).unwrap();assert!(![PASSWORD,CANARY,&token,&code].iter().any(|s|log.contains(s)));
    drop(server);let restarted=start(&url).await;
    assert_eq!(request(&restarted.base,"GET",LIST,Some(&token),None).0,401);
    assert_eq!(request(&restarted.base,"GET",LIST,Some(&other),None).0,200,"a surviving session is durable across restart");
    sqlx::query("DELETE FROM vx_auth_scope_grants WHERE action='secrets.list'").execute(&db.pool).await.unwrap();
    assert_eq!(request(&restarted.base,"GET",LIST,Some(&other),None).0,403);
    sqlx::query("UPDATE vx_auth_sessions SET expires_at=now()-interval '1 second'").execute(&db.pool).await.unwrap();
    assert_eq!(request(&restarted.base,"GET",LIST,Some(&other),None).0,401);
    let rows:Vec<String>=sqlx::query_scalar("SELECT t::text FROM vx_auth_users t UNION ALL SELECT t::text FROM vx_auth_sessions t UNION ALL SELECT t::text FROM vx_auth_instance t UNION ALL SELECT t::text FROM vx_operate_audit_events t").fetch_all(&db.pool).await.unwrap();
    assert!(rows.iter().all(|r|![PASSWORD,&token,&other,&code,CANARY].iter().any(|s|r.contains(s))));
    assert!(vx_audit::verify(&db.pool,"auth:instance").await.unwrap()>=5);
    drop(restarted);db.finish().await;
}

#[tokio::test]
async fn setup_expires_races_and_recovers_from_an_unavailable_audit(){
    let Some(db)=db().await else{return};let url=url(&db).await;let code=issue(&url);let server=start(&url).await;
    sqlx::query("UPDATE vx_auth_instance SET setup_expires_at=now()-interval '1 second'").execute(&db.pool).await.unwrap();
    assert_eq!(request(&server.base,"POST","/auth/setup",None,Some(setup_body(&code))).0,403);
    let code=issue(&url);
    sqlx::query("ALTER TABLE vx_operate_audit_heads RENAME TO vx_operate_audit_heads_off").execute(&db.pool).await.unwrap();
    assert_eq!(request(&server.base,"POST","/auth/setup",None,Some(setup_body(&code))).0,503);
    let users:i64=sqlx::query_scalar("SELECT count(*) FROM vx_auth_users").fetch_one(&db.pool).await.unwrap();assert_eq!(users,0);
    sqlx::query("ALTER TABLE vx_operate_audit_heads_off RENAME TO vx_operate_audit_heads").execute(&db.pool).await.unwrap();
    let attempts:Vec<_>=(0..2).map(|_|{let base=server.base.clone();let body=setup_body(&code);std::thread::spawn(move||request(&base,"POST","/auth/setup",None,Some(body)).0)}).collect();
    let mut results:Vec<_>=attempts.into_iter().map(|t|t.join().unwrap()).collect();results.sort();assert_eq!(results,vec![200,409]);
    let token=login(&server.base);
    sqlx::query("ALTER TABLE vx_operate_audit_heads RENAME TO vx_operate_audit_heads_off").execute(&db.pool).await.unwrap();
    assert_eq!(request(&server.base,"POST","/auth/logout",Some(&token),None).0,503);
    assert_eq!(request(&server.base,"POST","/auth/sessions",None,Some(json!({"email":EMAIL,"password":PASSWORD}))).0,503);
    let sessions:i64=sqlx::query_scalar("SELECT count(*) FROM vx_auth_sessions").fetch_one(&db.pool).await.unwrap();assert_eq!(sessions,1,"failed login/logout leaves no partial session change");
    sqlx::query("ALTER TABLE vx_operate_audit_heads_off RENAME TO vx_operate_audit_heads").execute(&db.pool).await.unwrap();
    assert_eq!(request(&server.base,"POST","/auth/logout",Some(&token),None).0,200);
    sqlx::query("UPDATE vx_auth_instance SET attempts=30,window_at=now()").execute(&db.pool).await.unwrap();
    assert_eq!(request(&server.base,"POST","/auth/sessions",None,Some(json!({"email":EMAIL,"password":PASSWORD}))).0,429);
    drop(server);db.finish().await;
}

#[tokio::test]
async fn the_human_cli_completes_the_journey_without_printing_or_persisting_credentials(){
    let Some(db)=db().await else{return};let url=url(&db).await;let code=issue(&url);let server=start(&url).await;
    let binary=std::path::Path::new(env!("CARGO_BIN_EXE_vaultixd")).parent().unwrap().join(if cfg!(windows){"vx.exe"}else{"vx"});
    assert!(binary.exists(),"build vx-client before running the auth acceptance tests");
    let mut cli=Command::new(binary).args(["session","--project","payments","--env","prod","--organization","CLI organization","--stdin-auth"]).env("VX_URL",&server.base).env_remove("VX_TOKEN").env_remove("VX_TOKEN_FILE").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    writeln!(cli.stdin.as_mut().unwrap(),"{}\nlist\nlogout",json!({"email":EMAIL,"password":PASSWORD,"setupCode":code})).unwrap();
    drop(cli.stdin.take());let result=cli.wait_with_output().unwrap();
    assert!(result.status.success(),"the terminal journey exits successfully");
    let output=String::from_utf8(result.stdout).unwrap();
    for text in ["Owner created.","Signed in.","\"secrets\": []","Signed out.","Access denied:"]{assert!(output.contains(text),"expected journey state: {text}");}
    assert!(!output.contains(PASSWORD)&&!output.contains(&code)&&!output.contains("vxs_"));
    let sessions:i64=sqlx::query_scalar("SELECT count(*) FROM vx_auth_sessions").fetch_one(&db.pool).await.unwrap();assert_eq!(sessions,0);
    drop(server);db.finish().await;
}
