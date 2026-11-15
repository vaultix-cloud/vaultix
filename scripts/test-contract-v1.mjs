// The v1 contract gate. It fails when:
//   * kernel/contracts/v1/openapi.json differs from what the Rust server generates (drift),
//   * the generated TypeScript differs from what the generator makes of that document,
//   * the generator, the static types, or the contract tests against a real server fail.
//
// Usage: node scripts/test-contract-v1.mjs [--update]   (--update rewrites openapi.json and the generated files)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { kernelBinary, startStack } from "./lib/vx-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = resolve(root, "kernel/contracts/v1");
const update = process.argv.includes("--update");
const run = (command, args, options = {}) => spawnSync(command, args, { stdio: "inherit", windowsHide: true, ...options });
const fail = message => { console.error(`contract: ${message}`); process.exit(1); };

console.log("Building vaultixd (debug)...");
if (run("cargo", ["build", "-q", "-p", "vaultixd"], { cwd: resolve(root, "kernel") }).status !== 0) fail("the build failed");

const generated = spawnSync(kernelBinary("vaultixd", "debug"), ["openapi"], { encoding: "utf8" });
if (generated.status !== 0) fail("vaultixd openapi failed");
const file = resolve(contract, "openapi.json");
if (update) writeFileSync(file, generated.stdout);
else if (readFileSync(file, "utf8") !== generated.stdout) fail("openapi.json is out of date with the Rust contract. Run: node scripts/test-contract-v1.mjs --update");
if (update && run("node", ["scripts/generate.mjs"], { cwd: contract }).status !== 0) fail("the generator failed");
if (run("node", ["scripts/generate.mjs", "--check"], { cwd: contract }).status !== 0) fail("the generated TypeScript is out of date. Run: node scripts/test-contract-v1.mjs --update");

console.log("\nGenerator tests");
if (run("node", ["--test", "tests/generator.test.mjs"], { cwd: contract }).status !== 0) fail("the generator tests failed");
console.log("\nStatic types");
if (run("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], { cwd: contract, shell: process.platform === "win32" }).status !== 0) fail("the generated types do not match the strictness assertions");

console.log("\nContract tests against a real server");
const stack = await startStack({ profile: "debug" });
let status = 1;
try {
  status = run("node", ["--test", "tests/contract.test.mjs"], { cwd: contract, env: { ...process.env, VX_BASE: stack.base, VX_TOKEN: stack.token, VX_PSQL_CONTAINER: stack.pgName } }).status ?? 1;
} finally { stack.stop(); }
if (status !== 0) fail("the contract tests failed");
console.log("\ncontract: v1 is consistent end to end");
