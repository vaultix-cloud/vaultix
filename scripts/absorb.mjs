// Land a branch on main and leave nothing behind (docs/0145).
//
//   node scripts/absorb.mjs <branch>             verify the full-tier receipt (run the gate if there is none), push, clean up, verify
//   node scripts/absorb.mjs <branch> --update    merge origin/main into the branch first when it is behind
//   node scripts/absorb.mjs <branch> --no-run    never run the gate; only land a branch that already has a passing receipt
//   node scripts/absorb.mjs --status             unresolved alerts
//   node scripts/absorb.mjs --hygiene            leftover branches and worktrees (git only; also raised as alerts)
//
// Exit 0: landed and verified. 1: stopped (nothing was deleted unless main already held the commit; the failure is an alert).
// There is no flag to skip the gate, ignore a rejection or force a push.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The tests run this against a temporary repository; that is only possible with VX_GATE_TEST=1 (the same switch the gate has).
const repoRoot = process.env.VX_GATE_TEST === "1" && process.env.VX_GATE_ROOT ? resolve(process.env.VX_GATE_ROOT) : scriptRoot;
const bootstrap = spawnSync(process.execPath, [resolve(scriptRoot, "scripts/gate/ensure-deps.mjs"), "kernel/contracts/documents"], { stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
if (bootstrap.status !== 0) { console.error("absorb: the documents package's dependencies could not be installed, and absorb needs them"); process.exit(2); }
const { absorb } = await import("./gate/absorb.mjs");
const { list } = await import("./gate/alerts.mjs");
const { syncHygiene } = await import("./gate/hygiene.mjs");
const { describe } = await import("./gate/poke.mjs");

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const branch = args.find(arg => !arg.startsWith("--"));

if (flag("--status")) {
  const text = describe(list(repoRoot));
  console.log(text || "absorb: no unresolved alerts");
  process.exit(text ? 1 : 0);
}
if (flag("--hygiene")) {
  const items = syncHygiene(repoRoot);
  for (const item of items) console.log(`${item.problem.padEnd(18)} ${item.ref}`);
  console.log(items.length ? `absorb: ${items.length} leftover item(s)` : "absorb: nothing left over");
  process.exit(items.length ? 1 : 0);
}
if (!branch) { console.error("usage: node scripts/absorb.mjs <branch> [--update] [--no-run] | --status | --hygiene"); process.exit(2); }

const result = await absorb({ root: repoRoot, branch, update: flag("--update"), runGate: !flag("--no-run") });
for (const note of result.notes) console.log(`absorb: ${note}`);
if (result.ok) {
  console.log(`absorb: ${branch} landed on main at ${result.head.slice(0, 8)}; the remote branch, the local branch and the worktree are gone, and that was checked`);
  process.exit(0);
}
console.error(`absorb: STOPPED at ${result.stage}: ${result.observed}`);
console.error("absorb: fix the source; do not change the expectation, ceiling, baseline or snapshot to match. The failure is an alert (node scripts/absorb.mjs --status) and stays until the branch lands.");
process.exit(1);
