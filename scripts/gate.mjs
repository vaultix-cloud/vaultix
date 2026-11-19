// The delivery gate (docs/0142): the one definition of green.
//
//   node scripts/gate.mjs                      the fast tier (what runs before every push)
//   node scripts/gate.mjs --full               the fast tier plus the full tier (what runs before a merge to main)
//   node scripts/gate.mjs --only id,id         just these checks (no receipt is written: a part is not a pass)
//   node scripts/gate.mjs --list               the checks, their tier and limits, and the known gaps
//   node scripts/gate.mjs --verify-receipt full   does a passing full-tier receipt exist for HEAD? (the merge guard)
//   node scripts/gate.mjs --install-hook       make `git push` run the fast tier
//
// A run writes a receipt (.gate/receipts/), one failure record per check that did not pass (.gate/failures/) and, for each, the
// message that would be emailed (.gate/outbox/). Check output is in .gate/logs/ and nowhere else. Exit status is 0 only when
// every check passed.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checks as realChecks, gaps } from "./gate/checks.mjs";
import { runChecks } from "./gate/run.mjs";
import { dockerAvailable, startTestPostgres } from "./lib/test-postgres.mjs";

// The gate validates its own documents with the documents package, which needs its dependencies. On a fresh checkout they are not
// installed, so the gate installs them first (a no-op when they are current) and only then loads the code that needs them.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bootstrap = spawnSync(process.execPath, [resolve(repoRoot, "scripts/gate/ensure-deps.mjs"), "kernel/contracts/documents"], { stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
if (bootstrap.status !== 0) { console.error("gate: the documents package's dependencies could not be installed, and the gate needs them"); process.exit(2); }
const { failureFor } = await import("./gate/failure.mjs");
const { announce, clearCheck } = await import("./gate/alerts.mjs");
const { assertValidReceipt, buildReceipt, readReceipt, verifyReceipt, writeReceipt } = await import("./gate/receipt.mjs");
const { command, fits, slug } = await import("../kernel/contracts/documents/src/gate-parts.ts");

