// Is each Zod construct we use the same as its ArkType replacement? Both are run over one corpus of awkward
// inputs and compared on whether the value is accepted and, if it is, on the value that comes out. A pair is
// declared `same` (they must agree on everything) or `differs` (they must disagree somewhere, and `because`
// says what a person converting code must do). A pair declared `differs` that turns out equal fails, so this
// file stays a true record of the mapping the converter relies on (docs/0137). Several first guesses about
// where they differ were wrong when measured, which is why this exists.
//
// Zod is 3.24.1 here, the version the frontend uses. ArkType is 2.2.9. Run with DETAIL=1 to see the
// disagreeing inputs.
import assert from "node:assert/strict";
import { inspect, isDeepStrictEqual } from "node:util";
import test from "node:test";
import { type } from "arktype";
import { zodEmail, zodUuid } from "./helpers.mjs";
// Which Zod to measure: the frontend locks 3.24.1, the backend locks 3.25.76, and its package.json asks for ^3.22.4.
// ZOD_PACKAGE names the installed alias (zod, zod-3-22, zod-3-25).
const zodPackage = process.env.ZOD_PACKAGE ?? "zod";
const { z } = await import(zodPackage);
const zodVersion = JSON.parse((await import("node:fs")).readFileSync(new URL(`./node_modules/${zodPackage}/package.json`, import.meta.url), "utf8")).version;

const emails = ["a@b.co", "a@b", "user+tag@example.com", "A@B.CO", "a b@c.d", "a@b..c", "@b.co", "a@.co", "a@b.c", "ünï@example.com", "a@[127.0.0.1]", "\"quoted\"@example.com", "a@b.co ", " a@b.co", "a@-b.co", "a@b-.co", "x".repeat(65) + "@b.co", "a@b.co.uk", "a.b@c-d.co", "a@1.2.3.4"];
const uuids = ["6f1c1f0e-8f1e-4e0b-9b5e-0c3f3a4b5c6d", "6F1C1F0E-8F1E-4E0B-9B5E-0C3F3A4B5C6D", "6f1c1f0e8f1e4e0b9b5e0c3f3a4b5c6d", "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff", "6f1c1f0e-8f1e-7e0b-9b5e-0c3f3a4b5c6d", "6f1c1f0e-8f1e-4e0b-1b5e-0c3f3a4b5c6d", "g1c1f0e-8f1e-4e0b-9b5e-0c3f3a4b5c6d", "6f1c1f0e-8f1e-4e0b-9b5e-0c3f3a4b5c6d ", "6f1c1f0e-8f1e-0e0b-9b5e-0c3f3a4b5c6d", "6f1c1f0e-8f1e-9e0b-9b5e-0c3f3a4b5c6d"];
const urls = ["https://example.com", "http://localhost:3000/x?y=1#z", "ftp://files.example.com", "example.com", "//example.com", "javascript:alert(1)", "mailto:a@b.co", "https://", "https://exa mple.com", "HTTPS://EXAMPLE.COM", "https://a.b/ü", "/relative", "https://user:pw@example.com", "file:///etc/passwd", "data:text/plain,hi", "http://[::1]:80", "https://a", "ws://x.y", "http:/x.y", "http//x.y"];
const dates = ["2026-11-15T10:00:00Z", "2026-11-15T10:00:00.123Z", "2026-11-15T10:00:00+02:00", "2026-11-15T10:00:00", "2026-11-15", "2026-11-15 10:00:00", "2026-13-45T10:00:00Z", "2026-02-30T10:00:00Z", "yesterday", "2026-11-15T25:00:00Z", "20261115T100000Z", "2026-11-15T10:00Z", "2026-11-15T10:00:00.1234567Z", "+002026-11-15T10:00:00Z", "2026-04-31T10:00:00Z", "2026-00-10T10:00:00Z", "2026-01-00T10:00:00Z", "2026-11-15T24:00:00Z", "2026-11-15T23:59:60Z", "2024-02-29T10:00:00Z", "2026-02-29T10:00:00Z", "2026-11-15T10:00:00z", "2026-11-15t10:00:00Z", "2026-11-15T10:00:00.Z"];
const corpus = [
  undefined, null, true, false, 0, -0, 1, -1, 2, 3, 5, 10, 11, 1.5, -1.5, 0.1, 100, NaN, Infinity, -Infinity, 2 ** 53, Number.MAX_VALUE, 15, 25,
  "", " ", "a", "ab", "abc", "abcd", "bc", "ab ", "  x  ", "\n", "A", "ABC", "true", "false", "0", "1", "1.5", "-3", "12abc", "1e3", "0x10", "null", "undefined", "😀", "😀😀😀", "é", "x".repeat(300), "Abc", "aBc",
  ...emails, ...uuids, ...urls, ...dates,
  [], [1], [1, 2], [1, 2, 3], ["a"], ["a", "b"], ["a", 1], [[]], [null], ["a", NaN],
  {}, { a: "x" }, { a: "x", b: 1 }, { a: "x", extra: true }, { a: 1 }, { a: undefined }, { a: null }, { b: 1 }, { a: "x", b: "1" }, { a: "x", b: null }, { a: "x", b: undefined }, { a: "x", b: NaN }, { x: 1, y: 2 },
  { kind: "a", x: "s" }, { kind: "b", y: 1 }, { kind: "c" }, { kind: "a", y: 1 }, { kind: "b", y: NaN },
  new Date("2026-11-15T10:00:00Z"), new Date("nope"), new Date(0), () => {}, Symbol.iterator, 10n, new Map(), new Set(), /re/, Object.create(null)
];

