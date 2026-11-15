#![allow(clippy::unwrap_used)] // test code
//! The Rust key schema against the inherited TypeScript one, on a shared corpus (docs/0139).
//!
//! `fixtures/inherited-schema.json` is what the inherited functions (running on the real Handlebars package) return for
//! 22 schemas, 6 environments, 15 keys and many destination names. Every case must either agree or fall into a named
//! class of deliberate difference. A difference that is not in a class fails the test, so a new one cannot slip in.

use serde_json::Value;
use std::collections::BTreeMap;
use vx_connectors::{KeySchema, SchemaError};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/inherited-schema.json")).unwrap()
}

/// What Handlebars does to inserted text.
fn escape(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&#x27;".to_string(),
            '`' => "&#x60;".to_string(),
            '=' => "&#x3D;".to_string(),
            other => other.to_string(),
        })
        .collect()
}

/// Why the new grammar refuses a schema the inherited code accepted (or mishandled), by schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Refused {
    NoSecretKey,
    MoreThanOneSecretKey,
    NotAPlaceholder,
    Unclosed,
}

fn refusal_expected(schema: &str) -> Option<Refused> {
    Some(match schema {
        // inherited: every secret is written to the one name "plain" / "" / the environment, so they overwrite each other
        "plain" | "{{environment}}" => Refused::NoSecretKey,
        // inherited: accepted, and the same key appears twice in the name
        "{{secretKey}}{{secretKey}}" | "{{secretKey}}_{{secretKey}}" => Refused::MoreThanOneSecretKey,
        // inherited: triple braces switch escaping off, blocks and helpers run code, and an unknown placeholder renders as nothing
        "{{{secretKey}}}" | "{{#if environment}}{{secretKey}}{{/if}}" | "{{upper secretKey}}" | "{{unknown}}{{secretKey}}" => Refused::NotAPlaceholder,
        "{{secretKey" => Refused::Unclosed,
        _ => return None,
    })
}

fn classify(error: &SchemaError) -> Refused {
    match error {
        SchemaError::SecretKeyCount => Refused::NoSecretKey, // refined below by counting
        SchemaError::UnknownPlaceholder(_) => Refused::NotAPlaceholder,
        SchemaError::Unclosed => Refused::Unclosed,
    }
}

