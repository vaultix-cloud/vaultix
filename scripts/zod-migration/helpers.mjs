// The small set of ArkType helpers a converted file imports (docs/0137). They exist because ArkType and Zod disagree
// in the ways equivalence.test.mjs measures. They become one shared module of the converter.
import { type } from "arktype";

/**
 * What Zod calls an object. ArkType treats an array, a Date, a Map, a Set and a function as objects, so an object
 * type accepts them. JSON documents need only the array half of this (docs/0136); form and in-memory values need all.
 */
export const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Map) && !(value instanceof Set) && typeof value.then !== "function";

/** Zod's default object: unknown keys are dropped from the result. */
export const shape = definition => type(definition).onUndeclaredKey("delete").narrow(isObject);
/** z.object().strict(): unknown keys are an error. */
export const strictShape = definition => type(definition).onUndeclaredKey("reject").narrow(isObject);

/**
 * Zod's .catch(value) on one schema: any value the schema refuses becomes `value`. It is one morph from `unknown`, so it is
 * a real type (and a real Standard Schema), unlike a union of two morphs, which ArkType refuses.
 */
export const fallbackTo = (inner, value) => type("unknown").pipe(input => { const result = inner(input); return result instanceof type.errors ? value : result; });

/**
 * Zod's .catch(value) on an object KEY. A key that is missing must also become `value`, and ArkType only runs a type on a key
 * that is present, so this is a default tuple: [type that falls back, "=", the default for a missing key].
 */
export const catchKey = (inner, value) => [fallbackTo(inner, value), "=", value];

/** z.coerce.string(): exactly String(x). */
export const coerceString = type("unknown").pipe(value => String(value)).to("string");
/** z.coerce.string().optional(): undefined passes through, anything else is String(x). */
export const coerceStringOptional = type("unknown").pipe(value => (value === undefined ? undefined : String(value)));

/** z.coerce.number(): exactly Number(x), then a finite-or-not number check (NaN is refused, as in Zod). */
export const coerceNumber = type("unknown").pipe(value => Number(value)).to("number");

/**
 * Zod's own patterns, copied from the installed releases (identical in 3.22.4, 3.24.1 and 3.25.76). ArkType's built-in
 * string.email and string.uuid are different rules (equivalence.test.mjs), so a conversion that must not change
 * behaviour uses these.
 */
export const zodEmail = type("string").and(/^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i);
export const zodUuid = type("string").and(/^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i);
