// Tests for the delivery gate (scripts/gate.mjs and scripts/gate/). The point of the gate is what it refuses, so these tests are
// mostly about refusals, and they drive the real command line against a temporary repository with fake checks wherever the whole
// path matters (VX_GATE_TEST=1 allows that and nothing else does):
//   - a check that hangs is stopped with everything it started, and is a timeout, not a failure;
//   - what a check prints is in its log and in no failure record and no message (a canary proves it);
//   - a receipt only stands for a merge when it is valid, passing, complete, clean, and about this commit and tier;
//   - a skipped check is not a pass; the registry is validated; checks never overlap when they must not.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { failureFor, messageFor } from "./failure.mjs";
import { buildReceipt, verifyReceipt } from "./receipt.mjs";
import { removeCopy, runMutations } from "../lib/mutation-copy.mjs";
import { runCheck, runChecks } from "./run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const gate = resolve(here, "../gate.mjs");
const CANARY = "CANARY-5c2e77-a-secret-in-a-check's-output";
const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

const sleep = ms => new Promise(done => setTimeout(done, ms));
const scripts = {
  "ok.mjs": "process.exit(0);",
  "fail.mjs": `console.log(${JSON.stringify(CANARY)}); console.error(${JSON.stringify(CANARY)}); process.exit(3);`,
  "hang.mjs": `
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    // On Windows a plain grandchild dies with its parent, so it cannot show whether the whole tree was stopped; a detached one outlives
    // it unless it is killed itself. (On POSIX a detached process leaves the check's process group, which the real kill uses, so it stays plain.)
    const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: process.platform === "win32" });
    writeFileSync("grandchild.pid", String(grandchild.pid));
    console.log(${JSON.stringify(CANARY)});
    setInterval(() => {}, 1000);`,
  "span.mjs": `
    import { appendFileSync } from "node:fs";
    const name = process.argv[2];
    appendFileSync("spans.log", "start " + name + " " + Date.now() + "\\n");
    await new Promise(done => setTimeout(done, 700));
    appendFileSync("spans.log", "end " + name + " " + Date.now() + "\\n");`,
  "side-effect.mjs": `import { writeFileSync } from "node:fs"; writeFileSync("ran.txt", "it ran");`
};
const node = (...args) => ({ program: "node", args });

/** A temporary git repository with the fixture scripts and a check list, so the real CLI can be run against it. */
function repository(list) {
  const dir = mkdtempSync(join(tmpdir(), "vx-gate-test-"));
  made.push(dir);
  for (const [name, body] of Object.entries(scripts)) writeFileSync(join(dir, name), body);
  writeFileSync(join(dir, ".gitignore"), ".gate/\nspans.log\ngrandchild.pid\nran.txt\n");
  const source = `export const checks = ${JSON.stringify(list)};\n`;
  writeFileSync(join(dir, "checks.mjs"), source);
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "gate@test.invalid");
  git("config", "user.name", "gate test");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  return { dir, head: git("rev-parse", "HEAD").stdout.trim(), git };
}
const check = (id, script, extra = {}) => ({ id, tier: "fast", title: id, command: node(script, ...(extra.args ?? [])), timeoutSeconds: 30, expect: `${id} passes`, ...extra, args: undefined });
const cli = (repo, ...args) => spawnSync(process.execPath, [gate, ...args], { cwd: repo.dir, encoding: "utf8", env: { ...process.env, VX_GATE_TEST: "1", VX_GATE_ROOT: repo.dir, VX_GATE_CHECKS: join(repo.dir, "checks.mjs") } });
const receiptOf = (repo, tier = "fast") => JSON.parse(readFileSync(join(repo.dir, ".gate/receipts", `${repo.head}.${tier}.json`), "utf8"));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---- the runner ----

test("a check that passes, and one that fails with its exit code, are told apart, and their output goes to a log", async () => {
  const { dir } = repository([]);
  const options = { root: dir, logDirectory: join(dir, ".gate/logs") };
  assert.deepEqual(Object.keys(await runCheck(check("ok", "ok.mjs"), options)).sort(), ["id", "seconds", "status"]);
  const failed = await runCheck(check("bad", "fail.mjs"), options);
  assert.deepEqual([failed.status, failed.exitCode], ["fail", 3]);
  assert.ok(readFileSync(join(dir, ".gate/logs/bad.log"), "utf8").includes(CANARY), "the output is in the log");
  assert.ok(!JSON.stringify(failed).includes(CANARY), "and in nothing the runner returns");
});

