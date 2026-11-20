// Starts a real kernel stack for tests: a disposable Postgres, a root key file, and `vaultixd`.
// Everything is removed by `stop()`. Nothing here touches another database or a running instance.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const exe = process.platform === "win32" ? ".exe" : "";
const sleep = ms => new Promise(done => setTimeout(done, ms));
const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024, ...options });

export const kernelBinary = (name, profile = "release") => resolve(root, "kernel/target", profile, name + exe);

const freePort = () => new Promise((done, fail) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => done(port)); });
  server.on("error", fail);
});

export async function startStack({ profile = "release", unsealed = true, provision = true, project = "payments", environment = "prod" } = {}) {
  const work = mkdtempSync(resolve(tmpdir(), "vx-stack-"));
  const pgName = `vx-stack-pg-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("hex");
  const children = [];
  const logs = [];
  const stop = () => { for (const child of children) { try { child.kill(); } catch { /* already gone */ } } docker(["rm", "-f", pgName]); };
  try {
    const started = docker(["run", "-d", "--rm", "--name", pgName, "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, "postgres:16.6-alpine"]);
    if (started.status !== 0) throw new Error(`Postgres did not start: ${started.stderr}`);
    for (let i = 0; i < 60 && docker(["exec", pgName, "pg_isready", "-U", "postgres"]).status !== 0; i += 1) await sleep(1000);
    await sleep(1500);
    const pgPort = docker(["port", pgName, "5432/tcp"]).stdout.trim().split("\n")[0].split(":").pop();

    const env = { ...process.env, VX_DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${pgPort}/postgres`, RUST_LOG: "info" };
    const setup = spawnSync(kernelBinary("vaultixd",profile),["setup-code"],{env,encoding:"utf8",windowsHide:true});
    if(setup.status!==0) throw new Error("setup-code failed");
    const setupCode=setup.stdout.trim();
    const credentials={email:"owner@example.test",password:randomBytes(24).toString("hex")};
    if (unsealed) {
      env.VX_ROOT_KEY_FILE = resolve(work, "root.key");
      if (spawnSync(kernelBinary("vaultixd", profile), ["init", "--key-file", env.VX_ROOT_KEY_FILE], { encoding: "utf8" }).status !== 0) throw new Error("init failed");
    }
    const port = await freePort();
    env.VX_LISTEN = `127.0.0.1:${port}`;
    const daemon = spawn(kernelBinary("vaultixd", profile), [], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    daemon.stdout.on("data", chunk => logs.push(chunk.toString()));
    daemon.stderr.on("data", chunk => logs.push(chunk.toString()));
    children.push(daemon);
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 100 && !up; i += 1) {
      try { up = (await fetch(`${base}/healthz`)).ok; } catch { await sleep(100); }
    }
    if (!up) throw new Error(`vaultixd did not start:\n${logs.join("").slice(-1500)}`);
    let session=null,otherSession=null;
    const auth=async(path,body)=>{
      const response=await fetch(`${base}/api/vx/v1/auth/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      if(!response.ok)throw new Error(`Auth fixture ${path} failed (${response.status})`);
      return response.json();
    };
    if(provision){
      await auth("setup",{...credentials,setupCode,organizationName:"Test organization",project,environment});
      session=await auth("sessions",credentials);otherSession=await auth("sessions",credentials);
    }
    return {
      base, token:session?.bearer, otherToken:otherSession?.bearer, session, setupCode, credentials, pgName, logs, work, rootKeyText: unsealed ? readFileSync(env.VX_ROOT_KEY_FILE, "utf8").trim() : null,
      psql: sql => docker(["exec", pgName, "psql", "-U", "postgres", "-At", "-c", sql]),
      stop
    };
  } catch (error) { stop(); throw error; }
}
