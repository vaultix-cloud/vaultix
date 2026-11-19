// Hygiene, the hook text that reaches the agent, and the command line (docs/0145).
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

test("hygiene finds a merged branch, its worktree, its remote copy and a stale local main, and sees nothing once they are gone", { timeout: 120000 }, () => {
  const w = world();
  assert.deepEqual(findings(w.main).items, [], "a fresh repository has nothing left over");
  const wt = w.branch("feat/merged");
  git(w.main, "merge", "-q", "--ff-only", "feat/merged");
  git(w.main, "push", "-q", "origin", "main");
  const first = findings(w.main).items.map(item => `${item.problem} ${item.ref}`).sort();
  assert.deepEqual(first, ["merged_branch origin/feat/merged", "merged_worktree feat/merged"]);
  git(w.main, "worktree", "remove", wt);
  assert.deepEqual(findings(w.main).items.map(item => `${item.problem} ${item.ref}`).sort(), ["merged_branch feat/merged", "merged_branch origin/feat/merged"]);
  git(w.main, "branch", "-q", "-d", "feat/merged");
  git(w.main, "push", "-q", "origin", "--delete", "feat/merged");
  assert.deepEqual(findings(w.main).items, []);
  w.pushToMain("e.txt", "e\n");
  git(w.main, "fetch", "-q", "origin");
  assert.deepEqual(findings(w.main).items.map(item => `${item.problem} ${item.ref}`), ["local_main_behind main"]);
});

test("a branch with work that is not in main is not a leftover", { timeout: 60000 }, () => {
  const w = world();
  w.branch("feat/live");
  assert.deepEqual(findings(w.main).items, []);
});

test("syncHygiene raises what is true and clears what is not, and never touches a failure alert", { timeout: 120000 }, () => {
  const w = world();
  raise(w.main, failureRecord());
  const wt = w.branch("feat/old");
  git(w.main, "merge", "-q", "--ff-only", "feat/old");
  git(w.main, "push", "-q", "origin", "main");
  assert.equal(syncHygiene(w.main).length, 2);
  assert.equal(list(w.main).filter(alert => alert.record.kind === "leftover_ref").length, 2);
  git(w.main, "worktree", "remove", wt);
  git(w.main, "branch", "-q", "-d", "feat/old");
  git(w.main, "push", "-q", "origin", "--delete", "feat/old");
  assert.equal(syncHygiene(w.main).length, 0);
  assert.deepEqual(list(w.main).map(alert => alert.record.kind), ["check_failed"], "the housekeeping alerts cleared themselves; the failure stayed");
});

test("the context text names the rule, what was expected and observed, and how an alert clears", { timeout: 60000 }, () => {
  const w = world();
  assert.equal(describe(list(w.main)), "", "no alert, no text, no cost");
  raise(w.main, failureRecord());
  const text = describe(list(w.main));
  assert.ok(text.includes(FIX_THE_SOURCE));
  assert.match(text, /kernel-tests/);
  assert.match(text, /expected: every kernel crate/);
  assert.match(text, /observed: exited with code 1/);
  assert.match(text, /There is no dismiss/);
});

test("a Stop hook pushes back on a failure at most twice, never while it is already continuing, and never for housekeeping", { timeout: 60000 }, () => {
  const w = world();
  assert.equal(stopDecision(w.main), null, "nothing wrong, nothing said");
  raise(w.main, failureRecord());
  assert.equal(stopDecision(w.main, { stopHookActive: true }), null, "the harness is already continuing because of a block: do not loop");
  assert.equal(list(w.main)[0].pokes, 0, "and that was not counted");
  for (let time = 0; time < MAX_POKES; time++) {
    const decision = stopDecision(w.main);
    assert.equal(decision.decision, "block");
    assert.ok(decision.reason.includes(FIX_THE_SOURCE));
  }
  assert.equal(stopDecision(w.main), null, "after two push-backs it is still shown on every prompt, but the turn may end");
  const { exitCode, ...base } = failureRecord();
  raise(w.main, { ...base, check: "hygiene", kind: "leftover_ref", problem: "merged_branch", ref: "feat/x" });
  assert.equal(stopDecision(w.main), null, "housekeeping never blocks");
});

test("the hook script itself: prints context on a prompt, answers a Stop with a block, and says nothing when all is well", { timeout: 60000 }, () => {
  const w = world();
  const poke = resolve(here, "poke.mjs");
  const run = (args, input = "") => spawnSync(process.execPath, [poke, ...args], { cwd: w.main, env: { ...process.env, CLAUDE_PROJECT_DIR: w.main }, input, encoding: "utf8", windowsHide: true });
  const quiet = run([]);
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout.trim(), "");
  raise(w.main, failureRecord());
  const prompt = run([]);
  assert.equal(prompt.status, 0);
  assert.match(prompt.stdout, /GATE ALERT/);
  const stop = run(["--stop"], JSON.stringify({ stop_hook_active: false }));
  assert.equal(JSON.parse(stop.stdout).decision, "block");
  const again = run(["--stop"], JSON.stringify({ stop_hook_active: true }));
  assert.equal(again.stdout.trim(), "");
  const outside = spawnSync(process.execPath, [poke], { cwd: tmpdir(), env: { ...process.env, CLAUDE_PROJECT_DIR: tmpdir() }, encoding: "utf8", windowsHide: true });
  assert.equal(outside.status, 0, "outside a repository a hook must never fail the session");
});

test("the command line: usage is an error, --status and --hygiene exit non-zero exactly when something is wrong", { timeout: 120000 }, () => {
  const w = world();
  assert.equal(cli(w).status, 2, "no branch and no option is a usage error");
  assert.equal(cli(w, "--status").status, 0);
  assert.equal(cli(w, "--hygiene").status, 0);
  raise(w.main, failureRecord());
  const status = cli(w, "--status");
  assert.equal(status.status, 1);
  assert.match(status.stdout, /kernel-tests/);
  const wt = w.branch("feat/tidy");
  git(w.main, "merge", "-q", "--ff-only", "feat/tidy");
  git(w.main, "push", "-q", "origin", "main");
  const hygiene = cli(w, "--hygiene");
  assert.equal(hygiene.status, 1);
  assert.match(hygiene.stdout, /merged_worktree\s+feat\/tidy/);
  assert.equal(existsSync(wt), true, "reporting leftovers does not delete them");
});

test("the command line: a branch that cannot land exits 1, says why, repeats the rule, and deletes nothing", { timeout: 120000 }, () => {
  const w = world();
  const wt = w.branch("feat/cli");
  const result = cli(w, "feat/cli", "--no-run");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STOPPED at gate/);
  assert.ok(result.stderr.includes(FIX_THE_SOURCE));
  assert.equal(existsSync(wt), true);
  assert.equal(w.remoteHas("feat/cli"), true);
  assert.equal(cli(w, "--status").status, 1, "and the failure is an alert");
});
