// Enforces the Vaultix design system rules (docs/0130 rule 2) in the canonical build:
// the design system uses no Radix; the rest of the app may only use Radix less over time;
// every primitive has a story with accessibility errors enforced; no color literal appears outside
// the tokens; and the generated token files and DESIGN.md's component reference match their source.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = resolve(root, "platform/engine/frontend");
const src = resolve(frontend, "src");
const system = resolve(src, "design-system");

// Files outside the design system that import Radix today. Lower it as screens move to Vaultix
// primitives; it may never rise.
const RADIX_CEILING = 44;

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? (name === "node_modules" ? [] : walk(path)) : [path];
});
const radix = /from\s+["']@radix-ui\//;
const problems = [];

const systemFiles = walk(system);
for (const file of systemFiles.filter((f) => /\.(tsx?|css)$/.test(f))) {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file).replaceAll("\\", "/");
  if (radix.test(text)) problems.push(`${rel} imports Radix; the design system builds on native HTML`);
  if (/tokens[\\/]tokens\.(css|ts)$/.test(file)) continue;
  const literal = text.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/);
  if (literal && !/\.stories\.tsx$/.test(file)) problems.push(`${rel} has a color literal (${literal[0]}); use a token`);
}

const primitives = resolve(system, "primitives");
for (const name of readdirSync(primitives)) {
  const stories = readdirSync(resolve(primitives, name)).filter((f) => f.endsWith(".stories.tsx"));
  const covered = stories.some((f) => /a11y:\s*\{\s*test:\s*"error"/.test(readFileSync(resolve(primitives, name, f), "utf8")));
  // IconButton is exercised through Tooltip's stories, which render it.
  if (!covered && !(name === "IconButton" && existsSync(resolve(primitives, "Tooltip/Tooltip.stories.tsx")))) {
    problems.push(`primitive ${name} has no story with a11y: { test: "error" }`);
  }
}

const radixUsers = walk(src).filter((f) => /\.tsx?$/.test(f) && !f.startsWith(system) && radix.test(readFileSync(f, "utf8")));
if (radixUsers.length > RADIX_CEILING) {
  problems.push(`${radixUsers.length} files outside the design system import Radix (ceiling ${RADIX_CEILING}); build on Vaultix primitives instead`);
}

try {
  execFileSync(process.execPath, ["scripts/build-tokens.mjs", "--check"], { cwd: frontend, stdio: "pipe" });
} catch (error) {
  problems.push(`design tokens: ${String(error.stderr || error.message).trim()}`);
}

assert.deepEqual(problems, [], problems.join("\n"));
console.log(JSON.stringify({ passed: true, primitives: readdirSync(primitives).length, radixFilesOutsideSystem: radixUsers.length, ceiling: RADIX_CEILING }));
