//! The backup file and the two operations on it.
//!
//! Layout of the file: `VXBK1\n`, then the sealed archive. The archive, once opened, is `VXBA`, a 4-byte length, a JSON
//! manifest, and then each table's data (PostgreSQL's binary COPY format, which round-trips every type exactly), in the order
//! the manifest lists them (parents before the tables that reference them).

use crate::anchor::{heads, Head};
use crate::RecoverError;
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool, Row};
use std::collections::{BTreeMap, BTreeSet};
use vx_keys::Keyring;
use vx_secret::Secret;

const FILE_MAGIC: &[u8] = b"VXBK1\n";
const ARCHIVE_MAGIC: &[u8] = b"VXBA";
const CONTEXT: &str = "vx-backup-v1";
/// Not a data table: the migration ledger is compared, never copied, because the target is migrated by the same binary.
const LEDGER: &str = "vx_operate_migrations";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TableEntry {
    pub name: String,
    pub rows: i64,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Manifest {
    pub format: u32,
    pub created_at: DateTime<Utc>,
    /// The applied migrations, `version name`. A restore needs the same list.
    pub migrations: Vec<String>,
    pub tables: Vec<TableEntry>,
    pub heads: Vec<Head>,
}

fn key(ring: &Keyring) -> Secret {
    Secret::from_vec(ring.derive("backup-v1").to_vec())
}

/// `vx_` tables, parents before children.
async fn tables(conn: &mut PgConnection) -> Result<Vec<String>, sqlx::Error> {
    let names: Vec<String> = sqlx::query_scalar("SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'vx\\_%' ORDER BY tablename").fetch_all(&mut *conn).await?;
    let edges: Vec<(String, String)> = sqlx::query_as(
        "SELECT c.conrelid::regclass::text, c.confrelid::regclass::text FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'f' AND n.nspname = 'public'",
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut parents: BTreeMap<String, BTreeSet<String>> = names.iter().map(|n| (n.clone(), BTreeSet::new())).collect();
    for (child, parent) in edges {
        if child != parent && parents.contains_key(&child) && parents.contains_key(&parent) {
            parents.get_mut(&child).map(|set| set.insert(parent));
        }
    }
    let mut ordered = Vec::with_capacity(names.len());
    let mut done: BTreeSet<String> = BTreeSet::new();
    while ordered.len() < names.len() {
        let ready: Vec<String> = parents.iter().filter(|(name, deps)| !done.contains(*name) && deps.iter().all(|d| done.contains(d))).map(|(name, _)| name.clone()).collect();
        if ready.is_empty() {
            break; // a cycle: not expected, and the verification below would catch a short list
        }
        for name in ready {
            done.insert(name.clone());
            ordered.push(name);
        }
    }
    Ok(ordered)
}

async fn migration_list(conn: &mut PgConnection) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query("SELECT version, name FROM vx_operate_migrations ORDER BY version").fetch_all(&mut *conn).await?;
    Ok(rows.iter().map(|r| format!("{} {}", r.get::<i32, _>("version"), r.get::<String, _>("name"))).collect())
}

async fn copy_out(conn: &mut PgConnection, table: &str) -> Result<Vec<u8>, sqlx::Error> {
    let mut stream = conn.copy_out_raw(&format!("COPY \"{table}\" TO STDOUT (FORMAT binary)")).await?;
    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        data.extend_from_slice(&chunk?);
    }
    Ok(data)
}

/// Take a backup. The result is the file to store; it can only be opened with the root key.
pub async fn backup(pool: &PgPool, ring: &Keyring) -> Result<Vec<u8>, RecoverError> {
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY").execute(&mut *conn).await?;
    let built = build(&mut conn).await;
    let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
    let (manifest, blobs) = built?;

    let manifest_json = serde_json::to_vec(&manifest).map_err(|_| RecoverError::NotArchive)?;
    let mut archive = Vec::with_capacity(blobs.iter().map(Vec::len).sum::<usize>() + manifest_json.len() + 8);
    archive.extend_from_slice(ARCHIVE_MAGIC);
    archive.extend_from_slice(&(manifest_json.len() as u32).to_be_bytes());
    archive.extend_from_slice(&manifest_json);
    for blob in &blobs {
        archive.extend_from_slice(blob);
    }
    let sealed = vx_keys::seal(&key(ring), CONTEXT, &Secret::from_vec(archive))?;
    let mut file = FILE_MAGIC.to_vec();
    file.extend_from_slice(&sealed);
    Ok(file)
}

