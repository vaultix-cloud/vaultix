// Exports every registered document version to JSON Schema 2020-12 (schemas/<id>.schema.json) for consumers
// that are not TypeScript (the Go CLI and release tooling, the Rust kernel, MCP tool descriptions), and holds
// released versions to their lock.
//
//   node scripts/export.mjs                 write schemas/*.schema.json
//   node scripts/export.mjs --check         fail if the committed files differ from what the registry exports,
//                                           or if a released version changed
//   node scripts/export.mjs --lock <id>     pin a released version's schema hash in released.lock.json
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allVersions, documents, schemaText, sha256, verifyReleased } from "../src/registry.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockFile = resolve(root, "released.lock.json");
const readLock = () => { try { return JSON.parse(readFileSync(lockFile, "utf8")); } catch { return {}; } };
const files = Object.fromEntries(allVersions(documents).map(version => [`${version.id}.schema.json`, schemaText(version)]));
const args = process.argv.slice(2);

if (args[0] === "--lock") {
  const version = allVersions(documents).find(candidate => candidate.id === args[1]);
  if (!version) { console.error(`documents: there is no version ${args[1]}`); process.exit(1); }
  if (version.status !== "released") { console.error(`documents: ${version.id} is a draft; mark it "released" in the registry first`); process.exit(1); }
  const lock = readLock();
  lock[version.id] = sha256(schemaText(version));
  writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`documents: locked ${version.id}`);
} else if (args[0] === "--check") {
  const problems = verifyReleased(documents, readLock());
  const present = new Set(readdirSync(resolve(root, "schemas")).filter(name => name.endsWith(".schema.json")));
  for (const [name, text] of Object.entries(files)) {
    let committed; try { committed = readFileSync(resolve(root, "schemas", name), "utf8"); } catch { committed = null; }
    if (committed !== text) problems.push(`schemas/${name} is out of date; run: node scripts/export.mjs`);
    present.delete(name);
  }
  for (const name of present) problems.push(`schemas/${name} belongs to no registered version; delete it`);
  if (problems.length) { for (const problem of problems) console.error(`documents: ${problem}`); process.exit(1); }
  console.log(`documents: ${Object.keys(files).length} exported schemas match the registry`);
} else {
  mkdirSync(resolve(root, "schemas"), { recursive: true });
  for (const name of readdirSync(resolve(root, "schemas"))) if (name.endsWith(".schema.json") && !(name in files)) rmSync(resolve(root, "schemas", name));
  for (const [name, text] of Object.entries(files)) writeFileSync(resolve(root, "schemas", name), text);
  console.log(`documents: exported ${Object.keys(files).join(", ")}`);
}
