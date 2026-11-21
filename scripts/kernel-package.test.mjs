import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exportKernel, kernelInput } from "./lib/kernel-package.mjs";

test("source allowlist excludes inherited application, credentials, build output and tests", () => {
  for (const path of ["kernel/Cargo.lock", "kernel/server/src/main.rs", "kernel/domains/auth/core/src/lib.rs", "kernel/foundation/store/migrations/0004_auth.sql", "kernel/clients/cli/src/bin/vx.rs"]) assert.equal(kernelInput(path), true, path);
  for (const path of ["platform/engine/backend/src/index.ts", "kernel/.env", "kernel/target/main.rs", "kernel/server/tests/auth.rs", "kernel/server/src/../../secret.rs", "kernel/server/src/.hidden/key.rs", "kernel/server/src/root.key", "kernel/server/src/token.json", "kernel\\Cargo.toml", "/kernel/Cargo.toml"]) assert.equal(kernelInput(path), false, path);
});

test("exports exact source bytes, fingerprints them, and refuses imported blobs or overwrites", () => {
  const root = mkdtempSync(join(tmpdir(), "vx-package-test-"));
  const path = "kernel/server/src/main.rs";
  mkdirSync(dirname(join(root, path)), { recursive: true });
  const bytes = Buffer.from("fn main() {}\n");
  writeFileSync(join(root, path), bytes);
  const output = join(root, "output");
  const files = exportKernel(root, output, [path]);
  assert.deepEqual(readFileSync(join(output, "server/src/main.rs")), bytes);
  assert.equal(files[0].sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.throws(() => exportKernel(root, output, [path]), /EEXIST/);
  const inherited = new Set([createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")]);
  assert.throws(() => exportKernel(root, join(root, "refused"), [path], inherited), /inherited/);
  assert.throws(() => exportKernel(root, output, ["kernel/../NOTICE"]), /Not a kernel build input/);
});

test("a directory junction cannot smuggle external source into the build context", () => {
  const root = mkdtempSync(join(tmpdir(), "vx-package-link-"));
  const outside = mkdtempSync(join(tmpdir(), "vx-package-outside-"));
  mkdirSync(join(root, "kernel/server"), { recursive: true });
  writeFileSync(join(outside, "main.rs"), "unreviewed external source");
  symlinkSync(outside, join(root, "kernel/server/src"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => exportKernel(root, join(root, "output"), ["kernel/server/src/main.rs"]), /Symlink/);
});
