//! `Secret` is the type a secret value lives in. It is deliberately hard to leak:
//!
//! * no `Clone`, `Display`, `Serialize`, `PartialEq` or `Hash`, so it cannot be copied around,
//!   formatted into a message, written into JSON or compared by accident;
//! * `Debug` prints a fixed placeholder, so a struct holding one can still derive `Debug`;
//! * the bytes are wiped when it is dropped;
//! * reading it is `expose`, which the workspace lint (`clippy.toml`) forbids everywhere except the
//!   value path, so a read elsewhere fails review and the build.
//!
//! The doc tests below are compile-fail tests: they prove the operations that would leak do not compile.
//!
//! ```compile_fail
//! let s = vx_secret::Secret::from_string("v".into());
//! let _copy = s.clone();
//! ```
//!
//! ```compile_fail
//! let s = vx_secret::Secret::from_string("v".into());
//! let _text = format!("{}", s);
//! ```
//!
//! ```compile_fail
//! fn needs_eq<T: PartialEq>(_: T) {}
//! needs_eq(vx_secret::Secret::from_string("v".into()));
//! ```

use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::fmt;
use zeroize::Zeroizing;

/// A secret value. Construct it at the edge where the value arrives and keep it in this type.
pub struct Secret(Zeroizing<Vec<u8>>);

impl Secret {
    pub fn from_vec(bytes: Vec<u8>) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub fn from_string(text: String) -> Self {
        Self(Zeroizing::new(text.into_bytes()))
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Read the bytes. Allowed only in the value path; every other use is a lint error.
    pub fn expose(&self) -> &[u8] {
        &self.0
    }

    /// A keyed fingerprint (HMAC-SHA256) that proves two values match without revealing either.
    /// Audit uses it so "this value was read" is recorded and the value is not.
    pub fn fingerprint(&self, key: &[u8]) -> [u8; 32] {
        // HMAC accepts any key length, so this cannot fail.
        let mut mac = Hmac::<Sha256>::new_from_slice(key).unwrap_or_else(|_| unreachable!());
        mac.update(&self.0);
        mac.finalize().into_bytes().into()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(**redacted**)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_never_shows_the_value() {
        let secret = Secret::from_string("hunter2-canary".into());
        let shown = format!("{secret:?}");
        assert!(!shown.contains("hunter2"));
        assert_eq!(shown, "Secret(**redacted**)");
    }

    #[test]
    fn fingerprint_is_stable_keyed_and_hides_the_value() {
        let a = Secret::from_string("same".into());
        let b = Secret::from_string("same".into());
        let c = Secret::from_string("different".into());
        assert_eq!(a.fingerprint(b"key-1"), b.fingerprint(b"key-1"));
        assert_ne!(a.fingerprint(b"key-1"), c.fingerprint(b"key-1"));
        assert_ne!(a.fingerprint(b"key-1"), a.fingerprint(b"key-2"));
        let hex = hex::encode(a.fingerprint(b"key-1"));
        assert!(!hex.contains("73616d65")); // the hex of "same"
    }
}
