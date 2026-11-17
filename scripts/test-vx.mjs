// Runs the new core's tests (kernel) against a disposable Postgres: starts one on a
// random loopback port, runs `cargo test`, and removes it. Nothing here touches another database.
//
// Usage: node scripts/test-vx.mjs [cargo test arguments]
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startTestPostgres } from "./lib/test-postgres.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../kernel");

let status = 1;
let database;
try {
  database = await startTestPostgres();
  const result = spawnSync("cargo", ["test", "--workspace", ...process.argv.slice(2)], {
    cwd: workspace, stdio: "inherit", windowsHide: true,
    env: { ...process.env, VX_TEST_DATABASE_URL: database.url }
  });
  status = result.status ?? 1;
} catch (error) {
  console.error(`vx tests: ${error.message}`);
} finally {
  database?.stop();
}
process.exit(status);