test("a program that does not exist is a failure with the not-found code, not a crash and not a pass", async () => {
  const { dir } = repository([]);
  const result = await runCheck({ id: "ghost", tier: "fast", title: "ghost", command: { program: "vx-no-such-program", args: [] }, timeoutSeconds: 5, expect: "x" }, { root: dir, logDirectory: join(dir, ".gate/logs") });
  assert.deepEqual([result.status, result.exitCode], ["fail", 127]);
});

test("a check that hangs is stopped with everything it started, and is a timeout and not a failure", async () => {
  const { dir } = repository([]);
  const result = await runCheck(check("hang", "hang.mjs", { timeoutSeconds: 1 }), { root: dir, logDirectory: join(dir, ".gate/logs") });
  assert.deepEqual([result.status, result.seconds], ["timeout", 1]);
  assert.equal(result.exitCode, undefined, "a timeout has no exit code to read as a disagreement");
  const grandchild = Number(readFileSync(join(dir, "grandchild.pid"), "utf8"));
  for (let wait = 0; wait < 40 && alive(grandchild); wait += 1) await sleep(100);
  assert.equal(alive(grandchild), false, "the process the check started is gone too");
});

test("a check that needs Postgres when none was provided is skipped, with the reason, and does not run", async () => {
  const { dir } = repository([]);
  const results = await runChecks([check("needs-db", "side-effect.mjs", { needs: ["postgres"] })], { root: dir, jobs: 2, provided: {}, logDirectory: join(dir, ".gate/logs") });
  assert.equal(results[0].status, "skipped");
  assert.match(results[0].reason, /postgres/);
  assert.equal(existsSync(join(dir, "ran.txt")), false, "a skipped check did not run");
});

test("checks run in parallel up to the limit, never two with the same serial key, and results keep the order given", async () => {
  const overlap = log => {
    const events = readFileSync(log, "utf8").trim().split("\n").map(line => line.split(" "));
    let running = 0; let most = 0;
    for (const [kind] of events.sort((a, b) => Number(a[2]) - Number(b[2]) || (a[0] === "end" ? -1 : 1))) { running += kind === "start" ? 1 : -1; most = Math.max(most, running); }
    return most;
  };
  const four = ["a", "b", "c", "d"].map(name => check(name, "span.mjs", { args: [name] }));
  for (const [label, list, jobs, verdict] of [["parallel", four, 4, most => most >= 2], ["one at a time", four, 1, most => most === 1], ["serial key", four.map(item => ({ ...item, serial: "k" })), 4, most => most === 1]]) {
    const { dir } = repository([]);
    const results = await runChecks(list, { root: dir, jobs, provided: {}, logDirectory: join(dir, ".gate/logs") });
    assert.deepEqual(results.map(result => result.id), ["a", "b", "c", "d"], `${label}: order`);
    assert.ok(results.every(result => result.status === "pass"), label);
    assert.ok(verdict(overlap(join(dir, "spans.log"))), `${label}: overlap was ${overlap(join(dir, "spans.log"))}`);
  }
});

// ---- failure records and messages ----

test("a failure record and its message hold the gate's own words and never what the check printed", async () => {
  const { dir, head } = repository([]);
  const bad = check("bad", "fail.mjs");
  const hung = check("hung", "hang.mjs", { timeoutSeconds: 1 });
  const options = { root: dir, logDirectory: join(dir, ".gate/logs") };
  const results = [await runCheck(bad, options), await runCheck(hung, options)];
  assert.ok(readFileSync(join(dir, ".gate/logs/bad.log"), "utf8").includes(CANARY));
  for (const [item, result, kind] of [[bad, results[0], "check_failed"], [hung, results[1], "check_timed_out"]]) {
    const record = failureFor(item, result, { commit: head, tier: "fast" });
    assert.equal(record.kind, kind);
    assert.equal(record.logPath, `.gate/logs/${item.id}.log`);
    const message = messageFor(record, { from: "notify@example.invalid", to: "owner@example.invalid" });
    assert.ok(!JSON.stringify(record).includes(CANARY) && !message.includes(CANARY), `${kind}: no output in the record or the message`);
    // On its own line, where a reader sees it first: the record below also holds it, so a mere substring match would pass without it.
    assert.ok(message.split("\n").includes("fix the source; do not change the expectation, ceiling, baseline or snapshot to match."), `${kind}: the message says the rule on its own line`);
    assert.ok(message.includes("Subject: Vaultix gate failed:"));
  }
  assert.equal(failureFor(bad, { id: "bad", status: "pass", seconds: 1 }, { commit: head, tier: "fast" }), null, "a pass has no failure record");
  assert.equal(failureFor(bad, { id: "bad", status: "skipped", seconds: 0, reason: "x" }, { commit: head, tier: "fast" }), null, "a skip is reported as a skip, not as a failure");
});

