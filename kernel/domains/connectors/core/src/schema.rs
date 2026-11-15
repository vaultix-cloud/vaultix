//! The key schema: how a Vaultix secret name becomes a name in the destination, and back.
//!
//! The inherited product used a full Handlebars template. That allows helpers and block logic nobody needs, and it
//! HTML-escapes what it inserts, so a key containing `&` or `=` changed on the way out and no longer matched on the
//! way back. This is a fixed grammar instead: text, exactly one `{{secretKey}}`, and optionally `{{environment}}`.

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SchemaError {
    #[error("the key schema must contain the secretKey placeholder exactly once")]
    SecretKeyCount,
    #[error("the key schema contains `{0}`, which is not a placeholder (only secretKey and environment are)")]
    UnknownPlaceholder(String),
    #[error("the key schema has an unclosed placeholder")]
    Unclosed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Part {
    Text(String),
    SecretKey,
    Environment,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeySchema {
    parts: Vec<Part>,
}

impl KeySchema {
    /// The schema that leaves names alone.
    pub fn identity() -> Self {
        Self { parts: vec![Part::SecretKey] }
    }

    pub fn parse(text: &str) -> Result<Self, SchemaError> {
        let mut parts = Vec::new();
        let mut rest = text;
        while let Some(start) = rest.find("{{") {
            if start > 0 {
                parts.push(Part::Text(rest[..start].to_string()));
            }
            let after = &rest[start + 2..];
            let end = after.find("}}").ok_or(SchemaError::Unclosed)?;
            match after[..end].trim() {
                "secretKey" => parts.push(Part::SecretKey),
                "environment" => parts.push(Part::Environment),
                other => return Err(SchemaError::UnknownPlaceholder(other.to_string())),
            }
            rest = &after[end + 2..];
        }
        if !rest.is_empty() {
            parts.push(Part::Text(rest.to_string()));
        }
        if parts.iter().filter(|p| **p == Part::SecretKey).count() != 1 {
            return Err(SchemaError::SecretKeyCount);
        }
        Ok(Self { parts })
    }

    /// The destination name for a secret. No escaping: the name goes out exactly as written.
    pub fn apply(&self, key: &str, environment: &str) -> String {
        self.parts
            .iter()
            .map(|part| match part {
                Part::Text(t) => t.as_str(),
                Part::SecretKey => key,
                Part::Environment => environment,
            })
            .collect()
    }

    fn affixes(&self, environment: &str) -> (String, String) {
        let mut prefix = String::new();
        let mut suffix = String::new();
        let mut seen = false;
        for part in &self.parts {
            let text = match part {
                Part::Text(t) => t.as_str(),
                Part::Environment => environment,
                Part::SecretKey => {
                    seen = true;
                    continue;
                }
            };
            if seen {
                suffix.push_str(text);
            } else {
                prefix.push_str(text);
            }
        }
        (prefix, suffix)
    }

    /// Whether a destination name is one this schema could have produced, so a sync never touches names it does not own.
    pub fn matches(&self, name: &str, environment: &str) -> bool {
        self.strip(name, environment).is_some()
    }

    /// The Vaultix secret name inside a destination name, or `None` if the destination name is not ours.
    /// When the schema uses `/` the secret part may not contain one: `/app/{{secretKey}}` owns `/app/A`, not `/app/x/A`.
    pub fn strip(&self, name: &str, environment: &str) -> Option<String> {
        let (prefix, suffix) = self.affixes(environment);
        let inner = name.strip_prefix(prefix.as_str())?.strip_suffix(suffix.as_str())?;
        if inner.is_empty() {
            return None;
        }
        if (prefix.contains('/') || suffix.contains('/')) && inner.contains('/') {
            return None;
        }
        Some(inner.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_leaves_names_alone() {
        let s = KeySchema::identity();
        assert_eq!(s.apply("DB_URL", "prod"), "DB_URL");
        assert_eq!(s.strip("DB_URL", "prod").as_deref(), Some("DB_URL"));
    }

    #[test]
    fn applies_and_strips_prefix_suffix_and_environment() {
        let s = KeySchema::parse("{{environment}}_{{secretKey}}_V1").unwrap();
        assert_eq!(s.apply("TOKEN", "prod"), "prod_TOKEN_V1");
        assert_eq!(s.strip("prod_TOKEN_V1", "prod").as_deref(), Some("TOKEN"));
        assert_eq!(s.strip("dev_TOKEN_V1", "prod"), None, "another environment's name is not ours");
        assert_eq!(s.strip("prod_TOKEN", "prod"), None, "missing suffix");
    }

    #[test]
    fn names_are_never_escaped() {
        // the inherited Handlebars template turned these into HTML entities
        let s = KeySchema::parse("a/{{secretKey}}").unwrap();
        for key in ["A&B", "K=V", "<x>", "it's", "q\"q"] {
            let out = s.apply(key, "e");
            assert_eq!(out, format!("a/{key}"));
            assert_eq!(s.strip(&out, "e").as_deref(), Some(key));
        }
    }

    #[test]
    fn a_path_schema_owns_one_level_only() {
        let s = KeySchema::parse("/app/{{secretKey}}").unwrap();
        assert!(s.matches("/app/A", "e"));
        assert!(!s.matches("/app/x/A", "e"));
        assert!(!s.matches("/other/A", "e"));
        assert!(!s.matches("/app/", "e"), "an empty name is not a secret");
    }

    #[test]
    fn strict_grammar_rejects_what_handlebars_allowed() {
        assert_eq!(KeySchema::parse("plain"), Err(SchemaError::SecretKeyCount));
        assert_eq!(KeySchema::parse("{{secretKey}}{{secretKey}}"), Err(SchemaError::SecretKeyCount));
        assert_eq!(KeySchema::parse("{{#if x}}{{secretKey}}{{/if}}"), Err(SchemaError::UnknownPlaceholder("#if x".into())));
        assert_eq!(KeySchema::parse("{{upper secretKey}}"), Err(SchemaError::UnknownPlaceholder("upper secretKey".into())));
        assert_eq!(KeySchema::parse("{{secretKey"), Err(SchemaError::Unclosed));
        assert!(KeySchema::parse("{{ secretKey }}").is_ok(), "spaces inside braces are allowed");
    }

    #[test]
    fn apply_and_strip_round_trip_for_awkward_text() {
        let s = KeySchema::parse("{{environment}}-{{secretKey}}").unwrap();
        for key in ["A", "A-B", "-", "é", "{{x}}"] {
            assert_eq!(s.strip(&s.apply(key, "p"), "p").as_deref(), Some(key));
        }
    }
}
