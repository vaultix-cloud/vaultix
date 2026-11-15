//! The no-leak proof. It must stay the only test in this file: it installs a log subscriber, and with busy neighbour tests
//! in the same process it failed 40 runs out of 40 (the INFO line was missing from its capture). Rebuilding tracing's
//! interest cache did not cure that, so isolation is the fix, and scripts/lib/kernel-boundaries.mjs enforces it.

mod common;
use common::*;
use vx_connectors::*;

#[tokio::test]
async fn no_value_appears_in_any_report_error_log_or_audit_row() {
    let capture = Capture::default();
    let subscriber = tracing_subscriber::fmt().with_writer(capture.clone()).with_max_level(tracing::Level::TRACE).finish();
    let _guard = tracing::subscriber::set_default(subscriber);

    // every path: success, retry, permanent failure, delete, hook failure, and each audit failure
    let mut rendered = String::new();
    for fail_at in [None, Some(1), Some(2)] {
        let log = new_log();
        let mut dest = Memory::new(&log).seed("prod_STALE", CANARY).fail("A", &[TRANSIENT, REJECTED]).fail("B", &[TRANSIENT]);
        dest.after_sync_error = Some(ConnectorError::new(ErrorKind::Transient, "deploy_failed"));
        let mut audit = Audit::new(&log);
        audit.fail_at = fail_at;
        let set = values(&[("A", CANARY), ("B", CANARY), ("C", CANARY), ("D", &format!("{CANARY}-other"))]);
        let result = sync(&dest, &audit, &Fingerprinter::new(KEY), &request("{{environment}}_{{secretKey}}", false, 2), &set).await;
        rendered.push_str(&format!("{result:?}\n"));
        match &result {
            Ok(report) => rendered.push_str(&format!("{report:?}\n")),
            Err(error) => rendered.push_str(&format!("{error}\n")),
        }
        for event in audit.events.lock().unwrap().iter() {
            rendered.push_str(&format!("{event:?}\n{}\n", serde_json::to_string(event).unwrap()));
        }
        // the destination really did receive the canary, so the absence above is not an artefact of nothing happening
        if fail_at.is_none() {
            assert_eq!(dest.store.lock().unwrap().get("prod_C"), Some(&fp(CANARY)));
        }
    }
    rendered.push_str(&String::from_utf8_lossy(&capture.0.lock().unwrap()));

    assert!(!rendered.is_empty());
    assert!(rendered.contains("connector.sync.finished"), "the audit rows were inspected, not skipped");
    assert!(rendered.contains("sync finished"), "the log lines were inspected, not skipped; captured: {:?}", String::from_utf8_lossy(&capture.0.lock().unwrap()));
    for needle in [CANARY, "CANARY", "9f3c1e7a"] {
        assert!(!rendered.contains(needle), "a value reached a report, error, log or audit row: found {needle}");
    }
}
