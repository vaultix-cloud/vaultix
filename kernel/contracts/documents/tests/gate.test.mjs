// The three delivery-gate documents (docs/0142): the feature manifest, the gate receipt and the failure record.
//
// Two independent judges, ArkType and the JSON Schema exported from it (compiled by Ajv in strict mode, the way the
// repository's contract tests compile), and no hand-written oracle to copy from. So the tests are built to find disagreements
// and holes rather than to confirm examples:
//   - every valid example is accepted by both;
//   - hundreds of broken variants are derived mechanically from each valid example, and the two judges must agree on every one
//     (a variant one accepts and the other rejects is a hole in the schema or its export);
//   - the properties the standard depends on are asserted by name, because "the judges agree" does not say they are right;
//   - an invalid document's error never repeats what was sent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { type } from "arktype";
import { feature } from "../src/feature.v1.ts";
import { FIX_THE_SOURCE, failure } from "../src/gate-failure.v1.ts";
import { receipt } from "../src/gate-receipt.v1.ts";
import { allVersions, documents, parseDocument, schemaText } from "../src/registry.ts";
import { compile } from "./harness.mjs";
import { failures, mutants, valid } from "./gate-documents.mjs";

const subjects = {
  feature: { id: "vaultix.feature.v1", arktype: feature },
  receipt: { id: "vaultix.gate-receipt.v1", arktype: receipt },
  failure: { id: "vaultix.gate-failure.v1", arktype: failure }
};
for (const subject of Object.values(subjects)) {
  const version = allVersions(documents).find(candidate => candidate.id === subject.id);
  assert.ok(version, `${subject.id} is registered`);
  subject.exported = compile(JSON.parse(schemaText(version)));
}
const arktypeAccepts = (subject, document) => !(subject.arktype(document) instanceof type.errors);
const judges = (subject, document) => ({ arktype: arktypeAccepts(subject, document), exported: subject.exported(document) });

test("every valid example is accepted by ArkType and by the exported JSON Schema", () => {
  for (const [name, subject] of Object.entries(subjects)) assert.deepEqual(judges(subject, valid[name]), { arktype: true, exported: true }, name);
  for (const [kind, document] of Object.entries(failures)) assert.deepEqual(judges(subjects.failure, document), { arktype: true, exported: true }, kind);
});

test("there is a valid example of every kind of failure, and nothing in the schema is left unexercised", () => {
  const exported = JSON.parse(schemaText(allVersions(documents).find(version => version.id === "vaultix.gate-failure.v1")));
  const kinds = exported.anyOf.map(branch => branch.properties.kind.const).sort();
  assert.deepEqual(Object.keys(failures).sort(), kinds);
});

for (const [name, subject] of Object.entries(subjects)) {
  test(`${name}: ArkType and the exported schema agree on every mechanically broken variant`, () => {
    const documentsToTry = name === "failure" ? Object.values(failures) : [valid[name]];
    let count = 0;
    const disagreements = [];
    for (const base of documentsToTry) {
      for (const variant of mutants(base)) {
        count += 1;
        const verdict = judges(subject, variant.document);
        if (verdict.arktype !== verdict.exported) disagreements.push(`${base.kind ?? name} / ${variant.label}: ArkType ${verdict.arktype}, exported ${verdict.exported}`);
      }
    }
    assert.ok(count > 150, `only ${count} variants were generated; the generator is not exercising the document`);
    assert.deepEqual(disagreements, []);
  });
}

// Agreement is not correctness: a bug in a schema and in its export agree with each other (a mutation check found one such
// hole, an undeclared key accepted on one kind of failure). So certain kinds of breakage are rejected outright, in every
// document and at every depth, whatever else is true of the field. A leading space or a "/" is not here: text may begin with
// either. Everything below is invalid in every field of every document.
const alwaysInvalid = /: (extra key|newline|control character|non-ASCII|too long|wrong type|array instead|object instead|array|null|string)$/;

test("an undeclared key, a newline, a control or non-ASCII character, an overlong string, or the wrong type is rejected everywhere", () => {
  let checked = 0;
  for (const [name, base] of [["feature", valid.feature], ["receipt", valid.receipt], ...Object.entries(failures).map(([kind, document]) => [`failure/${kind}`, document])]) {
    const subject = subjects[name.split("/")[0]];
    for (const variant of mutants(base)) {
      if (!alwaysInvalid.test(variant.label)) continue;
      checked += 1;
      assert.deepEqual(judges(subject, variant.document), { arktype: false, exported: false }, `${name} / ${variant.label}`);
    }
  }
  assert.ok(checked > 250, `only ${checked} always-invalid variants were checked`);
});

// The generator breaks things without knowing what is legal. These name what the standard depends on.
const rejects = (subject, document, why) => assert.deepEqual(judges(subject, document), { arktype: false, exported: false }, why);

