// The v1 contract against the real server. Every response, success or error, is validated with the
// validators generated from the OpenAPI document. Run with `node scripts/test-contract-v1.mjs`, which
// starts a real stack and sets VX_BASE, VX_TOKEN and VX_PSQL_CONTAINER.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { type } from "arktype";
import { operations } from "../generated/operations.ts";
import * as schemas from "../generated/schemas.ts";

const base = process.env.VX_BASE;
const token = process.env.VX_TOKEN;
const container = process.env.VX_PSQL_CONTAINER;
if (!base || !token) throw new Error("run this through scripts/test-contract-v1.mjs");
const document = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));
const psql = sql => spawnSync("docker", ["exec", container, "psql", "-U", "postgres", "-At", "-c", sql], { encoding: "utf8" });

const CANARY = `vxcanary-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
const problems = (validator, value) => { const out = validator(value); return out instanceof type.errors ? out.summary : null; };

const exercised = new Map(); // operationId -> Set of statuses seen
const samples = [];          // [operationId, status, parsed body] for the mutation tests

/** Call an operation exactly as documented, then hold the real answer to the contract. */
async function call(id, { path = {}, query = {}, headers = {}, body, authorized = true, expect } = {}) {
  const operation = operations[id];
  assert.ok(operation, `operation ${id} is in the contract`);
  let url = operation.path;
  for (const [name, value] of Object.entries(path)) url = url.replace(`{${name}}`, encodeURIComponent(value));
  const search = new URLSearchParams(query).toString();
  const response = await fetch(`${base}${url}${search ? `?${search}` : ""}`, {
    method: operation.method,
    headers: { ...(authorized ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed; try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
  assert.notEqual(parsed, undefined, `${id} ${response.status} answered with something that is not JSON: ${text.slice(0, 120)}`);
  if (expect !== undefined) assert.equal(response.status, expect, `${id} expected ${expect}: ${text.slice(0, 200)}`);

  const declared = operation.responses[response.status];
  assert.ok(response.status in operation.responses, `${id} answered ${response.status}, which the contract does not document`);
  const validator = declared ?? schemas.ErrorBody;
  const issue = problems(validator, parsed);
  assert.equal(issue, null, `${id} ${response.status} does not match the contract: ${issue}\n${text.slice(0, 300)}`);
  if (response.status >= 400) assert.equal(problems(schemas.ErrorBody, parsed), null, `${id} ${response.status} is not a contract error`);
  if (!exercised.has(id)) exercised.set(id, new Set());
  exercised.get(id).add(response.status);
  samples.push([id, response.status, parsed]);
  return { status: response.status, body: parsed, text, headers: response.headers };
}

const address = (name = "API_TOKEN", extra = {}) => ({ project: "payments", environment: "prod", name, ...extra });

test("status is public and matches the contract", async () => {
  const { body } = await call("getStatus", { authorized: false, expect: 200 });
  assert.equal(body.sealed, false);
  assert.equal(body.database, "ok");
});

test("every secured operation refuses a missing token with a contract error", async () => {
  const secured = Object.entries(operations).filter(([, op]) => op.secured);
  assert.ok(secured.length >= 10, `expected the secured operations, found ${secured.length}`);
  for (const [id, op] of secured) {
    const path = Object.fromEntries(op.parameters.filter(p => p.in === "path").map(p => [p.name, "6f1c1f0e-8f1e-4e0b-9b5e-0c3f3a4b5c6d"]));
    const query = Object.fromEntries(op.parameters.filter(p => p.in === "query" && p.required).map(p => [p.name, "payments"]));
    const { body } = await call(id, { authorized: false, path, query, body: op.request ? {} : undefined, expect: 401 });
    assert.equal(body.code, "unauthorized");
  }
});

test("secrets: write, list, request, inject and redeem", async () => {
  const put = await call("putSecret", { body: { ...address(), value: CANARY }, headers: { "X-Vx-Actor": "human:ada" }, expect: 200 });
  assert.deepEqual([put.body.outcome, put.body.name, put.body.version], ["applied", "API_TOKEN", 1]);
  assert.equal((await call("putSecret", { body: { ...address(), value: `${CANARY}-2` }, expect: 200 })).body.version, 2);
  await call("putSecret", { body: { ...address(), value: CANARY }, expect: 200 });

  const list = await call("listSecrets", { query: { project: "payments", environment: "prod" }, expect: 200 });
  assert.deepEqual(list.body.secrets.map(s => [s.name, s.version, s.updatedBy]), [["API_TOKEN", 3, "operator"]]);
  assert.ok(!list.text.includes(CANARY), "a list never carries a value");

  const requested = await call("requestSecretValue", { body: { ...address("DB_PASSWORD"), purpose: "the migration check" }, expect: 200 });
  assert.equal(requested.body.outcome, "requested");

  assert.equal((await call("createInjection", { body: { purpose: "x", secrets: [address("NOPE")] }, expect: 404 })).body.code, "not_found");
  const made = await call("createInjection", { body: { purpose: "contract test", secrets: [address()], ttlSeconds: 30 }, headers: { "X-Vx-Actor": "mcp:contract" }, expect: 200 });
  assert.equal(made.headers.get("cache-control"), "no-store");
  assert.ok(made.body.handle.startsWith("vxh_"));

  assert.equal((await call("redeemInjection", { path: { handle: made.body.handle }, headers: { "X-Vx-Actor": "mcp:other" }, expect: 410 })).body.code, "handle_invalid");
  const redeemed = await call("redeemInjection", { path: { handle: made.body.handle }, headers: { "X-Vx-Actor": "mcp:contract" }, expect: 200 });
  assert.equal(redeemed.headers.get("cache-control"), "no-store");
  assert.deepEqual(redeemed.body.values.map(v => [v.name, v.value, v.encoding]), [["API_TOKEN", CANARY, "utf8"]], "the contract carries the right value, once");
  assert.equal((await call("redeemInjection", { path: { handle: made.body.handle }, headers: { "X-Vx-Actor": "mcp:contract" }, expect: 410 })).body.code, "handle_invalid");
});

test("operate: jobs, schedules, retry and the audit trail", async () => {
  const jobs = await call("listJobs", { expect: 200 });
  assert.ok(Array.isArray(jobs.body.jobs));
  assert.equal((await call("listJobs", { query: { status: "stuck" }, expect: 422 })).body.code, "invalid_status");
  assert.equal((await call("listJobs", { query: { limit: "many" }, expect: 422 })).body.code, "invalid_request");
  const schedules = await call("listSchedules", { expect: 200 });
  assert.equal(schedules.body.schedules[0].name, "operate.prune");

  assert.equal((await call("retryJob", { path: { id: "6f1c1f0e-8f1e-4e0b-9b5e-0c3f3a4b5c6d" }, expect: 409 })).body.code, "not_dead");
  assert.equal((await call("retryJob", { path: { id: "not-a-uuid" }, expect: 422 })).body.code, "invalid_request");
  const inserted = psql("INSERT INTO vx_operate_jobs (kind, status, attempts, max_attempts, last_error, finished_at) VALUES ('demo', 'dead', 5, 5, 'the provider answered 503', now()) RETURNING id");
  const id = inserted.stdout.trim().split("\n")[0];
  assert.match(id, /^[0-9a-f-]{36}$/, inserted.stderr);
  const dead = await call("listJobs", { query: { status: "dead" }, expect: 200 });
  assert.equal(dead.body.jobs.find(j => j.id === id).lastError, "the provider answered 503");
  assert.equal((await call("retryJob", { path: { id }, expect: 200 })).body.outcome, "requeued");

  const verify = await call("verifyAuditChain", { query: { chain: "payments" }, expect: 200 });
  assert.equal(verify.body.intact, true);
  assert.ok(verify.body.events >= 6, `the writes, request and injections are recorded (${verify.body.events})`);
  const events = await call("listAuditEvents", { query: { chain: "payments" }, expect: 200 });
  assert.ok(events.body.events.some(e => e.action === "secret.value.read" && e.hasValueFingerprint));
  assert.ok(!events.text.includes(CANARY), "the audit trail never carries a value");
  psql("UPDATE vx_operate_audit_events SET actor = 'someone-else' WHERE chain = 'payments' AND seq = 1");
  const tampered = await call("verifyAuditChain", { query: { chain: "payments" }, expect: 200 });
  assert.deepEqual([tampered.body.intact, tampered.body.firstAlteredEvent], [false, 1]);
});

test("the server and the generated request validators agree on what is invalid", async () => {
  const valid = { ...address(), value: "x" };
  assert.equal(problems(operations.putSecret.request, valid), null);
  const cases = [
    ["an uppercase project", { ...valid, project: "Payments" }],
    ["a project with a space", { ...valid, project: "pay ments" }],
    ["an environment that is too long", { ...valid, environment: "a".repeat(64) }],
    ["a name that starts with a digit", { ...valid, name: "1TOKEN" }],
    ["a name with a semicolon", { ...valid, name: "A;rm" }],
    ["a missing value", { project: "payments", environment: "prod", name: "API_TOKEN" }],
    ["an empty value", { ...valid, value: "" }],
    ["an unknown field", { ...valid, force: true }],
    ["a value that is a number", { ...valid, value: 5 }]
  ];
  for (const [label, body] of cases) {
    assert.notEqual(problems(operations.putSecret.request, body), null, `the validator rejects ${label}`);
    const { status } = await call("putSecret", { body, expect: undefined }).catch(error => { throw new Error(`${label}: ${error.message}`); });
    assert.equal(status, 422, `the server rejects ${label} with 422`);
  }
  const injectionCases = [["no secrets", { purpose: "x", secrets: [] }], ["too many", { purpose: "x", secrets: Array(33).fill(address()) }], ["no purpose", { secrets: [address()] }], ["a ttl that is text", { purpose: "x", secrets: [address()], ttlSeconds: "soon" }]];
  for (const [label, body] of injectionCases) {
    assert.notEqual(problems(operations.createInjection.request, body), null, `the validator rejects ${label}`);
    assert.equal((await call("createInjection", { body })).status, 422, `the server rejects ${label} with 422`);
  }
});

// Mutation testing of the validators, guided by the OpenAPI document so each mutation has an exact
// expected outcome: removing a required field must be rejected, removing an optional field must be
// accepted, a wrong type or a value outside an enum or format must be rejected, and a field the contract
// does not declare must be rejected. Nothing is skipped because it "might be optional".
const component = name => document.components.schemas[name];
const resolve = schema => schema?.$ref ? resolve(component(schema.$ref.split("/").pop())) : schema;
const nonNull = schema => {
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives) { const live = alternatives.filter(a => a.type !== "null"); if (live.length === 1) return resolve(live[0]); }
  if (Array.isArray(schema.type)) return { ...schema, type: schema.type.find(t => t !== "null") };
  return schema;
};
const objectShape = schema => {
  schema = nonNull(resolve(schema));
  if (schema.allOf) return schema.allOf.map(objectShape).reduce((all, part) => ({ properties: { ...all.properties, ...part.properties }, required: [...all.required, ...part.required] }), { properties: {}, required: [] });
  return { properties: schema.properties ?? null, required: schema.required ?? [] };
};
const corrupt = schema => {
  schema = nonNull(resolve(schema));
  if (schema.enum) return "__not_a_member__";
  if (schema.format === "date-time") return "yesterday";
  if (schema.format === "uuid") return "nope";
  return { string: 12345, integer: "text", number: "text", boolean: "true", array: "nope", object: 12345 }[schema.type];
};

test("validators reject drift: every field, removed or corrupted, behaves exactly as the contract says", () => {
  let rejected = 0;
  let accepted = 0;
  const seen = new Set();
  for (const [id, status, body] of samples) {
    if (status !== 200 || seen.has(id)) continue;
    seen.add(id);
    const validator = operations[id].responses[200];
    const root = document.paths[operations[id].path][operations[id].method.toLowerCase()].responses["200"].content["application/json"].schema;
    assert.equal(problems(validator, body), null, id + " sample is valid before mutation");

    const walk = (schema, value, rebuild, where) => {
      schema = nonNull(resolve(schema));
      if (schema.type === "array" && Array.isArray(value) && value.length) return walk(schema.items, value[0], mutated => rebuild([mutated, ...value.slice(1)]), where + "[0]");
      const { properties, required } = objectShape(schema);
      if (!properties || value === null || typeof value !== "object" || Array.isArray(value)) return;
      for (const key of Object.keys(value)) {
        if (!(key in properties)) assert.fail(id + ": the server sent " + where + "." + key + ", which the contract does not declare");
        const here = where + "." + key;
        const without = { ...value }; delete without[key];
        const outcome = problems(validator, rebuild(without));
        if (required.includes(key)) { assert.notEqual(outcome, null, id + ": removing required " + here + " must be rejected"); rejected += 1; }
        else { assert.equal(outcome, null, id + ": removing optional " + here + " must be accepted: " + outcome); accepted += 1; }
        const wrong = corrupt(properties[key]);
        if (wrong !== undefined) { assert.notEqual(problems(validator, rebuild({ ...value, [key]: wrong })), null, id + ": a wrong " + here + " must be rejected"); rejected += 1; }
        assert.notEqual(problems(validator, rebuild({ ...value, undeclared: 1 })), null, id + ": an undeclared field next to " + here + " must be rejected"); rejected += 1;
        walk(properties[key], value[key], mutated => rebuild({ ...value, [key]: mutated }), here);
      }
    };
    walk(root, body, whole => whole, id);
  }
  assert.ok(rejected >= 60, "expected a meaningful number of rejected mutants, got " + rejected);
  assert.ok(accepted >= 1, "expected at least one optional field to be exercised, got " + accepted);
});

test("no value appears in any answer except a redeem", () => {
  for (const [id, , body] of samples) {
    if (id === "redeemInjection") continue;
    assert.ok(!JSON.stringify(body).includes(CANARY), `${id} must not carry the canary value`);
  }
});

test("coverage: every documented operation was called and succeeded", () => {
  const documented = Object.values(document.paths).flatMap(item => Object.values(item).map(op => op.operationId));
  assert.equal(documented.length, Object.keys(operations).length);
  for (const id of documented) assert.ok(exercised.get(id)?.has(200), `${id} was not exercised with a 200`);
  const documentedStatuses = documented.flatMap(id => Object.keys(operations[id].responses).map(s => `${id} ${s}`));
  const seen = documented.flatMap(id => [...(exercised.get(id) ?? [])].map(s => `${id} ${s}`));
  const missing = documentedStatuses.filter(entry => !seen.includes(entry));
  console.log(`# documented statuses not exercised (${missing.length}): ${missing.join(", ")}`);
});
