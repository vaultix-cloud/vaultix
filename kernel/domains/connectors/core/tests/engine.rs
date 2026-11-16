//! The sync engine against an in-memory destination (helpers in common/mod.rs).

mod common;
use common::*;
use vx_connectors::*;

#[tokio::test]
async fn a_new_secret_reaches_the_destination_with_the_right_value() {
    let log = new_log();
    let (dest, audit) = (Memory::new(&log), Audit::new(&log));
    let report = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "one"), ("B", "two")])).await.unwrap();
    assert_eq!((report.put, report.deleted, report.unchanged), (2, 0, 0));
    assert!(report.ok());
    let store = dest.store.lock().unwrap();
    assert_eq!(store.get("A"), Some(&fp("one")), "the destination received exactly the value");
    assert_eq!(store.get("B"), Some(&fp("two")));
}

#[tokio::test]
async fn the_plan_is_recorded_before_the_destination_is_touched_and_the_outcome_after() {
    let log = new_log();
    let (dest, audit) = (Memory::new(&log), Audit::new(&log));
    sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "one")])).await.unwrap();
    let order = log.lock().unwrap().clone();
    assert_eq!(order, ["list", "audit:connector.sync.planned", "put:A", "after_sync", "audit:connector.sync.finished"]);
}

#[tokio::test]
async fn if_the_plan_cannot_be_recorded_nothing_changes() {
    let log = new_log();
    let (dest, audit) = (Memory::new(&log).seed("OLD", "stale"), Audit::new(&log).failing_at(1));
    let error = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "one")])).await.unwrap_err();
    assert!(matches!(error, SyncError::NotRecorded(_)), "{error}");
    assert_eq!(dest.calls("put:"), 0, "no secret was written");
    assert_eq!(dest.calls("delete:"), 0, "no secret was deleted");
    assert_eq!(dest.calls("after_sync"), 0);
    assert_eq!(dest.store.lock().unwrap().keys().collect::<Vec<_>>(), ["OLD"], "the destination is exactly as it was");
}

#[tokio::test]
async fn if_the_outcome_cannot_be_recorded_the_caller_gets_an_error_with_the_report_not_a_success() {
    let log = new_log();
    let (dest, audit) = (Memory::new(&log), Audit::new(&log).failing_at(2));
    let error = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "one")])).await.unwrap_err();
    match error {
        SyncError::Unrecorded { report, .. } => assert_eq!(report.put, 1, "the destination was changed and the error says so"),
        other => panic!("expected Unrecorded, got {other}"),
    }
}

#[tokio::test]
async fn a_second_sync_of_an_unchanged_set_writes_nothing() {
    let log = new_log();
    let (dest, audit) = (Memory::new(&log), Audit::new(&log));
    let set = values(&[("A", "one"), ("B", "two")]);
    sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &set).await.unwrap();
    let before = dest.calls("put:");
    let second = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &set).await.unwrap();
    assert_eq!((second.put, second.unchanged), (0, 2));
    assert_eq!(dest.calls("put:"), before);
    assert_eq!(dest.calls("after_sync"), 1, "the hook runs only when something changed");
}

#[tokio::test]
async fn a_changed_value_is_rewritten() {
    let log = new_log();
    let (dest, audit) = (Memory::new(&log).seed("A", "old"), Audit::new(&log));
    let report = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "new")])).await.unwrap();
    assert_eq!(report.put, 1);
    assert_eq!(dest.store.lock().unwrap().get("A"), Some(&fp("new")));
}

#[tokio::test]
async fn a_destination_that_cannot_return_values_is_always_written() {
    let log = new_log();
    let mut dest = Memory::new(&log).seed("A", "one");
    dest.readable = false;
    let audit = Audit::new(&log);
    let report = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "one")])).await.unwrap();
    assert_eq!((report.put, report.unchanged), (1, 0));
}

#[tokio::test]
async fn deletes_only_what_the_schema_owns_and_respects_keep_removed() {
    let log = new_log();
    let seed = |log: &Log| Memory::new(log).seed("prod_OLD", "x").seed("dev_OLD", "x").seed("UNRELATED", "x");
    let (dest, audit) = (seed(&log), Audit::new(&log));
    let report = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{environment}}_{{secretKey}}", false, 3), &values(&[("A", "one")])).await.unwrap();
    assert_eq!(report.deleted, 1);
    let keys: Vec<String> = dest.store.lock().unwrap().keys().cloned().collect();
    assert_eq!(keys, ["UNRELATED", "dev_OLD", "prod_A"]);

    let log = new_log();
    let (dest, audit) = (seed(&log), Audit::new(&log));
    let kept = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{environment}}_{{secretKey}}", true, 3), &values(&[("A", "one")])).await.unwrap();
    assert_eq!(kept.deleted, 0);
    assert!(dest.store.lock().unwrap().contains_key("prod_OLD"));
}

