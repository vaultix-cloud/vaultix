// Plants one bug at a time in the delivery gate itself (scripts/gate.mjs, scripts/gate/) and checks that its tests
// (scripts/gate/gate.test.mjs) fail on each. A gate whose tests cannot fail could pass a broken commit (docs/0142, section 3).
//
//   node scripts/mutation-gate.mjs
//
// The bugs go into throwaway copies (scripts/lib/mutation-copy.mjs), never into the real source. Each is a mistake that would be
// easy to make and that makes the gate say green when it should not, or leak what it should keep, or hang where it should stop.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMutations } from "./lib/mutation-copy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = "scripts/gate/run.mjs";
const receipt = "scripts/gate/receipt.mjs";
const failure = "scripts/gate/failure.mjs";
const cli = "scripts/gate.mjs";
const windows = process.platform === "win32";
const fs = 'process.getBuiltinModule("node:fs")';

const mutations = [
  // the runner
  ["a check that runs past its limit is not stopped", run, /timedOut = true; killTree\(child\.pid\);/, "timedOut = true;"],
  windows
    ? ["a timed-out check's children are left running", run, /\["\/PID", String\(pid\), "\/T", "\/F"\]/, '["/PID", String(pid), "/F"]']
    : ["a timed-out check's children are left running", run, /process\.kill\(-pid, "SIGKILL"\)/, 'process.kill(pid, "SIGKILL")'],
  ["a non-zero exit is read as a pass", run, /else if \(code === 0\)/, "else if (true)"],
  ["a timeout is reported as a plain failure", run, /status: "timeout", seconds: check\.timeoutSeconds/, 'status: "fail", seconds: check.timeoutSeconds, exitCode: 1'],
  ["a skipped check is reported as a pass", run, /status: "skipped", seconds: 0, reason \}/, 'status: "pass", seconds: 0, reason }'],
  ["a check that lacks what it needs runs anyway", run, /(which the gate could not provide`\));\s*continue;/, (_match, kept) => kept],
  ["checks that share a serial key overlap", run, /if \(check\.serial && serialBusy\.has\(check\.serial\)\) \{ index \+= 1; continue; \}/, ""],
  ["the parallel limit is ignored", run, /running\.size < jobs/, "true"],
  ["results come back in finishing order", run, /return checks\.map\(check => results\.get\(check\.id\)\);/, "return [...results.values()];"],
  ["a check's output is returned in its result", run, /try \{ closeSync\(log\); \} catch \{ \/\* closed \*\/ \} done\(result\);/, `try { closeSync(log); } catch { /* closed */ } done({ ...result, output: ${fs}.readFileSync(resolve(logDirectory, \`\${check.id}.log\`), "utf8") });`],

  ["a check runs even though its prerequisite did not pass", run, /if \(notPassed\.length > 0 \|\| missing\.length > 0\)/, "if (missing.length > 0)"],
  ["a check whose prerequisite is not in the run waits forever", run, /if \(running\.size === 0 && pending\.length > 0 && pending\.every\(/, "if (false && pending.every("],

  // receipts
  ["a skipped check counts as a pass in a receipt", receipt, /result\.status === "pass"\) \? "pass" : "fail"/, 'result.status !== "fail" && result.status !== "timeout") ? "pass" : "fail"'],
  ["the merge guard accepts a dirty worktree", receipt, /if \(requireClean && !receipt\.clean\)/, "if (false)"],
  ["the merge guard accepts a receipt for another commit", receipt, /if \(receipt\.commit !== commit\)/, "if (false)"],
  ["the merge guard accepts a receipt that skipped checks of its tier", receipt, /for \(const id of expectedIds\)/, "for (const id of [])"],
  ["the merge guard accepts a result that contradicts its checks", receipt, /if \(receipt\.result !== overall\(receipt\.checks\)\)/, "if (false)"],
  ["the merge guard accepts a fast receipt for a merge", receipt, /if \(tier === "full" && receipt\.tier !== "full"\)/, "if (false)"],
  ["the merge guard accepts a receipt that did not pass", receipt, /if \(receipt\.result !== "pass"\) problems\.push/, 'if (false) problems.push'],

  // failure records and messages
  ["a failure record includes what the check printed", failure, /expected: check\.expect,/, `expected: \`\${check.expect} \${(() => { try { return ${fs}.readFileSync(\`.gate/logs/\${check.id}.log\`, "utf8").replace(/\\s+/g, " ").slice(0, 120); } catch { return ""; } })()}\`,`],
  ["a message leaves out the fix-the-source rule", failure, /`\$\{record\.rule\}\.`,/, '"",'],

  // the command line
  ["the gate exits 0 when a check failed", cli, /process\.exit\(results\.every\(result => result\.status === "pass"\) \? 0 : 1\);/, "process.exit(0);"],
  ["a part of a tier writes a receipt", cli, /if \(only\) \{\n  console\.log\(`gate: ran/, "if (false) {\n  console.log(`gate: ran"],
  ["a dirty worktree is reported clean", cli, /const clean = git\("status", "--porcelain"\)\.length === 0;/, "const clean = true;"],
  ["an invalid registry does not stop the gate", cli, /if \(registryProblems\.length\) \{/, "if (false) {"],
  ["the test hooks work without VX_GATE_TEST=1", cli, /const testMode = process\.env\.VX_GATE_TEST === "1";/, "const testMode = true;"],
  ["--only runs a check without its prerequisites", cli, /const toRun = only \? withPrerequisites\(only\) : selected;/, "const toRun = only ? selected.filter(check => only.includes(check.id)) : selected;"],
  ["a prerequisite cycle is accepted", cli, /if \(cyclic\(check\.id\)\) \{/, "if (false) {"],
  ["the dependency installer ignores a changed lockfile", "scripts/gate/ensure-deps.mjs", /readFileSync\(marker, "utf8"\)\.trim\(\) === hash/, "true"],
  ["the dependency installer reinstalls every time", "scripts/gate/ensure-deps.mjs", /if \(existsSync\(marker\) && /, "if (false && "],
  ["the merge guard passes when there is no receipt", cli, /: \[`there is no \$\{wanted\}-tier receipt[^\n]*`\];/, ": [];"]
];

const ok = await runMutations({
  root, name: "gate", mutations, parallel: 4, timeoutSeconds: 100,
  // The gate imports the documents' schemas, and its tests check that every real check names a script that exists.
  // node_modules is COPIED (arktype and its two packages, 1.5 MB) and never linked: some of these mutations make the dependency
  // installer run `npm ci`, which deletes node_modules, and through a link that emptied the real one.
  entries: ["scripts", "kernel/contracts/documents/src", "kernel/contracts/documents/package.json", "kernel/contracts/documents/package-lock.json", "kernel/contracts/documents/tsconfig.json", "kernel/Cargo.toml",
    // arktype's whole runtime closure, read from the lockfile: arktype, @ark/schema, @ark/util, arkregex
    "kernel/contracts/documents/node_modules/arktype", "kernel/contracts/documents/node_modules/@ark", "kernel/contracts/documents/node_modules/arkregex",
    "kernel/contracts/documents/node_modules/.vx-lock-hash"],
  links: [],
  cwd: ".", testArgs: ["--test", "scripts/gate/gate.test.mjs"]
});
process.exit(ok ? 0 : 1);
