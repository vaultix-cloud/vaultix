// vaultix.gate-failure.v1: why a gate check failed, in a form that tells whoever reads it to fix the source (docs/0142,
// section 4), and that is safe to put in an email (section 5).
//
// Two properties are the point of this document, and each is in the shape and not in a convention:
//
//  1. Every record carries the rule, as a literal. `rule` is not free text: only the one sentence validates, so a record that
//     drops or rewords it is invalid. Whoever reads a failure reads that fixing the source is the answer and changing the
//     expectation, ceiling, baseline or snapshot is not.
//  2. A record holds nothing the gate did not write. Every text field is one line of printable ASCII and is filled from a fixed
//     message, never from a check's output; the output stays in a local log that `logPath` points at. Where a failure has
//     problems to report (a manifest that does not validate), they are paths and expectations from registry.describe, which
//     never repeats what was sent.
//
// The failure is a union keyed on `kind`. Each kind lists what makes it actionable, and an answer edit cannot be recorded
// without naming the files and what each one was.
import { type } from "arktype";
import { notArray, unique } from "./rules.ts";
import { capabilityRef, commit, line, location, logPath, repoPath, slug, tier } from "./gate-parts.ts";

/** The one sentence every record carries. Exported so the gate writes exactly this and a test pins it. */
export const FIX_THE_SOURCE = "fix the source; do not change the expectation, ceiling, baseline or snapshot to match";

const exitCode = type("number.integer").and(type("-2147483648 <= number <= 4294967295"));

const common = {
  schemaVersion: "'vaultix.gate-failure.v1'",
  commit,
  check: slug,
  tier,
  rule: `'${FIX_THE_SOURCE}'`,
  expected: line(1, 300),
  observed: line(1, 300),
  "location?": location,
  "logPath?": logPath
} as const;

/** A thing an answer edit changed: the kinds of file that hold what a check expects. */
const answerKind = type("'ceiling' | 'baseline' | 'snapshot' | 'golden' | 'expectation' | 'assertion'");
const edit = type({ file: repoPath, what: answerKind }).onUndeclaredKey("reject").narrow(notArray);

/** One problem reported by registry.describe: where, and what was expected, never what was sent. */
const problem = type({ path: line(1, 120), expected: line(1, 200) }).onUndeclaredKey("reject").narrow(notArray);

const checkFailed = type({ ...common, kind: "'check_failed'", exitCode }).onUndeclaredKey("reject").narrow(notArray);
const checkTimedOut = type({ ...common, kind: "'check_timed_out'", timeoutSeconds: type("number.integer").and(type("1 <= number <= 86400")) })
  .onUndeclaredKey("reject")
  .narrow(notArray);
const flowMissing = type({ ...common, kind: "'flow_missing'", capability: capabilityRef }).onUndeclaredKey("reject").narrow(notArray);
const flowStale = type({ ...common, kind: "'flow_stale'", capability: capabilityRef, flow: slug }).onUndeclaredKey("reject").narrow(notArray);
const mutationSurvived = type({ ...common, kind: "'mutation_survived'", flow: slug, mutation: slug }).onUndeclaredKey("reject").narrow(notArray);
const unownedSource = type({ ...common, kind: "'unowned_source'", files: repoPath.array().atLeastLength(1).atMostLength(50).narrow(unique) })
  .onUndeclaredKey("reject")
  .narrow(notArray);
const answerEdit = type({ ...common, kind: "'answer_edit'", edits: edit.array().atLeastLength(1).atMostLength(50) }).onUndeclaredKey("reject").narrow(notArray);
const manifestInvalid = type({ ...common, kind: "'manifest_invalid'", feature: slug, problems: problem.array().atLeastLength(1).atMostLength(20) })
  .onUndeclaredKey("reject")
  .narrow(notArray);
const receiptMissing = type({ ...common, kind: "'receipt_missing'" }).onUndeclaredKey("reject").narrow(notArray);

/** Structural validation of one gate failure record. */
export const failure = checkFailed
  .or(checkTimedOut)
  .or(flowMissing)
  .or(flowStale)
  .or(mutationSurvived)
  .or(unownedSource)
  .or(answerEdit)
  .or(manifestInvalid)
  .or(receiptMissing);
export type Failure = typeof failure.infer;

export const failureMeta = {
  title: "Vaultix gate failure",
  description:
    "Why one delivery-gate check failed (docs/0142): the check, what was expected, what was observed, and the rule that the source is fixed, not the answer. Holds only text the gate wrote; a check's own output stays in a local log."
};
