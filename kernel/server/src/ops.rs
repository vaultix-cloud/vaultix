//! Operator commands: `vaultixd backup`, `restore`, `anchor` and `check-anchor` (docs/0140, phase 0).
//!
//! They read `VX_DATABASE_URL` and `VX_ROOT_KEY_FILE` like the server. They write only to a file path the operator names, never
//! overwrite one, and print counts and codes, never a name or a value. Restore migrates the target and then loads the backup,
//! so run it on a fresh database *before* the first start.

use std::io::Write;
use std::sync::Arc;

type Failure = Box<dyn std::error::Error>;

async fn connect() -> Result<(sqlx::PgPool, Arc<vx_keys::Keyring>), Failure> {
    let url = std::env::var("VX_DATABASE_URL").map_err(|_| "VX_DATABASE_URL is required")?;
    let path = std::env::var("VX_ROOT_KEY_FILE").map_err(|_| "VX_ROOT_KEY_FILE is required: a backup is sealed with the root key")?;
    let pool = vx_store::open(&url, 4).await?;
    Ok((pool, Arc::new(crate::app::load_keyring(&path)?)))
}

fn flag<'a>(args: &'a [String], name: &str) -> Result<&'a str, Failure> {
    match args {
        [given, path] if given == name => Ok(path),
        _ => Err(format!("usage: vaultixd <command> {name} PATH").into()),
    }
}

fn write_new(path: &str, bytes: &[u8]) -> Result<(), Failure> {
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|_| "the output file already exists or cannot be created; it is never overwritten")?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[allow(clippy::print_stdout)] // a one-time report to the person running the command
pub async fn run(command: &str, args: &[String]) -> Result<(), Failure> {
    match command {
        "backup" => {
            let out = flag(args, "--out")?;
            let (pool, ring) = connect().await?;
            let file = vx_recover::backup(&pool, &ring).await?;
            write_new(out, &file)?;
            println!("Wrote an encrypted backup ({} bytes) to {out}. Opening it needs the root key or the recovery key.", file.len());
        }
        "restore" => {
            let from = flag(args, "--in")?;
            let (pool, ring) = connect().await?;
            vx_store::migrate(&pool).await?;
            let manifest = vx_recover::restore(&pool, &ring, &std::fs::read(from).map_err(|_| "the backup file cannot be read")?).await?;
            let rows: i64 = manifest.tables.iter().map(|t| t.rows).sum();
            println!("Restored {rows} rows in {} tables and {} audit chains, each verified. Start the server now.", manifest.tables.len(), manifest.heads.len());
        }
        "anchor" => {
            let out = flag(args, "--out")?;
            let (pool, ring) = connect().await?;
            let anchor = vx_recover::anchor(&pool, &ring).await?;
            write_new(out, serde_json::to_string_pretty(&anchor)?.as_bytes())?;
            println!("Wrote a signed anchor of {} audit chains to {out}. Keep it somewhere the database administrator cannot reach.", anchor.heads.len());
        }
        "check-anchor" => {
            let from = flag(args, "--in")?;
            let (pool, ring) = connect().await?;
            let anchor: vx_recover::Anchor = serde_json::from_slice(&std::fs::read(from).map_err(|_| "the anchor file cannot be read")?).map_err(|_| "the anchor file is not valid")?;
            vx_recover::check_anchor(&pool, &ring, &anchor).await?;
            println!("The database matches the anchor taken at {}.", anchor.at);
        }
        other => return Err(format!("unknown command {other}").into()),
    }
    Ok(())
}
