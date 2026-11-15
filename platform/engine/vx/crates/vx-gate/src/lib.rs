//! The output gate: the one choke point every payload passes on its way toward a model, a log, a
//! signal, a trace or an error message. It fails closed: anything that looks like a credential, any
//! registered canary, and any token equal to a value the instance holds (in plain, hex or base64
//! form) is blocked, and the answer says which rule fired, never what matched.
#![allow(clippy::disallowed_methods)] // registering a value reads it once, to fingerprint its forms

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand::RngCore;
use regex::RegexSet;
use serde_json::Value;
use std::collections::{BTreeSet, HashSet};
use std::fmt;
use vx_secret::Secret;

/// Why a payload was blocked. It names a rule and nothing from the payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blocked {
    pub rule: &'static str,
}

impl fmt::Display for Blocked {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "blocked by the output gate (rule: {})", self.rule)
    }
}

impl std::error::Error for Blocked {}

const RULES: &[(&str, &str)] = &[
    ("private-key-block", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    ("aws-access-key", r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    ("github-token", r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b"),
    ("slack-token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    ("stripe-key", r"\b[sr]k_(live|test)_[A-Za-z0-9]{16,}\b"),
    ("anthropic-or-openai-key", r"\bsk-(ant-)?[A-Za-z0-9_-]{32,}\b"),
    ("jwt", r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
    ("url-with-password", r"[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]{3,}@"),
    ("vaultix-handle", r"\bvxh_[A-Za-z0-9]{20,}\b"),
];

/// A token shorter than this is not fingerprinted; it is too common to identify a value.
const MIN_TOKEN: usize = 8;

pub struct Gate {
    patterns: RegexSet,
    key: [u8; 32],
    canaries: Vec<String>,
    values: HashSet<[u8; 32]>,
    // The lengths of every learned form, so the check tests only windows a value could fill.
    lengths: BTreeSet<usize>,
}

impl Default for Gate {
    fn default() -> Self {
        Self::new()
    }
}

impl Gate {
    pub fn new() -> Self {
        let mut key = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key);
        Self { patterns: RegexSet::new(RULES.iter().map(|(_, p)| *p)).expect("static rules"), key, canaries: Vec::new(), values: HashSet::new(), lengths: BTreeSet::new() }
    }

    /// Plant a canary: a marker that must never appear in any output. The build plants one and fails
    /// if it ever surfaces.
    pub fn plant_canary(&mut self, marker: &str) {
        if !marker.is_empty() {
            self.canaries.push(marker.to_string());
        }
    }

    /// Learn a value the instance holds, in the forms it could leak in. Only fingerprints are kept.
    pub fn learn(&mut self, value: &Secret) {
        let raw = value.expose();
        for form in [raw.to_vec(), hex::encode(raw).into_bytes(), STANDARD.encode(raw).into_bytes()] {
            if form.len() >= MIN_TOKEN {
                self.lengths.insert(form.len());
                self.values.insert(Secret::from_vec(form).fingerprint(&self.key));
            }
        }
    }

    /// Check text. `Ok` means nothing in it is blocked.
    pub fn check(&self, text: &str) -> Result<(), Blocked> {
        if self.canaries.iter().any(|canary| text.contains(canary.as_str())) {
            return Err(Blocked { rule: "canary" });
        }
        if let Some(index) = self.patterns.matches(text).iter().next() {
            return Err(Blocked { rule: RULES[index].0 });
        }
        if !self.values.is_empty() {
            // A value can sit after `=`, `:`, `/`, a quote or anything else, so test a window of each
            // learned length from the start of the text and after every non-alphanumeric character.
            let bytes = text.as_bytes();
            let starts = std::iter::once(0).chain(text.char_indices().filter(|(_, c)| !c.is_ascii_alphanumeric()).map(|(i, c)| i + c.len_utf8()));
            for start in starts {
                for &length in &self.lengths {
                    let end = start + length;
                    if end > bytes.len() || !text.is_char_boundary(start) || !text.is_char_boundary(end) {
                        continue;
                    }
                    if self.values.contains(&Secret::from_string(text[start..end].to_string()).fingerprint(&self.key)) {
                        return Err(Blocked { rule: "known-value" });
                    }
                }
            }
        }
        Ok(())
    }

    /// Check every string, and every key, inside a JSON document.
    pub fn check_json(&self, value: &Value) -> Result<(), Blocked> {
        match value {
            Value::String(text) => self.check(text),
            Value::Array(items) => items.iter().try_for_each(|item| self.check_json(item)),
            Value::Object(map) => map.iter().try_for_each(|(key, child)| self.check(key).and_then(|_| self.check_json(child))),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn blocked(gate: &Gate, text: &str) -> Option<&'static str> {
        gate.check(text).err().map(|b| b.rule)
    }

    #[test]
    fn credential_shapes_are_blocked_and_ordinary_text_passes() {
        let gate = Gate::new();
        let cases = [
            ("-----BEGIN RSA PRIVATE KEY-----\nMIIE", "private-key-block"),
            ("key AKIAIOSFODNN7EXAMPLE here", "aws-access-key"),
            ("ghp_0123456789abcdefghijklmnopqrstuvwxyzAB", "github-token"),
            ("xoxb-1234567890-abcdefghij", "slack-token"),
            ("sk_live_abcdefghijklmnop1234", "stripe-key"),
            ("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", "anthropic-or-openai-key"),
            ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk", "jwt"),
            ("postgres://admin:hunter22@db.internal:5432/app", "url-with-password"),
        ];
        for (text, rule) in cases {
            assert_eq!(blocked(&gate, text), Some(rule), "{text}");
        }
        for fine in ["The DATABASE_URL secret in production was rotated yesterday", "secret:db-url version 7", "postgres://db.internal:5432/app"] {
            assert!(gate.check(fine).is_ok(), "{fine}");
        }
    }

    #[test]
    fn a_planted_canary_is_caught_anywhere() {
        let mut gate = Gate::new();
        gate.plant_canary("CANARY-7c1e-do-not-leak");
        assert_eq!(blocked(&gate, "log: ok CANARY-7c1e-do-not-leak end"), Some("canary"));
        assert!(gate.check_json(&json!({"nested": [{"msg": "x CANARY-7c1e-do-not-leak"}]})).is_err());
        assert!(gate.check_json(&json!({"CANARY-7c1e-do-not-leak": 1})).is_err(), "keys are checked too");
    }

    #[test]
    fn a_learned_value_is_caught_in_plain_hex_and_base64_form() {
        let mut gate = Gate::new();
        let value = Secret::from_string("correct-horse-battery-staple".into());
        gate.learn(&value);
        assert_eq!(blocked(&gate, "the password is correct-horse-battery-staple, ok?"), Some("known-value"));
        assert_eq!(blocked(&gate, &format!("{{\"v\":\"{}\"}}", hex::encode("correct-horse-battery-staple"))), Some("known-value"));
        assert_eq!(blocked(&gate, &format!("data={}", STANDARD.encode("correct-horse-battery-staple"))), Some("known-value"));
        assert!(gate.check("correct horse battery staple").is_ok(), "a similar sentence is not the value");
    }

    #[test]
    fn short_values_are_not_fingerprinted_and_the_answer_never_echoes_the_match() {
        let mut gate = Gate::new();
        gate.learn(&Secret::from_string("abc".into()));
        assert!(gate.check("abc abc abc").is_ok());
        let error = gate.check("AKIAIOSFODNN7EXAMPLE").unwrap_err();
        let shown = format!("{error} {error:?}");
        assert!(!shown.contains("AKIA"), "the block reason must not repeat the content");
    }
}
