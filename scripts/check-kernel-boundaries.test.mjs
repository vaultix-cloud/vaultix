// Proves the kernel boundary check catches each kind of violation, and passes the real kernel.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkKernel } from "./lib/kernel-boundaries.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(crates, members = ["foundation/*", "domains/*/*", "server", "clients/*"]) {
  const root = mkdtempSync(join(tmpdir(), "kernel-boundaries-"));
  mkdirSync(join(root, "kernel"), { recursive: true });
  writeFileSync(join(root, "kernel/Cargo.toml"), `[workspace]\nmembers = ${JSON.stringify(members)}\n`);
  for (const [dir, deps = []] of Object.entries(crates)) {
    mkdirSync(join(root, "kernel", dir), { recursive: true });
    const name = `vx-${dir.replace(/[\\/]/g, "-")}`;
    const lines = deps.map(([depName, depPath]) => `${depName} = { path = "${depPath}" }`).join("\n");
    writeFileSync(join(root, "kernel", dir, "Cargo.toml"), `[package]\nname = "${name}"\nversion = "0.0.0"\n\n[dependencies]\n${lines}\n`);
  }
  return root;
}

test("the real kernel follows the rules", () => {
  assert.deepEqual(checkKernel(repo), []);
});

test("a clean layout passes", () => {
  const root = fixture({ "foundation/keys": [], "foundation/store": [["vx-keys", "../keys"]], "domains/secrets/core": [["vx-foundation-store", "../../../foundation/store"]], "server": [["vx-secrets", "../domains/secrets/core"]] });
  assert.deepEqual(checkKernel(root), []);
});

test("foundation may not depend on a domain", () => {
  const root = fixture({ "foundation/keys": [["vx-domains-secrets-core", "../../domains/secrets/core"]], "domains/secrets/core": [] });
  assert.match(checkKernel(root).join("\n"), /\(foundation\) depends on .*\(domain\)/);
});

test("one domain may not depend on another", () => {
  const root = fixture({ "domains/secrets/core": [["vx-access", "../../access/core"]], "domains/access/core": [] });
  assert.match(checkKernel(root).join("\n"), /domains meet only through foundation or the server/);
});

test("a domain may not depend on the server or a client", () => {
  const root = fixture({ "domains/secrets/core": [["vx-server", "../../../server"]], "server": [] });
  assert.match(checkKernel(root).join("\n"), /never depends on the server or a client/);
});

test("the kernel may not reach outside itself", () => {
  const root = fixture({ "foundation/keys": [["shippin", "../../../platform/shippin"]] });
  assert.match(checkKernel(root).join("\n"), /outside the kernel/);
});

test("a folder that collects unrelated code is refused", () => {
  const root = fixture({ "foundation/keys": [] });
  mkdirSync(join(root, "kernel/foundation/utils"), { recursive: true });
  assert.match(checkKernel(root).join("\n"), /"utils" collects unrelated code/);
});

test("a crate outside the layout or outside the workspace is refused", () => {
  assert.match(checkKernel(fixture({ "stray/thing": [] })).join("\n"), /outside the layout/);
  assert.match(checkKernel(fixture({ "foundation/keys": [] }, ["server"])).join("\n"), /not in the workspace members/);
});


test("a test file that installs a log subscriber must hold exactly one test", () => {
  const root = fixture({ "domains/connectors/core": [] });
  mkdirSync(join(root, "kernel/domains/connectors/core/tests"), { recursive: true });
  const write = (name, body) => writeFileSync(join(root, "kernel/domains/connectors/core/tests", name), body);
  const one = "#[tokio::test]\nasync fn a() { let _g = tracing::subscriber::set_default(s); }\n";
  write("one.rs", one);
  assert.deepEqual(checkKernel(root), [], "one test with a subscriber is fine");
  write("two.rs", `${one}#[tokio::test]\nasync fn b() {}\n`);
  assert.match(checkKernel(root).join("\n"), /two\.rs: installs a log subscriber and has 2 tests/);
  write("two.rs", "#[test]\nfn a() {}\n#[test]\nfn b() {}\n");
  assert.deepEqual(checkKernel(root), [], "many tests without a subscriber are fine");
});
