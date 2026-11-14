// The v1 AI documents migration (docs/0126) against rows stored before it: every existing
// connection keeps working under its v1 kind, no credential is read or changed, persona domains
// gain a value check, and rollback maps the rows back or refuses when v1-only data exists.
// Runs the migration's own SQL in a disposable PostgreSQL; nothing else is touched.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = await import(pathToFileURL(resolve(root,
  "platform/engine/backend/src/db/migrations/20261114100000_vx-ai-v1-documents.ts")).href);
const captured = direction => {
  const statements = [];
  return migration[direction]({ raw: sql => { statements.push(sql); return Promise.resolve(); } }).then(() => statements.join(";\n"));
};
const docker = (args, input) => spawnSync("docker", args, { input, encoding: "utf8", timeout: 120_000 });
const name = `vaultix-ai-migration-${randomBytes(8).toString("hex")}`;
const psql = (sql, { fail = false } = {}) => {
  const r = docker(["exec", "-i", name, "psql", "-X", "-q", "-1", "-v", "ON_ERROR_STOP=1", "-U", "vaultix", "-d", "vaultix", "-At"], sql);
  assert.equal(r.status === 0, !fail, `${fail ? "expected a refusal" : "SQL failed"}: ${r.stderr}`);
  return r.stdout.trim();
};
const checks = [];
const check = text => { checks.push(text); console.log(`Vaultix AI migration: ${text}`); };

try {
  assert.equal(docker(["run", "-d", "--rm", "--name", name, "--network", "none", "-e", "POSTGRES_USER=vaultix", "-e", "POSTGRES_DB=vaultix",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16.6-alpine"]).status, 0, "PostgreSQL did not start");
  for (let i = 0; i < 60 && docker(["exec", name, "pg_isready", "-U", "vaultix", "-d", "vaultix"]).status !== 0; i += 1) {
    await new Promise(done => setTimeout(done, 1000));
  }
  // The columns the earlier AI migrations created (20261111120000, 20261111180000), with the same
  // inline kind check, so PostgreSQL gives it the same name.
  psql(`
    CREATE TABLE vx_ai_providers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "orgId" uuid,
      kind varchar(32) NOT NULL CHECK (kind IN ('anthropic','bedrock','vertex','openai','openai-compatible')),
      name varchar(64) NOT NULL, model varchar(128) NOT NULL, "baseUrl" varchar(512) NOT NULL DEFAULT '',
      region varchar(32) NOT NULL DEFAULT '', "cloudProject" varchar(30) NOT NULL DEFAULT '', "encryptedCredential" bytea,
      active boolean NOT NULL DEFAULT false, "lastTestedAt" timestamptz, "lastTestOutcome" varchar(16), "lastTestMessage" varchar(300),
      "fastModel" varchar(128) NOT NULL DEFAULT '', "deepModel" varchar(128) NOT NULL DEFAULT '',
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
    CREATE TABLE vx_ai_personas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "orgId" uuid, slug varchar(32) NOT NULL, name varchar(64) NOT NULL,
      role varchar(16) NOT NULL, tier varchar(16) NOT NULL, description varchar(300) NOT NULL DEFAULT '', instructions text NOT NULL,
      domains text[] NOT NULL, "providerId" uuid, enabled boolean NOT NULL DEFAULT true, "builtIn" boolean NOT NULL DEFAULT false,
      model varchar(128) NOT NULL DEFAULT '', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
    INSERT INTO vx_ai_providers (name, kind, model, "baseUrl", region, "encryptedCredential") VALUES
      ('compatible with key', 'openai-compatible', 'm', 'http://127.0.0.1:1234/v1', '', '\\x01020304'),
      ('compatible without key', 'openai-compatible', 'm', 'http://ollama:11434/v1', '', NULL),
      ('openai through a proxy', 'openai', 'gpt-5', 'https://proxy.example/v1', '', '\\x05'),
      ('anthropic through a proxy', 'anthropic', 'claude', 'https://proxy.example', '', '\\x06'),
      ('anthropic direct', 'anthropic', 'claude', '', '', '\\x07'),
      ('bedrock with an address', 'bedrock', 'anthropic.claude', 'https://bedrock.example', 'us-east-1', '\\x08');
    INSERT INTO vx_ai_personas (slug, name, role, tier, instructions, domains) VALUES ('notes', 'Notes', 'specialist', 'standard', 'x', ARRAY['secrets']);
  `);
  const credentials = () => psql(`SELECT string_agg(name || '=' || coalesce(encode("encryptedCredential", 'hex'), ''), ',' ORDER BY name) FROM vx_ai_providers`);
  const before = credentials();

  psql(await captured("up"));
  const rows = Object.fromEntries(psql(`SELECT name, kind || '|' || "apiStyle" || '|' || "authType" || '|' || "authHeaderName" || '|' || "baseUrl" FROM vx_ai_providers`)
    .split("\n").map(line => line.split("|")).map(([n, ...rest]) => [n, rest.join("|")]));
  assert.deepEqual(rows, {
    "compatible with key": "custom|openai-chat|bearer||http://127.0.0.1:1234/v1",
    "compatible without key": "custom|openai-chat|none||http://ollama:11434/v1",
    "openai through a proxy": "custom|openai-chat|bearer||https://proxy.example/v1",
    "anthropic through a proxy": "custom|anthropic-messages|header|x-api-key|https://proxy.example",
    "anthropic direct": "anthropic||||",
    "bedrock with an address": "bedrock||||"
  });
  assert.equal(credentials(), before, "the migration changed a stored credential");
  assert.equal(psql(`SELECT "memoryUse" || '|' || (tools IS NULL) || '|' || ("modelSettings" IS NULL) FROM vx_ai_personas`), "all|true|true");
  check("every stored connection maps to its v1 kind and keeps working; no credential is read or changed; personas default to all memories and their areas' tools");

  psql(`INSERT INTO vx_ai_personas (slug, name, role, tier, instructions, domains) VALUES ('bad', 'B', 'specialist', 'standard', 'x', ARRAY['mesh'])`, { fail: true });
  psql(`INSERT INTO vx_ai_providers (name, kind, model) VALUES ('old kind', 'openai-compatible', 'm')`, { fail: true });
  check("the database refuses an unknown persona area and the retired openai-compatible kind");

  psql(await captured("down"));
  assert.equal(psql(`SELECT string_agg(name || '=' || kind, ',' ORDER BY name) FROM vx_ai_providers`),
    "anthropic direct=anthropic,anthropic through a proxy=anthropic,bedrock with an address=bedrock,compatible with key=openai-compatible," +
    "compatible without key=openai-compatible,openai through a proxy=openai-compatible");
  assert.equal(credentials(), before);
  check("rollback maps the connections back to kinds the earlier binary reads, credentials untouched");

  psql(await captured("up"));
  psql(`INSERT INTO vx_ai_providers (name, kind, model, "billTo") VALUES ('hf', 'huggingface', 'openai/gpt-oss-120b:fastest', 'my-org')`);
  psql(await captured("down"), { fail: true });
  assert.equal(psql(`SELECT count(*) FROM vx_ai_providers WHERE kind = 'huggingface'`), "1", "a refused rollback must leave the data as it was");
  check("rollback refuses, and changes nothing, once a Hugging Face connection exists");
  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  console.log(JSON.stringify({ passed: false, checks, failure: error.message }));
  process.exitCode = 1;
} finally {
  docker(["rm", "-f", "-v", name]);
}
