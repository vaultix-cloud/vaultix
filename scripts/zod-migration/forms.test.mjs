// Do forms behave the same when zodResolver is replaced by Standard Schema and an ArkType schema, on the React Hook
// Form version the frontend locks (7.56.3, React 18.3.1)? Three resolver generations are mounted on real forms in a
// DOM, side by side: @hookform/resolvers 3.9.1 (what the frontend runs, zodResolver), 5.2.2 (the first with
// standardSchemaResolver and no Zod peer) and 7.0.6 (current; its optional Zod peer wants 3.25 or newer).
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { JSDOM } from "jsdom";
import { type } from "arktype";
import { z } from "zod";
import { standardSchemaResolver as standard7 } from "@hookform/resolvers/standard-schema";
import { standardSchemaResolver as standard5 } from "@hookform/resolvers-5/standard-schema";
import { zodResolver } from "@hookform/resolvers-3/zod";
import { coerceNumber, shape, zodEmail } from "./helpers.mjs";

// ---- a DOM for React Hook Form ----
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import("react")).default;
const { useForm } = await import("react-hook-form");
const { render, fireEvent, cleanup, waitFor, act } = await import("@testing-library/react");
const h = React.createElement;

// ---- the same signup form, written for each library ----
const zodSignup = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  age: z.coerce.number().int().min(18),
  nickname: z.string().trim().optional()
});
const arkSignup = shape({
  email: zodEmail,
  password: type("string >= 8"),
  age: coerceNumber.pipe(type("number.integer >= 18")),
  "nickname?": type("string.trim | undefined")
});

const resolvers = {
  "3.9.1 zodResolver": () => zodResolver(zodSignup),
  "5.2.2 standardSchemaResolver + ArkType": () => standard5(arkSignup),
  "7.0.6 standardSchemaResolver + ArkType": () => standard7(arkSignup)
};

const run = async (resolver, values) => {
  const result = await resolver(values, undefined, { fields: {}, criteriaMode: "firstError", shouldUseNativeValidation: false });
  const flat = (errors, prefix = "") => Object.entries(errors ?? {}).flatMap(([key, error]) => (error && typeof error === "object" && "message" in error ? [[`${prefix}${key}`, error.type]] : flat(error, `${prefix}${key}.`)));
  return { values: result.values, errors: Object.fromEntries(flat(result.errors)), messages: Object.fromEntries(flat(result.errors).map(([path]) => [path, path.split(".").reduce((node, part) => node?.[part], result.errors).message])) };
};

const cases = [
  ["valid", { email: "a@b.co", password: "longenough", age: "30", nickname: "  Al  " }],
  ["valid, nickname empty string", { email: "a@b.co", password: "longenough", age: "30", nickname: "" }],
  ["bad email", { email: "nope", password: "longenough", age: "30" }],
  ["password exactly 7 (one short)", { email: "a@b.co", password: "1234567", age: "30" }],
  ["password exactly 8 (the minimum)", { email: "a@b.co", password: "12345678", age: "30" }],
  ["age exactly 18 (the minimum)", { email: "a@b.co", password: "longenough", age: "18" }],
  ["age 17.9", { email: "a@b.co", password: "longenough", age: "17.9" }],
  ["age 18.5 (not an integer)", { email: "a@b.co", password: "longenough", age: "18.5" }],
  ["email with a hyphen-led label (refused by Zod's rule, so refused here)", { email: "a@-b.co", password: "longenough", age: "30" }],
  ["short password", { email: "a@b.co", password: "short", age: "30" }],
  ["under age", { email: "a@b.co", password: "longenough", age: "17" }],
  ["age not a number", { email: "a@b.co", password: "longenough", age: "abc" }],
  ["age empty (Zod coerces '' to 0)", { email: "a@b.co", password: "longenough", age: "" }],
  ["everything empty", { email: "", password: "", age: "", nickname: "" }],
  ["missing keys", {}],
  ["explicit undefined nickname", { email: "a@b.co", password: "longenough", age: "30", nickname: undefined }]
];

test("which fields fail, and with which kind of error, is the same for zodResolver and Standard Schema + ArkType", async () => {
  const reference = resolvers["3.9.1 zodResolver"]();
  const mismatches = [];
  for (const [name, values] of cases) {
    const expected = await run(reference, structuredClone(values));
    for (const [label, make] of Object.entries(resolvers).slice(1)) {
      const actual = await run(make(), structuredClone(values));
      if (JSON.stringify(Object.keys(expected.errors).sort()) !== JSON.stringify(Object.keys(actual.errors).sort())) mismatches.push({ case: name, resolver: label, zodFields: Object.keys(expected.errors), arkFields: Object.keys(actual.errors) });
      if (Object.keys(expected.errors).length === 0 && JSON.stringify(expected.values) !== JSON.stringify(actual.values)) mismatches.push({ case: name, resolver: label, zodValues: expected.values, arkValues: actual.values });
    }
  }
  assert.deepEqual(mismatches, [], JSON.stringify(mismatches.slice(0, 3)));
});

test("resolvers 5.2.2 and 7.0.6 return identical results for ArkType, on every case", async () => {
  for (const [name, values] of cases) {
    const five = await run(resolvers["5.2.2 standardSchemaResolver + ArkType"](), structuredClone(values));
    const seven = await run(resolvers["7.0.6 standardSchemaResolver + ArkType"](), structuredClone(values));
    assert.deepEqual(seven, five, name);
  }
});

