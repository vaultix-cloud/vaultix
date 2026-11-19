// Hygiene: branches and worktrees that should be gone (docs/0145). Git only, no network, no builds: it is cheap enough to run every
// time a session opens. It reads the refs as they are; `node scripts/absorb.mjs <branch>` is what fetches.
//
// Findings are advice raised as alerts of kind leftover_ref. They clear themselves when the thing is fixed, because every run
// recomputes them: an alert for a branch that is gone is removed, one that is still true is kept.
import { spawnSync } from "node:child_process";
import { FIX_THE_SOURCE } from "../../kernel/contracts/documents/src/gate-failure.v1.ts";
import { parseDocument } from "../../kernel/contracts/documents/src/registry.ts";
import { clear, list, raise } from "./alerts.mjs";

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
const out = (cwd, ...args) => { const result = git(cwd, ...args); return result.status === 0 ? result.stdout.trim() : null; };

const OBSERVED = {
  merged_branch: "the branch is already in origin/main and still exists",
  merged_worktree: "the branch is already in origin/main and its worktree still exists",
  local_main_behind: "local main is behind origin/main"
};

/** Worktrees of the repository: where each is and which branch it has out. */
export function worktrees(root) {
  const text = out(root, "worktree", "list", "--porcelain") ?? "";
  return text.split(/\r?\n\r?\n/).filter(Boolean).map(block => {
    const lines = block.split(/\r?\n/);
    return { path: lines.find(line => line.startsWith("worktree "))?.slice(9) ?? "", branch: lines.find(line => line.startsWith("branch "))?.slice(7) ?? null };
  });
}

/** What is left over, from the refs as they are now. Empty when origin/main is not known (there is nothing to compare with). */
export function findings(root) {
  const main = out(root, "rev-parse", "--verify", "refs/remotes/origin/main");
  if (!main) return { commit: null, items: [] };
  const merged = ref => git(root, "merge-base", "--is-ancestor", ref, main).status === 0;
  const withWorktree = new Set(worktrees(root).map(entry => entry.branch).filter(Boolean));
  const items = [];
  for (const name of (out(root, "for-each-ref", "--format=%(refname:short)", "refs/heads") ?? "").split(/\r?\n/).filter(Boolean)) {
    if (name === "main") continue;
    if (merged(`refs/heads/${name}`)) items.push({ problem: withWorktree.has(`refs/heads/${name}`) ? "merged_worktree" : "merged_branch", ref: name });
  }
  for (const name of (out(root, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin") ?? "").split(/\r?\n/).filter(Boolean)) {
    if (name === "origin" || name === "origin/HEAD" || name === "origin/main") continue;
    if (merged(`refs/remotes/${name}`)) items.push({ problem: "merged_branch", ref: name });
  }
  const local = out(root, "rev-parse", "--verify", "refs/heads/main");
  if (local && local !== main && merged("refs/heads/main")) items.push({ problem: "local_main_behind", ref: "main" });
  return { commit: main, items };
}

const recordFor = (commit, item) => ({
  schemaVersion: "vaultix.gate-failure.v1", commit, check: "hygiene", tier: "fast", rule: FIX_THE_SOURCE,
  kind: "leftover_ref", problem: item.problem, ref: item.ref,
  expected: "every branch merged into main is deleted with its worktree, and local main matches origin/main",
  observed: OBSERVED[item.problem]
});

/** Bring the alerts in line with the refs: raise what is true, clear what is not. Returns the findings. */
export function syncHygiene(root) {
  const { commit, items } = findings(root);
  if (!commit) return [];
  const wanted = new Set();
  for (const item of items) {
    const record = recordFor(commit, item);
    const parsed = parseDocument(record);
    if (!parsed.ok) continue; // a ref name that is not printable ASCII is reported by git, not here
    wanted.add(raise(root, record));
  }
  for (const alert of list(root)) if (alert.record.kind === "leftover_ref" && !wanted.has(alert.key)) clear(root, alert.key);
  return items;
}
