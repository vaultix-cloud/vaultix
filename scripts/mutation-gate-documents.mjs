// Plants one bug at a time in the delivery-gate documents (kernel/contracts/documents/src/gate-*.ts, feature.v1.ts) and
// checks that tests/gate.test.mjs fails on each. A test that cannot fail proves nothing (docs/0142, section 3).
//
//   node scripts/mutation-gate-documents.mjs
//
// The mutations are made in a throwaway copy of the package, kernel/contracts/documents-mutant/ (ignored by git), never in
// the real source. An earlier version of this idea edited the source in place and a killed run left a planted bug in a
// commit (ae4a7c8b); a copy cannot do that. Each mutation is checked to have changed the copy, and every mutation must
// make the tests fail for a reason, which is printed.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const real = resolve(root, "kernel/contracts/documents");
const copy = resolve(root, "kernel/contracts/documents-mutant");

const mutations = [
  ["a failure kind accepts undeclared keys", "src/gate-failure.v1.ts", /const answerEdit = type\(\{([^\n]*)\}\)\s*\.onUndeclaredKey\("reject"\)/, 'const answerEdit = type({$1})'],
  ["the rule is free text, not the one sentence", "src/gate-failure.v1.ts", /rule: `'\$\{FIX_THE_SOURCE\}'`,/, 'rule: "string",'],
  ["text may contain a newline", "src/gate-parts.ts", /\^\[\\x20-\\x7e\]\+\$/, "^[\\x09-\\x7e]+$"],
  ["a path may climb out with ..", "src/gate-parts.ts", /\(\?!\(\?:\.\*\/\)\?\\\.\\\.\(\?:\/\|\$\)\)\[A-Za-z0-9\._@\+\\-\/\]\+\$`\)\);\n\n\/\*\* A glob/, "[A-Za-z0-9._@+\\-/]+$`));\n\n/** A glob"],
  ["a flow may have no mutation", "src/feature.v1.ts", /mutations: slug\.array\(\)\.atLeastLength\(1\)/, "mutations: slug.array().atLeastLength(0)"],
  ["a capability may have no flow", "src/feature.v1.ts", /flows: flow\.array\(\)\.atLeastLength\(1\)/, "flows: flow.array().atLeastLength(0)"],
  ["a flow may be a shell", "src/gate-parts.ts", /const program = type\("'node' \| 'cargo' \| 'npm' \| 'npx'"\)/, "const program = type(\"'node' | 'cargo' | 'npm' | 'npx' | 'sh'\")"],
  ["a skipped check need not say why", "src/gate-receipt.v1.ts", /reason: line\(1, 160\)/, '"reason?": line(1, 160)'],
  ["a commit may be a short id", "src/gate-parts.ts", /characters\(40, 40\)\.and\(pattern\(String\.raw`\^\[0-9a-f\]\{40\}\$`\)\)/, "characters(7, 40).and(pattern(String.raw`^[0-9a-f]{7,40}$`))"],
  ["a timestamp may omit the zone", "src/gate-parts.ts", /\(\?:\\\.\\d\{1,3\}\)\?Z\$/, "(?:\\.\\d{1,3})?Z?$"],
  ["an answer edit may name no edit", "src/gate-failure.v1.ts", /edits: edit\.array\(\)\.atLeastLength\(1\)/, "edits: edit.array().atLeastLength(0)"],
  ["a failure may carry a check's output", "src/gate-failure.v1.ts", /"logPath\?": logPath\n/, '"logPath?": logPath,\n  "output?": "string"\n']
];

const prepare = () => {
  rmSync(copy, { recursive: true, force: true });
  mkdirSync(copy, { recursive: true });
  for (const name of ["src", "tests", "package.json", "tsconfig.json"]) cpSync(resolve(real, name), resolve(copy, name), { recursive: true });
  symlinkSync(resolve(real, "node_modules"), resolve(copy, "node_modules"), "junction");
};
const run = () => {
  const result = spawnSync(process.execPath, ["--test", "tests/gate.test.mjs"], { cwd: copy, encoding: "utf8", timeout: 120_000 });
  const text = `${result.stdout}${result.stderr}`.replace(/\r/g, "");
  const failed = [...text.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]);
  return { status: result.status, failed, text };
};

let missed = 0;
prepare();
const baseline = run();
console.log(`baseline: ${baseline.status === 0 ? "pass" : `FAIL (${baseline.failed.join("; ")})`}`);
if (baseline.status !== 0) { rmSync(copy, { recursive: true, force: true }); process.exit(1); }

for (const [label, file, pattern, replacement] of mutations) {
  prepare();
  const path = resolve(copy, file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(pattern, replacement);
  if (after === before) { console.log(`!! ${label}: the mutation did not change the file`); missed += 1; continue; }
  writeFileSync(path, after);
  const outcome = run();
  if (outcome.status === 0) { console.log(`!! SURVIVED  ${label}`); missed += 1; }
  else console.log(`caught      ${label}  ->  ${outcome.failed.length ? outcome.failed[0].slice(0, 80) : "the module no longer loads"}`);
}
rmSync(copy, { recursive: true, force: true });
console.log(missed === 0 ? `\nall ${mutations.length} planted bugs were caught` : `\n${missed} of ${mutations.length} planted bugs were NOT caught`);
process.exit(missed === 0 ? 0 : 1);
