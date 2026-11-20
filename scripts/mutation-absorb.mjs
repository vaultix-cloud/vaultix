// Plants one bug at a time in absorb, the alerts, hygiene and the poke (scripts/absorb.mjs, scripts/gate/{absorb,alerts,hygiene,poke}.mjs)
// and checks that their tests fail on each. A test that cannot fail proves nothing (docs/0142, section 3), and these are the scripts
// that delete branches and decide whether a failure reaches anyone.
//
//   node scripts/mutation-absorb.mjs [text]     all mutations, or only those whose label contains <text>
//
// The bugs go into throwaway copies (scripts/lib/mutation-copy.mjs), never into the real source. Each names the test files that can
// catch it, so a bug in the hook text does not rerun the git-heavy landing tests.
//
// Not planted, because no test CAN tell: a force flag on the push (git refuses a non-fast-forward without it, and the fetch before it
// already stops the push), the final "verify" stage (it re-checks what the stages before it already did, and that main HOLDS the commit
// rather than equals it only differs when someone else pushes in the instant between), and the hint in the message when a worktree
// cannot be removed (the cause, a terminal sitting in it, cannot be made on every machine a test runs on). They are layers or text,
// not the only guard; planting them would survive and prove nothing, so they are listed here and not faked.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMutations } from "./lib/mutation-copy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const absorbFile = "scripts/gate/absorb.mjs";
const alerts = "scripts/gate/alerts.mjs";
const hygiene = "scripts/gate/hygiene.mjs";
const poke = "scripts/gate/poke.mjs";
const cli = "scripts/absorb.mjs";
const land = "scripts/gate/absorb-land.test.mjs";
const safety = "scripts/gate/absorb-safety.test.mjs";
const alertTests = "scripts/gate/absorb-alerts.test.mjs";
const hygienePoke = "scripts/gate/absorb-hygiene-poke.test.mjs";
const resume = "scripts/gate/absorb-resume.test.mjs";