async fn build(conn: &mut PgConnection) -> Result<(Manifest, Vec<Vec<u8>>), RecoverError> {
    let names: Vec<String> = tables(conn).await?.into_iter().filter(|n| n != LEDGER).collect();
    let migrations = migration_list(conn).await?;
    let mut entries = Vec::new();
    let mut blobs = Vec::new();
    for name in names {
        let rows: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM \"{name}\"")).fetch_one(&mut *conn).await?;
        let data = copy_out(conn, &name).await?;
        entries.push(TableEntry { name, rows, bytes: data.len() });
        blobs.push(data);
    }
    let heads = heads(conn).await?;
    Ok((Manifest { format: 1, created_at: Utc::now(), migrations, tables: entries, heads }, blobs))
}

/// Restore a backup into an empty, migrated database, in one transaction. Returns the manifest on success.
#[allow(clippy::disallowed_methods)] // the opened archive is read here: restoring is a value path
pub async fn restore(pool: &PgPool, ring: &Keyring, file: &[u8]) -> Result<Manifest, RecoverError> {
    let sealed = file.strip_prefix(FILE_MAGIC).ok_or(RecoverError::NotArchive)?;
    let opened = vx_keys::open(&key(ring), CONTEXT, sealed).map_err(|_| RecoverError::WrongKeyOrCorrupt)?;
    let bytes = opened.expose();
    let body = bytes.strip_prefix(ARCHIVE_MAGIC).ok_or(RecoverError::WrongKeyOrCorrupt)?;
    let length = u32::from_be_bytes(body.get(..4).ok_or(RecoverError::WrongKeyOrCorrupt)?.try_into().map_err(|_| RecoverError::WrongKeyOrCorrupt)?) as usize;
    let manifest: Manifest = serde_json::from_slice(body.get(4..4 + length).ok_or(RecoverError::WrongKeyOrCorrupt)?).map_err(|_| RecoverError::WrongKeyOrCorrupt)?;
    if manifest.format != 1 {
        return Err(RecoverError::SchemaMismatch(format!("backup format {}", manifest.format)));
    }

    let mut tx = pool.begin().await?;
    let present = migration_list(&mut tx).await?;
    if present != manifest.migrations {
        return Err(RecoverError::SchemaMismatch(format!("backup has migrations {:?}, this database has {:?}", manifest.migrations, present)));
    }
    let target_tables: Vec<String> = tables(&mut tx).await?.into_iter().filter(|n| n != LEDGER).collect();
    if target_tables != manifest.tables.iter().map(|t| t.name.clone()).collect::<Vec<_>>() {
        return Err(RecoverError::SchemaMismatch("the set of tables differs".into()));
    }
    for table in &target_tables {
        sqlx::query(&format!("LOCK TABLE \"{table}\" IN EXCLUSIVE MODE")).execute(&mut *tx).await?;
        let any: bool = sqlx::query_scalar(&format!("SELECT EXISTS (SELECT 1 FROM \"{table}\")")).fetch_one(&mut *tx).await?;
        if any {
            return Err(RecoverError::NotEmpty(table.clone()));
        }
    }

    let mut offset = 4 + length;
    for entry in &manifest.tables {
        let data = body.get(offset..offset + entry.bytes).ok_or(RecoverError::WrongKeyOrCorrupt)?;
        offset += entry.bytes;
        let mut copy = (&mut *tx).copy_in_raw(&format!("COPY \"{}\" FROM STDIN (FORMAT binary)", entry.name)).await?;
        copy.send(data).await?;
        copy.finish().await?;
    }

    // sequences continue after the restored rows instead of from one
    let serials: Vec<(String, String)> = sqlx::query_as(
        "SELECT table_name::text, column_name::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name LIKE 'vx\\_%' AND column_default LIKE 'nextval(%'",
    )
    .fetch_all(&mut *tx)
    .await?;
    for (table, column) in serials {
        sqlx::query(&format!("SELECT setval(pg_get_serial_sequence('\"{table}\"', '{column}'), COALESCE((SELECT max(\"{column}\") FROM \"{table}\"), 0) + 1, false)")).execute(&mut *tx).await?;
    }

    // prove it before committing
    for entry in &manifest.tables {
        let rows: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM \"{}\"", entry.name)).fetch_one(&mut *tx).await?;
        if rows != entry.rows {
            return Err(RecoverError::Verification(format!("{} has {rows} rows, expected {}", entry.name, entry.rows)));
        }
    }
    if heads(&mut tx).await? != manifest.heads {
        return Err(RecoverError::Verification("the audit chain heads differ from the backup's".into()));
    }
    for head in &manifest.heads {
        vx_audit::verify_on(&mut tx, &head.chain).await.map_err(|error| RecoverError::Verification(error.to_string()))?;
    }
    tx.commit().await?;
    Ok(manifest)
}