const verdict = (run, value) => { try { return run(value); } catch (error) { return { threw: error?.constructor?.name ?? "error" }; } };
const zodRun = schema => value => { const result = schema.safeParse(value); return result.success ? { ok: true, value: result.data } : { ok: false }; };
const arkRun = schema => value => { const result = schema(value); return result instanceof type.errors ? { ok: false } : { ok: true, value: result }; };
// Two invalid Dates are never deep-equal in Node, so treat them as the same outcome.
// Zod copies a RegExp passed to an all-optional object into a fresh empty object; ArkType returns the RegExp itself.
// Both accept it and no real caller passes one, so such a result is compared by its own enumerable properties.
const plain = value => (value instanceof RegExp ? { ...value } : value);
const sameValue = (a, b) => (a instanceof Date && b instanceof Date && Number.isNaN(+a) && Number.isNaN(+b)) || isDeepStrictEqual(plain(a), plain(b));
const same = (a, b) => a.ok === b.ok && a.threw === b.threw && (!a.ok || sameValue(a.value, b.value));
const structuredCloneSafe = value => { try { return structuredClone(value); } catch { return value; } };
const show = value => inspect(value, { depth: 3, breakLength: Infinity, maxStringLength: 24 });

function compare(zodSchema, arkSchema, inputs = corpus) {
  const disagreements = [];
  const zod = zodRun(zodSchema); const ark = arkRun(arkSchema);
  for (const input of inputs) {
    const a = verdict(zod, structuredCloneSafe(input)); const b = verdict(ark, structuredCloneSafe(input));
    if (!same(a, b)) disagreements.push({ input: show(input), zod: a.ok === undefined ? a : a.ok ? { accepted: show(a.value) } : "rejected", arktype: b.ok === undefined ? b : b.ok ? { accepted: show(b.value) } : "rejected" });
  }
  return disagreements;
}

// ---- the guards and helpers a converted file uses (they become one shared module in the converter) ----
/**
 * What Zod calls an object. ArkType treats an array, a Date, a Map, a Set and a function as objects, so an object
 * type accepts them (and with onUndeclaredKey("delete") hollows out an array). Zod's z.object accepts none of them.
 * JSON documents need only the array half of this (docs/0136); form and in-memory values need all of it.
 */
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Map) && !(value instanceof Set) && typeof value.then !== "function";
const shape = definition => type(definition).onUndeclaredKey("delete").narrow(isObject); // Zod's default: unknown keys are dropped
const strictShape = definition => type(definition).onUndeclaredKey("reject").narrow(isObject);
/**
 * Zod's datetime() is not one rule: it changed between releases (3.22.4 checks the shape only, so month 13 and
 * February 30 pass; 3.24.1 also checks the calendar and needs seconds; 3.25.76 makes seconds optional). A faithful
 * port is written for the Zod version it must match. ArkType's string.date.iso is none of them (it accepts a bare
 * date, an offset, and February 30).
 */
