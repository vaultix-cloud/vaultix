// Differential fuzzing. Fixtures are written by the people who wrote the schema, so they share its blind spots.
// This takes every valid fixture, applies thousands of random mutations (a field removed, replaced with an
// edge-case value, an unknown field added, a kind swapped, fields grafted in from another document) and asks
// three judges whether each result is valid: the existing hand-written JSON Schema (the oracle), the ArkType
// version, and the JSON Schema exported from it. Any disagreement fails the run and is printed as a minimal
// reproduction. The seed is fixed so a failure is repeatable; set FUZZ_SEED to explore others.
import assert from "node:assert/strict";
import test from "node:test";
import { accepts, subjects } from "./harness.mjs";

const SEED = Number(process.env.FUZZ_SEED ?? 20261115);
const ROUNDS = Number(process.env.FUZZ_ROUNDS ?? 12000);

function random(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const STRINGS = [
  "", " ", "   ", "\n", "a", " a ", "a\n", "x".repeat(31), "x".repeat(32), "x".repeat(33), "x".repeat(63), "x".repeat(64), "x".repeat(65), "x".repeat(128), "x".repeat(129), "x".repeat(300), "x".repeat(301), "x".repeat(4096), "x".repeat(4097),
  "😀".repeat(64), "😀".repeat(65), "é".repeat(64), "é".repeat(65), "日本語", "a\u0000b", " ", " x",
  "https://example.com", "https://example.com/v1/chat", "https://example.com/a b", "https://user:pw@example.com", "https://example.com/?q=1", "https://example.com/#f", "http://example.com", "http://localhost:8080/v1", "http://127.0.0.1", "http://[::1]:9/x", "http://localhost.evil.com", "ftp://example.com", "HTTPS://example.com",
  "us-east-1", "eu-central-2", "us-east5", "global", "us-east-", "US-EAST-1", "my-project-123", "My-Project", "ab", "a".repeat(31),
  "AKIAIOSFODNN7EXAMPLE", "akiaiosfodnn7example", "SHORT", "authorization", "Authorization", "cookie", "x-team", "X-Team", "x-api-key", "x-hf-bill-to", "content-type", "host",
  "vaultix.secrets.list", "vaultix.", "vaultix.Secrets", "secrets.list", "router", "secrets", "claude-sonnet-5-5", "model id", "m",
  "6f1c1f0e-8f1e-4e0b-9b5e-0c3f3a4b5c6d", "6F1C1F0E-8F1E-4E0B-9B5E-0C3F3A4B5C6D", "not-a-uuid",
  "fast", "standard", "deep", "all", "instance", "none", "auto", "bearer", "header", "openai-chat", "anthropic-messages", "specialist", "guard", "public", "access"
];
const NUMBERS = [0, 1, 2, 4, 4.9, 5, 5.5, 60, 119, 120, 121, -1, 0.5, 1.5, 2.0001, 32000, 32001, 1e9, 3];
const KIND_LIKE = [
  ["kind", ["anthropic", "openai", "bedrock", "vertex", "huggingface", "huggingface-endpoint", "custom", "other"]],
  ["role", ["router", "specialist", "guard", "other"]],
  ["tier", ["fast", "standard", "deep", "other"]],
  ["type", ["bearer", "header", "none", "other"]],
  ["apiStyle", ["openai-chat", "anthropic-messages", "other"]],
  ["use", ["all", "instance", "none", "other"]],
  ["toolChoice", ["auto", "none", "other"]]
];

function paths(value, prefix = []) {
  const found = [prefix];
  if (Array.isArray(value)) value.forEach((item, index) => found.push(...paths(item, [...prefix, index])));
  else if (value && typeof value === "object") for (const key of Object.keys(value)) found.push(...paths(value[key], [...prefix, key]));
  return found;
}
const getAt = (root, path) => path.reduce((node, key) => node?.[key], root);
function setAt(root, path, replace) {
  if (path.length === 0) return replace(root);
  const clone = structuredClone(root);
  const parent = getAt(clone, path.slice(0, -1));
  const key = path[path.length - 1];
  const next = replace(parent[key], parent, key);
  if (next === DELETE) Array.isArray(parent) ? parent.splice(key, 1) : delete parent[key]; else parent[key] = next;
  return clone;
}
const DELETE = Symbol("delete");

function mutate(document, others, next) {
  const pick = list => list[Math.floor(next() * list.length)];
  const target = pick(paths(document));
  const value = getAt(document, target);
  const choice = Math.floor(next() * 12);
  const where = `/${target.join("/")}`;
  switch (choice) {
    case 0: return target.length ? [setAt(document, target, () => DELETE), `delete ${where}`] : [document, "no-op"];
    case 1: { const s = pick(STRINGS); return [setAt(document, target, () => s), `${where} = string ${JSON.stringify(s.length > 40 ? `${s.slice(0, 20)}...(${[...s].length} chars)` : s)}`]; }
    case 2: { const n = pick(NUMBERS); return [setAt(document, target, () => n), `${where} = number ${n}`]; }
    case 3: { const v = pick([true, false, null, [], {}, [""], ["a", "a"], { a: 1 }]); return [setAt(document, target, () => v), `${where} = ${JSON.stringify(v)}`]; }
    case 4: if (value && typeof value === "object" && !Array.isArray(value)) { const key = pick(["unexpected", "kind", "region", "endpoint", "handoffs", "credential", "headers", "billTo", "enabled", "x"]); return [setAt(document, target, node => ({ ...node, [key]: pick(STRINGS) })), `add ${where}/${key}`]; } return [document, "no-op"];
    case 5: if (Array.isArray(value) && value.length) return [setAt(document, target, array => [...array, array[0]]), `duplicate the first item of ${where}`]; return [document, "no-op"];
    case 6: if (Array.isArray(value)) return [setAt(document, target, array => [...array, pick(STRINGS)]), `append a string to ${where}`]; return [document, "no-op"];
    case 7: case 8: { const [key, values] = pick(KIND_LIKE); const at = paths(document).find(p => p[p.length - 1] === key); if (!at) return [document, "no-op"]; const v = pick(values); return [setAt(document, at, () => v), `/${at.join("/")} = ${v}`]; }
    case 9: { const donor = pick(others); const key = pick(Object.keys(donor)); return [{ ...document, [key]: structuredClone(donor[key]) }, `graft top-level ${key} from another document`]; }
    case 10: if (typeof value === "string") { const cut = Math.floor(next() * ([...value].length + 1)); return [setAt(document, target, text => [...text].slice(0, cut).join("")), `truncate ${where}`]; } return [document, "no-op"];
    default: if (typeof value === "string") return [setAt(document, target, text => `${text}${pick(["x", " ", "\n", "😀", "é", "/", "-"])}`), `append a character to ${where}`]; return [document, "no-op"];
  }
}

for (const [name, subject] of Object.entries(subjects)) {
  test(`${subject.label}: ${ROUNDS} random mutations get the same verdict from the hand-written schema, the ArkType version and the exported schema`, () => {
    const seeds = subject.fixtures.filter(fixture => (fixture.schemaValid ?? fixture.valid)).map(fixture => fixture.document);
    assert.ok(seeds.length >= 4, "valid documents to mutate");
    const next = random(SEED + name.length);
    const disagreements = [];
    let bothAccept = 0;
    let bothReject = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      let document = structuredClone(seeds[Math.floor(next() * seeds.length)]);
      const steps = [];
      for (let count = 1 + Math.floor(next() * 3); count > 0; count -= 1) { const [mutated, step] = mutate(document, seeds, next); document = mutated; steps.push(step); }
      const oracle = subject.handWritten(document);
      const candidate = accepts(subject.arktype, document);
      const exported = subject.exported(document);
      if (oracle === candidate && candidate === exported) { if (oracle) bothAccept += 1; else bothReject += 1; continue; }
      if (disagreements.length < 5) disagreements.push({ steps, oracle, arktype: candidate, exported, document: JSON.stringify(document).slice(0, 600) });
    }
    assert.deepEqual(disagreements, [], `${disagreements.length}+ documents judged differently (oracle, ArkType, exported):\n${JSON.stringify(disagreements, null, 1)}`);
    assert.ok(bothAccept >= 100, `the fuzz must keep producing valid documents, got ${bothAccept}`);
    assert.ok(bothReject >= 1000, `the fuzz must produce plenty of invalid documents, got ${bothReject}`);
    console.log(`# ${subject.label}: ${ROUNDS} mutations, ${bothAccept} valid and ${bothReject} invalid by all three judges, 0 disagreements`);
  });
}
