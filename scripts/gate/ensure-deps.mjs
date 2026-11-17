// Installs the JavaScript dependencies a gate check needs, only when they are missing or the lockfile changed.
//
//   node scripts/gate/ensure-deps.mjs <directory>...        (directories relative to the repository root)
//
// A fresh checkout has no node_modules anywhere, so without this a check fails with "Cannot find package" and the gate cannot be
// green on a clean machine or in CI. `npm ci` installs exactly what package-lock.json says; it is skipped when a marker written
// after the last successful install matches the lockfile's hash, so a second run costs nothing.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directories = process.argv.slice(2);
if (directories.length === 0) { console.error("usage: node scripts/gate/ensure-deps.mjs <directory>..."); process.exit(2); }

let failed = false;
for (const directory of directories) {
  const cwd = resolve(root, directory);
  const lock = resolve(cwd, "package-lock.json");
  if (!existsSync(lock)) { console.error(`${directory}: there is no package-lock.json, so nothing pins what to install`); failed = true; continue; }
  const hash = createHash("sha256").update(readFileSync(lock)).digest("hex");
  const marker = resolve(cwd, "node_modules/.vx-lock-hash");
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === hash) { console.log(`${directory}: dependencies are up to date`); continue; }
  console.log(`${directory}: npm ci`);
  // On Windows npm is a .cmd file, which Node starts only through a shell; the arguments are fixed here.
  const result = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" });
  if (result.status !== 0) { console.error(`${directory}: npm ci failed`); failed = true; continue; }
  // A package with no dependencies gets no node_modules from npm ci, and the marker lives there.
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, `${hash}\n`);
}
process.exit(failed ? 1 : 0);
