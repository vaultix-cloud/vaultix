// How much of the tree is still the inherited engine? Compares every tracked file with the import commit (docs/0138).
//   identical : the same bytes exist in the baseline (at any path, so a move does not hide it)
//   modified  : the path (after core/ -> platform/engine/) existed in the baseline with different bytes
//   authored  : neither; written here
// Usage: node scripts/lineage-census.mjs [--json] [--check]   (--check fails if inherited-identical rises above the ceiling)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = "1da705e0";
const CEILING_FILE = resolve(root, "scripts/lineage-ceiling.json");
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });

const tree = ref => new Map(git(["ls-tree", "-r", "-z", ref]).split("\0").filter(Boolean).map(line => {
  const [meta, path] = line.split("\t");
  return [path, meta.split(" ")[2]];
}));

const base = tree(BASELINE);
const baseBlobs = new Set(base.values());
const now = tree("HEAD");
const renamed = path => path.replace(/^platform\/engine\//, "core/");

const areaOf = path => {
  const parts = path.split("/");
  if (parts[0] === "platform" && parts[1] === "engine") return `platform/engine/${parts[2] ?? ""}`;
  if (["kernel", "control", "platform", "panel", "docs", "scripts"].includes(parts[0])) return parts[0] === "platform" ? `platform/${parts[1] ?? ""}` : parts[0];
  return "other";
};

const areas = new Map();
const total = { identical: 0, modified: 0, authored: 0 };
for (const [path, blob] of now) {
  const kind = baseBlobs.has(blob) ? "identical" : (base.has(path) || base.has(renamed(path))) ? "modified" : "authored";
  total[kind] += 1;
  const row = areas.get(areaOf(path)) ?? { identical: 0, modified: 0, authored: 0 };
  row[kind] += 1;
  areas.set(areaOf(path), row);
}

const report = { baseline: BASELINE, baselineFiles: base.size, files: now.size, ...total, areas: Object.fromEntries([...areas].sort((a, b) => b[1].identical - a[1].identical)) };
if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const pct = n => `${((100 * n) / now.size).toFixed(1)}%`;
console.log(`lineage vs ${BASELINE}: ${now.size} tracked files; ${total.identical} identical (${pct(total.identical)}), ${total.modified} modified (${pct(total.modified)}), ${total.authored} authored here (${pct(total.authored)})`);
for (const [area, row] of [...areas].sort((a, b) => b[1].identical - a[1].identical).slice(0, 12)) {
  console.log(`  ${area.padEnd(34)} identical ${String(row.identical).padStart(5)}  modified ${String(row.modified).padStart(5)}  authored ${String(row.authored).padStart(5)}`);
}

if (process.argv.includes("--check")) {
  let ceiling;
  try { ceiling = JSON.parse(readFileSync(CEILING_FILE, "utf8")).identical; } catch { console.error(`no ${CEILING_FILE}`); process.exit(1); }
  if (total.identical > ceiling) { console.error(`inherited-identical files rose: ${total.identical} > ceiling ${ceiling}`); process.exit(1); }
  console.log(`ceiling ${ceiling}: ok${total.identical < ceiling ? ` (lower the ceiling to ${total.identical})` : ""}`);
}
