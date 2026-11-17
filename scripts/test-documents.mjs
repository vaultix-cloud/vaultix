// The versioned-documents gate (kernel/contracts/documents, docs/0136): the ArkType documents type-check, the
// committed JSON Schema files match what the registry exports and released versions are unchanged, and the
// tests pass: the delivery-gate documents (kernel/contracts/documents/tests/gate.test.mjs), the 77 existing fixtures, the differential fuzz against the hand-written schemas, and the
// version mechanics.
//
// Usage: node scripts/test-documents.mjs [--export]   (--export rewrites kernel/contracts/documents/schemas first)
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const documents = resolve(dirname(fileURLToPath(import.meta.url)), "../kernel/contracts/documents");
const run = (label, command, args) => {
  console.log(`\n${label}`);
  const result = spawnSync(command, args, { cwd: documents, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" && command === "npx" });
  if (result.status !== 0) { console.error(`documents: ${label} failed`); process.exit(1); }
};
if (process.argv.includes("--export")) run("Export", process.execPath, ["scripts/export.mjs"]);
run("Type-check", "npx", ["tsc", "--noEmit", "-p", "tsconfig.json"]);
run("Exported schemas and released locks", process.execPath, ["scripts/export.mjs", "--check"]);
run("Tests", process.execPath, ["--test", "tests/fixtures.test.mjs", "tests/differential.test.mjs", "tests/versions.test.mjs", "tests/gate.test.mjs"]);
console.log("\ndocuments: the versioned documents are consistent");
