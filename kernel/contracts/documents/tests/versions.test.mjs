// How versions work: a document names its version, an older version is read by its own validator and can be
// upgraded step by step, an error never repeats what was sent, and a released version is frozen by hash.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { type } from "arktype";
import { describe, documents, parseDocument, schemaText, sha256, verifyReleased } from "../src/registry.ts";
import { notArray } from "../src/rules.ts";
import { subjects } from "./harness.mjs";

const thing = (version, definition, status = "draft") => ({ id: `vaultix.thing.${version}`, status, schema: type(definition).onUndeclaredKey("reject").narrow(notArray), title: "Thing", description: "A test document." });
const registry = () => ({
  "vaultix.thing": {
    versions: {
      v1: thing("v1", { schemaVersion: "'vaultix.thing.v1'", label: "string > 0" }, "released"),
      v2: thing("v2", { schemaVersion: "'vaultix.thing.v2'", title: "string > 0", "owner?": "string" })
    },
    // v2 renamed `label` to `title`: a breaking change, so a new version with an upgrade from v1.
    upgrades: { v1: older => ({ schemaVersion: "vaultix.thing.v2", title: older.label }) }
  }
});

test("a document is read by the validator its schemaVersion names", () => {
  const read = parseDocument({ schemaVersion: "vaultix.thing.v1", label: "first" }, registry());
  assert.deepEqual([read.ok, read.id], [true, "vaultix.thing.v1"]);
  assert.equal(parseDocument({ schemaVersion: "vaultix.thing.v2", title: "second" }, registry()).ok, true);
  assert.equal(parseDocument({ schemaVersion: "vaultix.thing.v1", title: "wrong shape for v1" }, registry()).code, "invalid");
});

test("an older document is upgraded step by step to the newest version, and only when asked", () => {
  const untouched = parseDocument({ schemaVersion: "vaultix.thing.v1", label: "first" }, registry());
  assert.deepEqual(untouched.value, { schemaVersion: "vaultix.thing.v1", label: "first" });
  const upgraded = parseDocument({ schemaVersion: "vaultix.thing.v1", label: "first" }, registry(), { toLatest: true });
  assert.deepEqual([upgraded.ok, upgraded.id, upgraded.value], [true, "vaultix.thing.v2", { schemaVersion: "vaultix.thing.v2", title: "first" }]);
});

test("an upgrade that produces something invalid is an error, not a silently wrong document", () => {
  const broken = registry();
  broken["vaultix.thing"].upgrades.v1 = () => ({ schemaVersion: "vaultix.thing.v2" });
  const result = parseDocument({ schemaVersion: "vaultix.thing.v1", label: "first" }, broken, { toLatest: true });
  assert.deepEqual([result.ok, result.code], [false, "upgrade_invalid"]);
});

test("unknown, malformed and missing versions are refused with a reason", () => {
  const reg = registry();
  const code = raw => parseDocument(raw, reg).code;
  assert.equal(code({ schemaVersion: "vaultix.thing.v9" }), "unknown_version");
  assert.equal(code({ schemaVersion: "vaultix.other.v1" }), "unknown_document");
  for (const raw of [null, [], "text", 5, {}, { schemaVersion: 1 }, { schemaVersion: "thing.v1" }, { schemaVersion: "vaultix.thing.v0" }, { schemaVersion: "vaultix.thing.v01" }, { schemaVersion: "vaultix.thing.v1.extra" }]) assert.equal(code(raw), "not_a_document", JSON.stringify(raw));
});

test("the real registry reads the AI documents by version", () => {
  const valid = subjects.connection.fixtures.find(fixture => fixture.valid).document;
  assert.deepEqual([parseDocument(valid).ok, parseDocument(valid).id], [true, "vaultix.ai-connection.v1"]);
  const persona = subjects.persona.fixtures.find(fixture => fixture.valid).document;
  assert.equal(parseDocument(persona).id, "vaultix.ai-persona.v1");
  assert.equal(parseDocument({ ...valid, schemaVersion: "vaultix.ai-connection.v2" }).code, "unknown_version");
});

test("an error says where and what was expected, never what was sent: a credential cannot leak through a validation message", () => {
  const canary = "CANARY-do-not-echo-9f3a7c1e5b2d";
  const base = subjects.connection.fixtures.find(fixture => fixture.valid && fixture.document.kind === "bedrock")?.document;
  assert.ok(base, "a valid bedrock fixture");
  const attempts = [
    { ...base, credential: { accessKeyId: canary, secretAccessKey: canary } },
    { ...base, credential: { accessKeyId: base.credential.accessKeyId, secretAccessKey: canary.repeat(300) } },
    { ...base, name: canary.repeat(10), region: canary, extra: canary },
    { ...base, credential: { apiKey: canary } }
  ];
  for (const attempt of attempts) {
    const result = parseDocument(attempt);
    assert.equal(result.ok, false);
    const shown = JSON.stringify(result);
    assert.ok(!shown.includes("CANARY"), `the problem report must not repeat the input: ${shown.slice(0, 300)}`);
    assert.ok(result.problems.length > 0 && result.problems.every(problem => typeof problem.path === "string" && typeof problem.expected === "string"));
  }
  assert.deepEqual(describe([{ path: ["credential", "apiKey"], expected: "a string" }]), [{ path: "credential.apiKey", expected: "a string" }]);
});

test("a released version is frozen by hash: changing it, forgetting its lock, or dropping it are all caught", () => {
  const reg = registry();
  const lock = { "vaultix.thing.v1": sha256(schemaText(reg["vaultix.thing"].versions.v1)) };
  assert.deepEqual(verifyReleased(reg, lock), []);
  assert.match(verifyReleased(reg, {}).join("\n"), /released but not locked/);
  const changed = registry();
  changed["vaultix.thing"].versions.v1 = thing("v1", { schemaVersion: "'vaultix.thing.v1'", label: "string > 0", "added?": "string" }, "released");
  assert.match(verifyReleased(changed, lock).join("\n"), /released and its schema has changed.*new version/);
  const demoted = registry();
  demoted["vaultix.thing"].versions.v1.status = "draft";
  assert.match(verifyReleased(demoted, lock).join("\n"), /locked but is no longer a released version/);
  assert.deepEqual(verifyReleased(documents, {}), [], "the real documents are drafts, so nothing is locked yet");
});

test("the committed JSON Schema files are exactly what the registry exports", () => {
  const run = spawnSync(process.execPath, ["scripts/export.mjs", "--check"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
