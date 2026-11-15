// The existing fixtures (the same 77 cases the Go rules and the Ajv contract test use), judged three ways:
// the hand-written schema (as a sanity check of this harness), the ArkType version, and the JSON Schema
// exported from the ArkType version. All three must agree with the fixture, case by case.
import assert from "node:assert/strict";
import test from "node:test";
import { accepts, subjects } from "./harness.mjs";

for (const [name, subject] of Object.entries(subjects)) {
  test(`${subject.label}: the ArkType version agrees with every fixture`, () => {
    assert.ok(subject.fixtures.length >= 29);
    for (const fixture of subject.fixtures) {
      const expected = fixture.schemaValid ?? fixture.valid;
      assert.equal(accepts(subject.arktype, fixture.document), expected, `${name} / ${fixture.name}: the fixture says ${expected}`);
    }
  });

  test(`${subject.label}: the exported JSON Schema agrees with every fixture`, () => {
    for (const fixture of subject.fixtures) {
      const expected = fixture.schemaValid ?? fixture.valid;
      assert.equal(subject.exported(fixture.document), expected, `${name} / ${fixture.name}: ${JSON.stringify(subject.exported.errors)?.slice(0, 200)}`);
    }
  });

  test(`${subject.label}: the harness itself is right (the hand-written schema agrees with every fixture)`, () => {
    for (const fixture of subject.fixtures) assert.equal(subject.handWritten(fixture.document), fixture.schemaValid ?? fixture.valid, `${name} / ${fixture.name}`);
  });
}

test("a character is a character: 64 emoji fit in a 64-character name, 65 do not, in every judge", () => {
  const base = JSON.parse(JSON.stringify(subjects.connection.fixtures.find(c => c.valid).document));
  for (const [count, expected] of [[64, true], [65, false]]) {
    const document = { ...base, name: "😀".repeat(count) };
    assert.equal(accepts(subjects.connection.arktype, document), expected, `ArkType, ${count} emoji`);
    assert.equal(subjects.connection.exported(document), expected, `exported schema, ${count} emoji`);
    assert.equal(subjects.connection.handWritten(document), expected, `hand-written schema, ${count} emoji`);
  }
});