test("a failure record must carry the fix-the-source rule, word for word", () => {
  rejects(subjects.failure, (({ rule, ...rest }) => rest)(failures.check_failed), "no rule");
  rejects(subjects.failure, { ...failures.check_failed, rule: "fix the answer" }, "another sentence");
  rejects(subjects.failure, { ...failures.check_failed, rule: `${FIX_THE_SOURCE}.` }, "the sentence with something added");
  // Markdown wraps lines, so compare the words and not the line breaks.
  const standard = readFileSync(new URL("../../../../docs/0142-delivery-standard.md", import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.ok(standard.includes(FIX_THE_SOURCE), "docs/0142 says the same sentence the schema pins");
});

test("a failure record holds one line of printable text and nothing else a reader could be misled by", () => {
  for (const field of ["expected", "observed"]) {
    for (const bad of ["two\nlines", "tab\there", "bell\u0007", "caf\u00e9", "line\r", "\u202eright-to-left", "a".repeat(301), ""]) {
      rejects(subjects.failure, { ...failures.check_failed, [field]: bad }, `${field}: ${JSON.stringify(bad).slice(0, 30)}`);
    }
  }
  rejects(subjects.failure, { ...failures.check_failed, output: "the check's own output" }, "a field for a check's output does not exist");
});

test("an answer edit cannot be recorded without saying what was edited, and a failure carries only its own kind's fields", () => {
  rejects(subjects.failure, { ...failures.answer_edit, edits: [] }, "no edits");
  rejects(subjects.failure, (({ edits, ...rest }) => rest)(failures.answer_edit), "edits missing");
  rejects(subjects.failure, { ...failures.answer_edit, edits: [{ file: "a.json", what: "tweak" }] }, "an unknown kind of edit");
  rejects(subjects.failure, { ...failures.check_failed, edits: failures.answer_edit.edits }, "another kind's field");
  rejects(subjects.failure, { ...failures.check_failed, kind: "something_else" }, "an unknown kind");
});

test("a failed absorb says which stage stopped and which branch, and a leftover says what is left over: from the lists, never free text", () => {
  for (const stage of ["preflight", "update", "gate", "push", "cleanup", "verify"]) {
    assert.deepEqual(judges(subjects.failure, { ...failures.absorb_failed, stage }), { arktype: true, exported: true }, `stage ${stage}`);
  }
  for (const bad of ["teleport", "", "Gate", "gate ", "push\n"]) rejects(subjects.failure, { ...failures.absorb_failed, stage: bad }, `stage ${JSON.stringify(bad)}`);
  rejects(subjects.failure, (({ stage, ...rest }) => rest)(failures.absorb_failed), "no stage");
  rejects(subjects.failure, (({ branch, ...rest }) => rest)(failures.absorb_failed), "no branch");
  rejects(subjects.failure, { ...failures.absorb_failed, branch: "a".repeat(101) }, "a branch name too long");
  for (const problem of ["merged_branch", "merged_worktree", "local_main_behind"]) {
    assert.deepEqual(judges(subjects.failure, { ...failures.leftover_ref, problem }), { arktype: true, exported: true }, `problem ${problem}`);
  }
  for (const bad of ["stale", "", "merged branch", "MERGED_BRANCH"]) rejects(subjects.failure, { ...failures.leftover_ref, problem: bad }, `problem ${JSON.stringify(bad)}`);
  rejects(subjects.failure, (({ problem, ...rest }) => rest)(failures.leftover_ref), "no problem");
  rejects(subjects.failure, (({ ref, ...rest }) => rest)(failures.leftover_ref), "no ref");
  rejects(subjects.failure, { ...failures.leftover_ref, stage: "gate" }, "another kind's field");
  rejects(subjects.failure, { ...failures.absorb_failed, problem: "merged_branch" }, "another kind's field");
});

test("paths and globs cannot be absolute or climb out of the repository, on any field that takes one", () => {
  for (const bad of ["/etc/passwd", "../outside", "a/../../b", "a/..", "C:\\windows", "a\\b", "a b", "a\nb", ""]) {
    rejects(subjects.failure, { ...failures.unowned_source, files: [bad] }, `unowned file ${JSON.stringify(bad)}`);
    rejects(subjects.feature, { ...valid.feature, owns: [bad] }, `owned glob ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(judges(subjects.feature, { ...valid.feature, owns: ["kernel/**/*.rs", "scripts/{a,b}.mjs", "docs/0142-delivery-standard.md"] }), { arktype: true, exported: true });
  rejects(subjects.failure, { ...failures.check_failed, logPath: "/tmp/log" }, "a log outside .gate/logs");
  rejects(subjects.failure, { ...failures.check_failed, logPath: ".gate/logs/../../secrets" }, "a log path that climbs");
});

test("a capability needs a flow, a flow needs a mutation it must fail on, and a flow is a program and arguments, never a shell string", () => {
  const withCapability = patch => ({ ...valid.feature, capabilities: [{ ...valid.feature.capabilities[0], ...patch }] });
  rejects(subjects.feature, withCapability({ flows: [] }), "a capability with no flow");
  const withFlow = patch => withCapability({ flows: [{ ...valid.feature.capabilities[0].flows[0], ...patch }] });
  rejects(subjects.feature, withFlow({ mutations: [] }), "a flow that cannot fail");
  rejects(subjects.feature, withFlow({ mutations: ["same", "same"] }), "a mutation listed twice");
  rejects(subjects.feature, withFlow({ command: "cargo test && curl evil" }), "a shell string");
  rejects(subjects.feature, withFlow({ command: { program: "sh", args: ["-c", "anything"] } }), "a shell as the program");
  rejects(subjects.feature, withFlow({ command: { program: "cargo", args: Array.from({ length: 33 }, () => "x") } }), "more than 32 arguments");
  rejects(subjects.feature, withFlow({ timeoutSeconds: 0 }), "no time limit");
  rejects(subjects.feature, withFlow({ timeoutSeconds: 1801 }), "a limit over half an hour");
});

test("a receipt's statuses carry what they should: a skip says why, only a failure has an exit code, a timeout is not a failure", () => {
  const withChecks = checks => ({ ...valid.receipt, checks });
  rejects(subjects.receipt, withChecks([{ id: "x", status: "skipped", seconds: 0 }]), "a silent skip");
  rejects(subjects.receipt, withChecks([{ id: "x", status: "skipped", seconds: 3, reason: "no docker" }]), "a skip that took time");
  rejects(subjects.receipt, withChecks([{ id: "x", status: "pass", seconds: 1, exitCode: 0 }]), "an exit code on a pass");
  rejects(subjects.receipt, withChecks([{ id: "x", status: "timeout", seconds: 600, exitCode: 1 }]), "an exit code on a timeout");
  rejects(subjects.receipt, withChecks([{ id: "x", status: "passed", seconds: 1 }]), "an unknown status");
  rejects(subjects.receipt, withChecks([]), "a receipt with no checks");
  rejects(subjects.receipt, { ...valid.receipt, clean: "yes" }, "clean must be a boolean");
  rejects(subjects.receipt, { ...valid.receipt, commit: "HEAD" }, "a commit must be the full id");
  rejects(subjects.receipt, { ...valid.receipt, commit: commitOf(valid.receipt).toUpperCase() }, "a commit id is lowercase");
  // The short form `git log --oneline` prints is not an identity: two commits can share it. Only the full 40 characters will do.
  for (const bad of [commitOf(valid.receipt).slice(0, 7), commitOf(valid.receipt).slice(0, 8), commitOf(valid.receipt).slice(0, 39), `${commitOf(valid.receipt)}0`, `${commitOf(valid.receipt).slice(0, 39)}g`, ""]) {
    rejects(subjects.receipt, { ...valid.receipt, commit: bad }, `receipt commit ${JSON.stringify(bad)}`);
    rejects(subjects.failure, { ...failures.check_failed, commit: bad }, `failure commit ${JSON.stringify(bad)}`);
  }
  for (const bad of ["2026-11-17", "2026-11-17T18:00:00", "2026-11-17T18:00:00.123", "2026-11-17T18:00:00+01:00", "2026-11-17T18:00Z", "2026-13-17T18:00:00Z", "2026-11-17 18:00:00Z", "2026-11-17T18:00:00z", "yesterday"]) rejects(subjects.receipt, { ...valid.receipt, startedAt: bad }, `startedAt ${bad}`);
});

const commitOf = document => document.commit;

test("what a schema cannot say is not claimed: the shape accepts a receipt whose result contradicts its checks (the gate checks that)", () => {
  // Pinned on purpose. If a future change moves this rule into the shape, this test says so and the docs are updated with it.
  const contradiction = { ...valid.receipt, result: "pass" };
  assert.deepEqual(judges(subjects.receipt, contradiction), { arktype: true, exported: true });
});

test("the registry reads each document by its schemaVersion and refuses another", () => {
  for (const [name, subject] of Object.entries(subjects)) {
    const read = parseDocument(valid[name]);
    assert.deepEqual([read.ok, read.id], [true, subject.id], name);
    assert.equal(parseDocument({ ...valid[name], schemaVersion: subject.id.replace(/\.v1$/, ".v2") }).code, "unknown_version", name);
  }
  assert.equal(parseDocument({ ...valid.receipt, schemaVersion: "vaultix.feature.v1" }).code, "invalid", "a receipt cannot pass as a feature");
});

test("an invalid document's problems say where and what was expected, never what was sent", () => {
  const canary = "CANARY-8f3a91-must-not-appear";
  let checked = 0;
  for (const [name, base] of [["feature", valid.feature], ["receipt", valid.receipt], ...Object.entries(failures).map(([kind, document]) => [`failure/${kind}`, document])]) {
    // Put the canary where text is expected, in a form that is invalid there (it ends in a newline), and in places a type is expected.
    for (const variant of mutants(base)) {
      const text = JSON.stringify(variant.document);
      if (text === undefined) continue;
      const planted = JSON.parse(JSON.stringify(variant.document, (key, value) => (typeof value === "string" && key !== "schemaVersion" && key !== "kind" && key !== "status" && key !== "rule" ? `${canary}\n` : value)) ?? "null");
      const result = parseDocument(planted);
      if (!result.ok) { checked += 1; assert.ok(!JSON.stringify(result).includes(canary), `${name} / ${variant.label}: an error repeated what was sent`); }
    }
  }
  assert.ok(checked > 300, `only ${checked} invalid documents were checked`);
});
