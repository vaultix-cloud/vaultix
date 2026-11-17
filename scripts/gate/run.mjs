// Runs gate checks: in parallel up to a limit, each under its own time limit, each with its output in its own log file.
//
// Three rules the standard depends on, each tested in gate.test.mjs and each with a planted bug in mutation-gate.mjs:
//   - a check that runs past its limit is stopped, along with everything it started (a hung build is not left running), and is
//     reported as a timeout, which is not the same as a failure;
//   - a check's output goes to `.gate/logs/<id>.log` and nowhere else: nothing here reads it back into a result;
//   - a check that needs something the gate could not provide is skipped with the reason, never silently, and never as a pass.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { resolve } from "node:path";

/** Stop a process and everything it started. */
export function killTree(pid) {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } } }
}

// On Windows npm and npx are .cmd files, which Node will only start through a shell. The arguments are then restricted to
// characters a shell leaves alone, so nothing here can become a command.
const SHELL_SAFE = /^[A-Za-z0-9._:/=@+,-]+$/;
const needsShell = program => process.platform === "win32" && (program === "npm" || program === "npx");

const round = seconds => Math.round(seconds * 1000) / 1000;

/** Run one check. Resolves to a result: { id, status, seconds, exitCode?, reason? }. Never rejects. */
export function runCheck(check, { root, logDirectory, env = process.env }) {
  const started = process.hrtime.bigint();
  const elapsed = () => round(Number(process.hrtime.bigint() - started) / 1e9);
  return new Promise(done => {
    const { program, args } = check.command;
    if (needsShell(program) && !args.every(argument => SHELL_SAFE.test(argument))) {
      done({ id: check.id, status: "fail", seconds: 0, exitCode: 2 });
      return;
    }
    mkdirSync(logDirectory, { recursive: true });
    const log = openSync(resolve(logDirectory, `${check.id}.log`), "w");
    let child;
    try {
      child = spawn(program, args, { cwd: resolve(root, check.cwd ?? "."), env, stdio: ["ignore", log, log], windowsHide: true, shell: needsShell(program), detached: process.platform !== "win32" });
    } catch {
      closeSync(log);
      done({ id: check.id, status: "fail", seconds: elapsed(), exitCode: 127 });
      return;
    }
    let timedOut = false;
    let settled = false;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); try { closeSync(log); } catch { /* closed */ } done(result); };
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, check.timeoutSeconds * 1000);
    // A program that cannot be started (not installed) is a failure with the conventional "not found" code.
    child.on("error", () => finish({ id: check.id, status: "fail", seconds: elapsed(), exitCode: 127 }));
    child.on("close", code => {
      if (timedOut) finish({ id: check.id, status: "timeout", seconds: check.timeoutSeconds });
      else if (code === 0) finish({ id: check.id, status: "pass", seconds: elapsed() });
      else finish({ id: check.id, status: "fail", seconds: elapsed(), exitCode: code ?? 1 });
    });
  });
}

/**
 * Run checks with at most `jobs` at a time, and never two checks with the same `serial` key together. `provided` says what the gate
 * could provide (`{ postgres: url }`); a check that needs more is skipped with the reason. `onFinish` is called as each one ends.
 */
export async function runChecks(checks, { root, logDirectory, jobs, provided = {}, onFinish = () => {} }) {
  const results = new Map();
  const pending = [...checks];
  const running = new Set();
  const serialBusy = new Set();
  await new Promise(resolveAll => {
    const launch = () => {
      for (let index = 0; index < pending.length && running.size < jobs;) {
        const check = pending[index];
        const missing = (check.needs ?? []).filter(need => !provided[need]);
        if (missing.length > 0) {
          pending.splice(index, 1);
          const result = { id: check.id, status: "skipped", seconds: 0, reason: `needs ${missing.join(" and ")}, which the gate could not provide` };
          results.set(check.id, result);
          onFinish(check, result);
          continue;
        }
        if (check.serial && serialBusy.has(check.serial)) { index += 1; continue; }
        pending.splice(index, 1);
        if (check.serial) serialBusy.add(check.serial);
        const env = { ...process.env };
        if (provided.postgres && (check.needs ?? []).includes("postgres")) env.VX_TEST_DATABASE_URL = provided.postgres;
        const promise = runCheck(check, { root, logDirectory, env }).then(result => {
          running.delete(promise);
          if (check.serial) serialBusy.delete(check.serial);
          results.set(check.id, result);
          onFinish(check, result);
          launch();
        });
        running.add(promise);
      }
      if (pending.length === 0 && running.size === 0) resolveAll();
    };
    launch();
  });
  // In the order the checks were given, whatever order they finished in.
  return checks.map(check => results.get(check.id));
}
