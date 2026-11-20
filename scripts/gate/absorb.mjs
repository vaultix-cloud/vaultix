// Land a branch on main, and leave nothing behind (docs/0145).
//
//   preflight  the branch exists and has a clean worktree; origin is fetched; no other absorb is running
//   update     (--update) origin/main is merged into the branch; a conflict aborts the merge and stops
//   gate       a passing FULL-tier receipt for the exact head commit exists; if not, the gate runs it
//   push       exactly that commit goes to main, fast-forward only, never forced
//   cleanup    local main is fast-forwarded, the remote branch, the worktree and the local branch are deleted
//   verify     everything above is checked to be true, and only then is it reported as done
//
// A run can stop in the cleanup, after main holds the commit (a terminal sitting in the worktree stops Windows removing it). Running it
// again finishes the job: origin/main already holding the commit is the proof, so nothing is pushed and the gate is not run again, and
// the leftovers are deleted. Without that the alert could never clear, because it stays until the branch lands.
//
// Two rules shape it:
//  - NOTHING IS DELETED UNTIL main HOLDS THE COMMIT. A failure at any stage before the push leaves the branch, its remote branch and
//    its worktree exactly as they were. There is no flag to skip the gate, push past a rejection or force anything.
//  - A FAILURE IS LOUD. It is recorded as a vaultix.gate-failure.v1 of kind absorb_failed (alert, outbox message, webhook), and the
//    alert stays until the branch lands. What git said is in `.gate/logs/absorb.log`, never in the record.
//
// Resource use: no polling and nothing runs unless asked. A branch that already has a passing full receipt for its head is not
// gated again; the gate runs once per head commit, in the branch's own worktree, where its dependencies and build cache already are.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { FIX_THE_SOURCE } from "../../kernel/contracts/documents/src/gate-failure.v1.ts";
import { announce, clearBranch, commonDir } from "./alerts.mjs";
import { worktrees } from "./hygiene.mjs";
import { receiptPath } from "./receipt.mjs";

/**
 * The proof outlives the worktree. The passing full-tier receipt for the commit that landed is copied into main's `.gate/receipts/`
 * (ignored by git), because the baseline is the receipt for the commit on main and the worktree that held it is about to be deleted.
 * A receipt that cannot be kept is a note, not a failure: the commit is already safe on main.
 */
function keepReceipt(from, to, commit, notes) {
  try {
    if (resolve(from) === resolve(to)) return;
    const source = receiptPath(from, commit, "full");
    if (!existsSync(source)) { notes.push("no full-tier receipt file was found in the worktree to keep"); return; }
    const target = receiptPath(to, commit, "full");
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    notes.push("the full-tier receipt for this commit was kept in main's .gate/receipts");
  } catch {
    notes.push("the full-tier receipt for this commit could not be copied to main's .gate/receipts");
  }
}

const inside = (child, parent) => { const a = resolve(child), b = resolve(parent); const [x, y] = process.platform === "win32" ? [a.toLowerCase(), b.toLowerCase()] : [a, b]; return x === y || x.startsWith(`${y}${process.platform === "win32" ? "\\" : "/"}`); };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; } };

/** The real gate, run in the branch's own worktree. Both are replaceable so the tests can use a fake. */
export const realDeps = {
  verifyReceipt(worktree) {
    const result = spawnSync(process.execPath, ["scripts/gate.mjs", "--verify-receipt", "full"], { cwd: worktree, encoding: "utf8", windowsHide: true });
    return { ok: result.status === 0, text: `${result.stdout}${result.stderr}`.trim() };
  },
  runGate(worktree, { timeoutSeconds = 3600 } = {}) {
    return new Promise(done => {
      const child = spawn(process.execPath, ["scripts/gate.mjs", "--full"], { cwd: worktree, stdio: "inherit", windowsHide: true });
      const timer = setTimeout(() => {
        if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        else child.kill("SIGKILL");
        done(124);
      }, timeoutSeconds * 1000);
      child.on("close", code => { clearTimeout(timer); done(code ?? 1); });
    });
  }
};

/**
 * @param {object} options
 * @param {string} options.root     a worktree of the repository to run from (its `.gate/` holds the failure log and outbox)
 * @param {string} options.branch   the local branch to land
 * @param {boolean} [options.update]  merge origin/main into the branch first when it is behind
 * @param {boolean} [options.runGate] run the full tier when no passing receipt exists (default true)
 * @returns {Promise<{ok: boolean, stage?: string, observed?: string, head?: string, notes: string[]}>}
 */