test("a message with no mail address configured says so instead of inventing one", () => {
  const record = failureFor({ id: "x", expect: "x passes", timeoutSeconds: 5 }, { id: "x", status: "fail", seconds: 1, exitCode: 1 }, { commit: "a".repeat(40), tier: "fast" });
  const message = messageFor(record, {});
  assert.match(message, /From: \(VX_GATE_NOTIFY_FROM is not set\)/);
  assert.match(message, /To: \(VX_GATE_NOTIFY_TO is not set\)/);
});

// ---- receipts ----

const commit = "0123456789abcdef0123456789abcdef01234567";
const base = { commit, tier: "full", startedAt: new Date("2026-11-17T18:00:00Z"), finishedAt: new Date("2026-11-17T18:01:00Z"), clean: true };
const passing = [{ id: "a", status: "pass", seconds: 1 }, { id: "b", status: "pass", seconds: 2 }];
const verify = (receipt, extra = {}) => verifyReceipt(receipt, { commit, tier: "full", expectedIds: ["a", "b"], ...extra });

test("a receipt is a pass only when every check passed: a failure, a timeout and a skip each make it a fail", () => {
  assert.equal(buildReceipt({ ...base, results: passing }).result, "pass");
  for (const result of [{ id: "b", status: "fail", seconds: 1, exitCode: 1 }, { id: "b", status: "timeout", seconds: 600 }, { id: "b", status: "skipped", seconds: 0, reason: "no docker" }]) {
    assert.equal(buildReceipt({ ...base, results: [passing[0], result] }).result, "fail", result.status);
  }
});

test("a receipt stands for a merge only if it is valid, passing, complete, clean and about this commit and tier", () => {
  const good = buildReceipt({ ...base, results: passing });
  assert.deepEqual(verify(good), []);
  const contains = (problems, text) => assert.ok(problems.some(problem => problem.includes(text)), `${JSON.stringify(problems)} should mention "${text}"`);
  contains(verify(good, { commit: "f".repeat(40) }), "different commit");
  contains(verify({ ...good, tier: "fast" }), "fast-tier receipt");
  contains(verify({ ...good, result: "fail" }), "its result is fail but its checks say pass");
  contains(verify({ ...good, checks: [...passing, passing[0]] }), "more than once");
  contains(verify({ ...good, startedAt: "2026-11-17T19:00:00.000Z" }), "before it started");
  contains(verify(good, { expectedIds: ["a", "b", "c"] }), "check c did not run");
  contains(verify({ ...good, clean: false }), "uncommitted changes");
  contains(verify(buildReceipt({ ...base, results: [passing[0], { id: "b", status: "fail", seconds: 1, exitCode: 1 }] })), "did not pass");
  assert.ok(verify({ ...good, surprise: 1 }).length > 0, "an undeclared key makes it not a receipt");
  assert.ok(verify("not a receipt").length > 0);
  assert.deepEqual(verify({ ...good, tier: "full" }, { tier: "fast" }), [], "a full receipt can stand in for a fast one");
});

// ---- the command line, end to end ----

test("every check passing: exit 0, a valid receipt, and the merge guard accepts it", () => {
  const repo = repository([check("one", "ok.mjs"), check("two", "ok.mjs")]);
  const run = cli(repo);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const receipt = receiptOf(repo);
  assert.deepEqual([receipt.result, receipt.clean, receipt.checks.map(item => item.status)], ["pass", true, ["pass", "pass"]]);
  assert.equal(cli(repo, "--verify-receipt", "fast").status, 0);
  assert.equal(cli(repo, "--verify-receipt", "full").status, 1, "a fast receipt is not enough for a merge");
});

