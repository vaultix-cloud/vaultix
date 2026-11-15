//! The sync plan: what to write and what to delete so a destination matches Vaultix.
//!
//! Inputs are names and keyed fingerprints, never values. Many destinations cannot return a value at all, so a remote
//! entry may have no fingerprint; the plan then writes it, because "unknown" is not "equal".

use crate::schema::KeySchema;
use std::collections::{BTreeMap, BTreeSet};

/// A name and, if it can be known, a keyed fingerprint of its value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub fingerprint: Option<[u8; 32]>,
}

#[derive(Debug, Clone)]
pub struct PlanOptions {
    pub environment: String,
    pub schema: KeySchema,
    /// Keep names in the destination that Vaultix no longer has.
    pub keep_removed: bool,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Plan {
    /// Vaultix names to write (the connector applies the schema when it writes).
    pub put: Vec<String>,
    /// Destination names to delete, already in the destination's spelling.
    pub delete: Vec<String>,
    /// Vaultix names the destination already holds with the same value.
    pub unchanged: Vec<String>,
}

/// `desired`: every secret Vaultix wants in the destination, by Vaultix name, with its fingerprint.
/// `remote`: what the destination holds, by destination name.
pub fn plan(desired: &[Entry], remote: &[Entry], options: &PlanOptions) -> Plan {
    let remote_by_name: BTreeMap<&str, &Entry> = remote.iter().map(|e| (e.name.as_str(), e)).collect();
    let mut result = Plan::default();
    let mut wanted_remote_names = BTreeSet::new();

    let mut desired_sorted: Vec<&Entry> = desired.iter().collect();
    desired_sorted.sort_by(|a, b| a.name.cmp(&b.name));
    for entry in desired_sorted {
        let destination_name = options.schema.apply(&entry.name, &options.environment);
        match remote_by_name.get(destination_name.as_str()) {
            Some(r) if r.fingerprint.is_some() && r.fingerprint == entry.fingerprint => result.unchanged.push(entry.name.clone()),
            _ => result.put.push(entry.name.clone()),
        }
        wanted_remote_names.insert(destination_name);
    }

    if !options.keep_removed {
        // BTreeMap keys are already sorted.
        result.delete = remote_by_name
            .keys()
            .filter(|name| !wanted_remote_names.contains(**name) && options.schema.matches(name, &options.environment))
            .map(|name| (*name).to_string())
            .collect();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(name: &str, fp: Option<u8>) -> Entry {
        Entry { name: name.into(), fingerprint: fp.map(|b| [b; 32]) }
    }
    fn options(schema: &str, keep_removed: bool) -> PlanOptions {
        PlanOptions { environment: "prod".into(), schema: KeySchema::parse(schema).unwrap(), keep_removed }
    }

    #[test]
    fn writes_new_and_changed_and_skips_equal() {
        let p = plan(&[e("A", Some(1)), e("B", Some(2)), e("C", Some(3))], &[e("A", Some(1)), e("B", Some(9))], &options("{{secretKey}}", false));
        assert_eq!(p.unchanged, ["A"]);
        assert_eq!(p.put, ["B", "C"]);
        assert!(p.delete.is_empty());
    }

    #[test]
    fn an_unreadable_remote_value_is_written_not_assumed_equal() {
        let p = plan(&[e("A", Some(1))], &[e("A", None)], &options("{{secretKey}}", false));
        assert_eq!(p.put, ["A"]);
        let p = plan(&[e("A", None)], &[e("A", None)], &options("{{secretKey}}", false));
        assert_eq!(p.put, ["A"], "two unknowns are not equal either");
    }

    #[test]
    fn deletes_only_names_the_schema_owns() {
        let remote = [e("prod_A", Some(1)), e("prod_OLD", Some(2)), e("dev_OLD", Some(3)), e("UNRELATED", Some(4))];
        let p = plan(&[e("A", Some(1))], &remote, &options("{{environment}}_{{secretKey}}", false));
        assert_eq!(p.unchanged, ["A"]);
        assert_eq!(p.delete, ["prod_OLD"], "other environments and unrelated names are left alone");
    }

    #[test]
    fn keep_removed_deletes_nothing() {
        let p = plan(&[], &[e("OLD", Some(1))], &options("{{secretKey}}", true));
        assert!(p.delete.is_empty());
    }

    #[test]
    fn the_plan_is_deterministic_for_any_input_order() {
        let a = plan(&[e("B", Some(2)), e("A", Some(1))], &[e("Z", Some(1)), e("Y", Some(1))], &options("{{secretKey}}", false));
        let b = plan(&[e("A", Some(1)), e("B", Some(2))], &[e("Y", Some(1)), e("Z", Some(1))], &options("{{secretKey}}", false));
        assert_eq!(a, b);
        assert_eq!(a.delete, ["Y", "Z"]);
    }

    #[test]
    fn a_path_schema_never_deletes_a_deeper_path() {
        let p = plan(&[], &[e("/app/A", Some(1)), e("/app/x/B", Some(1))], &options("/app/{{secretKey}}", false));
        assert_eq!(p.delete, ["/app/A"]);
    }
}