const mutations = [
  // landing
  ["the gate is never run, whatever the receipt says", absorbFile, /let receipt = deps\.verifyReceipt\(branchTree\.path\);\n      if \(!receipt\.ok\) \{/, "let receipt = deps.verifyReceipt(branchTree.path);\n      if (false) {", [land]],
  ["the gate runs again although a passing receipt exists", absorbFile, /\n      if \(!receipt\.ok\) \{\n        if \(!runGate\)/, "\n      if (true) {\n        if (!runGate)", [land]],
  ["--no-run runs the gate anyway", absorbFile, /if \(!runGate\) return await fail\("gate"/, 'if (false) return await fail("gate"', [land]],
  ["a rejected push does not stop the cleanup", absorbFile, /if \(!git\(root, "push", "origin", `\$\{head\}:refs\/heads\/main`\)\.ok\) return await fail\("push"[^\n]*\n/, () => 'git(root, "push", "origin", `${head}:refs/heads/main`);\n', [safety]],
  ["a conflict during --update is ignored", absorbFile, /if \(!merged\.ok\) \{/, "if (false) {", [land]],
  ["a conflicted merge is left half done", absorbFile, /\n        git\(branchTree\.path, "merge", "--abort"\);/, "", [land]],
  ["a worktree with uncommitted changes is accepted", absorbFile, /(status", "--porcelain"\)\.out\.length) > 0(\) return await fail\("preflight", "the branch's worktree)/, (_match, before, after) => `${before} > 99999${after}`, [land]],
  ["main is accepted as the branch to land", absorbFile, / \|\| branch === "main"/, "", [land]],
  ["the lock is never released", absorbFile, /if \(lockPath\) rmSync\(lockPath, \{ force: true \}\);/, "", [safety]],
  ["a lock held by a running absorb is taken over", absorbFile, /if \(holder && alive\(holder\.pid\)\)/, "if (false)", [safety]],
  ["the branch's worktree is left behind", absorbFile, /if \(!git\(safe, "worktree", "remove", branchTree\.path\)\.ok\)/, "if (false)", [land, safety]],
  ["the remote branch is not deleted", absorbFile, /if \(git\(safe, "ls-remote", "--heads", "origin", branch\)\.out\) \{\n      if \(!git\(safe, "push"/, () => 'if (false) {\n      if (!git(safe, "push"', [land]],
  ["a failed absorb writes no alert", absorbFile, /\n    await announce\(home, record, env\);/, "", [land]],
  ["a failed absorb's record carries what git printed", absorbFile, /observed: `stopped at \$\{stage\}: \$\{observed\}`/, () => 'observed: `stopped at ${stage}: ${observed} ${log.join(" ").replace(/\\s+/g, " ").slice(0, 150)}`', [land]],
  ["landing does not clear the branch's alert", absorbFile, /\n    clearBranch\(safe, branch\);/, "", [land]],
  ["local main is not brought up to date", absorbFile, /else if \(!git\(mainTree\.path, "merge", "--ff-only", "refs\/remotes\/origin\/main"\)\.ok\) notes\.push/, () => 'else if (false) notes.push', [land]],
  ["the worktree being deleted is the working directory", absorbFile, /if \(branchTree && inside\(process\.cwd\(\), branchTree\.path\)\) process\.chdir\(safe\);/, "", [safety]],

  // finishing a landing that stopped in the cleanup, and keeping the proof
  ["a branch that main already holds is treated as a new one", absorbFile, /const resumed = heldByMain\(\);/, "const resumed = false;", [resume]],
  ["a branch that main does not hold is finished without a worktree", absorbFile, /if \(!resumed && !branchTree\) return await fail\("preflight"/, 'if (false) return await fail("preflight"', [resume]],
  ["a landed branch's worktree with uncommitted changes is not refused", absorbFile, /if \(branchTree && git\(branchTree\.path, "status", "--porcelain"\)\.out\.length > 0\) return await fail\("preflight"/, 'if (false) return await fail("preflight"', [resume]],
  ["the receipt of the commit that landed is not kept", absorbFile, /copyFileSync\(source, target\);/, "", [resume]],
  ["a worktree without a receipt file fails the landing", absorbFile, /notes\.push\("no full-tier receipt file was found in the worktree to keep"\); return;/, 'throw new Error("no receipt file");', [resume]],

  // alerts
  ["an invalid record is raised", alerts, /if \(!parsed\.ok \|\| parsed\.id !== "vaultix\.gate-failure\.v1"\) throw/, "if (false) throw", [alertTests]],
  ["a new commit keeps the old poke count", alerts, /const same = before\?\.record\?\.commit === record\.commit;/, "const same = true;", [alertTests]],
  ["a passing check clears every check's alerts", alerts, /if \(alert\.record\.check === checkId && /, "if (", [alertTests]],
  ["a file that is not a valid record is trusted", alerts, /if \(parsed\?\.ok && parsed\.id === "vaultix\.gate-failure\.v1"\) alerts\.push/, "if (true) alerts.push", [alertTests]],
  ["a webhook that is down makes the failure throw", alerts, /\} catch \(error\) \{\n    return \{ sent: false, reason: `the webhook could not be reached/, () => "} catch (error) {\n    throw error;\n    return { sent: false, reason: `the webhook could not be reached", [alertTests]],
  ["announcing a failure writes no alert", alerts, /const key = raise\(root, record\);/, 'const key = "none";', [alertTests]],
  ["the webhook is posted without saying it is urgent", alerts, /priority: "urgent", /, "", [alertTests]],
  ["alerts are kept per worktree, not shared", alerts, /resolve\(commonDir\(root\), "vx-alerts"\)/, 'resolve(root, ".gate/alerts")', [alertTests]],

  // hygiene
  ["an unmerged branch is reported as a leftover", hygiene, /if \(merged\(`refs\/heads\/\$\{name\}`\)\) items\.push/, "if (true) items.push", [hygienePoke]],
  ["main itself is reported as a leftover", hygiene, /\n    if \(name === "main"\) continue;/, "", [hygienePoke]],
  ["housekeeping alerts never clear themselves", hygiene, /if \(alert\.record\.kind === "leftover_ref" && !wanted\.has\(alert\.key\)\) clear/, "if (false) clear", [hygienePoke]],
  ["hygiene clears failure alerts too", hygiene, /if \(alert\.record\.kind === "leftover_ref" && !wanted\.has\(alert\.key\)\) clear/, "if (!wanted.has(alert.key)) clear", [hygienePoke]],
  ["a stale local main is not noticed", hygiene, /if \(local && local !== main && merged\("refs\/heads\/main"\)\)/, "if (false)", [hygienePoke]],

  // the poke
  ["a Stop hook pushes back even while it is already continuing", poke, /\n  if \(stopHookActive\) return null;/, "", [hygienePoke]],
  ["a Stop hook never gives up", poke, /alert\.pokes < MAX_POKES/, "true", [hygienePoke]],
  ["housekeeping blocks a session from ending", poke, /filter\(alert => isBlocking\(alert\.record\) && /, "filter(alert => ", [hygienePoke]],
  ["the context text leaves out the rule", poke, / \$\{FIX_THE_SOURCE\}\.`\];/, "`];", [hygienePoke]],
  ["the context text says nothing about how an alert clears", poke, /An alert clears only when its check passes or its branch lands on main[^\n]*\n/, "\n", [hygienePoke]],
  ["a hook outside a repository fails the session", poke, /\} catch \{\n    \/\/ Outside a repository/, "} catch (error) {\n    throw error;\n    // Outside a repository", [hygienePoke]],
  ["the hook counts a push-back it did not make", poke, /if \(stopHookActive\) return null;\n  const owed = list\(root\)\.filter/, "const owed0 = list(root); for (const a of owed0) countPoke(root, a.key);\n  if (stopHookActive) return null;\n  const owed = list(root).filter", [hygienePoke]],

  // the command line
  ["the command line exits 0 when it stopped", cli, /\nprocess\.exit\(1\);\n$/, "\nprocess.exit(0);\n", [hygienePoke]],
  ["the command line leaves out the rule", cli, /fix the source; do not change the expectation, ceiling, baseline or snapshot to match\. The failure is an alert/, "The failure is an alert", [hygienePoke]],
  ["--status exits 0 with an alert pending", cli, /process\.exit\(text \? 1 : 0\);/, "process.exit(0);", [hygienePoke]],
  ["--hygiene deletes nothing, or it would not be safe to run every session", cli, /process\.exit\(items\.length \? 1 : 0\);/, "process.exit(0);", [hygienePoke]]
];

const filter = process.argv[2];
const selected = filter ? mutations.filter(mutation => mutation[0].includes(filter)) : mutations;
if (selected.length === 0) { console.error(`no mutation matches "${filter}"`); process.exit(2); }

const ok = await runMutations({
  root, name: "absorb", mutations: selected, parallel: 4, timeoutSeconds: 300,
  // The scripts import the documents' schemas; node_modules is COPIED, never linked (see mutation-gate.mjs).
  entries: ["scripts", "kernel/contracts/documents/src", "kernel/contracts/documents/package.json", "kernel/contracts/documents/package-lock.json", "kernel/contracts/documents/tsconfig.json",
    "kernel/contracts/documents/node_modules/arktype", "kernel/contracts/documents/node_modules/@ark", "kernel/contracts/documents/node_modules/arkregex",
    "kernel/contracts/documents/node_modules/.vx-lock-hash"],
  links: [],
  cwd: ".", testArgs: ["--test", land, safety, alertTests, hygienePoke, resume]
});
process.exit(ok ? 0 : 1);