#[tokio::test]
async fn transient_failures_are_retried_and_permanent_ones_are_not() {
    let log = new_log();
    let dest = Memory::new(&log).fail("A", &[TRANSIENT, TRANSIENT]).fail("B", &[REJECTED]);
    let audit = Audit::new(&log);
    let report = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "one"), ("B", "two"), ("C", "three")])).await.unwrap();
    assert_eq!(dest.calls("put:A"), 3, "two transient failures, then success");
    assert_eq!(dest.calls("put:B"), 1, "a rejection is not retried");
    assert_eq!(report.put, 2, "A and C were written; one bad name did not stop the rest");
    assert_eq!(report.failed.len(), 1);
    assert_eq!((report.failed[0].name.as_str(), report.failed[0].kind, report.failed[0].code), ("B", ErrorKind::Rejected, "name_not_allowed"));
    assert!(!report.ok());
    let finished = audit.events.lock().unwrap().last().unwrap().clone();
    assert_eq!(finished.outcome, "completed_with_failures");
}

#[tokio::test]
async fn retries_stop_after_the_attempt_budget() {
    let log = new_log();
    let dest = Memory::new(&log).fail("A", &[TRANSIENT; 10]);
    let report = sync(&dest, &Audit::new(&log), &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "one")])).await.unwrap();
    assert_eq!(dest.calls("put:A"), 3);
    assert_eq!(report.failed.len(), 1);
}

#[tokio::test]
async fn a_failing_after_sync_hook_is_reported_not_hidden() {
    let log = new_log();
    let mut dest = Memory::new(&log);
    dest.after_sync_error = Some(ConnectorError::new(ErrorKind::Rejected, "deploy_failed"));
    let report: Report = sync(&dest, &Audit::new(&log), &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 1), &values(&[("A", "one")])).await.unwrap();
    assert_eq!(report.put, 1);
    assert!(!report.ok());
    assert_eq!(report.after_sync_failed.as_ref().map(|f| f.code), Some("deploy_failed"));
}


#[tokio::test]
async fn a_destination_that_upper_cases_names_is_synced_by_its_own_spelling() {
    let log = new_log();
    let mut dest = Memory::new(&log).seed("APP_OLD", "x").seed("OTHER", "x");
    dest.fold_upper = true;
    let audit = Audit::new(&log);
    let report = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("app_{{secretKey}}", false, 2), &values(&[("a", "one"), ("b", "two")])).await.unwrap();
    assert_eq!((report.put, report.deleted), (2, 1));
    let keys: Vec<String> = dest.store.lock().unwrap().keys().cloned().collect();
    assert_eq!(keys, ["APP_A", "APP_B", "OTHER"], "written in the destination's spelling; its own old name deleted; an unrelated name left alone");
    let again = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("app_{{secretKey}}", false, 2), &values(&[("a", "one"), ("b", "two")])).await.unwrap();
    assert_eq!((again.put, again.unchanged), (0, 2), "a lower-case name is recognised as already present, not rewritten every time");
}

#[tokio::test]
async fn two_names_that_would_become_one_are_refused_before_anything_changes() {
    let log = new_log();
    let mut dest = Memory::new(&log).seed("APP_OLD", "x");
    dest.fold_upper = true;
    let audit = Audit::new(&log);
    let error = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("app_{{secretKey}}", false, 2), &values(&[("db", "one"), ("DB", "two"), ("ok", "three")])).await.unwrap_err();
    match error {
        SyncError::NameCollision(names) => assert_eq!(names, ["APP_DB"]),
        other => panic!("expected NameCollision, got {other}"),
    }
    assert_eq!(dest.calls("put:"), 0);
    assert_eq!(dest.calls("delete:"), 0);
    assert!(audit.events.lock().unwrap().is_empty());
    assert_eq!(dest.store.lock().unwrap().keys().collect::<Vec<_>>(), ["APP_OLD"]);
}