#[derive(Default)]
struct Tally(BTreeMap<&'static str, usize>);
impl Tally {
    fn add(&mut self, class: &'static str) {
        *self.0.entry(class).or_default() += 1;
    }
}

#[test]
fn every_difference_from_the_inherited_schema_is_a_named_deliberate_one() {
    let fixture = fixture();
    let mut tally = Tally::default();
    let mut unexplained: Vec<String> = Vec::new();
    let mut refused_schemas = BTreeMap::new();

    for case in fixture["cases"].as_array().unwrap() {
        let schema_text = case["schema"].as_str().unwrap();
        let environment = case["environment"].as_str().unwrap();

        // An absent schema means "leave names alone" in both; the empty text is the absent schema.
        let parsed = if schema_text.is_empty() { Ok(KeySchema::identity()) } else { KeySchema::parse(schema_text) };
        let schema = match parsed {
            Ok(schema) => {
                if let Some(expected) = refusal_expected(schema_text) {
                    unexplained.push(format!("{schema_text:?} was expected to be refused ({expected:?}) but parsed"));
                }
                schema
            }
            Err(error) => {
                let mut why = classify(&error);
                if why == Refused::NoSecretKey && schema_text.matches("{{secretKey}}").count() > 1 {
                    why = Refused::MoreThanOneSecretKey;
                }
                match refusal_expected(schema_text) {
                    Some(expected) if expected == why => {
                        refused_schemas.insert(schema_text.to_string(), why);
                        tally.add("schema refused by the strict grammar");
                    }
                    other => unexplained.push(format!("{schema_text:?} refused as {why:?}, expected {other:?}")),
                }
                continue;
            }
        };

        let escapable_env = escape(environment) != environment;

        for (key, inherited) in case["apply"].as_object().unwrap() {
            let Some(inherited) = inherited["ok"].as_str() else {
                unexplained.push(format!("inherited apply failed for an accepted schema {schema_text:?}: {inherited}"));
                continue;
            };
            let ours = schema.apply(key, environment);
            if ours == inherited {
                tally.add("apply agrees");
            } else if escape(&ours) == inherited || (escapable_env && escape_parts_match(&schema, key, environment, inherited)) {
                tally.add("apply: inherited HTML-escaped the name");
            } else {
                unexplained.push(format!("apply({schema_text:?}, env {environment:?}, key {key:?}): inherited {inherited:?}, ours {ours:?}"));
            }
        }

        for (name, result) in case["names"].as_object().unwrap() {
            let inherited_matches = result["matches"]["ok"].as_bool();
            let inherited_strip = result["strip"]["ok"].as_str().map(str::to_string);
            let ours_strip = schema.strip(name, environment);
            let ours_matches = schema.matches(name, environment);

            // matches
            match inherited_matches {
                Some(inherited) if inherited == ours_matches => tally.add("matches agrees"),
                Some(inherited) => {
                    let empty_inner = !ours_matches && inherited && inherited_strip.as_deref() == Some("");
                    if escapable_env && schema_uses_environment(schema_text) {
                        tally.add("matches: inherited compared an HTML-escaped environment");
                    } else if empty_inner || (schema_text.is_empty() && name.is_empty()) {
                        tally.add("matches: inherited treated an empty secret name as a secret");
                    } else {
                        unexplained.push(format!("matches({name:?}, env {environment:?}, {schema_text:?}): inherited {inherited}, ours {ours_matches}"));
                    }
                }
                None => unexplained.push(format!("inherited matches failed on {name:?} with {schema_text:?}")),
            }

            // strip: the inherited one returns a name for anything with the right ends (null when it did not start/end right)
            if inherited_strip == ours_strip {
                tally.add("strip agrees");
            } else if escapable_env && schema_uses_environment(schema_text) {
                tally.add("strip: inherited compared an HTML-escaped environment");
            } else if inherited_strip.as_deref() == Some("") && ours_strip.is_none() {
                tally.add("strip: inherited returned an empty secret name");
            } else if ours_strip.is_none() && inherited_strip.as_deref().is_some_and(|s| s.contains('/')) && (schema_text.contains('/') || (environment.contains('/') && schema_uses_environment(schema_text))) {
                tally.add("strip: inherited ignored the one-level path rule that its own matches applied");
            } else {
                unexplained.push(format!("strip({name:?}, env {environment:?}, {schema_text:?}): inherited {inherited_strip:?}, ours {ours_strip:?}"));
            }
        }
    }

    // print the summary so a reader can see what the comparison covered
    println!("# differential tally:");
    for (class, count) in &tally.0 {
        println!("#   {count:6}  {class}");
    }
    println!("# schemas refused on purpose: {refused_schemas:?}");

    assert!(unexplained.is_empty(), "{} unexplained differences, first: {:#?}", unexplained.len(), &unexplained[..unexplained.len().min(8)]);
    // each class must really occur, or it is explaining nothing
    for class in [
        "schema refused by the strict grammar",
        "apply: inherited HTML-escaped the name",
        "matches: inherited compared an HTML-escaped environment",
        "matches: inherited treated an empty secret name as a secret",
        "strip: inherited returned an empty secret name",
        "strip: inherited ignored the one-level path rule that its own matches applied",
        "apply agrees",
        "matches agrees",
        "strip agrees",
    ] {
        assert!(tally.0.get(class).copied().unwrap_or(0) > 0, "the class \"{class}\" never occurred, so it is not tested");
    }
    assert_eq!(refused_schemas.len(), 9, "the nine schemas refused on purpose");
}

fn schema_uses_environment(schema_text: &str) -> bool {
    schema_text.contains("{{environment}}")
}

/// The inherited code escaped the environment too; compare after escaping only the environment part.
fn escape_parts_match(schema: &KeySchema, key: &str, environment: &str, inherited: &str) -> bool {
    let ours_with_escaped_env = schema.apply(key, &escape(environment));
    inherited == ours_with_escaped_env || inherited == escape(&ours_with_escaped_env)
}

#[test]
fn the_inherited_code_really_did_escape_names_so_the_difference_is_not_imagined() {
    let fixture = fixture();
    let row = fixture["cases"].as_array().unwrap().iter().find(|c| c["schema"] == "{{environment}}_{{secretKey}}" && c["environment"] == "prod").unwrap();
    assert_eq!(row["apply"]["A&B"]["ok"], "prod_A&amp;B");
    assert_eq!(row["apply"]["K=V"]["ok"], "prod_K&#x3D;V");
    let ours = KeySchema::parse("{{environment}}_{{secretKey}}").unwrap();
    assert_eq!(ours.apply("A&B", "prod"), "prod_A&B");
}

#[test]
fn the_fixture_records_the_source_it_was_generated_from() {
    let fixture = fixture();
    assert!(fixture["source"].as_str().unwrap().ends_with("secret-sync-fns.ts"));
    assert_eq!(fixture["sourceSha256"].as_str().unwrap().len(), 64);
    assert!(fixture["handlebarsVersion"].as_str().unwrap().starts_with("4."));
}
