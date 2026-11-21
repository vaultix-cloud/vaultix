// Real HTTP journey on a disposable Docker network, with loopback-only host
// publication. No credential or value is printed. This is not an egress proof.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

export async function proveKernelImage(image) {
  const network = `vx-image-${randomBytes(6).toString("hex")}`;
  const pg = `${network}-pg`, server = `${network}-server`, volume = `${network}-keys`;
  const password = randomBytes(24).toString("hex"), canary = randomBytes(32).toString("hex");
  const checks = [], containers = [];
  const docker = (args, label, allowFailure = false) => {
    const result = spawnSync("docker", args, { encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`Image proof: ${label} failed`);
    return result;
  };
  const check = (name, ok) => { if (!ok) throw new Error(`Image proof: ${name} failed`); checks.push(name); };
  const environment = name => ["-e", `VX_DATABASE_URL=postgres://postgres:${password}@${pg}:5432/${name}`, "-e", "VX_ROOT_KEY_FILE=/state/root.key", "-v", `${volume}:/state`, "--network", network];
  const wait = ms => new Promise(done => setTimeout(done, ms));
  let base;
  const request = async (path, status, { method = "GET", token, body } = {}) => {
    const response = await fetch(`${base}/api/vx/v1${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    if (response.status !== status) throw new Error(`Image proof: HTTP ${method} expected ${status}, got ${response.status}`);
    return response.json();
  };
  async function start(name, db) {
    containers.push(name);
    docker(["run", "-d", "--name", name, ...environment(db), "-p", "127.0.0.1::8210", image], "start kernel");
    const binding = docker(["port", name, "8210/tcp"], "read port").stdout.trim().split("\n")[0];
    base = `http://127.0.0.1:${binding.split(":").pop()}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* starting */ }
      await wait(200);
    }
    throw new Error("Image proof: kernel readiness timed out");
  }
  try {
    docker(["network", "create", network], "create network");
    docker(["volume", "create", volume], "create key volume");
    containers.push(pg);
    docker(["run", "-d", "--name", pg, "--network", network, "-e", `POSTGRES_PASSWORD=${password}`, "postgres:16.6-alpine"], "start Postgres");
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (docker(["exec", pg, "pg_isready", "-U", "postgres"], "Postgres readiness", true).status === 0) { ready = true; break; }
      await wait(500);
    }
    check("Postgres ready", ready);
    // Generate into a disposable volume, then give the non-root image uid access.
    docker(["run", "--rm", "--user", "0", "--network=none", "-v", `${volume}:/state`, image, "init", "--key-file", "/state/root.key"], "generate key");
    docker(["run", "--rm", "--user", "0", "--network=none", "-v", `${volume}:/state`, "--entrypoint", "sh", image, "-c", "chmod 600 /state/root.key && chown -R 10001:10001 /state"], "protect key");
    const setupCode = docker(["run", "--rm", ...environment("postgres"), image, "setup-code"], "issue setup code").stdout.trim();
    await start(server, "postgres");
    const credentials = { email: "owner@example.test", password };
    const scope = { project: "demo", environment: "dev" };
    const list = "/secrets?project=demo&environment=dev";
    await request(list, 401);
    await request("/auth/setup", 200, { method: "POST", body: { ...credentials, setupCode, organizationName: "Image proof", ...scope } });
    const token = (await request("/auth/sessions", 200, { method: "POST", body: credentials })).bearer;
    const other = (await request("/auth/sessions", 200, { method: "POST", body: credentials })).bearer;
    const reference = { ...scope, name: "API_TOKEN" };
    await request("/secrets", 200, { method: "PUT", token, body: { ...reference, value: canary } });
    const metadata = await request(list, 200, { token });
    check("metadata lists the secret without its value", JSON.stringify(metadata).includes("API_TOKEN") && !JSON.stringify(metadata).includes(canary));
    const injection = await request("/secrets/injections", 200, { method: "POST", token, body: { purpose: "image proof", secrets: [reference] } });
    const redeem = `/secrets/injections/${injection.handle}/redeem`;
    await request(redeem, 410, { method: "POST", token: other });
    const values = await request(redeem, 200, { method: "POST", token });
    check("redeem returns the actual stored value", JSON.stringify(values).includes(canary));
    await request(redeem, 410, { method: "POST", token });
    check("wrong session and repeated redemption denied", true);
    const audit = await request("/operate/audit/verify?chain=demo", 200, { token });
    check("audit chain verifies", audit.intact === true);
    await request("/auth/logout", 200, { method: "POST", token });
    await request(list, 401, { token });
    check("logout revokes access", true);
    docker(["run", "--rm", ...environment("postgres"), image, "backup", "--out", "/state/backup.vx"], "encrypted backup");
    docker(["exec", pg, "createdb", "-U", "postgres", "restored"], "create restore database");
    docker(["run", "--rm", ...environment("restored"), image, "restore", "--in", "/state/backup.vx"], "restore backup");
    await start(`${server}-restored`, "restored");
    const restored = (await request("/auth/sessions", 200, { method: "POST", body: credentials })).bearer;
    const restoredInjection = await request("/secrets/injections", 200, { method: "POST", token: restored, body: { purpose: "restore proof", secrets: [reference] } });
    const restoredValue = await request(`/secrets/injections/${restoredInjection.handle}/redeem`, 200, { method: "POST", token: restored });
    check("restored account can redeem the preserved secret", JSON.stringify(restoredValue).includes(canary));
    for (const name of [server, `${server}-restored`, pg]) {
      const logs = docker(["logs", name], "read logs");
      check(`${name === pg ? "database" : name === server ? "kernel" : "restored kernel"} logs exclude credentials and canary`, ![password, canary, token, other, setupCode, restored].some(value => (logs.stdout + logs.stderr).includes(value)));
    }
    return checks;
  } finally {
    for (const name of containers.reverse()) docker(["rm", "-f", name], "cleanup container", true);
    docker(["volume", "rm", volume], "cleanup volume", true);
    docker(["network", "rm", network], "cleanup network", true);
  }
}
