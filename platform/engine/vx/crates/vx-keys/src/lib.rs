//! The key hierarchy and the value path. This crate is one of the few places allowed to read a
//! `Secret` (see `clippy.toml`); everything it returns is ciphertext, a `Secret`, or a count.
//!
//! root key -> a key-encryption key per scope (an HMAC derivation, never stored) -> a random data
//! key per scope and version (stored wrapped) -> values sealed with AES-256-GCM, with the value's
//! identity bound in as associated data so a ciphertext cannot be moved to another secret.
//!
//! The instance starts sealed: there is no `Keyring` until a root key is supplied.
#![allow(clippy::disallowed_methods)] // the value path: every `expose` here is deliberate

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use sqlx::PgPool;
use vx_secret::Secret;
use zeroize::Zeroizing;

const NONCE: usize = 12;
const KEY: usize = 32;

#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    #[error("a root key must be 32 bytes")]
    RootLength,
    #[error("the recovery key is not valid")]
    BadRecovery,
    #[error("the data could not be opened: it was altered, or the key or its context is wrong")]
    Open,
    #[error("the sealed data is too short to be valid")]
    Malformed,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// An unsealed instance's keys. Dropping it wipes the root key from memory.
#[derive(Debug)]
pub struct Keyring {
    root: Secret,
}

impl Keyring {
    pub fn new(root: Secret) -> Result<Self, KeyError> {
        if root.len() != KEY {
            return Err(KeyError::RootLength);
        }
        Ok(Self { root })
    }

    /// A new random root key.
    pub fn generate_root() -> Secret {
        let mut bytes = Zeroizing::new([0u8; KEY]);
        rand::rngs::OsRng.fill_bytes(&mut *bytes);
        Secret::from_vec(bytes.to_vec())
    }

    fn kek(&self, scope: &str) -> Zeroizing<[u8; KEY]> {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(self.root.expose()).unwrap_or_else(|_| unreachable!());
        mac.update(b"vx-kek-v1|");
        mac.update(scope.as_bytes());
        Zeroizing::new(mac.finalize().into_bytes().into())
    }

    /// A new random data key for a scope and version, with its wrapped form to store.
    pub fn new_data_key(&self, scope: &str, version: i32) -> Result<(Secret, Vec<u8>), KeyError> {
        let mut bytes = Zeroizing::new([0u8; KEY]);
        rand::rngs::OsRng.fill_bytes(&mut *bytes);
        let key = Secret::from_vec(bytes.to_vec());
        let wrapped = encrypt(&*self.kek(scope), key_context(scope, version).as_bytes(), key.expose())?;
        Ok((key, wrapped))
    }

    pub fn unwrap_data_key(&self, scope: &str, version: i32, wrapped: &[u8]) -> Result<Secret, KeyError> {
        decrypt(&*self.kek(scope), key_context(scope, version).as_bytes(), wrapped)
    }
}

fn key_context(scope: &str, version: i32) -> String {
    format!("vx-key|{scope}|{version}")
}

