// Building blocks for versioned documents.
//
// Two facts about ArkType shaped this file (both checked on 2.2.9, docs/0136):
//
//  1. Its length bound (`1 <= string <= 64`) counts UTF-16 code units, but JSON Schema and the Go server count
//     characters (code points). Forty emoji are forty characters and eighty units, so a native bound rejects a
//     name the schema and the server accept, and its JSON Schema export would say "characters" while meaning
//     "units". `characters()` counts code points.
//  2. A rule written as a function cannot be exported to JSON Schema on its own. Each such rule here carries
//     its own JSON Schema description (`json`), and the export reads it, so the exported schema says what the
//     rule enforces. An undescribed rule makes the export fail loudly.
import { type } from "arktype";
import type { Type } from "arktype";

/** Compile a pattern the way a JSON Schema validator does: with the `u` flag. */
export const pattern = (source: string): RegExp => new RegExp(source, "u");

type Check<T> = ((value: T, context: { mustBe: (expected: string) => false }) => boolean) & { json: Record<string, unknown> };

/** A rule with no ArkType keyword, with the JSON Schema fragment that describes it. */
export function rule<T>(check: (value: T) => boolean, expected: string, json: Record<string, unknown>): Check<T> {
  return Object.assign((value: T, context: { mustBe: (expected: string) => false }) => check(value) || context.mustBe(expected), { json });
}

/** A string of `min` to `max` characters (Unicode code points), as JSON Schema `minLength` and `maxLength` count them. */
export const characters = (min: number, max: number) =>
  type("string").narrow(rule((text: string) => { const length = [...text].length; return length >= min && length <= max; }, `${min} to ${max} characters`, { minLength: min, maxLength: max }));

/**
 * ArkType treats an array as an object, so an object type whose keys are all optional accepts `[]`, where JSON
 * Schema's `type: object` does not (found by the differential fuzz, docs/0136). Every object type ends with this.
 */
export const notArray = rule((value: unknown) => !Array.isArray(value), "an object, not an array", {});

/** An array whose items are all different (JSON Schema `uniqueItems`, by deep equality). */
export const unique = rule((items: readonly unknown[]) => new Set(items.map(item => JSON.stringify(item))).size === items.length, "no repeated items", { uniqueItems: true });

/** The portable form of a type: JSON Schema 2020-12 with an `$id`, for Go, Rust and anything else that reads JSON Schema. */
export function exportJsonSchema(documentId: string, schema: Type<any>, meta: { title: string; description: string }): Record<string, unknown> {
  const body = schema.toJsonSchema({
    fallback: (context: { code: string; base: Record<string, unknown>; predicate?: { json?: Record<string, unknown> }; pattern?: string }) => {
      // A string that must match two patterns: JSON Schema's `pattern` holds one, so the second goes in `allOf`.
      if (context.code === "patternIntersection" && context.pattern) {
        const existing = Array.isArray(context.base.allOf) ? context.base.allOf : [];
        return { ...context.base, allOf: [...existing, { pattern: context.pattern }] };
      }
      const json = context.code === "predicate" ? context.predicate?.json : undefined;
      if (!json) throw new Error(`${documentId}: a rule has no JSON Schema form (${context.code}); describe it with rule(..., json)`);
      return { ...context.base, ...json };
    }
  } as never) as Record<string, unknown>;
  const { $schema: _dropped, ...rest } = body;
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $id: `https://vaultix.cloud/schemas/${documentId}.schema.json`, title: meta.title, description: meta.description, ...rest };
}
