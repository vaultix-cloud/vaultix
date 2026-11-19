// Landing a branch: races, a rejected push, the lock, running from inside the worktree being deleted (docs/0145).
// Real git repositories from absorb-world.mjs; each test file runs in its own process, so they run side by side.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { FIX_THE_SOURCE } from "../../kernel/contracts/documents/src/gate-failure.v1.ts";
import { absorb } from "./absorb.mjs";
import { alertDirectory, announce, clearCheck, list, raise } from "./alerts.mjs";
import { findings, syncHygiene } from "./hygiene.mjs";
import { MAX_POKES, describe, stopDecision } from "./poke.mjs";
import { cli, commitAll, failureRecord, fakeGate, git, gitOk, go, head, here, mentions, world, write } from "./absorb-world.mjs";

test("main moving while the gate runs stops the push, and main is never overwritten", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/race");
  let theirs;
  const gate = fakeGate({ onRun: () => { theirs = w.pushToMain("d.txt", "d\n"); } });
  const result = await go(w, "feat/race", gate);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "push");
  assert.equal(w.originMain(), theirs, "the other commit is still main");
  assert.equal(w.localHas("feat/race"), true);
  assert.equal(w.remoteHas("feat/race"), true);
  assert.equal(existsSync(wt), true);
});

test("a rejected push deletes nothing", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/reject");
  const hook = resolve(w.origin, "hooks/pre-receive");
  writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/main" ]; then echo "main is protected" >&2; exit 1; fi\ndone\nexit 0\n', { mode: 0o755 });
  const before = w.originMain();
  const gate = fakeGate();
  gate.receipts.add(head(wt));
  const result = await go(w, "feat/reject", gate);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "push");
  assert.equal(w.originMain(), before);
  assert.equal(w.localHas("feat/reject"), true);
  assert.equal(w.remoteHas("feat/reject"), true);
  assert.equal(existsSync(wt), true);
});

test("a second absorb is refused while one runs, and does not take the first one's lock", { timeout: 60000 }, async () => {
  const w = world();
  w.branch("feat/locked");
  const lock = resolve(git(w.main, "rev-parse", "--path-format=absolute", "--git-common-dir"), "vx-absorb.lock");
  writeFileSync(lock, JSON.stringify({ pid: process.pid, branch: "feat/other" }));
  const result = await go(w, "feat/locked", fakeGate());
  assert.equal(result.ok, false);
  assert.equal(result.stage, "preflight");
  assert.match(result.observed, /another absorb is running/);
  assert.equal(existsSync(lock), true, "the running absorb's lock is still there");
});

test("a lock left by a process that is gone is taken over, and released afterwards", { timeout: 120000 }, async () => {
  const w = world();
  w.branch("feat/stale");
  const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
  const lock = resolve(git(w.main, "rev-parse", "--path-format=absolute", "--git-common-dir"), "vx-absorb.lock");
  writeFileSync(lock, JSON.stringify({ pid: dead, branch: "feat/old" }));
  const result = await go(w, "feat/stale", fakeGate());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(existsSync(lock), false);
});

test("it can be run from inside the branch's own worktree (the first absorb of a branch that adds this script)", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/inside");
  // A separate process whose working directory IS the branch's worktree: absorb has to step out of it before it can delete it, and
  // changing a process's directory would disturb the other cases running beside this one.
  const script = `import { absorb } from ${JSON.stringify(pathToFileURL(resolve(here, "absorb.mjs")).href)};
const result = await absorb({ root: process.cwd(), branch: "feat/inside", deps: { verifyReceipt: () => ({ ok: true, text: "" }), runGate: async () => 0 }, env: {} });
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: wt, encoding: "utf8", windowsHide: true });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.equal(existsSync(wt), false);
  assert.equal(w.localHas("feat/inside"), false);
  assert.equal(w.remoteHas("feat/inside"), false);
});

test("a local branch that was never pushed lands too, with nothing to delete on the remote", { timeout: 120000 }, async () => {
  const w = world();
  w.branch("feat/local", undefined, undefined, { push: false });
  const result = await go(w, "feat/local", fakeGate());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(w.remoteHas("feat/local"), false);
});