test("a failing check: exit 1, a failing receipt, a record and an outbox message without the check's output, and the guard refuses", () => {
  const repo = repository([check("fine", "ok.mjs"), check("bad", "fail.mjs", { expect: "bad passes" })]);
  const run = cli(repo);
  assert.equal(run.status, 1);
  assert.equal(receiptOf(repo).result, "fail");
  const record = JSON.parse(readFileSync(join(repo.dir, ".gate/failures", repo.head, "bad.json"), "utf8"));
  assert.deepEqual([record.kind, record.exitCode, record.expected], ["check_failed", 3, "bad passes"]);
  const outbox = readdirSync(join(repo.dir, ".gate/outbox"));
  assert.equal(outbox.length, 1, "one failure, one message");
  const everything = [readFileSync(join(repo.dir, ".gate/outbox", outbox[0]), "utf8"), JSON.stringify(record), run.stdout, run.stderr].join("\n");
  assert.ok(!everything.includes(CANARY), "the check's output is in none of the record, the message or the gate's own output");
  assert.ok(readFileSync(join(repo.dir, ".gate/logs/bad.log"), "utf8").includes(CANARY), "it is in the log");
  const guard = cli(repo, "--verify-receipt", "fast");
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /did not pass/);
});

test("a failing check raises an alert in the shared git directory, and only that check passing clears it", () => {
  const repo = repository([check("bad", "fail.mjs"), check("also-bad", "fail.mjs")]);
  const alertFiles = () => { try { return readdirSync(join(repo.dir, ".git/vx-alerts")).sort(); } catch { return []; } };
  const run = cli(repo);
  assert.equal(run.status, 1);
  assert.deepEqual(alertFiles(), ["check_failed-also-bad.json", "check_failed-bad.json"]);
  assert.ok(!readFileSync(join(repo.dir, ".git/vx-alerts/check_failed-bad.json"), "utf8").includes(CANARY), "an alert holds what the gate wrote, never what the check printed");
  assert.match(run.stdout, /alert check_failed-bad/);
  // Fix one check's source. The other is still failing, so its alert must stay: nothing clears an alert but the check passing.
  writeFileSync(join(repo.dir, "checks.mjs"), `export const checks = ${JSON.stringify([check("bad", "ok.mjs"), check("also-bad", "fail.mjs")])};\n`);
  assert.equal(cli(repo).status, 1);
  assert.deepEqual(alertFiles(), ["check_failed-also-bad.json"]);
  writeFileSync(join(repo.dir, "checks.mjs"), `export const checks = ${JSON.stringify([check("bad", "ok.mjs"), check("also-bad", "ok.mjs")])};\n`);
  assert.equal(cli(repo).status, 0);
  assert.deepEqual(alertFiles(), []);
});

test("a check that hangs is a timeout on the command line, with a record that says so", () => {
  const repo = repository([check("hung", "hang.mjs", { timeoutSeconds: 1 })]);
  const run = cli(repo);
  assert.equal(run.status, 1);
  assert.equal(receiptOf(repo).checks[0].status, "timeout");
  assert.equal(JSON.parse(readFileSync(join(repo.dir, ".gate/failures", repo.head, "hung.json"), "utf8")).kind, "check_timed_out");
});

test("uncommitted changes: the receipt says so and the merge guard refuses it", () => {
  const repo = repository([check("one", "ok.mjs")]);
  writeFileSync(join(repo.dir, "untracked-change.txt"), "not committed");
  assert.equal(cli(repo).status, 0, "the checks pass");
  assert.equal(receiptOf(repo).clean, false);
  const guard = cli(repo, "--verify-receipt", "fast");
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /uncommitted changes/);
});

test("no receipt at all: the merge guard refuses and says what to run", () => {
  const repo = repository([check("one", "ok.mjs")]);
  const guard = cli(repo, "--verify-receipt", "full");
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /no full-tier receipt/);
});

test("a receipt for another commit does not stand for this one", () => {
  const repo = repository([check("one", "ok.mjs")]);
  assert.equal(cli(repo).status, 0);
  writeFileSync(join(repo.dir, "next.txt"), "next");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "next");
  const guard = cli(repo, "--verify-receipt", "fast");
  assert.equal(guard.status, 1, "the new head has no receipt");
  assert.match(guard.stderr, /no fast-tier receipt/);
});

