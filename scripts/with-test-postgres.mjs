// Starts a disposable Postgres on a random loopback port, runs a command with VX_TEST_DATABASE_URL pointing at it, and removes it.
// For loops that run many test commands against one database (mutation checks, repeated drills):
//
//   node scripts/with-test-postgres.mjs -- sh -c "cd kernel && cargo test -p vx-recover"
//
// Nothing here touches another database. `node scripts/test-vx.mjs` is the same idea for the whole kernel workspace.
import { spawnSync } from "node:child_process";
import { startTestPostgres } from "./lib/test-postgres.mjs";

const separator = process.argv.indexOf("--");
if (separator < 0 || separator === process.argv.length - 1) {
  console.error("usage: node scripts/with-test-postgres.mjs -- <command> [args...]");
  process.exit(2);
}
const command = process.argv.slice(separator + 1);

let status = 1;
let database;
try {
  database = await startTestPostgres();
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", windowsHide: true, env: { ...process.env, VX_TEST_DATABASE_URL: database.url } });
  status = result.status ?? 1;
} catch (error) {
  console.error(`with-test-postgres: ${error.message}`);
} finally {
  database?.stop();
}
process.exit(status);