test("a successful submit hands the form the parsed values: numbers coerced, text trimmed (as Zod does)", async () => {
  const [, valid] = cases[0];
  const zodOut = (await run(resolvers["3.9.1 zodResolver"](), valid)).values;
  const arkOut = (await run(resolvers["7.0.6 standardSchemaResolver + ArkType"](), valid)).values;
  assert.deepEqual(arkOut, zodOut);
  assert.equal(arkOut.age, 30);
  assert.equal(arkOut.nickname, "Al");
});

// ---- the words a person sees ----
test("the messages DIFFER, and ArkType's can repeat what was typed: a password field needs its own message", async () => {
  const [, bad] = cases[3];
  const zod = (await run(resolvers["3.9.1 zodResolver"](), bad)).messages.password;
  const ark = (await run(resolvers["7.0.6 standardSchemaResolver + ArkType"](), bad)).messages.password;
  console.log(`# message for a short password: Zod "${zod}" | ArkType "${ark}"`);
  assert.notEqual(ark, zod, "the wording is not the same, so any test or screen that matches the text must change");
  // a pattern rule echoes the input in ArkType's default text
  const echoing = standard7(shape({ password: type("string").and(/^[A-Za-z]+$/) }));
  const typed = "hunter2-secret";
  const text = (await run(echoing, { password: typed })).messages.password;
  assert.ok(text.includes(typed), `ArkType's default message repeated the typed value: "${text}"`);
  // and a configured message does not
  const safe = standard7(shape({ password: type("string").and(/^[A-Za-z]+$/).configure({ message: "Use letters only." }) }));
  const safeText = (await run(safe, { password: typed })).messages.password;
  assert.equal(safeText, "Use letters only.");
  assert.ok(!safeText.includes(typed));
});

test("a cross-field rule can name the field it blames, as Zod's refine({ path }) does", async () => {
  const zodPair = z.object({ password: z.string(), confirm: z.string() }).refine(v => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });
  const arkPair = shape({ password: "string", confirm: "string" }).narrow((value, context) => value.password === value.confirm || context.reject({ expected: "the same as the password", path: ["confirm"], message: "Passwords do not match" }));
  const z1 = await run(zodResolver(zodPair), { password: "a", confirm: "b" });
  const a1 = await run(standard7(arkPair), { password: "a", confirm: "b" });
  assert.deepEqual(Object.keys(a1.errors), Object.keys(z1.errors));
  assert.deepEqual(Object.keys(a1.errors), ["confirm"]);
  assert.equal(a1.messages.confirm, "Passwords do not match");
  assert.equal((await run(standard7(arkPair), { password: "a", confirm: "a" })).errors.confirm, undefined);
});

test("nested objects and arrays report errors at the same paths", async () => {
  const zodNested = z.object({ address: z.object({ street: z.string().min(1) }), items: z.array(z.object({ name: z.string().min(1) })) });
  const arkNested = shape({ address: shape({ street: "string > 0" }), items: shape({ name: "string > 0" }).array() });
  const values = { address: { street: "" }, items: [{ name: "ok" }, { name: "" }] };
  const z1 = await run(zodResolver(zodNested), structuredClone(values));
  const a1 = await run(standard7(arkNested), structuredClone(values));
  assert.deepEqual(Object.keys(a1.errors).sort(), Object.keys(z1.errors).sort());
  assert.deepEqual(Object.keys(a1.errors).sort(), ["address.street", "items.1.name"]);
});

// ---- real React Hook Form, real inputs, a real submit ----
function SignupForm({ makeResolver, onValid }) {
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: makeResolver(), defaultValues: { email: "", password: "", age: "", nickname: "" } });
  return h("form", { "aria-label": "signup", onSubmit: handleSubmit(onValid) },
    ...["email", "password", "age", "nickname"].flatMap(name => [
      h("input", { key: name, "aria-label": name, ...register(name) }),
      errors[name] ? h("p", { key: `${name}-error`, role: "alert", "data-field": name }, errors[name].message) : null
    ]),
    h("button", { type: "submit" }, "Create account"));
}

async function submit(makeResolver, typed) {
  const received = [];
  const view = render(h(SignupForm, { makeResolver, onValid: values => received.push(values) }));
  for (const [name, value] of Object.entries(typed)) fireEvent.change(view.getByLabelText(name), { target: { value } });
  await act(async () => { fireEvent.submit(view.getByRole("form", { name: "signup" })); });
  await waitFor(() => assert.ok(received.length > 0 || view.queryAllByRole("alert").length > 0));
  const alerts = view.queryAllByRole("alert").map(node => node.getAttribute("data-field"));
  cleanup();
  return { received, alerts };
}

for (const [label, make] of Object.entries(resolvers)) {
  test(`a real form with ${label}: invalid input shows an alert per bad field and does not submit`, async () => {
    const { received, alerts } = await submit(make, { email: "nope", password: "short", age: "17", nickname: "" });
    assert.deepEqual(received, []);
    assert.deepEqual(alerts.sort(), ["age", "email", "password"]);
  });
  test(`a real form with ${label}: valid input submits the parsed values and shows no alert`, async () => {
    const { received, alerts } = await submit(make, { email: "a@b.co", password: "longenough", age: "30", nickname: "  Al  " });
    assert.deepEqual(alerts, []);
    assert.deepEqual(received, [{ email: "a@b.co", password: "longenough", age: 30, nickname: "Al" }]);
  });
}

after(() => dom.window.close());
