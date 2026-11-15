// Runs the Zod-versus-ArkType equivalence suite against every Zod the code runs, then the Zod-to-Zod comparison.
// The frontend locks 3.24.1, the backend 3.25.76, and the backend's package.json asks for ^3.22.4.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failed = false;
for (const [label, alias] of [["3.22.4", "zod-3-22"], ["3.24.1 (frontend)", "zod"], ["3.25.76 (backend)", "zod-3-25"]]) {
  console.log(`\nZod ${label}`);
  const run = spawnSync(process.execPath, ["--test", "equivalence.test.mjs"], { cwd: here, stdio: "inherit", env: { ...process.env, ZOD_PACKAGE: alias } });
  failed ||= run.status !== 0;
}
console.log("\nZod against Zod");
failed ||= spawnSync(process.execPath, ["--test", "zod-versions.test.mjs"], { cwd: here, stdio: "inherit" }).status !== 0;
process.exit(failed ? 1 : 0);