const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const datetimeLike = ({ calendar, optionalSeconds }) => {
  const seconds = optionalSeconds ? /(?::(\d{2})(?:\.\d+)?)?/ : /:(\d{2})(?:\.\d+)?/;
  const timestamp = new RegExp(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.source + seconds.source + /Z$/.source);
  return type("string").narrow(value => {
    const match = timestamp.exec(value);
    if (!match) return false;
    if (!calendar) return true;
    const [, year, month, day, hour, minute, second] = match.map(part => (part === undefined ? undefined : Number(part)));
    return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month) && hour <= 23 && minute <= 59 && (second === undefined || second <= 59);
  });
};
const faithfulDatetime = datetimeLike({ calendar: zodVersion !== "3.22.4", optionalSeconds: zodVersion === "3.25.76" });

/** Zod's .catch(): ArkType refuses a union of two branches that both transform the same input, so this is a function. */
const withFallback = (schema, fallback) => value => { const result = schema(value); return result instanceof type.errors ? fallback : result; };
/** Faithful ports of Zod's z.coerce.*, which are exactly Number(x), Boolean(x), String(x) and new Date(x). */
const coerce = {
  number: type("unknown").pipe(value => Number(value)).to("number"),
  boolean: type("unknown").pipe(value => Boolean(value)).to("boolean"),
  string: type("unknown").pipe(value => String(value)).to("string"),
  date: type("unknown").pipe(value => new Date(value)).to("Date")
};

// What a TypeScript enum is at runtime.
const Color = Object.freeze({ Red: "red", Blue: "blue" });
const Count = Object.freeze({ One: 1, Two: 2, 1: "One", 2: "Two" });

