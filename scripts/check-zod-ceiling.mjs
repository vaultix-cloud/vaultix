// Zod is being retired (docs/0136). The inherited engine still uses it in many files; they go away
// as each domain moves to the kernel and as each screen is rewritten on the design system, not by a
// mass conversion of code that is about to be deleted. This gate makes that real:
//
//   * new code never imports Zod (the kernel, platform, control, and every new TypeScript file);
//   * the number of inherited files that still import it may only fall (the ceiling below).
//
// Lower CEILING when a count drops. Never raise it. Run with --write-count to see the current count.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodCandidates } from "./lib/zod-candidates.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Inherited files that import Zod or one of its adapters. Falls to 0.
const CEILING = 2065;

const IMPORT = /from\s+["'](zod(\/[^"']*)?|@tanstack\/zod-adapter|@hookform\/resolvers\/zod|fastify-type-provider-zod|zod-validation-error|@asteasolutions\/zod-to-openapi)["']|require\(["']zod["']\)/;
// New code is held to zero from the start.
const ZERO = /^(kernel|control|platform\/shippin)\//;
// The one place allowed to import Zod outside the inherited count: tooling whose job is to compare Zod with
// ArkType so Zod can be removed (docs/0137). It is not part of the product and goes when the count reaches zero.
const MIGRATION_TOOLING = /^scripts\/zod-migration\//;

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 256 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
// Git grep does not follow source symlinks. Refuse them rather than let a link
// bypass the import rule (ordinary source files remain the supported boundary).
const entries = execFileSync("git", ["ls-files", "--stage", "-z"], { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString().split("\0");
if (entries.some(entry => entry.startsWith("120000 ") && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.split("\t")[1] ?? ""))) {
  console.error("zod ceiling: tracked source symlinks must be replaced with ordinary source files");
  process.exit(1);
}
const importers = [];
for (const file of zodCandidates(root)) {
  let text;
  try { text = readFileSync(resolve(root, file), "utf8"); } catch { continue; }
  if (IMPORT.test(text)) importers.push(file);
}

const tooling = importers.filter(file => MIGRATION_TOOLING.test(file));
const counted = importers.filter(file => !MIGRATION_TOOLING.test(file));
const inNewCode = counted.filter(file => ZERO.test(file));
const inherited = counted.length - inNewCode.length;
const packageJsons = tracked.filter(file => ZERO.test(file) && file.endsWith("package.json")).filter(file => /"zod"|zod-adapter|resolvers\/zod/.test(readFileSync(resolve(root, file), "utf8")));

if (process.argv.includes("--write-count")) console.log(JSON.stringify({ inheritedFilesImportingZod: inherited, inNewCode: inNewCode.length }));

const problems = [];
if (inNewCode.length) problems.push(`New code imports Zod (use ArkType): ${inNewCode.slice(0, 5).join(", ")}`);
if (packageJsons.length) problems.push(`New packages depend on Zod: ${packageJsons.join(", ")}`);
if (inherited > CEILING) problems.push(`${inherited} inherited files import Zod, over the ceiling of ${CEILING}. It may only fall.`);
if (problems.length) {
  for (const problem of problems) console.error(`zod ceiling: ${problem}`);
  process.exit(1);
}
console.log(`zod ceiling: ${inherited} inherited files (ceiling ${CEILING}), 0 in new code, ${tooling.length} migration-tooling file(s)${inherited < CEILING ? `; lower the ceiling to ${inherited}` : ""}`);
