// The frontend locks Zod 3.24.1, the backend locks 3.25.76 (its package.json asks for ^3.22.4). Before relying on
// one equivalence result for both, run the same schemas through all three Zod releases over the same corpus and
// report where Zod itself differs from Zod. A difference here is a risk in conversion even if ArkType is right.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import test from "node:test";

const packages = { "3.22.4": "zod-3-22", "3.24.1": "zod", "3.25.76": "zod-3-25" };
const zods = {};
for (const [version, name] of Object.entries(packages)) {
  const installed = JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), "utf8")).version;
  assert.equal(installed, version, `${name} must really be Zod ${version}`);
  zods[version] = (await import(name)).z;
}

const emails = ["a@b.co", "a@b", "user+tag@example.com", "A@B.CO", "a b@c.d", "a@b..c", "@b.co", "a@.co", "ünï@example.com", "a@-b.co", "a@b-.co", "x".repeat(65) + "@b.co", "a@b.co.uk", "a.b@c-d.co", "a@1.2.3.4", "a@[127.0.0.1]", "a@b.c", "a@b.co ", "\"q\"@b.co"];
const uuids = ["6f1c1f0e-8f1e-4e0b-9b5e-0c3f3a4b5c6d", "6F1C1F0E-8F1E-4E0B-9B5E-0C3F3A4B5C6D", "6f1c1f0e8f1e4e0b9b5e0c3f3a4b5c6d", "00000000-0000-0000-0000-000000000000", "6f1c1f0e-8f1e-7e0b-9b5e-0c3f3a4b5c6d", "6f1c1f0e-8f1e-4e0b-1b5e-0c3f3a4b5c6d", "g1c1f0e-8f1e-4e0b-9b5e-0c3f3a4b5c6d", "6f1c1f0e-8f1e-0e0b-9b5e-0c3f3a4b5c6d", "6f1c1f0e-8f1e-9e0b-9b5e-0c3f3a4b5c6d"];
const urls = ["https://example.com", "http://localhost:3000/x?y=1#z", "ftp://x.y", "example.com", "//example.com", "javascript:alert(1)", "mailto:a@b.co", "https://", "https://exa mple.com", "https://a.b/ü", "/relative", "http://[::1]:80", "https://a", "data:text/plain,hi", "http:/x.y"];
const dates = ["2026-11-15T10:00:00Z", "2026-11-15T10:00:00.123Z", "2026-11-15T10:00:00+02:00", "2026-11-15T10:00:00", "2026-11-15", "2026-13-45T10:00:00Z", "2026-02-30T10:00:00Z", "2026-11-15T10:00Z", "2026-11-15T10:00:00.1234567Z", "+002026-11-15T10:00:00Z"];
const misc = [undefined, null, true, false, 0, -0, 1, -1, 1.5, NaN, Infinity, "", " ", "a", "  x  ", "😀", "12abc", "1e3", "0x10", [], [1], ["a"], {}, { a: "x" }, { a: "x", extra: 1 }, { a: undefined }, { a: null }, new Date(0), new Date("x"), 10n, () => {}, Symbol.iterator];
const corpus = [...emails, ...uuids, ...urls, ...dates, ...misc];

const build = z => ({
  "string.email": z.string().email(), "string.uuid": z.string().uuid(), "string.url": z.string().url(), "string.datetime": z.string().datetime(), "string.datetime offset": z.string().datetime({ offset: true }),
  "string.trim.min": z.string().trim().min(1), "number": z.number(), "number.int": z.number().int(), "date": z.date(),
  "object strip": z.object({ a: z.string() }), "object optional": z.object({ a: z.string().optional() }), "object nullish": z.object({ a: z.string().nullish() }), "object default": z.object({ a: z.string().default("d") }),
  "record": z.record(z.string(), z.number()), "tuple": z.tuple([z.string(), z.number()]), "array": z.array(z.string()),
  "coerce.number": z.coerce.number(), "coerce.boolean": z.coerce.boolean(), "coerce.string": z.coerce.string(), "coerce.date": z.coerce.date(),
  "catch": z.string().catch("fb"), "union": z.union([z.string(), z.number()]), "nativeEnum": z.nativeEnum({ A: "a", B: "b" })
});
const run = schema => value => { try { const r = schema.safeParse(structuredClone(value)); return r.success ? { ok: true, value: r.data } : { ok: false }; } catch (e) { return { threw: e.constructor.name }; } };
const same = (a, b) => a.ok === b.ok && a.threw === b.threw && (!a.ok || (a.value instanceof Date && b.value instanceof Date && Number.isNaN(+a.value) && Number.isNaN(+b.value)) || isDeepStrictEqual(a.value, b.value));

const built = Object.fromEntries(Object.entries(zods).map(([version, z]) => [version, build(z)]));
const pairs = [["3.22.4", "3.24.1"], ["3.24.1", "3.25.76"]];
const differences = {};
for (const [from, to] of pairs) {
  for (const name of Object.keys(built[from])) {
    const a = run(built[from][name]); const b = run(built[to][name]);
    const bad = corpus.filter(value => !same(a(value), b(value)));
    if (bad.length) (differences[`${from} -> ${to}`] ??= {})[name] = bad.slice(0, 3).map(String);
  }
}

test("the three Zod aliases are three different releases", () => assert.equal(new Set(Object.values(zods)).size, 3));

// The only construct that changed between these releases, measured over this corpus, is datetime():
//   3.22.4 -> 3.24.1: the calendar is now checked (month 13, February 30, hour 25 and the like were accepted before)
//   3.24.1 -> 3.25.76: seconds became optional (10:00Z is accepted)
// Any other difference is new information and fails here until it is understood and written down.
const KNOWN = ["string.datetime", "string.datetime offset"];

test("Zod 3.22.4 to 3.24.1: only datetime() changed, and it became stricter", () => {
  console.log(`# Zod to Zod: ${JSON.stringify(differences)}`);
  assert.deepEqual(Object.keys(differences["3.22.4 -> 3.24.1"] ?? {}).sort(), KNOWN);
  assert.ok(differences["3.22.4 -> 3.24.1"]["string.datetime"].includes("2026-13-45T10:00:00Z"), "3.22.4 accepted month 13");
});

test("Zod 3.24.1 (frontend) to 3.25.76 (backend): only datetime() changed, and it became looser", () => {
  assert.deepEqual(Object.keys(differences["3.24.1 -> 3.25.76"] ?? {}).sort(), KNOWN);
  assert.deepEqual(differences["3.24.1 -> 3.25.76"]["string.datetime"], ["2026-11-15T10:00Z"], "3.25.76 accepts a timestamp without seconds");
});
