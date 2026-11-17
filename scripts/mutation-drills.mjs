// Plants one bug at a time in the server and the secrets domain and checks the real-process drills catch it
// (kernel/server/tests/drills.rs). Run through the disposable database, in the background (it takes several minutes):
//   node scripts/with-test-postgres.mjs -- node scripts/mutation-drills.mjs
//
// Safety: before touching a file the script saves it under kernel/.mutation-backup/. If an earlier run was killed (a timeout,
// a closed terminal) the next run restores those files FIRST and says so, so a planted bug can never be left in the source.
// Every mutation is also checked to have changed the file.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backupDir = resolve(root, "kernel/.mutation-backup");
const files = {
  secrets: "kernel/domains/secrets/core/src/lib.rs",
  app: "kernel/server/src/app.rs"
};
const backupPath = key => resolve(backupDir, `${key}.orig`);

// recover from an earlier killed run
if (existsSync(backupDir)) {
  for (const name of readdirSync(backupDir)) {
    const key = name.replace(/\.orig$/, "");
    if (files[key]) { writeFileSync(resolve(root, files[key]), readFileSync(resolve(backupDir, name))); console.log(`restored ${files[key]} from an earlier interrupted run`); }
  }
  rmSync(backupDir, { recursive: true, force: true });
}
mkdirSync(backupDir, { recursive: true });
const originals = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(resolve(root, p), "utf8")]));
for (const [k, text] of Object.entries(originals)) writeFileSync(backupPath(k), text);

const restore = () => { for (const [k, p] of Object.entries(files)) writeFileSync(resolve(root, p), originals[k]); };
const finish = () => { restore(); rmSync(backupDir, { recursive: true, force: true }); };
process.on("exit", finish);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

const run = () => {
  const result = spawnSync("cargo", ["test", "-p", "vaultixd", "--test", "drills", "--", "--test-threads=1"], { cwd: resolve(root, "kernel"), encoding: "utf8", env: process.env });
  const text = (result.stdout + result.stderr).replace(/\r/g, "");
  const failed = text.match(/^test .* FAILED$/gm) ?? [];
  const errors = text.match(/^error(\[[A-Z0-9]+\])?: .*$/gm) ?? [];
  return [...failed, ...errors.filter(e => !e.startsWith("error: test failed"))].join("\n  ") || (text.match(/test result: .*/)?.[0] ?? "no result");
};

const mutations = [
  ["a secret write skips its audit record", "secrets", /vx_audit::append\(\s*&mut tx,\s*Event::new\(&address\.project, actor, "secret\.write"[\s\S]*?\.await\?;/],
  ["readiness ignores a broken audit table", "app", /if sqlx::query\("SELECT 1 FROM vx_operate_audit_heads LIMIT 1"\)\.execute\(&state\.pool\)\.await\.is_err\(\) \{/, "if false {"],
  ["readiness ignores a sealed instance", "app", /if state\.keyring\.is_none\(\) \{\s*reasons\.push\("sealed"\);/, 'if false {\n        reasons.push("sealed");']
];

console.log("== baseline\n ", run());
for (const [label, key, pattern, replacement = ""] of mutations) {
  restore();
  const changed = originals[key].replace(pattern, () => replacement);
  if (changed === originals[key]) { console.log(`== ${label}: !! the mutation did not change the file`); continue; }
  writeFileSync(resolve(root, files[key]), changed);
  console.log(`== ${label}\n `, run());
}
finish();
console.log("== restored\n ", run());
