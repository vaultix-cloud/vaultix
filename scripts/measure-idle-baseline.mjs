// Idle baseline for one packaged image (docs/0132a, docs/0133 step 2). Starts a fresh disposable
// instance (database, cache, application) on an internal network with no outbound route, creates
// one owner, organization and project so the instance is realistic, lets it settle, then holds it
// with NO requests and measures what an unused instance costs: memory, CPU, network, cache commands
// and log lines per hour, plus start-up time and image size. Optional budgets fail the run, so the
// numbers become a test. Only counts, names and shapes are recorded: never queue payloads, values
// or credentials. The owner password and keys live in process memory and are never printed.
//
// Usage: node scripts/measure-idle-baseline.mjs <local-standalone-image> [options]
//   --hold-minutes N        quiet hold after settling (default 60)
//   --settle-seconds N      wait after setup before the first sample (default 120)
//   --sample-minutes N      interval for memory samples during the hold (default 5)
//   --out DIR               report directory (default .cache/idle-baseline-<time>)
//   --max-ops-per-sec N, --max-memory-mib N, --max-egress-mb-per-hour N, --max-log-lines-per-hour N
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDisposableImageHarness } from "./lib/disposable-image.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [image, ...rest] = process.argv.slice(2);
assert.ok(image, "Usage: node scripts/measure-idle-baseline.mjs <local-standalone-image> [options]");
const option = (name, fallback) => {
  const at = rest.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = rest[at + 1];
  assert.ok(value !== undefined && !value.startsWith("--"), `--${name} needs a value`);
  return value;
};
const number = (name, fallback) => {
  const value = option(name, undefined);
  if (value === undefined) return fallback;
  assert.ok(Number.isFinite(Number(value)) && Number(value) >= 0, `--${name} must be a number`);
  return Number(value);
};
const holdMinutes = number("hold-minutes", 60);
const settleSeconds = number("settle-seconds", 120);
const sampleMinutes = number("sample-minutes", 5);
const budgets = {
  opsPerSecond: number("max-ops-per-sec", undefined),
  memoryMiB: number("max-memory-mib", undefined),
  egressMBPerHour: number("max-egress-mb-per-hour", undefined),
  logLinesPerHour: number("max-log-lines-per-hour", undefined)
};

let phase = "image inspection";
const harness = createDisposableImageHarness(image, () => phase);
const { artifact, docker, container, ready, waitFor, createNetwork, request, cleanup } = harness;
const pause = ms => new Promise(done => setTimeout(done, ms));
const run = `vaultix-idle-${randomBytes(8).toString("hex")}`;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(root, option("out", `.cache/idle-baseline-${stamp}`));

const text = (id, args, options = {}) => {
  const result = docker(["exec", id, ...args], { allowFailure: true, ...options });
  return result.status === 0 ? result.stdout.toString() : null;
};
const firstNumber = (id, paths) => {
  for (const path of paths) {
    const value = text(id, ["cat", path]);
    if (value !== null && /^\d+/.test(value.trim())) return Number(value.trim().split(/\s+/)[0]);
  }
  return null;
};
const cpuMicroseconds = id => {
  const stat = text(id, ["cat", "/sys/fs/cgroup/cpu.stat"]);
  const match = stat?.match(/usage_usec\s+(\d+)/);
  if (match) return Number(match[1]);
  const nanoseconds = firstNumber(id, ["/sys/fs/cgroup/cpuacct/cpuacct.usage"]);
  return nanoseconds === null ? null : nanoseconds / 1000;
};
const network = id => {
  const table = text(id, ["cat", "/proc/net/dev"]);
  if (table === null) return null;
  let received = 0;
  let sent = 0;
  for (const line of table.split("\n").slice(2)) {
    const [name, counters] = line.split(":");
    if (!counters || name.trim() === "lo") continue;
    const fields = counters.trim().split(/\s+/).map(Number);
    received += fields[0];
    sent += fields[8];
  }
  return { received, sent };
};
const usage = id => ({
  memoryBytes: firstNumber(id, ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]),
  cpuMicroseconds: cpuMicroseconds(id),
  network: network(id)
});
const cacheNumbers = cache => {
  const info = text(cache, ["redis-cli", "INFO", "stats"]) ?? "";
  const field = key => Number(info.match(new RegExp(`${key}:(\\d+)`))?.[1] ?? NaN);
  const commands = {};
  for (const line of (text(cache, ["redis-cli", "INFO", "commandstats"]) ?? "").split("\n")) {
    const match = line.match(/^cmdstat_([^:]+):calls=(\d+)/);
    if (match) commands[match[1]] = Number(match[2]);
  }
  return { commands: field("total_commands_processed"), inputBytes: field("total_net_input_bytes"),
    outputBytes: field("total_net_output_bytes"), byCommand: commands };
};
const shape = line => {
  let message = line;
  try { message = JSON.parse(line).msg ?? line; } catch { /* plain text line */ }
  return String(message).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>").replace(/\d+/g, "N").slice(0, 100);
};
const snapshot = (services, label) => ({
  label, at: Date.now(),
  app: usage(services.app), db: usage(services.db), cache: { ...usage(services.cache), ...cacheNumbers(services.cache) }
});
const mib = bytes => (bytes === null ? null : Math.round((bytes / 1048576) * 10) / 10);
const perHour = (value, seconds) => Math.round((value / seconds) * 3600);

