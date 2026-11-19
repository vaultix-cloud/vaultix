// Landing a branch on main: the stages, and what a failure leaves untouched (docs/0145).
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

test("a branch with a passing receipt lands without running the gate, and nothing is left behind", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/one");
  const gate = fakeGate();
  gate.receipts.add(head(wt));
  const result = await go(w, "feat/one", gate);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(gate.ran.length, 0, "a passing receipt is the proof; the gate is not run again");
  assert.equal(w.originMain(), result.head);
  assert.equal(w.originMain(), head(w.main), "local main was fast-forwarded to what was pushed");
  assert.equal(existsSync(resolve(w.main, "feat-one.txt")), true);
  assert.equal(w.remoteHas("feat/one"), false);
  assert.equal(w.localHas("feat/one"), false);
  assert.equal(existsSync(wt), false);
  assert.deepEqual(list(w.main), []);
  assert.ok(result.notes.some(note => /already existed/.test(note)));
});

test("with no receipt the gate runs once, in the branch's worktree, and then the branch lands", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/two");
  const gate = fakeGate();
  const result = await go(w, "feat/two", gate);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(gate.ran.length, 1, "it ran once");
  assert.equal(resolve(gate.ran[0]).toLowerCase(), resolve(wt).toLowerCase(), "in the branch's own worktree");
  assert.equal(w.localHas("feat/two"), false);
});

test("--no-run lands only what already has a receipt", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/norun");
  const gate = fakeGate();
  const result = await go(w, "feat/norun", gate, { runGate: false });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "gate");
  assert.equal(gate.ran.length, 0);
  assert.equal(existsSync(wt), true);
  assert.equal(w.remoteHas("feat/norun"), true);
});

test("a gate that fails stops it, deletes nothing, and leaves a loud alert that holds only text the gate wrote", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/red");
  const before = w.originMain();
  const result = await go(w, "feat/red", fakeGate({ exit: 1 }));
  assert.equal(result.ok, false);
  assert.equal(result.stage, "gate");
  assert.equal(w.originMain(), before, "main did not move");
  assert.equal(w.localHas("feat/red"), true);
  assert.equal(w.remoteHas("feat/red"), true);
  assert.equal(existsSync(wt), true);
  const alerts = list(w.main);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].record.kind, "absorb_failed");
  assert.equal(alerts[0].record.stage, "gate");
  assert.equal(alerts[0].record.branch, "feat/red");
  assert.equal(alerts[0].record.rule, FIX_THE_SOURCE);
  const text = readFileSync(resolve(alertDirectory(w.main), `${alerts[0].key}.json`), "utf8");
  assert.equal(mentions(text, w.dir), false, "what git printed (paths) is in the log, not in the alert");
  assert.equal(mentions(readFileSync(resolve(w.main, ".gate/logs/absorb.log"), "utf8"), w.dir), true, "and the log does hold it, so this test can fail");
  assert.equal(existsSync(resolve(w.main, ".gate/logs/absorb.log")), true);
  assert.match(readFileSync(resolve(w.main, ".gate/logs/absorb.log"), "utf8"), /git fetch/);
  assert.ok(existsSync(resolve(w.main, ".gate/outbox")), "the outbox message was written");
});

test("fixing it and absorbing again lands the branch and clears the alert", { timeout: 120000 }, async () => {
  const w = world();
  w.branch("feat/retry");
  assert.equal((await go(w, "feat/retry", fakeGate({ exit: 1 }))).ok, false);
  assert.equal(list(w.main).length, 1);
  assert.equal((await go(w, "feat/retry", fakeGate())).ok, true);
  assert.deepEqual(list(w.main), [], "landing is the only thing that clears an absorb alert");
});

test("a branch that is behind main is refused; --update merges main in and lands it with a receipt for the NEW commit", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/behind");
  w.pushToMain("c.txt", "c\n");
  const gate = fakeGate();
  gate.receipts.add(head(wt));
  const refused = await go(w, "feat/behind", gate);
  assert.equal(refused.ok, false);
  assert.equal(refused.stage, "preflight");
  assert.equal(w.localHas("feat/behind"), true);
  assert.equal(existsSync(wt), true);
  const oldHead = head(wt);

  const landed = await go(w, "feat/behind", gate, { update: true });
  assert.equal(landed.ok, true, JSON.stringify(landed));
  assert.notEqual(landed.head, oldHead, "merging changed the commit");
  assert.equal(gate.ran.length, 1, "the old receipt does not cover the merged commit, so the gate ran again");
  assert.equal(existsSync(resolve(w.main, "c.txt")), true);
  assert.equal(existsSync(resolve(w.main, "feat-behind.txt")), true);
});

test("a conflict during --update aborts the merge and leaves the branch exactly as it was", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/conflict", "a.txt", "branch\n");
  w.pushToMain("a.txt", "other\n");
  const before = head(wt);
  const result = await go(w, "feat/conflict", fakeGate(), { update: true });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "update");
  assert.equal(head(wt), before);
  assert.equal(git(wt, "status", "--porcelain"), "", "the worktree is clean");
  assert.equal(gitOk(wt, "rev-parse", "-q", "--verify", "MERGE_HEAD"), false, "no merge is left half done");
  assert.equal(w.remoteHas("feat/conflict"), true);
});

test("a worktree with uncommitted changes is refused", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/dirty");
  write(wt, "scratch.txt", "not committed\n");
  const result = await go(w, "feat/dirty", fakeGate());
  assert.equal(result.ok, false);
  assert.equal(result.stage, "preflight");
  assert.equal(existsSync(resolve(wt, "scratch.txt")), true, "nothing was touched");
});

test("a branch that does not exist, or is main, is refused", { timeout: 60000 }, async () => {
  // `main` first, in a repository where nothing has failed yet: an earlier failure writes its log into the main checkout, which would
  // make main's worktree "dirty" and refuse it for the wrong reason, hiding that the name itself is what is refused.
  const w = world();
  const mainRefused = await go(w, "main", fakeGate());
  assert.equal(mainRefused.stage, "preflight");
  assert.match(mainRefused.observed, /not one this can land/, "refused because of what it is, not because of the state it happens to be in");
  assert.equal(w.remoteHas("main"), true, "main on the remote is untouched");
  assert.equal((await go(w, "feat/nope", fakeGate())).stage, "preflight");
  assert.equal((await go(w, "--force", fakeGate())).stage, "preflight", "a branch name cannot be a flag");
});
