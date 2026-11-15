# 0137: Retiring Zod, from measurements

**Status:** direction set by the owner 2026-11-15 ("Zod fully replaced, ArkType authored, not rushed but truly thought
out"); first phase done. **Builds on:** 0136 (schemas, ArkType, the gates). Nothing here has converted a Zod
file yet. This document is the evidence and the method, so that when files do convert, nothing changes quietly.

## 1. What Zod is doing here (`node scripts/zod-census.mjs`)

2,065 tracked files import Zod or one of its adapters.

| Where | Files | Of which a plain shape | Of which need a decision |
| --- | --- | --- | --- |
| `db/` (generated table schemas, migrations) | 281 | 258 | 23 |
| `platform/engine/backend/` (routes, services) | 1,111 | 679 | 432 |
| `platform/engine/frontend/` | 671 | 75 | 596 |
| elsewhere in the engine | 2 | 1 | 1 |

"Plain shape" means the file uses only objects, strings, numbers, booleans, arrays, enums, literals, unions, optional,
nullable, default, length bounds and the usual string formats. "Needs a decision" means it uses something whose
behaviour does not map one to one: `refine` (263 files), `superRefine` (154), `transform` (126), `coerce` (190),
`discriminatedUnion` (252), `nativeEnum` (335), `catch` (109), or an integration: `zodResolver` (399 files),
`zodValidator` (116), the Fastify type provider, or the OpenAPI generator. Zod's types, `z.infer`, appear in 1,220 files.

Zod does four different jobs, and each wants a different replacement:

| Job | Files | Where it goes |
| --- | --- | --- |
| Row schemas generated from the database | 280 under `db/schemas` | The Rust store's types (`vx-store`); they are produced by a generator, not written |
| API validation and OpenAPI for Fastify routes | 1,111 | The Rust contract (docs/0136), one domain at a time, as each route moves |
| Forms (`zodResolver`) | 399 | ArkType forms, as each screen is rewritten or converted |
| Route search parameters (`zodValidator`) | 116 | TanStack Router's `validateSearch`, which takes an ArkType type directly |

## 2. What "fully replaced" costs, and the two ways to get there

The count reaches zero only when all four jobs are gone. The backend and `db/` (1,392 files) belong to the Node
backend that the Rust kernel replaces domain by domain (docs/0134). The frontend (671 files) stays.

| | A. Delete the backend with its domains; convert the frontend | B. Convert the backend and `db/` first as well |
| --- | --- | --- |
| Zod reaches zero when | the last Node domain moves into the kernel, and the frontend is converted | the whole conversion is done |
| Conversion work | 671 frontend files | 2,065 files, 1,392 of them code that is about to be deleted |
| Risk | none to code that is deleted | 1,392 files change behaviour for no lasting gain |

**Recommendation: A.** The ceiling (`scripts/check-zod-ceiling.mjs`) falls with every deleted domain, and the
frontend is converted with proof. B reaches the same end state, earlier on paper and later in practice, because
the conversion time competes with moving the domains. If the owner wants B, the same tooling serves it.

## 3. Is ArkType the same as Zod? (`scripts/zod-migration/equivalence.test.mjs`)

Both libraries run over one corpus of awkward inputs (NaN, empty and huge strings, emoji, arrays where objects are
expected, dates, class instances, missing and undefined keys, emails, UUIDs, URLs and timestamps) and are compared on
whether a value is accepted and on the value that comes out. Zod is 3.24.1 (the frontend's version), ArkType 2.2.9.
78 tests: **66 pairs agree and 12 differ**, each difference with what a converter must do. Several first guesses were
wrong when measured (ArkType also rejects `NaN`, and also rejects an invalid `Date`), which is the reason to measure.

What differs, and the rule that follows:

| Construct | The difference | The rule |
| --- | --- | --- |
| Any object type | ArkType treats an array, and a `Date`, `Map`, `Set` or function, as an object, so a schema with no required key accepts `[]` and, with unknown keys deleted, turns `[1]` into a hole | Every converted object and record carries the guard (`value` is a non-null, non-array, non-Date, non-Map, non-Set, non-thenable object) |
| Unknown keys | Zod drops them from the result; ArkType keeps them | Use `onUndeclaredKey("delete")` to match Zod's default; `reject` for `.strict()` |
| Optional keys | ArkType's `exactOptionalPropertyTypes` (on by default) rejects an explicit `undefined` that Zod accepts, which React form state and spreads produce | Write `string \| undefined`, or set it off once, globally |
| `default` | Zod defaults a missing key and an explicit `undefined`; ArkType only a missing key | Check what each caller passes |
| `email` | ArkType accepts `a@-b.co`; Zod does not | Keep Zod's pattern as a regex where behaviour must not change |
| `uuid` | Zod accepts any 8-4-4-4-12 hex; ArkType enforces RFC version and variant bits | Same: Zod's pattern, or tighten on purpose |
| `datetime` | Zod needs a full UTC timestamp; `string.date.iso` also takes a bare date, no zone, and offsets | An explicit RFC 3339 regex |
| `coerce.*` | Zod's `coerce.number` is `Number(x)`, so `''`, `null` and `true` become numbers; `coerce.boolean` is `Boolean(x)`, so the string `'false'` is true; ArkType's parsers are stricter | A faithful port where behaviour must not change; a deliberate stricter rule otherwise. The `'false'` case is almost never intended |
| `passthrough` | A surplus key whose value is `undefined` is dropped by Zod, kept by ArkType | Invisible once serialised |
| `catch` | ArkType refuses a union of two branches that both transform the same input | A `withFallback` helper (a function, not a type) |

Agreeing, so converted mechanically: strings and their length bounds and `regex`, `startsWith`, `endsWith`,
`includes`, `trim`, `toLowerCase`, `toUpperCase`; `url` (on this corpus); every number rule; booleans, null,
undefined, literals, enums, native enums, `any`, `unknown`, `date()`, `bigint`; arrays and their bounds; tuples;
`union`, `nullable`, `discriminatedUnion`; `strict`, `extend`, `pick`, `omit`, `partial`; `transform`, `refine`,
`preprocess`. "Agree" means agree on this corpus; the corpus is meant to grow whenever a new difference is found.

## 4. The method: convert, then prove

No file is converted by trusting the table. A converter will:

1. read a Zod schema and emit the ArkType form using the rules above, with the shared helpers (the guard,
   faithful `coerce`, `withFallback`, Zod's exact string patterns) imported from one module;
2. keep the old schema beside the new one until the file is proven;
3. derive inputs from the schema's own shape (valid values, each field removed or corrupted, boundary values, the
   awkward corpus) and run both, failing the conversion on any disagreement that is not a declared difference;
4. replace the call sites (`z.infer` becomes `typeof T.infer`, `zodResolver` the Standard Schema resolver,
   `zodValidator` removed) and delete the Zod import, lowering the ceiling in the same commit.

A file that uses `refine`, `transform` or `coerce` is converted by hand with the table beside it, and gets a test
that states the behaviour it relies on. The proof is the same fuzz that found the four defects in 0136.

## 5. Order

1. **Done:** the census, the equivalence suite, the ceiling and the migration-tooling exception.
2. **The shared helper module** and the converter, proven on the 75 plain-shape frontend files.
3. **Route search parameters** (116 files): small shapes, and TanStack Router needs no adapter.
4. **Forms** (399 files): needs `@hookform/resolvers` (the frontend is on 3.9.1; 7.0.6 is current) and its
   Standard Schema resolver checked against ArkType (section 6: verified at runtime, not yet in types).
5. **Types** (`z.infer`, 1,220 files): mechanical once the schemas have moved.
6. **Backend and `db/`:** deleted with their domains; the `generate:schema` generator is frozen, not converted.
7. **The last step:** remove `zod`, the adapters and `scripts/zod-migration/` from every `package.json`.

## 6. Verified (2026-11-15, `scripts/zod-migration/`, `npm test`: 103 tests; `npm run test:zod-versions`)

**Forms: `@hookform/resolvers` with ArkType, React Hook Form 7.56.3, React 18.3.1, in jsdom.** The same signup form
(16 input cases, nested and cross-field rules, a real submit) runs under zodResolver 3.9.1 (what the frontend runs),
and `standardSchemaResolver` 5.2.2 and 7.0.6 with ArkType. Failing fields, error types and parsed values agree, and
5.2.2 and 7.0.6 are identical. The version jump is therefore safe for ArkType forms. What the measurement found:

- **Resolver and Zod versions are coupled.** 5.1.1 to 5.2.2 `zodResolver` imports `zod/v4/core`, which Zod 3.24.1
  does not export (`ERR_PACKAGE_PATH_NOT_EXPORTED`). 3.9.1 to 5.1.0 and 5.9.2 to 7.0.6 run on 3.24.1 (7.0.6 checked by
  running it). So the frontend can go from 3.9.1 straight to 7.0.6 without bumping Zod, and must not stop at 5.2.x.
- Resolver 7.0.6 declares an optional Zod peer of 3.25 or newer, so installing it beside Zod 3.24.1 needs
  `legacy-peer-deps` (see `.npmrc` in the tooling). Bumping the frontend to Zod 3.25.76 (the backend's lock) removes that.
- **Messages differ and can echo what was typed.** ArkType's default text for a pattern failure repeats the input, so a
  password field with a rule must set `.configure({ message })` (tested). Any test or screen matching Zod's wording changes.
- Not verified: TypeScript types of `useForm` with a Standard Schema resolver (runtime only).

**Router: `@tanstack/react-router` 1.95.1 (the installed version).** Seven schemas copied from real route files, each ported
by these rules, run on the real router with 40 URLs: zero differences from `zodValidator`. The router takes the ArkType type
directly (Standard Schema, no adapter). Rules learned: a `.catch` on an object key is the default tuple
`[fallbackTo(type, x), "=", x]`. A latent quirk is kept on purpose: `z.coerce.string().catch("")` yields the text
`"undefined"` for a missing key (12 uses in 10 files); fixing it is a decision. Not verified: `validateSearch` typing.

**Backend Zod.** The backend locks 3.25.76 (not 3.22; the frontend locks 3.24.1). The equivalence suite now runs on 3.22.4,
3.24.1 and 3.25.76 (78 tests each, all agree with ArkType in the same way); only `datetime()` differs between releases,
and the faithful helper is per version.

Still open: the frontend's behaviour where a form depends on a difference above (each form needs reading, not a rule).
Zod 4 is current (4.6.7) and is not what the code runs; nothing here concerns it.