// The gate's own tests run it against a temporary repository with fake checks. That is only possible with VX_GATE_TEST=1, and a
// receipt from such a run is in that temporary directory, so it can never stand for a real commit.
const testMode = process.env.VX_GATE_TEST === "1";
const root = testMode && process.env.VX_GATE_ROOT ? resolve(process.env.VX_GATE_ROOT) : repoRoot;
const checks = testMode && process.env.VX_GATE_CHECKS ? (await import(pathToFileURL(resolve(process.env.VX_GATE_CHECKS)).href)).checks : realChecks;
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const git = (...gitArgs) => spawnSync("git", gitArgs, { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim();

/** The registry is code, but it is validated like any other document: a typo in a check is an error here, not a skipped check. */
function validateRegistry(list) {
  const problems = [];
  const seen = new Set();
  for (const check of list) {
    if (!fits(slug, check.id)) problems.push(`check id "${check.id}" is not a slug`);
    if (seen.has(check.id)) problems.push(`check ${check.id} is listed twice`);
    seen.add(check.id);
    if (!fits(command, check.command)) problems.push(`check ${check.id}: its command is not a program from the allowed set and its arguments`);
    if (!["fast", "full"].includes(check.tier)) problems.push(`check ${check.id}: tier must be fast or full`);
    if (!Number.isInteger(check.timeoutSeconds) || check.timeoutSeconds < 1 || check.timeoutSeconds > 86400) problems.push(`check ${check.id}: it needs a time limit of 1 to 86400 seconds`);
    if (typeof check.expect !== "string" || !/^[\x20-\x7e]{1,300}$/.test(check.expect)) problems.push(`check ${check.id}: expect is one line of printable text, 300 characters at most`);
  }
  const byId = new Map(list.map(check => [check.id, check]));
  for (const check of list) {
    for (const id of check.after ?? []) {
      const earlier = byId.get(id);
      if (!earlier) problems.push(`check ${check.id}: it runs after ${id}, which is not a check`);
      else if (earlier.tier === "full" && check.tier === "fast") problems.push(`check ${check.id}: a fast check cannot wait for ${id}, which is in the full tier`);
    }
  }
  // A prerequisite cycle would leave its checks waiting for each other, so it is refused here.
  const visiting = new Set();
  const done = new Set();
  const cyclic = id => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const found = (byId.get(id)?.after ?? []).some(cyclic);
    visiting.delete(id);
    done.add(id);
    return found;
  };
  for (const check of list) if (cyclic(check.id)) { problems.push(`check ${check.id}: its prerequisites form a cycle`); break; }
  return problems;
}

/** The checks a run of `ids` needs: those, and everything they wait for, so `--only` never runs a check without what it relies on. */
function withPrerequisites(ids) {
  const wanted = new Set();
  const add = id => { if (wanted.has(id)) return; wanted.add(id); for (const earlier of checks.find(check => check.id === id)?.after ?? []) add(earlier); };
  ids.forEach(add);
  return checks.filter(check => wanted.has(check.id));
}

function install() {
  const hook = resolve(git("rev-parse", "--git-common-dir"), "hooks/pre-push");
  const body = "#!/bin/sh\n# Installed by `node scripts/gate.mjs --install-hook`: a push runs the fast tier and stops on red.\nexec node scripts/gate.mjs\n";
  writeFileSync(hook, body, { mode: 0o755 });
  console.log(`gate: a push now runs the fast tier (${hook})`);
}

const registryProblems = validateRegistry(checks);
if (registryProblems.length) { for (const problem of registryProblems) console.error(`gate: ${problem}`); process.exit(2); }

const tier = flag("--full") ? "full" : "fast";
const selected = checks.filter(check => tier === "full" || check.tier === "fast");
const idsFor = wanted => checks.filter(check => wanted === "full" || check.tier === "fast").map(check => check.id);

if (flag("--list")) {
  for (const check of checks) console.log(`${check.tier.padEnd(5)} ${check.id.padEnd(26)} ${String(check.timeoutSeconds).padStart(5)}s  ${check.title}`);
  console.log("\nknown gaps (not checks yet):");
  for (const gap of gaps) console.log(`  ${gap.id.padEnd(18)} ${gap.why}`);
  process.exit(0);
}
if (flag("--install-hook")) { install(); process.exit(0); }

const commit = git("rev-parse", "HEAD");
if (flag("--verify-receipt")) {
  const wanted = option("--verify-receipt") === "full" ? "full" : "fast";
  const receipt = readReceipt(root, commit, wanted) ?? (wanted === "fast" ? readReceipt(root, commit, "full") : null);
  const problems = receipt ? verifyReceipt(receipt, { commit, tier: wanted, expectedIds: idsFor(wanted) }) : [`there is no ${wanted}-tier receipt for ${commit.slice(0, 8)}; run: node scripts/gate.mjs${wanted === "full" ? " --full" : ""}`];
  if (problems.length) { for (const problem of problems) console.error(`gate: no passing ${wanted} receipt for ${commit.slice(0, 8)}: ${problem}`); process.exit(1); }
  console.log(`gate: a passing ${wanted}-tier receipt exists for ${commit.slice(0, 8)}`);
  process.exit(0);
}

const only = option("--only")?.split(",");
if (only) for (const id of only) if (!checks.some(check => check.id === id)) { console.error(`gate: there is no check "${id}"; see --list`); process.exit(2); }
const toRun = only ? withPrerequisites(only) : selected;

const clean = git("status", "--porcelain").length === 0;
const startedAt = new Date();
let database;
const provided = {};
const stopDatabase = () => { database?.stop(); database = undefined; };
process.on("SIGINT", () => { stopDatabase(); process.exit(130); });
process.on("SIGTERM", () => { stopDatabase(); process.exit(143); });

let results;
try {
  if (toRun.some(check => (check.needs ?? []).includes("postgres"))) {
    if (dockerAvailable()) { database = await startTestPostgres(); provided.postgres = database.url; }
    else console.warn("gate: Docker is not running, so checks that need Postgres will be skipped, and a skipped check is not a pass");
  }
  const jobs = Number(option("--jobs")) || Math.max(2, Math.min(4, Math.floor(cpus().length / 2)));
  console.log(`gate: ${tier} tier, ${toRun.length} checks, up to ${jobs} at a time, on ${commit.slice(0, 8)}${clean ? "" : " (uncommitted changes in the worktree)"}`);
  results = await runChecks(toRun, {
    root, jobs, provided, logDirectory: resolve(root, ".gate/logs"),
    onFinish: (check, result) => console.log(`${result.status.toUpperCase().padEnd(7)} ${check.id.padEnd(26)} ${result.seconds.toFixed(1).padStart(7)}s${result.exitCode !== undefined ? `  exit ${result.exitCode}` : ""}${result.reason ? `  ${result.reason}` : ""}`)
  });
} finally {
  stopDatabase();
}
const finishedAt = new Date();

// A failure is made loud (an alert every session sees, the outbox message, the webhook if configured). A check that passed clears the
// alerts it raised earlier: that is the only way an alert goes away.
for (const [index, check] of toRun.entries()) {
  if (results[index].status === "pass") { clearCheck(root, check.id); continue; }
  const record = failureFor(check, results[index], { commit, tier });
  if (!record) continue;
  const announced = await announce(root, record);
  console.log(`\n${check.id}: ${record.expected}\n  ${record.observed}; log ${record.logPath}\n  record ${announced.record.replace(root, ".")}; alert ${announced.key}${announced.webhook.sent ? "; webhook sent" : ""}`);
}
const skipped = results.filter(result => result.status === "skipped").length;

console.log("");
if (only) {
  console.log(`gate: ran ${toRun.length} of ${selected.length} checks; no receipt is written for part of a tier`);
} else {
  const receipt = buildReceipt({ commit, tier, startedAt, finishedAt, clean, results });
  assertValidReceipt(receipt);
  const path = writeReceipt(root, receipt);
  console.log(`gate: ${receipt.result.toUpperCase()} in ${((finishedAt - startedAt) / 1000).toFixed(1)}s; receipt ${path.replace(root, ".")}${clean ? "" : " (not clean: it will not stand for a merge)"}`);
}
if (gaps.length) console.log(`gate: ${gaps.length} known gaps are not checked (node scripts/gate.mjs --list): ${gaps.map(gap => gap.id).join(", ")}`);
if (skipped) console.log(`gate: ${skipped} checks were skipped; a skipped check is not a pass`);
process.exit(results.every(result => result.status === "pass") ? 0 : 1);
