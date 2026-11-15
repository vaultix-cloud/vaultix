// A census of how Zod is used in the tracked source, to plan its replacement from facts (docs/0137).
// Counts files, the Zod constructors and modifiers in use, the integrations built on it, and which files hold
// only simple schemas that can convert mechanically versus ones that need a decision.
//
//   node scripts/zod-census.mjs            summary
//   node scripts/zod-census.mjs --json     the full data
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IMPORT = /from\s+["'](zod(\/[^"']*)?|@tanstack\/zod-adapter|@hookform\/resolvers\/zod|fastify-type-provider-zod|zod-validation-error|@asteasolutions\/zod-to-openapi)["']|require\(["']zod["']\)/;

const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 256 * 1024 * 1024 }).toString().split("\0").filter(file => SOURCE.test(file) && !file.startsWith("leftover/"));
const bucket = file => file.startsWith("platform/engine/backend/") ? "backend" : file.startsWith("platform/engine/frontend/") ? "frontend" : file.startsWith("platform/engine/") ? "engine-other" : file.split("/")[0];

// Features, from the least to the most demanding to convert.
const FEATURES = {
  // constructors
  object: /\bz\.object\(/g, string: /\bz\.string\(/g, number: /\bz\.number\(/g, boolean: /\bz\.boolean\(/g, array: /\bz\.array\(/g, enum: /\bz\.enum\(/g, nativeEnum: /\bz\.nativeEnum\(/g,
  literal: /\bz\.literal\(/g, union: /\bz\.union\(/g, discriminatedUnion: /\bz\.discriminatedUnion\(/g, record: /\bz\.record\(/g, tuple: /\bz\.tuple\(/g, any: /\bz\.any\(/g, unknown: /\bz\.unknown\(/g,
  date: /\bz\.date\(/g, bigint: /\bz\.bigint\(/g, lazy: /\bz\.lazy\(/g, intersection: /\bz\.intersection\(|\.and\(/g, instanceOf: /\bz\.instanceof\(/g, custom: /\bz\.custom\(/g, never: /\bz\.never\(/g, nullLiteral: /\bz\.null\(/g,
  coerce: /\bz\.coerce\./g, preprocess: /\bz\.preprocess\(/g, effects: /\bz\.ZodEffects|\bz\.ZodType|\bz\.ZodSchema|\bZodTypeAny/g,
  // modifiers that stay inside a schema
  optional: /\.optional\(\)/g, nullable: /\.nullable\(\)/g, nullish: /\.nullish\(\)/g, default: /\.default\(/g, min: /\.min\(/g, max: /\.max\(/g, length: /\.length\(/g, regex: /\.regex\(/g, email: /\.email\(/g, url: /\.url\(/g, uuid: /\.uuid\(/g, datetime: /\.datetime\(/g, int: /\.int\(/g, trim: /\.trim\(\)/g, describe: /\.describe\(/g,
  strict: /\.strict\(\)/g, passthrough: /\.passthrough\(\)/g, strip: /\.strip\(\)/g, partial: /\.partial\(/g, pick: /\.pick\(/g, omit: /\.omit\(/g, extend: /\.extend\(/g, merge: /\.merge\(/g, deepPartial: /\.deepPartial\(/g, keyof: /\.keyof\(\)/g, shape: /\.shape\b/g,
  // behaviour that has no plain ArkType equivalent and needs a decision
  refine: /\.refine\(/g, superRefine: /\.superRefine\(/g, transform: /\.transform\(/g, pipe: /\.pipe\(/g, catch: /\.catch\(/g, brand: /\.brand\(/g, readonly: /\.readonly\(\)/g,
  // using a schema
  parse: /\.(parse|parseAsync)\(/g, safeParse: /\.(safeParse|safeParseAsync)\(/g, infer: /\bz\.(infer|input|output)</g,
  // integrations
  zodResolver: /\bzodResolver\b/g, zodValidator: /\bzodValidator\b|\bzodSearchValidator\b/g, fastifyProvider: /fastify-type-provider-zod|\bserializerCompiler\b|\bvalidatorCompiler\b|\bjsonSchemaTransform\b/g,
  zodToOpenapi: /zod-to-openapi|\bextendZodWithOpenApi\b|\bOpenAPIRegistry\b|\.openapi\(/g, zodError: /\bZodError\b|\bzod-validation-error\b|fromZodError/g
};
const SIMPLE_ONLY = new Set(["object", "string", "number", "boolean", "array", "enum", "literal", "union", "record", "any", "unknown", "date", "nullLiteral", "optional", "nullable", "nullish", "default", "min", "max", "length", "regex", "email", "url", "uuid", "datetime", "int", "trim", "describe", "strict", "partial", "pick", "omit", "extend", "merge", "keyof", "infer", "parse", "safeParse", "tuple", "intersection", "never", "shape", "strip", "passthrough"]);
const NEEDS_DECISION = ["refine", "superRefine", "transform", "pipe", "preprocess", "coerce", "catch", "brand", "readonly", "lazy", "custom", "instanceOf", "effects", "discriminatedUnion", "nativeEnum", "deepPartial", "bigint", "zodResolver", "zodValidator", "fastifyProvider", "zodToOpenapi", "zodError"];

const byBucket = {};
const featureTotals = {};
const filesWithFeature = {};
const classification = { zero: [], simple: [], decision: [] };
let importers = 0;
let totalUses = 0;

for (const file of files) {
  let text;
  try { text = readFileSync(resolve(root, file), "utf8"); } catch { continue; }
  if (!IMPORT.test(text)) continue;
  importers += 1;
  const where = bucket(file);
  const entry = (byBucket[where] ??= { files: 0, uses: 0, decision: 0, simple: 0 });
  entry.files += 1;
  let blocking = [];
  for (const [name, pattern] of Object.entries(FEATURES)) {
    const count = (text.match(pattern) ?? []).length;
    if (!count) continue;
    featureTotals[name] = (featureTotals[name] ?? 0) + count;
    (filesWithFeature[name] ??= new Set()).add(file);
    if (SIMPLE_ONLY.has(name) && ["object", "string", "number", "boolean", "array"].includes(name)) { entry.uses += count; totalUses += count; }
    if (NEEDS_DECISION.includes(name)) blocking.push(name);
  }
  if (blocking.length) { entry.decision += 1; classification.decision.push({ file, because: blocking }); } else { entry.simple += 1; classification.simple.push(file); }
}

const sorted = Object.entries(featureTotals).sort((a, b) => b[1] - a[1]);
const result = {
  filesImportingZod: importers,
  byBucket,
  convertibleWithoutADecision: classification.simple.length,
  needADecision: classification.decision.length,
  featureUse: Object.fromEntries(sorted.map(([name, count]) => [name, { uses: count, files: filesWithFeature[name].size }])),
  decisionBreakdown: Object.fromEntries(NEEDS_DECISION.filter(name => filesWithFeature[name]).map(name => [name, filesWithFeature[name].size]).sort((a, b) => b[1] - a[1]))
};
if (process.argv.includes("--json")) { console.log(JSON.stringify({ ...result, decisionFiles: classification.decision.slice(0, 50) }, null, 1)); process.exit(0); }
console.log(JSON.stringify(result, null, 1));
