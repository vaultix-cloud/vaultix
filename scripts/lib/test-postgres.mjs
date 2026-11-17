// A disposable Postgres for tests: started on a random loopback port with a random password, in a container that is removed
// when it stops. Nothing here touches another database. Used by scripts/gate.mjs, scripts/test-vx.mjs and
// scripts/with-test-postgres.mjs, so there is one way to start it and one way to remove it.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { connect } from "node:net";

/**
 * Ask Postgres a real protocol question through the host port, the way a client will: an SSLRequest, which a server answers with one
 * byte (S or N). `pg_isready` inside the container says the server is up; it does not say the port mapping Docker puts in front of
 * it is, and a client that connects in that gap is reset ("connection forcibly closed", os error 10054, seen on Windows).
 */
const answers = port => new Promise(done => {
  const socket = connect({ host: "127.0.0.1", port: Number(port) });
  const finish = ok => { socket.destroy(); done(ok); };
  socket.setTimeout(2000, () => finish(false));
  socket.on("error", () => finish(false));
  socket.on("connect", () => socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])));
  socket.on("data", data => finish(data[0] === 0x53 || data[0] === 0x4e));
});

const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", windowsHide: true, ...options });

/**
 * Start a Postgres and wait until it answers. Returns `{ name, url, stop }`; `url` is the admin URL the kernel's test support reads
 * as VX_TEST_DATABASE_URL. Always call `stop()` (in a `finally`): it removes the container.
 */
export async function startTestPostgres({ readySeconds = 60 } = {}) {
  const name = `vx-test-pg-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(16).toString("hex");
  const stop = () => { docker(["rm", "-f", name]); };
  const started = docker(["run", "-d", "--rm", "--name", name, "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=postgres", "postgres:16.6-alpine", "-c", "fsync=off", "-c", "max_connections=200"]);
  if (started.status !== 0) throw new Error(`Postgres did not start: ${(started.stderr || started.error?.message || "").trim()}`);
  try {
    let ready = false;
    for (let attempt = 0; attempt < readySeconds && !ready; attempt += 1) {
      ready = docker(["exec", name, "pg_isready", "-U", "postgres"]).status === 0;
      if (!ready) await new Promise(done => setTimeout(done, 1000));
    }
    if (!ready) throw new Error(`Postgres did not become ready within ${readySeconds}s`);
    const port = docker(["port", name, "5432/tcp"]).stdout.trim().split("\n")[0].split(":").pop();
    // Three answers in a row through the host port, not one lucky one.
    let answered = 0;
    for (let attempt = 0; attempt < readySeconds * 4 && answered < 3; attempt += 1) {
      answered = (await answers(port)) ? answered + 1 : 0;
      if (answered < 3) await new Promise(done => setTimeout(done, 250));
    }
    if (answered < 3) throw new Error(`Postgres is up but its port ${port} did not answer a client`);
    return { name, url: `postgres://postgres:${password}@127.0.0.1:${port}/postgres`, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

/** True when Docker is reachable, so a check that needs Postgres can say why it did not run. */
export const dockerAvailable = () => docker(["info", "--format", "{{.ServerVersion}}"]).status === 0;
