// Starts a disposable Postgres on a random loopback port, runs a command with VX_TEST_DATABASE_URL pointing at it, and removes it.
// For loops that run many test commands against one database (mutation checks, repeated drills):
//
//   node scripts/with-test-postgres.mjs -- sh -c "cd kernel && cargo test -p vx-recover"
//
// Nothing here touches another database. `node scripts/test-vx.mjs` is the same idea for the whole kernel workspace.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const separator = process.argv.indexOf("--");
if (separator < 0 || separator === process.argv.length - 1) {
  console.error("usage: node scripts/with-test-postgres.mjs -- <command> [args...]");
  process.exit(2);
}
const command = process.argv.slice(separator + 1);
const name = `vx-test-pg-${randomBytes(4).toString("hex")}`;
const password = randomBytes(16).toString("hex");
const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", windowsHide: true, ...options });

let status = 1;
try {
  const started = docker(["run", "-d", "--rm", "--name", name, "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=postgres", "postgres:16.6-alpine", "-c", "fsync=off", "-c", "max_connections=200"]);
  if (started.status !== 0) throw new Error(`Postgres did not start: ${started.stderr.trim()}`);
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    ready = docker(["exec", name, "pg_isready", "-U", "postgres"]).status === 0;
    if (!ready) await new Promise(done => setTimeout(done, 1000));
  }
  if (!ready) throw new Error("Postgres did not become ready");
  await new Promise(done => setTimeout(done, 1500));
  const port = docker(["port", name, "5432/tcp"]).stdout.trim().split("\n")[0].split(":").pop();
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", windowsHide: true, env: { ...process.env, VX_TEST_DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/postgres` } });
  status = result.status ?? 1;
} catch (error) {
  console.error(`with-test-postgres: ${error.message}`);
} finally {
  docker(["rm", "-f", name]);
}
process.exit(status);
