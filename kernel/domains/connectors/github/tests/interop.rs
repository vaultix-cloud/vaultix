#![allow(clippy::unwrap_used)] // test code
//! GitHub requires secrets sealed with libsodium's `crypto_box_seal`. The other tests use the same Rust library on both
//! sides, which only proves it agrees with itself. This one checks both directions against real libsodium
//! (`libsodium-wrappers`, pinned in `tests/fixtures/package.json`, which the kernel owns): a box Rust seals, libsodium opens; a box
//! libsodium seals, Rust opens. It needs Node and `npm ci` in `tests/fixtures` (the gate does that first), and FAILS (does not skip)
//! when they are missing.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use crypto_box::{aead::OsRng, PublicKey, SecretKey};
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[test]
fn a_box_sealed_here_opens_in_libsodium_and_one_sealed_by_libsodium_opens_here() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let module = manifest.join("tests/fixtures/node_modules/libsodium-wrappers").canonicalize().expect("libsodium-wrappers is installed (npm ci in kernel/domains/connectors/github/tests/fixtures; node scripts/gate.mjs does it)");
    let script = manifest.join("tests/fixtures/libsodium-interop.cjs");

    let secret = SecretKey::generate(&mut OsRng);
    let public: PublicKey = secret.public_key();
    let sealed = public.seal(&mut OsRng, b"sealed-by-rust-\xe2\x9c\x93").unwrap();
    let input = json!({
        // Windows' canonical form starts with \\?\, which Node cannot resolve
        "module": module.to_string_lossy().trim_start_matches(r"\\?\"),
        "pub": STANDARD.encode(public.as_bytes()),
        "sec": STANDARD.encode(secret.to_bytes()),
        "sealedByRust": STANDARD.encode(&sealed),
    });

    let mut child = Command::new("node").arg(&script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().expect("node is installed");
    child.stdin.take().unwrap().write_all(input.to_string().as_bytes()).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "libsodium failed to open what Rust sealed: {}", String::from_utf8_lossy(&output.stderr));
    let out: Value = serde_json::from_slice(&output.stdout).unwrap();

    assert_eq!(out["openedByLibsodium"], "sealed-by-rust-\u{2713}", "libsodium opened the box Rust sealed");

    let sec2: [u8; 32] = STANDARD.decode(out["sec2"].as_str().unwrap()).unwrap().try_into().unwrap();
    let ours = SecretKey::from(sec2);
    let opened = ours.unseal(&STANDARD.decode(out["sealedByLibsodium"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(opened, b"sealed-by-libsodium", "Rust opened the box libsodium sealed");
}