test("--only runs part of a tier and writes no receipt, because a part is not a pass", () => {
  const repo = repository([check("one", "ok.mjs"), check("two", "ok.mjs")]);
  const run = cli(repo, "--only", "one");
  assert.equal(run.status, 0);
  assert.equal(existsSync(join(repo.dir, ".gate/receipts")), false);
  assert.match(run.stdout, /no receipt is written for part of a tier/);
  assert.equal(cli(repo, "--only", "missing").status, 2, "an unknown check is an error, not a skipped one");
});

test("the registry is validated: a duplicate id, a shell, no time limit and a multi-line expectation each stop the gate", () => {
  for (const [label, list, message] of [
    ["duplicate", [check("one", "ok.mjs"), check("one", "ok.mjs")], /listed twice/],
    ["shell", [{ ...check("one", "ok.mjs"), command: { program: "sh", args: ["-c", "true"] } }], /command is not a program/],
    ["no limit", [{ ...check("one", "ok.mjs"), timeoutSeconds: 0 }], /time limit/],
    ["two lines", [{ ...check("one", "ok.mjs"), expect: "a\nb" }], /one line of printable text/],
    ["bad id", [check("Not A Slug", "ok.mjs")], /not a slug/]
  ]) {
    const run = cli(repository(list));
    assert.equal(run.status, 2, label);
    assert.match(run.stderr, message, label);
  }
});

test("the gate's test hooks do nothing without VX_GATE_TEST=1: the real registry is used", () => {
  const repo = repository([check("fixture-only-check", "ok.mjs")]);
  const run = spawnSync(process.execPath, [gate, "--list"], { cwd: repo.dir, encoding: "utf8", env: { ...process.env, VX_GATE_TEST: "", VX_GATE_CHECKS: join(repo.dir, "checks.mjs"), VX_GATE_ROOT: repo.dir } });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /kernel-clippy/, "the real checks, not the fixture's");
  assert.doesNotMatch(run.stdout, /fixture-only-check/);
});

test("every real check is valid and names a script that exists", async () => {
  const { checks } = await import("./checks.mjs");
  const root = resolve(here, "../..");
  assert.ok(checks.length >= 14);
  for (const item of checks) {
    const script = item.command.args.find(argument => /^scripts\/.*\.mjs$/.test(argument));
    if (script) assert.ok(existsSync(resolve(root, script)), `${item.id}: ${script} exists`);
    if (item.cwd) assert.ok(existsSync(resolve(root, item.cwd)), `${item.id}: ${item.cwd} exists`);
  }
});

