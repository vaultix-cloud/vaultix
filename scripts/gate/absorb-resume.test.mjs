// Finishing a landing that stopped in the cleanup, and keeping the proof when the worktree goes (docs/0145).
// The first one really happened: main took the commit, the worktree could not be removed, and absorb then refused to run again
// ("the branch has no worktree"), so an alert that stays until the branch lands could never clear.
// Real git repositories from absorb-world.mjs; the stop is made real by an origin that refuses to delete a branch.
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { list } from "./alerts.mjs";
import { fakeGate, git, go, head, world, write } from "./absorb-world.mjs";

const hook = w => resolve(w.origin, "hooks/pre-receive");
/** An origin that refuses to delete a branch (an update to all zeros): the push to main works and the cleanup cannot finish. */
const refuseDeletes = w => {
  writeFileSync(hook(w), "#!/bin/sh\nwhile read old new ref; do\n  case \"$new\" in *[!0]*) ;; *) echo \"deletes are refused here\" >&2; exit 1;; esac\ndone\nexit 0\n");
  chmodSync(hook(w), 0o755);
};
const allowDeletes = w => rmSync(hook(w), { force: true });
const never = () => { throw new Error("a branch that main already holds is neither gated nor pushed again"); };
const noGate = { deps: { verifyReceipt: never, runGate: never } };

test("a landing that stopped in the cleanup is finished by running it again: no gate, no push, and the alert clears", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/half");
  const landed = head(wt);
  const gate = fakeGate();
  gate.receipts.add(landed);
  refuseDeletes(w);
  const first = await go(w, "feat/half", gate);
  assert.equal(first.ok, false);
  assert.equal(first.stage, "cleanup");
  assert.equal(w.originMain(), landed, "main already holds the commit");
  assert.equal(list(w.main).length, 1, "the stop is an alert");
  // The state the incident left: the worktree gone, the local branch and the remote branch still there.
  git(w.main, "worktree", "remove", wt);
  assert.equal(existsSync(wt), false);
  assert.equal(w.localHas("feat/half"), true);
  assert.equal(w.remoteHas("feat/half"), true);
  allowDeletes(w);

  const second = await go(w, "feat/half", noGate);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.ok(second.notes.some(note => /already holds this commit/.test(note)), "it says why it did not gate or push");
  assert.equal(w.localHas("feat/half"), false);
  assert.equal(w.remoteHas("feat/half"), false);
  assert.deepEqual(list(w.main), [], "the alert cleared because the branch landed");
  assert.equal(w.originMain(), landed, "main was not touched again");
});

test("finishing a landing whose worktree is still there removes it too", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/still");
  const gate = fakeGate();
  gate.receipts.add(head(wt));
  refuseDeletes(w);
  assert.equal((await go(w, "feat/still", gate)).ok, false);
  assert.equal(existsSync(wt), true, "the failed cleanup left the worktree");
  allowDeletes(w);
  const second = await go(w, "feat/still", noGate);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(existsSync(wt), false);
  assert.equal(w.localHas("feat/still"), false);
  assert.equal(w.remoteHas("feat/still"), false);
  assert.deepEqual(list(w.main), []);
});

test("a branch that main already holds, whose worktree has uncommitted changes, is left exactly as it is", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/unsaved");
  git(wt, "push", "-q", "origin", "HEAD:main");
  write(wt, "notes.txt", "work nobody committed\n");
  const result = await go(w, "feat/unsaved", noGate);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "preflight");
  assert.equal(readFileSync(resolve(wt, "notes.txt"), "utf8"), "work nobody committed\n", "the uncommitted file is still there");
  assert.equal(w.localHas("feat/unsaved"), true);
  assert.equal(w.remoteHas("feat/unsaved"), true);
});

test("a branch main does not hold still needs its worktree, so nothing is finished by mistake", { timeout: 120000 }, async () => {
  const w = world();
  const wt = w.branch("feat/new");
  git(w.main, "worktree", "remove", wt);
  const result = await go(w, "feat/new", fakeGate());
  assert.equal(result.ok, false);
  assert.equal(result.stage, "preflight");
  assert.equal(w.localHas("feat/new"), true, "the unlanded branch is not deleted");
  assert.equal(w.remoteHas("feat/new"), true);
});

test("the passing receipt of the commit that landed is kept in main's .gate/receipts when its worktree goes", { timeout: 120000 }, async () => {
  const w = world();
  // .gate/ is ignored, as it is in the real repository, so a receipt written there does not make the worktree dirty.
  const wt = w.branch("feat/proof", ".gitignore", ".gate/\n");
  const gate = fakeGate({ onRun: dir => write(dir, `.gate/receipts/${head(dir)}.full.json`, "{\"result\":\"pass\"}\n") });
  const result = await go(w, "feat/proof", gate);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(existsSync(wt), false);
  assert.equal(readFileSync(resolve(w.main, ".gate/receipts", `${result.head}.full.json`), "utf8"), "{\"result\":\"pass\"}\n", "main holds the receipt of the commit it holds");
  assert.ok(result.notes.some(note => /receipt for this commit was kept/.test(note)));
});

test("a worktree with no receipt file does not stop the landing, and the note says none was kept", { timeout: 120000 }, async () => {
  const w = world();
  w.branch("feat/bare");
  const result = await go(w, "feat/bare", fakeGate());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.notes.some(note => /no full-tier receipt file was found/.test(note)));
  assert.equal(existsSync(resolve(w.main, ".gate/receipts")), false, "nothing was invented");
});