fn encrypt(key: &[u8], aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, KeyError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| KeyError::RootLength)?;
    let mut nonce = [0u8; NONCE];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let sealed = cipher.encrypt(Nonce::from_slice(&nonce), Payload { msg: plaintext, aad }).map_err(|_| KeyError::Open)?;
    let mut out = Vec::with_capacity(NONCE + sealed.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

fn decrypt(key: &[u8], aad: &[u8], sealed: &[u8]) -> Result<Secret, KeyError> {
    if sealed.len() < NONCE + 16 {
        return Err(KeyError::Malformed);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| KeyError::RootLength)?;
    let (nonce, body) = sealed.split_at(NONCE);
    let plain = cipher.decrypt(Nonce::from_slice(nonce), Payload { msg: body, aad }).map_err(|_| KeyError::Open)?;
    Ok(Secret::from_vec(plain))
}

/// Seal a value under a data key. `context` names the value (project, environment, path, name,
/// version): opening with any other context fails, so a ciphertext cannot be swapped between secrets.
pub fn seal(data_key: &Secret, context: &str, value: &Secret) -> Result<Vec<u8>, KeyError> {
    encrypt(data_key.expose(), context.as_bytes(), value.expose())
}

pub fn open(data_key: &Secret, context: &str, sealed: &[u8]) -> Result<Secret, KeyError> {
    decrypt(data_key.expose(), context.as_bytes(), sealed)
}

/// The recovery key is the root key in a form a person can store offline: shown once at setup.
pub fn recovery_string(root: &Secret) -> String {
    let hex = hex::encode(root.expose());
    hex.as_bytes().chunks(8).map(|c| std::str::from_utf8(c).unwrap_or("")).collect::<Vec<_>>().join("-")
}

pub fn parse_recovery(text: &str) -> Result<Secret, KeyError> {
    let compact: String = text.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
    let bytes = hex::decode(compact).map_err(|_| KeyError::BadRecovery)?;
    if bytes.len() != KEY {
        return Err(KeyError::BadRecovery);
    }
    Ok(Secret::from_vec(bytes))
}

/// Store a wrapped data key. The database holds only ciphertext.
pub async fn save_data_key(pool: &PgPool, scope: &str, version: i32, wrapped: &[u8]) -> Result<(), KeyError> {
    sqlx::query("INSERT INTO vx_kms_keys (id, scope, version, wrapped, parent) VALUES ($1, $2, $3, $4, 'root')")
        .bind(key_context(scope, version))
        .bind(scope)
        .bind(version)
        .bind(wrapped)
        .execute(pool)
        .await?;
    Ok(())
}

/// The newest non-retired key for a scope, as `(version, wrapped)`.
pub async fn load_current(pool: &PgPool, scope: &str) -> Result<Option<(i32, Vec<u8>)>, KeyError> {
    Ok(sqlx::query_as("SELECT version, wrapped FROM vx_kms_keys WHERE scope = $1 AND retired_at IS NULL ORDER BY version DESC LIMIT 1")
        .bind(scope)
        .fetch_optional(pool)
        .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring() -> Keyring {
        Keyring::new(Keyring::generate_root()).unwrap()
    }

    #[test]
    fn a_value_round_trips_and_the_ciphertext_hides_it() {
        let ring = ring();
        let (key, _) = ring.new_data_key("project:p1", 1).unwrap();
        let value = Secret::from_string("postgres://user:pw@host/db".into());
        let sealed = seal(&key, "p1/dev//DATABASE_URL/v1", &value).unwrap();
        assert!(!String::from_utf8_lossy(&sealed).contains("postgres"));
        assert_eq!(open(&key, "p1/dev//DATABASE_URL/v1", &sealed).unwrap().expose(), value.expose());
    }

    #[test]
    fn a_ciphertext_cannot_be_moved_to_another_secret_or_altered() {
        let ring = ring();
        let (key, _) = ring.new_data_key("project:p1", 1).unwrap();
        let sealed = seal(&key, "p1/dev//A/v1", &Secret::from_string("value-a".into())).unwrap();
        assert!(matches!(open(&key, "p1/dev//B/v1", &sealed), Err(KeyError::Open)), "another secret's context must fail");
        let mut flipped = sealed.clone();
        *flipped.last_mut().unwrap() ^= 1;
        assert!(open(&key, "p1/dev//A/v1", &flipped).is_err(), "a flipped bit must fail");
        assert!(matches!(open(&key, "p1/dev//A/v1", &sealed[..10]), Err(KeyError::Malformed)));
    }

    #[test]
    fn the_same_value_seals_differently_every_time() {
        let ring = ring();
        let (key, _) = ring.new_data_key("project:p1", 1).unwrap();
        let value = Secret::from_string("same".into());
        assert_ne!(seal(&key, "c", &value).unwrap(), seal(&key, "c", &value).unwrap());
    }

    #[test]
    fn data_keys_unwrap_only_for_their_scope_version_and_root() {
        let ring = ring();
        let (key, wrapped) = ring.new_data_key("project:p1", 1).unwrap();
        assert_eq!(ring.unwrap_data_key("project:p1", 1, &wrapped).unwrap().expose(), key.expose());
        assert!(ring.unwrap_data_key("project:p2", 1, &wrapped).is_err(), "another scope");
        assert!(ring.unwrap_data_key("project:p1", 2, &wrapped).is_err(), "another version");
        assert!(self::ring().unwrap_data_key("project:p1", 1, &wrapped).is_err(), "another root");
        let (next, _) = ring.new_data_key("project:p1", 2).unwrap();
        assert_ne!(next.expose(), key.expose(), "a rotated key is a different key");
    }

    #[test]
    fn the_recovery_key_restores_the_root() {
        let root = Keyring::generate_root();
        let text = recovery_string(&root);
        assert_eq!(text.split('-').count(), 8);
        assert_eq!(parse_recovery(&text).unwrap().expose(), root.expose());
        assert!(parse_recovery("not hex").is_err());
        assert!(parse_recovery("abcd").is_err());
        let ring = Keyring::new(root).unwrap();
        assert!(!format!("{ring:?}").contains(&text.replace('-', "")), "a keyring never prints its root");
    }

    #[test]
    fn a_root_key_must_be_32_bytes() {
        assert!(matches!(Keyring::new(Secret::from_vec(vec![1; 16])), Err(KeyError::RootLength)));
    }
}