// A test file that no check runs proves nothing, and nothing says so: cargo runs only the server's integration tests that a check
// names with --test, so a new file under kernel/server/tests was run by nothing. The first-owner-to-logout journeys sat in that
// state and the gate was green. Every one of the server's test files must be named by a check.
test("every integration test file of the server is run by a check, and the auth journeys get the client they run", async () => {
  const { checks } = await import("./checks.mjs");
  const root = resolve(here, "../..");
  const files = readdirSync(resolve(root, "kernel/server/tests"), { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(".rs")).map(entry => entry.name.slice(0, -3));
  assert.ok(files.includes("auth") && files.includes("api"), "the server's test files were found");
  const named = new Set();
  for (const item of checks) {
    const { program, args } = item.command;
    for (let index = 0; program === "cargo" && index < args.length - 1; index += 1) if (args[index] === "--test") named.add(args[index + 1]);
  }
  for (const file of files) assert.ok(named.has(file), `kernel/server/tests/${file}.rs is run by no check: add --test ${file} to a check in scripts/gate/checks.mjs`);
  const server = checks.find(item => item.id === "kernel-server-tests");
  assert.ok(server.after?.includes("kernel-client-build"), "the auth journeys run the vx client, so the check that runs them waits for the check that builds it");
  assert.ok(checks.find(item => item.id === "kernel-client-build"), "the check that builds the vx client exists");
});

// The same rule for the gate's own tests: node runs the files a check names, so a new scripts/gate/*.test.mjs is run by nothing until it is
// listed. (Most of the older scripts/*.test.mjs files are exactly that, and are listed as a known gap rather than hidden.)
test("every test file of the gate itself is run by a check", async () => {
  const { checks } = await import("./checks.mjs");
  const files = readdirSync(here).filter(name => name.endsWith(".test.mjs")).map(name => `scripts/gate/${name}`);
  assert.ok(files.length >= 5, "the gate's test files were found");
  const named = new Set(checks.filter(item => item.command.program === "node").flatMap(item => item.command.args));
  for (const file of files) assert.ok(named.has(file), `${file} is run by no check: add it to a check in scripts/gate/checks.mjs`);
});

// ---- prerequisites (`after`) ----

test("a check waits for its prerequisites, and runs once they pass", async () => {
  const { dir } = repository([]);
  const list = [check("second", "span.mjs", { args: ["second"], after: ["first"] }), check("first", "span.mjs", { args: ["first"] })];
  const results = await runChecks(list, { root: dir, jobs: 4, provided: {}, logDirectory: join(dir, ".gate/logs") });
  assert.deepEqual(results.map(result => [result.id, result.status]), [["second", "pass"], ["first", "pass"]], "results keep the order given");
  const spans = readFileSync(join(dir, "spans.log"), "utf8").trim().split("\n").map(line => line.split(" "));
  const at = (kind, name) => Number(spans.find(span => span[0] === kind && span[1] === name)[2]);
  assert.ok(at("start", "second") >= at("end", "first"), "the dependent started only after its prerequisite had ended, with room to run in parallel");
});

test("a check whose prerequisite did not pass is skipped with the reason, does not run, and is not a pass", async () => {
  const { dir } = repository([]);
  const list = [check("deps", "fail.mjs"), check("needs-deps", "side-effect.mjs", { after: ["deps"] }), check("independent", "ok.mjs")];
  const results = await runChecks(list, { root: dir, jobs: 4, provided: {}, logDirectory: join(dir, ".gate/logs") });
  assert.deepEqual(results.map(result => result.status), ["fail", "skipped", "pass"]);
  assert.match(results[1].reason, /deps did not pass first/);
  assert.equal(existsSync(join(dir, "ran.txt")), false);
});

test("a prerequisite that is not part of the run cannot leave a check waiting forever", async () => {
  const { dir } = repository([]);
  const results = await runChecks([check("orphan", "side-effect.mjs", { after: ["not-in-this-run"] })], { root: dir, jobs: 2, provided: {}, logDirectory: join(dir, ".gate/logs") });
  assert.equal(results[0].status, "skipped");
  assert.match(results[0].reason, /not part of this run/);
});

test("--only runs a check's prerequisites with it, and the registry refuses an unknown prerequisite, a cycle, and a fast check waiting on a full one", () => {
  const repo = repository([check("base", "span.mjs", { args: ["base"] }), check("top", "span.mjs", { args: ["top"], after: ["base"] }), check("other", "ok.mjs")]);
  const run = cli(repo, "--only", "top");
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /PASS\s+base/, "the prerequisite ran too");
  assert.doesNotMatch(run.stdout, /other/, "and nothing else did");
  for (const [label, list, message] of [
    ["unknown", [check("a", "ok.mjs", { after: ["ghost"] })], /ghost, which is not a check/],
    ["cycle", [check("a", "ok.mjs", { after: ["b"] }), check("b", "ok.mjs", { after: ["a"] })], /form a cycle/],
    ["self", [check("a", "ok.mjs", { after: ["a"] })], /form a cycle/],
    ["fast waits for full", [check("a", "ok.mjs", { after: ["b"] }), check("b", "ok.mjs", { tier: "full" })], /cannot wait for b, which is in the full tier/]
  ]) {
    const refused = cli(repository(list));
    assert.equal(refused.status, 2, label);
    assert.match(refused.stderr, message, label);
  }
});

// ---- the dependency installer ----

