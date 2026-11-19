// Valid examples of the three delivery-gate documents, and a generator of broken variants of them. Shared by the gate tests.
import { FIX_THE_SOURCE } from "../src/gate-failure.v1.ts";

const commit = "0f41f11a5c3d9e8b7a6f5e4d3c2b1a0918273645";
const common = { schemaVersion: "vaultix.gate-failure.v1", commit, check: "documents", tier: "fast", rule: FIX_THE_SOURCE, expected: "the exported schemas match the registry", observed: "schemas/vaultix.feature.v1.schema.json differs", location: { file: "kernel/contracts/documents/schemas/vaultix.feature.v1.schema.json", line: 1 }, logPath: ".gate/logs/documents.log" };
const capability = { feature: "secrets", capability: "redeem-once" };

export const valid = {
  feature: {
    schemaVersion: "vaultix.feature.v1",
    name: "secrets",
    title: "Secrets",
    owns: ["kernel/domains/secrets/**", "kernel/server/src/secrets.rs"],
    capabilities: [
      {
        id: "redeem-once",
        summary: "A handle redeems its value once; the second redeem is refused and both are in the audit chain.",
        flows: [{ id: "redeem-once-process", kind: "process", command: { program: "cargo", args: ["test", "-p", "vaultixd", "--test", "api", "--", "redeem_once"] }, timeoutSeconds: 120, mutations: ["redeem-twice-allowed", "redeem-skips-audit"] }]
      }
    ],
    parity: [{ capability: "redeem-once", upstream: "secret reveal", claim: "Vaultix returns a value once, to a handle, with an audit record.", proof: "redeem-once-process" }]
  },
  receipt: {
    schemaVersion: "vaultix.gate-receipt.v1",
    commit,
    tier: "full",
    startedAt: "2026-11-17T18:00:00.000Z",
    finishedAt: "2026-11-17T18:04:30Z",
    clean: true,
    result: "fail",
    checks: [
      { id: "documents", status: "pass", seconds: 7.1 },
      { id: "kernel-clippy", status: "fail", seconds: 41.2, exitCode: 101 },
      { id: "drills", status: "timeout", seconds: 600 },
      { id: "image-build", status: "skipped", seconds: 0, reason: "docker is not running" }
    ]
  },
  failure: { ...common, kind: "check_failed", exitCode: 1 }
};

/** One valid failure record of every kind, so a test can walk them all. */
export const failures = {
  check_failed: { ...common, kind: "check_failed", exitCode: 1 },
  check_timed_out: { ...common, kind: "check_timed_out", timeoutSeconds: 600 },
  flow_missing: { ...common, kind: "flow_missing", capability },
  flow_stale: { ...common, kind: "flow_stale", capability, flow: "redeem-once-process" },
  mutation_survived: { ...common, kind: "mutation_survived", flow: "redeem-once-process", mutation: "redeem-skips-audit" },
  unowned_source: { ...common, kind: "unowned_source", files: ["kernel/server/src/new.rs"] },
  answer_edit: { ...common, kind: "answer_edit", edits: [{ file: "scripts/lineage-ceiling.json", what: "ceiling" }] },
  manifest_invalid: { ...common, kind: "manifest_invalid", feature: "secrets", problems: [{ path: "capabilities.0.flows", expected: "non-empty" }] },
  receipt_missing: { ...common, kind: "receipt_missing" },
  absorb_failed: { ...common, kind: "absorb_failed", stage: "gate", branch: "feat/delivery-gate" },
  leftover_ref: { ...common, kind: "leftover_ref", problem: "merged_branch", ref: "origin/feat/old-work" }
};

const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every place in a document: a path of keys and the value there. */
export function* walk(value, path = []) {
  yield { path, value };
  if (Array.isArray(value)) for (let index = 0; index < value.length; index++) yield* walk(value[index], [...path, index]);
  else if (isObject(value)) for (const [key, child] of Object.entries(value)) yield* walk(child, [...path, key]);
}

const at = (root, path) => path.reduce((node, key) => node[key], root);
const setAt = (root, path, next) => {
  if (path.length === 0) return next;
  const copy = clone(root);
  at(copy, path.slice(0, -1))[path[path.length - 1]] = next;
  return copy;
};
const removeAt = (root, path) => {
  const copy = clone(root);
  const parent = at(copy, path.slice(0, -1));
  if (Array.isArray(parent)) parent.splice(path[path.length - 1], 1); else delete parent[path[path.length - 1]];
  return copy;
};

/**
 * Broken variants of a valid document, each labelled by where and how. The generator does not know which keys are required or
 * which values are legal: it only breaks things, and the tests ask two independent judges (ArkType, and the exported JSON
 * Schema) whether they agree. A variant that one accepts and the other rejects is a hole in the schema or in its export.
 */
export function* mutants(document) {
  const label = (path, what) => `${path.join(".") || "(root)"}: ${what}`;
  for (const { path, value } of walk(document)) {
    if (path.length > 0) yield { label: label(path, "removed"), document: removeAt(document, path) };
    if (isObject(value)) yield { label: label(path, "extra key"), document: setAt(document, path, { ...value, surprise: 1 }) };
    if (typeof value === "string") {
      for (const [what, next] of [["empty", ""], ["too long", "a".repeat(2000)], ["newline", `${value}\n`], ["control character", `${value}\u0007`], ["non-ASCII", `${value}é`], ["leading space", ` ${value}`], ["path climb", `../${value}`], ["absolute", `/${value}`], ["wrong type", 7]]) yield { label: label(path, what), document: setAt(document, path, next) };
    }
    if (typeof value === "number") for (const [what, next] of [["negative", -1], ["huge", 1e15], ["fraction", value + 0.5], ["string", "1"], ["zero", 0]]) yield { label: label(path, what), document: setAt(document, path, next) };
    if (typeof value === "boolean") for (const [what, next] of [["string", String(value)], ["number", 1]]) yield { label: label(path, what), document: setAt(document, path, next) };
    if (Array.isArray(value)) for (const [what, next] of [["empty", []], ["object instead", {}], ["duplicated first item", value.length ? [value[0], ...value] : value], ["too many", Array.from({ length: 300 }, () => value[0] ?? "x")]]) yield { label: label(path, what), document: setAt(document, path, next) };
    if (isObject(value) && path.length > 0) yield { label: label(path, "array instead"), document: setAt(document, path, []) };
  }
  yield { label: "(root): array", document: [] };
  yield { label: "(root): null", document: null };
  yield { label: "(root): string", document: "text" };
}