export async function absorb({ root, branch, update = false, runGate = true, deps = realDeps, env = process.env }) {
  const log = [];
  const notes = [];
  const git = (cwd, ...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    log.push(`$ git ${args.join(" ")}  (in ${cwd})\n${result.stdout ?? ""}${result.stderr ?? ""}`);
    return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
  };

  let head = null;
  let lockPath = null;
  // Where the log and the alert go. After the push it is main's worktree, because the branch's (and root, if root is the branch's)
  // is about to be deleted.
  let home = root;
  const fail = async (stage, observed) => {
    // Written only on failure, and only here: on success the worktree this lives in may be gone.
    mkdirSync(resolve(home, ".gate/logs"), { recursive: true });
    writeFileSync(resolve(home, ".gate/logs/absorb.log"), `${log.join("\n")}\n`);
    const originMain = spawnSync("git", ["rev-parse", "--verify", "refs/remotes/origin/main"], { cwd: home, encoding: "utf8", windowsHide: true }).stdout.trim();
    const record = {
      schemaVersion: "vaultix.gate-failure.v1", commit: head ?? (/^[0-9a-f]{40}$/.test(originMain) ? originMain : "0".repeat(40)), check: "absorb", tier: "full", rule: FIX_THE_SOURCE,
      kind: "absorb_failed", stage, branch,
      expected: "the branch lands on main with a passing full-tier receipt for the exact commit pushed, and nothing is left behind",
      observed: `stopped at ${stage}: ${observed}`, logPath: ".gate/logs/absorb.log"
    };
    await announce(home, record, env);
    return { ok: false, stage, observed, head: head ?? undefined, notes };
  };

  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch === "main" || branch.startsWith("-")) return fail("preflight", "the branch name is not one this can land");

  // One absorb at a time: two would race for main. A lock whose process is gone is taken over.
  try {
    lockPath = resolve(commonDir(root), "vx-absorb.lock");
  } catch {
    return fail("preflight", "this is not a git repository");
  }
  let locked = false;
  for (let attempt = 0; attempt < 2 && !locked; attempt++) {
    try { writeFileSync(lockPath, JSON.stringify({ pid: process.pid, branch }), { flag: "wx" }); locked = true; } catch {
      let holder = null;
      try { holder = JSON.parse(readFileSync(lockPath, "utf8")); } catch { /* unreadable: treat as stale */ }
      if (holder && alive(holder.pid)) { lockPath = null; return fail("preflight", `another absorb is running (process ${holder.pid}, branch ${holder.branch}); it holds the lock`); }
      rmSync(lockPath, { force: true }); // its process is gone: the lock is stale
    }
  }
  if (!locked) { lockPath = null; return fail("preflight", "the absorb lock could not be taken"); }

  try {
    if (!git(root, "fetch", "--prune", "origin").ok) return await fail("preflight", "origin could not be fetched");
    const found = git(root, "rev-parse", "--verify", `refs/heads/${branch}`);
    if (!found.ok) return await fail("preflight", "there is no local branch with that name");
    head = found.out;
    const all = worktrees(root);
    const branchTree = all.find(entry => entry.branch === `refs/heads/${branch}`);
    // An earlier run, or a person, may already have put this commit on main. origin/main holding it is the proof: nothing is pushed or
    // gated again, and what is left is the cleanup. A worktree that still has uncommitted changes is never removed, landed or not.
    const heldByMain = () => git(home, "merge-base", "--is-ancestor", head, "refs/remotes/origin/main").ok;
    const resumed = heldByMain();
    if (!resumed && !branchTree) return await fail("preflight", "the branch has no worktree, and the gate has to run in one");
    if (branchTree && git(branchTree.path, "status", "--porcelain").out.length > 0) return await fail("preflight", "the branch's worktree has uncommitted changes");
    if (resumed) notes.push("origin/main already holds this commit, so nothing was pushed and the gate was not run; only the cleanup was left");

    const contains = commit => git(home, "merge-base", "--is-ancestor", "refs/remotes/origin/main", commit).ok;
    if (!resumed && !contains(head)) {
      if (!update) return await fail("preflight", "origin/main has commits the branch does not contain; rerun with --update, or merge origin/main into the branch");
      const merged = git(branchTree.path, "merge", "--no-edit", "refs/remotes/origin/main");
      if (!merged.ok) {
        const conflicts = git(branchTree.path, "diff", "--name-only", "--diff-filter=U").out.split(/\r?\n/).filter(Boolean).length;
        git(branchTree.path, "merge", "--abort");
        return await fail("update", `merging origin/main conflicted in ${conflicts} files; the merge was aborted and the branch is unchanged`);
      }
      head = git(branchTree.path, "rev-parse", "HEAD").out;
      notes.push("origin/main was merged into the branch, so its commit changed and needs its own receipt");
    }

    if (!resumed) {
      // The receipt is the proof. It is about the exact commit that will be pushed, in a clean worktree.
      let receipt = deps.verifyReceipt(branchTree.path);
      if (!receipt.ok) {
        if (!runGate) return await fail("gate", "there is no passing full-tier receipt for this commit and the gate was not to be run");
        const code = await deps.runGate(branchTree.path);
        if (code !== 0) return await fail("gate", `the full tier did not pass (exit ${code}); each failing check has its own alert`);
        receipt = deps.verifyReceipt(branchTree.path);
        if (!receipt.ok) return await fail("gate", "the full tier finished but its receipt does not verify for this commit");
      } else notes.push("a passing full-tier receipt already existed for this commit, so the gate was not run again");
      if (git(branchTree.path, "status", "--porcelain").out.length > 0) return await fail("gate", "the gate left uncommitted changes in the worktree, so the receipt does not describe the commit");
      if (git(branchTree.path, "rev-parse", "HEAD").out !== head) return await fail("gate", "the branch moved while the gate ran");

      // main may have moved while the gate ran; a commit that does not contain it cannot be pushed as it was tested.
      if (!git(root, "fetch", "--prune", "origin").ok) return await fail("push", "origin could not be fetched before the push");
      if (!contains(head)) return await fail("push", "origin/main moved while the gate ran; rerun with --update (the new commit needs its own receipt)");
      if (!git(root, "push", "origin", `${head}:refs/heads/main`).ok) return await fail("push", "the push to main was rejected or failed; nothing was deleted");
      git(root, "fetch", "--prune", "origin");
    }

    // main holds the commit. From here a failure is loud, but the work is safe.
    const mainTree = all.find(entry => entry.branch === "refs/heads/main");
    const safe = mainTree?.path ?? dirname(commonDir(root));
    home = safe;
    if (mainTree) {
      // Tracked changes only: an untracked file cannot be lost by a fast-forward, and git refuses one that would overwrite it.
      if (git(mainTree.path, "status", "--porcelain", "--untracked-files=no").out.length > 0) notes.push("local main was not updated: its worktree has uncommitted changes");
      else if (!git(mainTree.path, "merge", "--ff-only", "refs/remotes/origin/main").ok) notes.push("local main could not be fast-forwarded");
    } else git(safe, "branch", "-f", "main", "refs/remotes/origin/main");

    if (branchTree && inside(process.cwd(), branchTree.path)) process.chdir(safe);
    if (git(safe, "ls-remote", "--heads", "origin", branch).out) {
      if (!git(safe, "push", "origin", "--delete", branch).ok) return await fail("cleanup", "main holds the commit, but the remote branch could not be deleted");
    }
    if (branchTree && existsSync(branchTree.path)) {
      keepReceipt(branchTree.path, safe, head, notes);
      // Another program can hold the directory (a terminal opened in it): this process can leave it, that one cannot.
      if (!git(safe, "worktree", "remove", branchTree.path).ok) return await fail("cleanup", "main holds the commit, but the branch's worktree could not be removed; a terminal or program may be using it as its working directory: close it and run absorb again");
    }
    git(safe, "worktree", "prune");
    if (!git(safe, "branch", "-d", branch).ok) {
      // -d judges against HEAD, and main's worktree may be dirty or elsewhere; the proof here is that origin/main contains the commit.
      if (!contains(head) || !git(safe, "branch", "-D", branch).ok) return await fail("cleanup", "main holds the commit, but the local branch could not be deleted");
    }

    // Done only when it is true.
    const problems = [];
    if (git(safe, "ls-remote", "--heads", "origin", branch).out) problems.push("the remote branch still exists");
    if (git(safe, "rev-parse", "--verify", `refs/heads/${branch}`).ok) problems.push("the local branch still exists");
    if (branchTree && existsSync(branchTree.path)) problems.push("the worktree directory still exists");
    // Holds, not equals: a push by someone else right after this one must not turn a good landing into a failure.
    if (!heldByMain()) problems.push("origin/main does not hold the commit");
    if (problems.length) return await fail("verify", problems.join("; "));

    clearBranch(safe, branch);
    const landed = resolve(commonDir(safe), "vx-absorbed");
    mkdirSync(landed, { recursive: true });
    writeFileSync(resolve(landed, `${head}.json`), `${JSON.stringify({ branch, head, notes }, null, 2)}\n`);
    return { ok: true, head, notes };
  } finally {
    if (lockPath) rmSync(lockPath, { force: true });
  }
}