test("ensure-deps installs only when the lockfile changed, and refuses a directory with no lockfile", () => {
  const dir = mkdtempSync(join(tmpdir(), "vx-deps-test-"));
  made.push(dir);
  const lock = description => JSON.stringify({ name: "fixture", version: "1.0.0", description, lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", version: "1.0.0" } } });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  writeFileSync(join(dir, "package-lock.json"), lock("one"));
  const ensure = (...directories) => spawnSync(process.execPath, [resolve(here, "ensure-deps.mjs"), ...directories], { encoding: "utf8" });
  const first = ensure(dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /npm ci/);
  // npm prints "up to date" itself when it reinstalls nothing new, so match the installer's own sentence and the absence of `npm ci`.
  const second = ensure(dir).stdout;
  assert.match(second, /dependencies are up to date/, "a second run says it did nothing");
  assert.doesNotMatch(second, /npm ci/, "and did not run npm");
  writeFileSync(join(dir, "package-lock.json"), lock("two"));
  assert.match(ensure(dir).stdout, /npm ci/, "a changed lockfile installs again");
  const empty = mkdtempSync(join(tmpdir(), "vx-deps-empty-"));
  made.push(empty);
  const none = ensure(empty);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no package-lock\.json/);
  assert.equal(ensure().status, 2, "no directory is a usage error");
});

// ---- the mutation runner's cleanup ----

test("removing a mutation copy never deletes through a link to the real files, and refuses when a link is left", () => {
  const base = mkdtempSync(join(tmpdir(), "vx-removecopy-"));
  made.push(base);
  const precious = join(base, "precious");
  mkdirSync(join(precious, "nested"), { recursive: true });
  writeFileSync(join(precious, "nested/keep.txt"), "the real node_modules");
  const copy = (name, linkNames) => {
    const dir = join(base, name);
    mkdirSync(join(dir, "inside"), { recursive: true });
    writeFileSync(join(dir, "inside/file.txt"), "a copied file");
    for (const link of linkNames) symlinkSync(precious, join(dir, link), "junction");
    return dir;
  };
  // a listed link is removed as a link, and the copy goes with it
  const listed = copy("listed", ["linked"]);
  removeCopy(listed, ["linked"]);
  assert.equal(existsSync(listed), false, "the copy is gone");
  assert.equal(readFileSync(join(precious, "nested/keep.txt"), "utf8"), "the real node_modules", "and what it linked to is untouched");
  // a link nobody listed: refuse, delete nothing, and the target is still whole
  const forgotten = copy("forgotten", ["linked"]);
  assert.throws(() => removeCopy(forgotten, []), /refusing to delete .* still contains a link/);
  assert.equal(existsSync(join(forgotten, "inside/file.txt")), true, "nothing was deleted");
  assert.equal(readFileSync(join(precious, "nested/keep.txt"), "utf8"), "the real node_modules");
  unlinkSync(join(forgotten, "linked"));
  removeCopy(forgotten, []);
  assert.equal(existsSync(forgotten), false);
  removeCopy(join(base, "never-existed"), []);
});

test("two mutation runs at once do not disturb each other: one finishing leaves the other's copies alone", async () => {
  // The gate runs two mutation checks together. Each used to delete the shared .gate/mutants when it finished, which took the other's
  // copies away mid-test (EBUSY on Windows, a vanished file elsewhere). The slow run here checks its own copy is still there after it
  // has slept past the fast run's finish.
  const root = mkdtempSync(join(tmpdir(), "vx-mutation-race-"));
  made.push(root);
  writeFileSync(join(root, "value.txt"), "good");
  const tests = (name, sleepMs) => ["-e", `
    const fs = require("fs");
    setTimeout(() => {
      const ok = fs.existsSync("value.txt") && fs.readFileSync("value.txt", "utf8") === "good";
      console.log(ok ? "ok 1 - ${name}" : "not ok 1 - ${name}");
      process.exit(ok ? 0 : 1);
    }, ${sleepMs});`];
  const options = { root, entries: ["value.txt"], cwd: ".", parallel: 1, timeoutSeconds: 30, mutations: [["good becomes bad", "value.txt", /good/, "bad"]] };
  const originalLog = console.log;
  console.log = () => {};
  let slow; let fast;
  try { [slow, fast] = await Promise.all([runMutations({ ...options, name: "slow", testArgs: tests("slow", 2500) }), runMutations({ ...options, name: "fast", testArgs: tests("fast", 100) })]); }
  finally { console.log = originalLog; }
  assert.deepEqual([slow, fast], [true, true], "both runs caught their planted bug and neither was disturbed");
  assert.equal(readFileSync(join(root, "value.txt"), "utf8"), "good", "the real file was never touched");
  assert.equal(existsSync(join(root, ".gate/mutants")), false, "and nothing is left behind");
});
