// Records what the INHERITED key-schema code does on a shared corpus, so the Rust key schema can be compared with it
// (docs/0139). The fixture is frozen: when the inherited code is deleted the evidence stays.
//
// The three functions below are copied from platform/engine/backend/src/services/secret-sync/secret-sync-fns.ts
// (getKeyWithSchema, stripSchema, matchesSchema) with the TypeScript types removed and nothing else changed. They run on the
// real `handlebars` package that the backend installs. The source file's hash is recorded so a change to it is visible.
//
//   node scripts/connectors-differential.mjs            writes kernel/domains/connectors/core/tests/fixtures/inherited-schema.json
//   node scripts/connectors-differential.mjs --check    fails if the committed fixture differs from what the code now gives
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = "platform/engine/backend/src/services/secret-sync/secret-sync-fns.ts";
const requireFromBackend = createRequire(resolve(root, "platform/engine/backend/package.json"));
const handlebars = requireFromBackend("handlebars");

// ---- verbatim from the inherited file, types removed ----
const getKeyWithSchema = ({ key, environment, schema }) => {
  if (!schema) return key;
  return handlebars.compile(schema)({ secretKey: key, environment });
};

const stripSchema = (unprocessedSecretMap, environment, schema) => {
  if (!schema) return unprocessedSecretMap;
  const compiledSchemaPattern = handlebars.compile(schema)({ secretKey: "{{secretKey}}", environment });
  const parts = compiledSchemaPattern.split("{{secretKey}}");
  const prefix = parts[0];
  const suffix = parts[parts.length - 1];
  const strippedMap = {};
  for (const [key, value] of Object.entries(unprocessedSecretMap)) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const strippedKey = key.slice(prefix.length, key.length - suffix.length);
    strippedMap[strippedKey] = value;
  }
  return strippedMap;
};

const matchesSchema = (key, environment, schema) => {
  if (!schema) return true;
  const compiledSchemaPattern = handlebars.compile(schema)({ secretKey: "{{secretKey}}", environment });
  if (!compiledSchemaPattern.includes("{{secretKey}}")) return key === compiledSchemaPattern;
  const parts = compiledSchemaPattern.split("{{secretKey}}");
  const prefix = parts[0];
  const suffix = parts[parts.length - 1];
  if (prefix === "" && suffix === "") return true;
  if (prefix !== "" && !key.startsWith(prefix)) return false;
  if (suffix !== "" && !key.endsWith(suffix)) return false;
  if (key.length < prefix.length + suffix.length) return false;
  const secretKeyPortion = key.slice(prefix.length, suffix.length > 0 ? key.length - suffix.length : undefined);
  if (prefix.includes("/") || suffix.includes("/")) {
    if (secretKeyPortion.includes("/")) return false;
  }
  return true;
};
// ---- end of the copied code ----

const schemas = [
  "{{secretKey}}", "{{ secretKey }}", "APP_{{secretKey}}", "{{secretKey}}_V1", "{{environment}}_{{secretKey}}", "{{secretKey}}-{{environment}}",
  "/app/{{secretKey}}", "/app/{{environment}}/{{secretKey}}", "a/{{secretKey}}/b", "{{environment}}{{secretKey}}",
  "plain", "", "{{environment}}", "{{secretKey}}{{secretKey}}", "{{secretKey}}_{{secretKey}}",
  "{{{secretKey}}}", "{{#if environment}}{{secretKey}}{{/if}}", "{{upper secretKey}}", "{{secretKey", "{{unknown}}{{secretKey}}",
  "{{secretKey}} ", " {{secretKey}}"
];
const environments = ["prod", "dev", "", "pr&d", "a/b", "it's"];
const keys = ["A", "DB_URL", "A&B", "K=V", "<x>", "it's", "q\"q", "a/b", "", "é", "{{x}}", "`", "-", "a b", "A_B-C"];
// destination names to test matches/strip on: what the schema would produce, plus near misses
const extraNames = ["APP_", "_V1", "APP_A", "A_V1", "prod_A", "dev_A", "/app/", "/app/A", "/app/x/A", "a/A/b", "a//b", "plain", "UNRELATED", ""];

const run = fn => { try { return { ok: fn() }; } catch (error) { return { error: String(error.message).split("\n")[0].slice(0, 80) }; } };

const cases = [];
for (const schema of schemas) {
  for (const environment of environments) {
    const row = { schema, environment, apply: {}, names: {} };
    for (const key of keys) row.apply[key] = run(() => getKeyWithSchema({ key, environment, schema }));
    const names = new Set([...extraNames, ...keys.map(k => run(() => getKeyWithSchema({ key: k, environment, schema })).ok).filter(n => typeof n === "string")]);
    for (const name of names) {
      row.names[name] = { matches: run(() => matchesSchema(name, environment, schema)), strip: run(() => stripSchema({ [name]: 1 }, environment, schema)) };
      if (row.names[name].strip.ok) row.names[name].strip = { ok: Object.keys(row.names[name].strip.ok)[0] ?? null };
    }
    cases.push(row);
  }
}

const fixture = {
  about: "Inherited key-schema behaviour on a shared corpus (docs/0139). Generated by scripts/connectors-differential.mjs; do not edit.",
  source, sourceSha256: createHash("sha256").update(readFileSync(resolve(root, source))).digest("hex"),
  handlebarsVersion: handlebars.VERSION, cases
};
const out = resolve(root, "kernel/domains/connectors/core/tests/fixtures/inherited-schema.json");
const text = `${JSON.stringify(fixture, null, 1)}\n`;
if (process.argv.includes("--check")) {
  const committed = JSON.parse(readFileSync(out, "utf8"));
  const same = JSON.stringify(committed.cases) === JSON.stringify(fixture.cases);
  console.log(same ? "differential fixture: matches what the inherited code gives" : "differential fixture: DIFFERS from what the inherited code now gives");
  process.exit(same ? 0 : 1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(`wrote ${cases.length} schema/environment rows (${(text.length / 1024).toFixed(0)} KB), handlebars ${handlebars.VERSION}, source ${fixture.sourceSha256.slice(0, 12)}`);