const SAME = "same";
const DIFFERS = "differs";
// [name, zod, arktype, expectation, because]
const cases = [
  // ---- strings
  ["string", z.string(), type("string"), SAME],
  ["string.min(3)", z.string().min(3), type("string >= 3"), SAME],
  ["string.max(3)", z.string().max(3), type("string <= 3"), SAME],
  ["string.length(3)", z.string().length(3), type("string == 3"), SAME],
  ["string.min(1) (non-empty)", z.string().min(1), type("string > 0"), SAME],
  ["string.regex", z.string().regex(/^[a-z]+$/), type("string").and(/^[a-z]+$/), SAME],
  ["string.startsWith", z.string().startsWith("ab"), type("string").and(/^ab/), SAME],
  ["string.endsWith", z.string().endsWith("bc"), type("string").and(/bc$/), SAME],
  ["string.includes", z.string().includes("b"), type("string").and(/b/), SAME],
  ["string.email, Zod's own pattern", z.string().email(), zodEmail, SAME],
  ["string.email, idiomatic", z.string().email(), type("string.email"), DIFFERS, "ArkType accepts addresses Zod rejects (a label that starts with a hyphen). Keep Zod's exact pattern as a regex where behaviour must not change"],
  ["string.uuid, Zod's own pattern", z.string().uuid(), zodUuid, SAME],
  ["string.uuid, idiomatic", z.string().uuid(), type("string.uuid"), DIFFERS, "Zod accepts any 8-4-4-4-12 hex string; ArkType's string.uuid enforces the RFC version and variant bits. Use Zod's pattern as a regex, or decide to tighten"],
  ["string.url", z.string().url(), type("string.url"), SAME],
  ["string.datetime, idiomatic", z.string().datetime(), type("string.date.iso"), DIFFERS, "string.date.iso accepts a bare date, no zone, an offset, and February 30; Zod's datetime() accepts none of those. Never use it as a stand-in"],
  ["string.datetime, faithful to this Zod", z.string().datetime(), faithfulDatetime, SAME],
  ["string.trim().min(1)", z.string().trim().min(1), type("string.trim").pipe(type("string > 0")), SAME],
  ["string.toLowerCase", z.string().toLowerCase(), type("string.lower"), SAME],
  ["string.toUpperCase", z.string().toUpperCase(), type("string.upper"), SAME],
  // ---- numbers (ArkType rejects NaN too)
  ["number", z.number(), type("number"), SAME],
  ["number.int", z.number().int(), type("number.integer"), SAME],
  ["number.min(0)", z.number().min(0), type("number >= 0"), SAME],
  ["number.max(10)", z.number().max(10), type("number <= 10"), SAME],
  ["number.int().min(1).max(10)", z.number().int().min(1).max(10), type("1 <= number.integer <= 10"), SAME],
  ["number.positive", z.number().positive(), type("number > 0"), SAME],
  ["number.nonnegative", z.number().nonnegative(), type("number >= 0"), SAME],
  ["number.finite", z.number().finite(), type("number").narrow(Number.isFinite), SAME],
  ["number.multipleOf(5)", z.number().multipleOf(5), type("number % 5"), SAME],
  // ---- scalars and literals
  ["boolean", z.boolean(), type("boolean"), SAME],
  ["null", z.null(), type("null"), SAME],
  ["undefined", z.undefined(), type("undefined"), SAME],
  ["literal('a')", z.literal("a"), type("'a'"), SAME],
  ["literal(1)", z.literal(1), type("1"), SAME],
  ["literal(true)", z.literal(true), type("true"), SAME],
  ["enum", z.enum(["a", "ab"]), type("'a' | 'ab'"), SAME],
  ["nativeEnum (string)", z.nativeEnum(Color), type.valueOf(Color), SAME],
  ["nativeEnum (number)", z.nativeEnum(Count), type.valueOf(Count), SAME],
  ["any", z.any(), type("unknown"), SAME],
  ["unknown", z.unknown(), type("unknown"), SAME],
  ["date()", z.date(), type("Date"), SAME],
  ["bigint", z.bigint(), type("bigint"), SAME],
  // ---- arrays, tuples, records
  ["array(string)", z.array(z.string()), type("string[]"), SAME],
  ["array(string).min(1)", z.array(z.string()).min(1), type("string[] > 0"), SAME],
  ["array(string).max(2)", z.array(z.string()).max(2), type("string[] <= 2"), SAME],
  ["array(string).nonempty()", z.array(z.string()).nonempty(), type("string[] > 0"), SAME],
  ["tuple([string, number])", z.tuple([z.string(), z.number()]), type(["string", "number"]), SAME],
  ["record(string, number), guarded", z.record(z.string(), z.number()), type.Record("string", "number").narrow(isObject), SAME],
  ["record(string, number), UNGUARDED", z.record(z.string(), z.number()), type.Record("string", "number"), DIFFERS, "an array is an object to ArkType, so Record accepts [] where Zod rejects it. Every converted object and record type carries the isObject guard"],
  // ---- objects: unknown keys, optional keys, the array hazard
  ["object (extra keys kept)", z.object({ a: z.string() }), type({ a: "string" }), DIFFERS, "Zod drops unknown keys from the result; ArkType keeps them. Zod's default is onUndeclaredKey('delete')"],
  ["object (Zod default: extra keys dropped)", z.object({ a: z.string() }), shape({ a: "string" }), SAME],
  ["object.strict()", z.object({ a: z.string() }).strict(), strictShape({ a: "string" }), SAME],
  ["object.passthrough()", z.object({ a: z.string() }).passthrough(), type({ a: "string" }).narrow(isObject), DIFFERS, "a surplus key whose value is undefined is dropped by Zod and kept by ArkType; invisible once serialised to JSON, visible to Object.keys"],
  ["object (required)", z.object({ a: z.string(), b: z.number().int() }), shape({ a: "string", b: "number.integer" }), SAME],
  ["object (nullable key)", z.object({ a: z.string().nullable() }), shape({ a: "string | null" }), SAME],
  ["object (optional key, undefined allowed)", z.object({ a: z.string().optional() }), shape({ "a?": "string | undefined" }), SAME],
  ["object (optional key, ArkType default)", z.object({ a: z.string().optional() }), shape({ "a?": "string" }), DIFFERS, "ArkType's exactOptionalPropertyTypes (on by default) rejects an explicit undefined that Zod accepts, which is what React form state and spread objects produce. Convert with 'string | undefined', or set exactOptionalPropertyTypes: false once, globally"],
  ["object (nullish key)", z.object({ a: z.string().nullish() }), shape({ "a?": "string | null | undefined" }), SAME],
  ["object (required + optional)", z.object({ a: z.string(), b: z.number().optional() }), shape({ a: "string", "b?": "number | undefined" }), SAME],
  ["object (all optional), UNGUARDED", z.object({ a: z.string().optional() }), type({ "a?": "string | undefined" }).onUndeclaredKey("delete"), DIFFERS, "an all-optional ArkType object accepts an array and, with onUndeclaredKey('delete'), silently deletes its indexes ([1] becomes a hole). The guard is not optional"],
  ["object.extend", z.object({ a: z.string() }).extend({ b: z.string().nullable() }), shape({ a: "string", b: "string | null" }), SAME],
  ["object.pick", z.object({ a: z.string(), b: z.string() }).pick({ a: true }), type({ a: "string", b: "string" }).pick("a").onUndeclaredKey("delete").narrow(isObject), SAME],
  ["object.omit", z.object({ a: z.string(), b: z.string().nullable() }).omit({ b: true }), type({ a: "string", b: "string | null" }).omit("b").onUndeclaredKey("delete").narrow(isObject), SAME],
  ["object.partial", z.object({ a: z.string() }).partial(), type({ a: "string | undefined" }).partial().onUndeclaredKey("delete").narrow(isObject), SAME],
  // ---- defaults, unions
  ["default", z.object({ a: z.string().default("d") }), shape({ a: "string = 'd'" }), DIFFERS, "Zod applies the default to an explicit undefined and to a missing key; ArkType's default is a missing key only. Check what the caller passes"],
  ["union(string, number)", z.union([z.string(), z.number()]), type("string | number"), SAME],
  ["nullable string", z.string().nullable(), type("string | null"), SAME],
  ["discriminatedUnion", z.discriminatedUnion("kind", [z.object({ kind: z.literal("a"), x: z.string() }), z.object({ kind: z.literal("b"), y: z.number() })]), type({ kind: "'a'", x: "string" }).or({ kind: "'b'", y: "number" }).onUndeclaredKey("delete").narrow(isObject), SAME],
  // ---- coercion: ArkType's idiomatic parsers are stricter than Zod's coerce, which is just Number(x), Boolean(x), String(x), new Date(x)
  ["coerce.number, idiomatic", z.coerce.number(), type("string.numeric.parse | number"), DIFFERS, "Zod's coerce.number() is Number(x): '', null, true and [] become numbers; ArkType's parsers are stricter. A form that relies on '' meaning 0 changes"],
  ["coerce.number, faithful", z.coerce.number(), coerce.number, SAME],
  ["coerce.boolean, idiomatic", z.coerce.boolean(), type("boolean"), DIFFERS, "Zod's coerce.boolean() is Boolean(x), so the string 'false' is true; that is almost never what was meant"],
  ["coerce.boolean, faithful", z.coerce.boolean(), coerce.boolean, SAME],
  ["coerce.string, faithful", z.coerce.string(), coerce.string, SAME],
  ["coerce.date, idiomatic", z.coerce.date(), type("string.date.parse | Date"), DIFFERS, "Zod's coerce.date() is new Date(x): numbers, null and loose strings become dates"],
  ["coerce.date, faithful", z.coerce.date(), coerce.date, SAME],
  // ---- transformation and refinement
  ["transform", z.string().transform(value => value.length), type("string").pipe(value => value.length), SAME],
  ["refine", z.string().refine(value => value.startsWith("a"), "must start with a"), type("string").narrow(value => value.startsWith("a")), SAME],
  ["preprocess", z.preprocess(value => (typeof value === "string" ? value.trim() : value), z.string().min(1)), type("unknown").pipe(value => (typeof value === "string" ? value.trim() : value)).pipe(type("string > 0")), SAME],
  ["catch", z.string().catch("fallback"), withFallback(type("string"), "fallback"), SAME, "needs the withFallback helper: ArkType cannot express it as a type"]
];

const report = [];
for (const [name, zodSchema, arkSchema, expectation, because] of cases) {
  test(`${name}: ${expectation === SAME ? "Zod and ArkType agree" : "they differ, as documented"}`, () => {
    const disagreements = compare(zodSchema, arkSchema);
    report.push({ name, expectation, disagreements: disagreements.length, because, examples: disagreements.slice(0, 4) });
    if (expectation === SAME) assert.deepEqual(disagreements.slice(0, 4), [], `${name} was declared the same but disagrees on ${disagreements.length} inputs`);
    else assert.ok(disagreements.length > 0, `${name} was declared to differ but agrees everywhere: ${because}`);
  });
}

test.after(() => {
  if (process.env.DETAIL) for (const entry of report.filter(e => e.disagreements > 0)) console.log(`# DETAIL ${entry.name} [${entry.disagreements}]: ${JSON.stringify(entry.examples)}`);
  const differing = report.filter(entry => entry.expectation !== SAME);
  console.log(`# ${report.length - differing.length} pairs agree, ${differing.length} differ (each with what to do):`);
  for (const entry of differing) console.log(`#   ${entry.name} [${entry.disagreements} inputs]: ${entry.because}`);
});
