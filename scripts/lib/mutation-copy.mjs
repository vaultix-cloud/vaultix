// Mutation checks done safely: each planted bug goes into a throwaway COPY of the files under test, never into the real source.
// (An earlier script edited the source in place; a killed run left a planted bug in a commit, ae4a7c8b. A copy cannot do that.)
//
// For each mutation: copy the entries, apply the change, confirm the change really changed a file, run the tests in the copy, and
// report whether they failed. A mutation the tests do not fail on SURVIVED, and the run fails: a test that cannot fail proves
// nothing (docs/0142, section 3). Copies live under `.gate/mutants/` (ignored by git) and are removed afterwards.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Copy `entries` (paths relative to root) into `dir`, keeping their layout, and link `links` (large, read-only: node_modules). */
function makeCopy({ root, dir, entries, links }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const entry of entries) {
    mkdirSync(dirname(resolve(dir, entry)), { recursive: true });
    cpSync(resolve(root, entry), resolve(dir, entry), { recursive: true });
  }
  for (const link of links) {
    mkdirSync(dirname(resolve(dir, link)), { recursive: true });
    symlinkSync(resolve(root, link), resolve(dir, link), "junction");
  }
}

function runTests({ dir, cwd, args, timeoutSeconds }) {
  return new Promise(done => {
    const child = spawn(process.execPath, args, { cwd: resolve(dir, cwd), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", chunk => { text += chunk; });
    child.stderr.on("data", chunk => { text += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGKILL");
    }, timeoutSeconds * 1000);
    child.on("close", status => {
      clearTimeout(timer);
      const clean = text.replace(/\r/g, "");
      done({ status: timedOut ? null : status, timedOut, failed: [...clean.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]) });
    });
  });
}

/**
 * @param {object} options
 * @param {string} options.root            repository root
 * @param {string[]} options.entries       paths to copy (relative to root)
 * @param {string[]} options.links         paths to link instead of copy (relative to root)
 * @param {string} options.cwd             where, inside a copy, the test command runs
 * @param {string[]} options.testArgs      node arguments that run the tests, e.g. ["--test", "tests/x.test.mjs"]
 * @param {Array<[string, string, RegExp, string | ((...groups: string[]) => string)]>} options.mutations  [label, file (relative to root), pattern, replacement]
 * @returns {Promise<boolean>} true when every mutation was caught
 */
export async function runMutations({ root, entries, links = [], cwd, testArgs, mutations, parallel = 4, timeoutSeconds = 120, name }) {
  const base = resolve(root, ".gate/mutants", name);
  const dirOf = index => `${base}-${index}`;
  const options = { root, entries, links };
  makeCopy({ ...options, dir: dirOf("baseline") });
  const baseline = await runTests({ dir: dirOf("baseline"), cwd, args: testArgs, timeoutSeconds: timeoutSeconds * 2 });
  rmSync(dirOf("baseline"), { recursive: true, force: true });
  console.log(`baseline: ${baseline.status === 0 ? "pass" : `FAIL ${baseline.timedOut ? "(timed out)" : baseline.failed.join("; ")}`}`);
  if (baseline.status !== 0) return false;

  const outcomes = new Array(mutations.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= mutations.length) return;
      const [label, file, pattern, replacement] = mutations[index];
      const dir = dirOf(index);
      makeCopy({ ...options, dir });
      const path = resolve(dir, file);
      const before = readFileSync(path, "utf8");
      // A string replacement is literal (so a $ in it is a $); a function replacement may use the pattern's groups.
      const after = before.replace(pattern, typeof replacement === "function" ? replacement : () => replacement);
      if (after === before) { outcomes[index] = { label, verdict: "unchanged" }; rmSync(dir, { recursive: true, force: true }); continue; }
      writeFileSync(path, after);
      const result = await runTests({ dir, cwd, args: testArgs, timeoutSeconds });
      const caught = result.status !== 0;
      outcomes[index] = { label, verdict: caught ? "caught" : "survived", detail: result.timedOut ? "the tests hung" : result.failed[0]?.slice(0, 90) ?? "the module no longer loads" };
      rmSync(dir, { recursive: true, force: true });
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, mutations.length) }, worker));
  let missed = 0;
  for (const outcome of outcomes) {
    if (outcome.verdict === "caught") console.log(`caught      ${outcome.label}  ->  ${outcome.detail}`);
    else { missed += 1; console.log(`!! ${outcome.verdict === "unchanged" ? "NO CHANGE " : "SURVIVED  "}${outcome.label}${outcome.verdict === "unchanged" ? "  (the pattern did not match, so nothing was planted)" : ""}`); }
  }
  rmSync(resolve(root, ".gate/mutants"), { recursive: true, force: true });
  console.log(missed === 0 ? `\nall ${mutations.length} planted bugs were caught` : `\n${missed} of ${mutations.length} planted bugs were NOT caught`);
  return missed === 0;
}