try {
  phase = "start-up";
  createNetwork(run);
  const dbName = `${run}-db`;
  const cacheName = `${run}-cache`;
  const databasePassword = randomBytes(24).toString("hex");
  const db = container(dbName, "postgres:16.6-alpine", [], { POSTGRES_USER: "vaultix", POSTGRES_DB: "vaultix", POSTGRES_PASSWORD: databasePassword });
  const cache = container(cacheName, "docker.dragonflydb.io/dragonflydb/dragonfly:v1.34.2",
    ["--default_lua_flags=allow-undeclared-keys", "--cache_mode=false", "--maxmemory=512mb", "--proactor_threads=2"]);
  await waitFor(() => docker(["exec", db, "pg_isready", "-U", "vaultix", "-d", "vaultix"], { allowFailure: true }).status === 0, "database readiness");
  await waitFor(() => docker(["exec", cache, "redis-cli", "ping"], { allowFailure: true }).status === 0, "cache readiness");
  const startedAt = Date.now();
  const app = container(`${run}-app`, artifact.id, [], {
    DB_CONNECTION_URI: `postgres://vaultix:${databasePassword}@${dbName}:5432/vaultix`,
    VAULTIX_CACHE_PROVIDER: "dragonfly", VAULTIX_CACHE_URL: `redis://${cacheName}:6379`,
    ENCRYPTION_KEY: randomBytes(16).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"),
    SITE_URL: "http://127.0.0.1:8200", TELEMETRY_ENABLED: "false", DISABLE_UPDATE_CHECK: "true"
  });
  await ready(app);
  const startToReadySeconds = Math.round((Date.now() - startedAt) / 100) / 10;
  const services = { app, db, cache };
  const imageBytes = Number(harness.output(["image", "inspect", "--format", "{{.Size}}", artifact.id]));

  phase = "setup";
  const password = `Vx9!${randomBytes(24).toString("hex")}`;
  const owner = await request(app, "/api/v1/admin/signup", { method: "POST",
    body: { email: `${run}@vaultix.invalid`, password, firstName: "Idle", organizationName: "Idle Org" } });
  const { token } = await request(app, "/api/v3/auth/select-organization", { method: "POST", token: owner.token,
    body: { organizationId: owner.organization.id } });
  await request(app, "/api/v1/projects", { method: "POST", token, body: { projectName: "Idle Project" } });
  console.log(`Idle baseline: ready in ${startToReadySeconds}s, owner and project created; settling ${settleSeconds}s`);

  phase = "settle";
  await pause(settleSeconds * 1000);
  const settledAt = new Date();
  const first = snapshot(services, "start of hold");
  console.log(`Idle baseline: holding ${holdMinutes} minute(s) with no requests`);

  phase = "hold";
  const memory = [{ minute: 0, appMiB: mib(first.app.memoryBytes), dbMiB: mib(first.db.memoryBytes), cacheMiB: mib(first.cache.memoryBytes) }];
  const holdMs = holdMinutes * 60_000;
  const stepMs = Math.max(sampleMinutes, 0.05) * 60_000;
  for (let elapsed = stepMs; elapsed < holdMs; elapsed += stepMs) {
    await pause(stepMs);
    const point = snapshot(services, "during hold");
    memory.push({ minute: Math.round(elapsed / 6000) / 10, appMiB: mib(point.app.memoryBytes), dbMiB: mib(point.db.memoryBytes), cacheMiB: mib(point.cache.memoryBytes) });
  }
  const wait = first.at + holdMs - Date.now();
  if (wait > 0) await pause(wait);
  const last = snapshot(services, "end of hold");
  const seconds = (last.at - first.at) / 1000;
  memory.push({ minute: Math.round(seconds / 6) / 10, appMiB: mib(last.app.memoryBytes), dbMiB: mib(last.db.memoryBytes), cacheMiB: mib(last.cache.memoryBytes) });

  phase = "analysis";
  const logResult = docker(["logs", "--since", settledAt.toISOString(), app], { allowFailure: true });
  const logLines = `${logResult.stdout}${logResult.stderr}`.split("\n").filter(Boolean);
  const shapes = {};
  for (const line of logLines) shapes[shape(line)] = (shapes[shape(line)] ?? 0) + 1;
  const commandDeltas = Object.entries(last.cache.byCommand)
    .map(([name, calls]) => [name, calls - (first.cache.byCommand[name] ?? 0)])
    .filter(([, calls]) => calls > 0).sort((a, b) => b[1] - a[1]);
  const queueNames = (text(cache, ["redis-cli", "--scan", "--pattern", "bull:*:meta"]) ?? "")
    .split("\n").filter(Boolean).map(key => key.split(":")[1]).sort();

  // Which queues and commands the idle traffic belongs to: a short MONITOR sample, reduced in memory
  // to queue names and command names. Arguments, values and payloads are discarded.
  const monitored = docker(["exec", cache, "timeout", "20", "redis-cli", "MONITOR"], { allowFailure: true, timeout: 40_000 });
  const attribution = { available: false, sampleSeconds: 20, byQueue: {}, byCommand: {} };
  const monitorLines = monitored.stdout.toString().split("\n").filter(line => /^\d+\.\d+ \[/.test(line));
  if (monitorLines.length > 0) {
    attribution.available = true;
    for (const line of monitorLines) {
      const command = line.match(/\] "([^"]+)"/)?.[1]?.toLowerCase() ?? "unknown";
      const queue = line.match(/bull:([^:"\s]+)/)?.[1] ?? "(no queue key)";
      attribution.byCommand[command] = (attribution.byCommand[command] ?? 0) + 1;
      attribution.byQueue[queue] = (attribution.byQueue[queue] ?? 0) + 1;
    }
  }

  const appCpuPercent = Math.round(((last.app.cpuMicroseconds - first.app.cpuMicroseconds) / (seconds * 1_000_000)) * 1000) / 10;
  const report = {
    image: { id: artifact.id, revision: artifact.revision, sizeMiB: mib(imageBytes) },
    takenAt: new Date().toISOString(), holdSeconds: Math.round(seconds), startToReadySeconds,
    scope: "One fresh instance, internal network, one owner and project, no requests during the hold",
    app: {
      memoryStartMiB: mib(first.app.memoryBytes), memoryEndMiB: mib(last.app.memoryBytes),
      memoryMaxMiB: Math.max(...memory.map(point => point.appMiB ?? 0)), cpuPercentAverage: appCpuPercent,
      networkReceivedMBPerHour: mib(perHour(last.app.network.received - first.app.network.received, seconds)),
      networkSentMBPerHour: mib(perHour(last.app.network.sent - first.app.network.sent, seconds))
    },
    database: { memoryEndMiB: mib(last.db.memoryBytes) },
    cache: {
      memoryEndMiB: mib(last.cache.memoryBytes), operationsPerSecond: Math.round(((last.cache.commands - first.cache.commands) / seconds) * 10) / 10,
      inputMBPerHour: mib(perHour(last.cache.inputBytes - first.cache.inputBytes, seconds)),
      outputMBPerHour: mib(perHour(last.cache.outputBytes - first.cache.outputBytes, seconds)),
      topCommands: commandDeltas.slice(0, 10).map(([name, calls]) => ({ name, perHour: perHour(calls, seconds) })),
      queues: queueNames, attribution
    },
    logs: { linesPerHour: perHour(logLines.length, seconds), topShapes: Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([message, count]) => ({ message, perHour: perHour(count, seconds) })) },
    memory
  };

  const failures = [];
  const over = (label, value, limit, unit) => { if (limit !== undefined && value > limit) failures.push(`${label} ${value} ${unit} is over the budget of ${limit}`); };
  over("Idle cache operations", report.cache.operationsPerSecond, budgets.opsPerSecond, "per second");
  over("Application memory", report.app.memoryMaxMiB, budgets.memoryMiB, "MiB");
  over("Application egress", report.app.networkSentMBPerHour, budgets.egressMBPerHour, "MB per hour");
  over("Log lines", report.logs.linesPerHour, budgets.logLinesPerHour, "per hour");
  report.budgets = { limits: budgets, failures };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Idle baseline: report written to ${outDir}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`Idle baseline: ${failure}`);
    process.exitCode = 1;
  }
} finally {
  const clean = cleanup();
  if (!clean) {
    console.error("Idle baseline: some disposable resources were not removed; list them with `docker ps -a --filter name=vaultix-idle`");
    process.exitCode = process.exitCode || 1;
  }
}
