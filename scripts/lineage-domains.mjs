// Inherited code by domain: files and lines still byte-identical to the import (docs/0138). Ranks what to rewrite or delete.
// Usage: node scripts/lineage-domains.mjs [depth-root ...]   default: backend services, backend routes, frontend pages
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = a => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 1 << 29 });
const tree = ref => new Map(git(["ls-tree", "-r", "-z", ref]).split("\0").filter(Boolean).map(l => { const [m, p] = l.split("\t"); return [p, m.split(" ")[2]]; }));
const baseBlobs = new Set(tree("1da705e0").values());
const now = tree("HEAD");
const groups = process.argv.slice(2).length ? process.argv.slice(2) : [
  "platform/engine/backend/src/services", "platform/engine/backend/src/server/routes", "platform/engine/frontend/src/pages", "platform/engine/frontend/src/hooks/api"];
const code = /\.(ts|tsx|go|rs|sql)$/;
const rows = [];
for (const g of groups) {
  const by = new Map();
  for (const [path, blob] of now) {
    if (!path.startsWith(g + "/") || !code.test(path) || /\.(test|spec|stories)\./.test(path)) continue;
    const name = path.slice(g.length + 1).split("/")[0];
    const r = by.get(name) ?? { files: 0, identical: 0, lines: 0, identicalLines: 0 };
    let lines = 0; try { lines = readFileSync(resolve(root, path), "utf8").split("\n").length; } catch {}
    r.files++; r.lines += lines;
    if (baseBlobs.has(blob)) { r.identical++; r.identicalLines += lines; }
    by.set(name, r);
  }
  for (const [name, r] of by) rows.push({ group: g.replace("platform/engine/", ""), name, ...r });
}
rows.sort((a, b) => b.identicalLines - a.identicalLines);
console.log("group".padEnd(30), "domain".padEnd(34), "files", "ident", "lines".padStart(7), "identLines".padStart(10));
for (const r of rows.slice(0, 40)) console.log(r.group.padEnd(30), r.name.padEnd(34), String(r.files).padStart(5), String(r.identical).padStart(5), String(r.lines).padStart(7), String(r.identicalLines).padStart(10));
console.log(`... ${rows.length} domains; total identical lines ${rows.reduce((s, r) => s + r.identicalLines, 0)}`);