#[tokio::test]
async fn a_rate_limit_that_says_how_long_to_wait_is_waited_for() {
    let log = new_log();
    let dest = Memory::new(&log).fail("A", &[ConnectorError::new(ErrorKind::Transient, "rate_limited").retry_after(1)]);
    let started = std::time::Instant::now();
    let report = sync(&dest, &Audit::new(&log), &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "one")])).await.unwrap();
    assert_eq!(report.put, 1);
    assert!(started.elapsed() >= std::time::Duration::from_secs(1), "the engine ignored Retry-After (base backoff here is zero)");
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
}

#[tokio::test]
async fn a_transient_failure_while_listing_the_destination_is_retried_and_a_permanent_one_stops_the_sync() {
    let log = new_log();
    let dest = Memory::new(&log);
    dest.list_failures.lock().unwrap().extend([TRANSIENT, TRANSIENT]);
    let report = sync(&dest, &Audit::new(&log), &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "one")])).await.unwrap();
    assert_eq!(report.put, 1);
    assert_eq!(dest.calls("list"), 3, "two transient failures, then success");

    let log = new_log();
    let dest = Memory::new(&log);
    dest.list_failures.lock().unwrap().push_back(ConnectorError::new(ErrorKind::Auth, "bad_credentials"));
    let audit = Audit::new(&log);
    let error = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "one")])).await.unwrap_err();
    assert!(matches!(error, SyncError::List(e) if e.code == "bad_credentials"));
    assert_eq!(dest.calls("list"), 1, "an auth failure is not retried");
    assert_eq!(dest.calls("put:"), 0);
    assert!(audit.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_destination_that_batches_gets_one_call_for_all_writes_and_one_for_all_deletes() {
    let log = new_log();
    let mut dest = Memory::new(&log).seed("prod_OLD1", "x").seed("prod_OLD2", "x").seed("OTHER", "x");
    dest.batch = true;
    let report = sync(&dest, &Audit::new(&log), &Fingerprinter::new(KEY), &request("{{environment}}_{{secretKey}}", false, 2), &values(&[("A", "1"), ("B", "2"), ("C", "3")])).await.unwrap();
    assert_eq!((report.put, report.deleted), (3, 2));
    assert_eq!(dest.calls("put_batch:3"), 1, "three secrets, one call (one release on Fly.io)");
    assert_eq!(dest.calls("delete_batch:2"), 1);
    assert_eq!(dest.calls("put:") + dest.calls("delete:"), 0, "no per-secret calls were made");
    assert_eq!(dest.store.lock().unwrap().keys().collect::<Vec<_>>(), ["OTHER", "prod_A", "prod_B", "prod_C"]);
}

#[tokio::test]
async fn a_failed_batch_fails_every_name_in_it_and_a_transient_one_is_retried_whole() {
    let log = new_log();
    let mut dest = Memory::new(&log);
    dest.batch = true;
    dest.batch_failures.lock().unwrap().extend([TRANSIENT, REJECTED]);
    let report = sync(&dest, &Audit::new(&log), &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 3), &values(&[("A", "1"), ("B", "2")])).await.unwrap();
    assert_eq!(dest.calls("put_batch:2"), 2, "retried once after the transient failure, then refused for good");
    assert_eq!(report.put, 0);
    let mut names: Vec<_> = report.failed.iter().map(|f| (f.name.as_str(), f.code)).collect();
    names.sort_unstable();
    assert_eq!(names, [("A", "name_not_allowed"), ("B", "name_not_allowed")]);
    assert!(dest.store.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_name_the_destination_refuses_fails_alone_in_both_modes_and_is_never_sent() {
    for batch in [false, true] {
        let log = new_log();
        let mut dest = Memory::new(&log);
        dest.batch = batch;
        let report = sync(&dest, &Audit::new(&log), &Fingerprinter::new(KEY), &request("{{secretKey}}", false, 2), &values(&[("BAD_ONE", "1"), ("good", "2")])).await.unwrap();
        assert_eq!(report.put, 1, "batch={batch}");
        assert_eq!(report.failed.len(), 1);
        assert_eq!((report.failed[0].name.as_str(), report.failed[0].code), ("BAD_ONE", "invalid_name"));
        assert_eq!(dest.store.lock().unwrap().keys().collect::<Vec<_>>(), ["good"]);
    }
}
