//! Backup, restore and rollback detection (docs/0140, phase 0).
//!
//! * **Backup** is one encrypted file holding every `vx_` table, taken in a single consistent snapshot, so a sync that is
//!   writing while it runs cannot leave the file half-way between two states. The whole file is sealed with a key derived
//!   from the root key, because tables hold names and audit metadata in the clear: a stolen backup file shows nothing, and
//!   restoring it needs the root key (or the recovery key that is the same key).
//! * **Restore** goes into an empty, migrated database in one transaction. It refuses a wrong key, a damaged file, a different
//!   schema and a non-empty target, and it proves every audit chain is intact **before** it commits. Nothing partial is left.
//! * **Anchors** are signed audit chain heads kept outside the database. A database restored from an older backup, or one whose
//!   chain was rewritten, no longer matches the newest anchor, and `check_anchor` says which.

mod anchor;
mod archive;

pub use anchor::{anchor, check_anchor, heads, Anchor, AnchorProblem, Head};
pub use archive::{backup, restore, Manifest, TableEntry};

#[derive(Debug, thiserror::Error)]
pub enum RecoverError {
    #[error("this is not a Vaultix backup file")]
    NotArchive,
    /// An authenticated cipher cannot tell a wrong key from a damaged file, so neither does this.
    #[error("the backup could not be opened: the key is wrong, or the file is damaged")]
    WrongKeyOrCorrupt,
    #[error("the backup is from a different schema than this database ({0})")]
    SchemaMismatch(String),
    #[error("the target database already holds data in {0}; restore into an empty, freshly migrated database before starting the server")]
    NotEmpty(String),
    #[error("the restored data failed verification ({0}); nothing was restored")]
    Verification(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Key(#[from] vx_keys::KeyError),
    #[error(transparent)]
    Audit(#[from] vx_audit::AuditError),
}
