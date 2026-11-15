// The generator turns OpenAPI schemas into ArkType expressions. These tests run the generated expressions
// with the real ArkType and prove two things: what it generates validates strictly, and what it does not
// understand fails loudly instead of becoming a weaker validator.
import assert from "node:assert/strict";
import test from "node:test";
import { type } from "arktype";
import { expression, generate } from "../scripts/generate.mjs";

const build = (schema, scope = {}) => {
  const text = expression(schema, "test", new Set());
  return new Function("type", ...Object.keys(scope), `return ${text};`)(type, ...Object.values(scope));
};
const accepts = (validator, value) => !(validator(value) instanceof type.errors);

test("date-time is RFC 3339, not just any date", () => {
  const v = build({ type: "string", format: "date-time" });
  assert.ok(accepts(v, "2026-11-15T10:00:00Z") && accepts(v, "2026-11-15T10:00:00.123456+02:00"));
  for (const bad of ["yesterday", "2026-11-15", "2026-11-15 10:00:00", 5]) assert.ok(!accepts(v, bad), String(bad));
});

test("uuid, email and url formats are checked", () => {
  assert.ok(accepts(build({ type: "string", format: "uuid" }), "6f1c1f0e-8f1e-4e0b-9b5e-0c3f3a4b5c6d"));
  assert.ok(!accepts(build({ type: "string", format: "uuid" }), "nope"));
  assert.ok(!accepts(build({ type: "string", format: "email" }), "x"));
  assert.ok(!accepts(build({ type: "string", format: "uri" }), "no"));
});

test("patterns, lengths and enums are enforced", () => {
  const slug = build({ type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,62}$" });
  assert.ok(accepts(slug, "payments-api") && !accepts(slug, "Payments") && !accepts(slug, ""));
  const bounded = build({ type: "string", minLength: 1, maxLength: 3 });
  assert.ok(accepts(bounded, "abc") && !accepts(bounded, "") && !accepts(bounded, "abcd"));
  const state = build({ type: "string", enum: ["queued", "dead"] });
  assert.ok(accepts(state, "dead") && !accepts(state, "stuck"));
});

test("integers have their width and bounds", () => {
  const int32 = build({ type: "integer", format: "int32" });
  assert.ok(accepts(int32, 7) && accepts(int32, 2147483647) && !accepts(int32, 2147483648) && !accepts(int32, 1.5) && !accepts(int32, "7"));
  const bounded = build({ type: "integer", minimum: 5, maximum: 300 });
  assert.ok(accepts(bounded, 60) && !accepts(bounded, 4) && !accepts(bounded, 301));
});

test("nullable types, in both OpenAPI 3.1 spellings", () => {
  for (const schema of [{ type: ["string", "null"] }, { anyOf: [{ type: "string" }, { type: "null" }] }]) {
    const v = build(schema);
    assert.ok(accepts(v, null) && accepts(v, "x") && !accepts(v, 5));
  }
});

test("objects: required, optional and undeclared keys", () => {
  const v = build({ type: "object", required: ["name", "version"], properties: { name: { type: "string" }, version: { type: "integer" }, note: { type: "string" } } });
  assert.ok(accepts(v, { name: "A", version: 1 }) && accepts(v, { name: "A", version: 1, note: "x" }));
  assert.ok(!accepts(v, { name: "A" }), "a required field is required");
  assert.ok(!accepts(v, { name: "A", version: 1, extra: true }), "an undeclared field is an error");
  assert.ok(!accepts(v, { name: "A", version: "1" }));
});

test("arrays honour item type and size", () => {
  const v = build({ type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 });
  assert.ok(accepts(v, ["a"]) && !accepts(v, []) && !accepts(v, ["a", "b", "c"]) && !accepts(v, [1]));
});

test("allOf merges objects and oneOf is a union", () => {
  const A = build({ type: "object", required: ["a"], properties: { a: { type: "string" } } });
  const merged = build({ allOf: [{ $ref: "#/components/schemas/A" }, { type: "object", required: ["b"], properties: { b: { type: "integer" } } }] }, { A });
  assert.ok(accepts(merged, { a: "x", b: 1 }), "both halves' fields are accepted together");
  assert.ok(!accepts(merged, { a: "x" }) && !accepts(merged, { b: 1 }), "each half's required field is still required");
  assert.ok(!accepts(merged, { a: "x", b: 1, c: true }), "an undeclared field is still an error");
  assert.ok(!accepts(merged, { a: "x", b: "1" }));
  const either = build({ oneOf: [{ type: "string" }, { type: "integer" }] });
  assert.ok(accepts(either, "x") && accepts(either, 3) && !accepts(either, true));
});

test("what it cannot represent is an error, never a weaker validator", () => {
  const fails = (schema, pattern) => assert.throws(() => expression(schema, "test", new Set()), pattern);
  fails({ type: "string", format: "hostname" }, /unsupported string format "hostname"/);
  fails({ type: "string", contentEncoding: "base64" }, /unsupported keyword "contentEncoding"/);
  fails({ type: "object", properties: { a: { type: "string" } }, additionalProperties: true }, /additionalProperties: false/);
  fails({ type: "array" }, /needs items/);
  fails({ type: "string", not: { enum: ["x"] } }, /unsupported keyword "not"/);
  fails({ $ref: "https://example.com/schema.json" }, /only #\/components\/schemas/);
  fails({ type: "object", required: ["ghost"], properties: { a: { type: "string" } } }, /"ghost" is not declared/);
  fails({}, /needs a type/);
});

test("a whole document: recursion, missing refs, missing operation ids and wrong versions are refused", () => {
  const doc = (extra) => ({ openapi: "3.1.0", paths: {}, components: { schemas: {} }, ...extra });
  assert.throws(() => generate(doc({ openapi: "3.0.3" })), /expected OpenAPI 3.1/);
  assert.throws(() => generate(doc({ components: { schemas: { A: { type: "object", properties: { b: { $ref: "#/components/schemas/B" } } }, B: { type: "object", properties: { a: { $ref: "#/components/schemas/A" } } } } } })), /recursive/);
  assert.throws(() => generate(doc({ components: { schemas: { A: { $ref: "#/components/schemas/Missing" } } } })), /does not exist/);
  assert.throws(() => generate(doc({ paths: { "/x": { get: { responses: {} } } } })), /needs an operationId/);
  const ok = generate(doc({ components: { schemas: { Thing: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, paths: { "/things": { get: { operationId: "listThings", responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Thing" } } } } } } } } }));
  assert.match(ok.schemasTs, /export const Thing = /);
  assert.match(ok.operationsTs, /"listThings"/);
});
