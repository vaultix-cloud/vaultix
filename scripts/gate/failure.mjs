// A failure record for a check that did not pass, and the message that carries it to the owner (docs/0142, sections 4 and 5).
//
// A record holds only text this file writes: the check's fixed expectation (from checks.mjs) and a fixed sentence about what
// happened (an exit code, or a time limit). It never holds what the check printed. That output is in `.gate/logs/<id>.log` on
// this machine, and the record points at the file. So there is nothing for a secret to travel in: a test (gate.test.mjs) puts
// a canary in a failing check's output and requires that it is in the log and in no record and no message.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIX_THE_SOURCE } from "../../kernel/contracts/documents/src/gate-failure.v1.ts";
import { parseDocument } from "../../kernel/contracts/documents/src/registry.ts";

/** The record for one result that is not a pass or a skip, or null for one that is. */
export function failureFor(check, result, { commit, tier }) {
  const common = { schemaVersion: "vaultix.gate-failure.v1", commit, check: check.id, tier, rule: FIX_THE_SOURCE, expected: check.expect, logPath: `.gate/logs/${check.id}.log` };
  let record;
  if (result.status === "fail") record = { ...common, kind: "check_failed", observed: `exited with code ${result.exitCode ?? 1}`, exitCode: result.exitCode ?? 1 };
  else if (result.status === "timeout") record = { ...common, kind: "check_timed_out", observed: `did not finish within ${check.timeoutSeconds} seconds and was stopped`, timeoutSeconds: check.timeoutSeconds };
  else return null;
  const parsed = parseDocument(record);
  if (!parsed.ok) throw new Error(`the gate built an invalid failure record for ${check.id}: ${parsed.problems.map(problem => `${problem.path}: ${problem.expected}`).join("; ")}`);
  return parsed.value;
}

/**
 * The message for one failure: addressed from configuration, and containing the record and nothing else. `from` and `to` come from
 * VX_GATE_NOTIFY_FROM and VX_GATE_NOTIFY_TO; when they are not set the message says so and is only written to the outbox.
 */
export function messageFor(record, { from, to }) {
  const subject = `Vaultix gate failed: ${record.check} on ${record.commit.slice(0, 8)} (${record.tier})`;
  return [
    `From: ${from ?? "(VX_GATE_NOTIFY_FROM is not set)"}`,
    `To: ${to ?? "(VX_GATE_NOTIFY_TO is not set)"}`,
    `Subject: ${subject}`,
    "",
    `${record.rule}.`,
    "",
    JSON.stringify(record, null, 2),
    ""
  ].join("\n");
}

/** Write the record to `.gate/failures/` and the message to `.gate/outbox/`. Nothing is sent from here: sending needs a mail host (docs/0142, section 7). */
export function writeFailure(root, record, notify) {
  const failures = resolve(root, ".gate/failures", record.commit);
  const outbox = resolve(root, ".gate/outbox");
  mkdirSync(failures, { recursive: true });
  mkdirSync(outbox, { recursive: true });
  writeFileSync(resolve(failures, `${record.check}.json`), `${JSON.stringify(record, null, 2)}\n`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const message = resolve(outbox, `${stamp}-${record.check}.txt`);
  writeFileSync(message, messageFor(record, notify));
  return { record: resolve(failures, `${record.check}.json`), message };
}
