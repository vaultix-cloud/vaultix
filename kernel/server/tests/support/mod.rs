//! Fixture identity for the non-auth failure drills. Authentication acceptance uses the real setup
//! and login routes in auth.rs. This helper never exists in the server binary.
use sha2::{Digest,Sha256};
pub const TOKEN:&str="vxs_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
pub async fn seed(pool:&sqlx::PgPool,project:&str,environment:&str){
    let user:uuid::Uuid=sqlx::query_scalar("INSERT INTO vx_auth_users (organization_id,email,password_hash,is_owner) VALUES ('00000000-0000-4000-8000-000000000001','fixture@example.test','fixture-cannot-login',true) ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id").fetch_one(pool).await.unwrap();
    sqlx::query("INSERT INTO vx_auth_sessions (user_id,bearer_hash,method,expires_at) VALUES ($1,$2,'password',now()+interval '15 minutes') ON CONFLICT (bearer_hash) DO NOTHING").bind(user).bind(Sha256::digest(TOKEN.as_bytes()).to_vec()).execute(pool).await.unwrap();
    for action in ["secrets.list","secrets.write","secrets.request","secrets.inject"]{
        sqlx::query("INSERT INTO vx_auth_scope_grants (user_id,project,environment,action) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING").bind(user).bind(project).bind(environment).bind(action).execute(pool).await.unwrap();
    }
}
