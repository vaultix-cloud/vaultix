// Runs the new core's tests (platform/engine/vx) against a disposable Postgres: starts one on a
// random loopback port, runs `cargo test`, and removes it. Nothing here touches another database.
//
// Usage: node scripts/test-vx.mjs [cargo test arguments]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(root, "platform/engine/vx");
const name = `vx-test-pg-${randomBytes(4).toString("hex")}`;
const password = randomBytes(16).toString("hex");
const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", windowsHide: true, ...options });

let status = 1;
try {
  const started = docker(["run", "-d", "--rm", "--name", name, "-p", "127.0.0.1::5432",
    "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=postgres", "postgres:16.6-alpine",
    "-c", "fsync=off", "-c", "max_connections=200"]);
  if (started.status !== 0) throw new Error(`Postgres did not start: ${started.stderr.trim()}`);
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    ready = docker(["exec", name, "pg_isready", "-U", "postgres"]).status === 0;
    if (!ready) await new Promise(done => setTimeout(done, 1000));
  }
  if (!ready) throw new Error("Postgres did not become ready");
  await new Promise(done => setTimeout(done, 1500));
  const port = docker(["port", name, "5432/tcp"]).stdout.trim().split("\n")[0].split(":").pop();
  const result = spawnSync("cargo", ["test", "--workspace", ...process.argv.slice(2)], {
    cwd: workspace, stdio: "inherit", windowsHide: true,
    env: { ...process.env, VX_TEST_DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/postgres` }
  });
  status = result.status ?? 1;
} catch (error) {
  console.error(`vx tests: ${error.message}`);
} finally {
  docker(["rm", "-f", name]);
}
process.exit(status);
