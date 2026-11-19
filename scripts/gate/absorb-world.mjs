// Shared helpers for the absorb tests (docs/0145): a real bare origin, a main checkout, linked worktrees, and a fake gate.
// Only the gate is fake; the git behaviour the tests depend on is the real thing.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { after } from "node:test";
import { FIX_THE_SOURCE } from "../../kernel/contracts/documents/src/gate-failure.v1.ts";
import { dirname, resolve } from "node:path";
import { absorb } from "./absorb.mjs";

Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_NOSYSTEM: "1" });
export const here = dirname(fileURLToPath(import.meta.url));
export const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
export const gitOk = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).status === 0;
export const write = (dir, file, text) => { mkdirSync(dirname(resolve(dir, file)), { recursive: true }); writeFileSync(resolve(dir, file), text); };
/** Whether `text` contains the path, as written or as JSON escapes backslashes (a Windows path never matches unescaped). */
export const mentions = (text, path) => text.toLowerCase().includes(path.toLowerCase()) || text.toLowerCase().includes(JSON.stringify(path).slice(1, -1).toLowerCase());
export const commitAll = (cwd, message) => { git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", message); };

const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

/** A bare origin, a main checkout with one commit pushed, and helpers to make branches with worktrees and a second clone. */
export function world() {
  const dir = mkdtempSync(resolve(tmpdir(), "vx-absorb-"));
  made.push(dir);
  const origin = resolve(dir, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin], { stdio: "ignore" });
  const main = resolve(dir, "main");
  execFileSync("git", ["clone", "-q", origin, main], { stdio: "ignore" });
  git(main, "config", "core.autocrlf", "false");
  git(main, "checkout", "-q", "-B", "main");
  write(main, "a.txt", "one\n");
  commitAll(main, "one");
  git(main, "push", "-q", "-u", "origin", "main");
  let other = null;
  return {
    dir, origin, main,
    branch(name, file = `${name.replace(/\//g, "-")}.txt`, text = "x\n", { push = true } = {}) {
      const wt = resolve(dir, `wt-${name.replace(/\//g, "-")}`);
      git(main, "worktree", "add", "-q", "-b", name, wt, "main");
      write(wt, file, text);
      commitAll(wt, name);
      if (push) git(wt, "push", "-q", "-u", "origin", name);
      return wt;
    },
    /** Move main on origin from somewhere else, as another person would. */
    pushToMain(file, text) {
      if (!other) { other = resolve(dir, "other"); execFileSync("git", ["clone", "-q", origin, other], { stdio: "ignore" }); git(other, "config", "core.autocrlf", "false"); }
      git(other, "pull", "-q", "--ff-only", "origin", "main");
      write(other, file, text);
      commitAll(other, `other ${file}`);
      git(other, "push", "-q", "origin", "main");
      return git(other, "rev-parse", "HEAD");
    },
    remoteHas: name => git(main, "ls-remote", "--heads", "origin", name).length > 0,
    localHas: name => gitOk(main, "rev-parse", "--verify", "-q", `refs/heads/${name}`),
    originMain: () => git(origin, "rev-parse", "main")
  };
}

/** A gate that is not the real one: receipts are a set of commits, running it adds the head (or fails). */
export function fakeGate({ exit = 0, onRun } = {}) {
  const receipts = new Set();
  const ran = [];
  return {
    receipts, ran,
    deps: {
      verifyReceipt: wt => ({ ok: receipts.has(git(wt, "rev-parse", "HEAD")), text: "" }),
      runGate: async wt => { ran.push(wt); if (onRun) await onRun(wt); if (exit === 0) receipts.add(git(wt, "rev-parse", "HEAD")); return exit; }
    }
  };
}
export const go = (w, branch, gate, extra = {}) => absorb({ root: w.main, branch, deps: gate.deps, env: {}, ...extra });
export const head = wt => git(wt, "rev-parse", "HEAD");

// ---------------------------------------------------------------------------------------------------------------- landing

export const failureRecord = (over = {}) => ({
  schemaVersion: "vaultix.gate-failure.v1", commit: "a".repeat(40), check: "kernel-tests", tier: "fast", rule: FIX_THE_SOURCE, kind: "check_failed", exitCode: 1,
  expected: "every kernel crate's tests pass against a real database", observed: "exited with code 1", logPath: ".gate/logs/kernel-tests.log", ...over
});

export const cli = (w, ...args) => spawnSync(process.execPath, [resolve(here, "../absorb.mjs"), ...args], { cwd: w.main, env: { ...process.env, VX_GATE_TEST: "1", VX_GATE_ROOT: w.main }, encoding: "utf8", windowsHide: true });
