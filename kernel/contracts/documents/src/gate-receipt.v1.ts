// vaultix.gate-receipt.v1: the record of one gate run on one commit (docs/0142, section 2).
//
// The receipt for the exact head commit is what lets a merge happen: a merge with no full-tier receipt for the commit it
// merges is refused. The baseline is the receipt for the commit on main.
//
// A check's result is a union keyed on `status`, so each status carries exactly what it needs and nothing else: a skipped
// check must say why (a skip is never silent), a failed one may carry the exit code, a timed-out one is a different result
// from a failed one (it says the check hung, not that it disagreed).
//
// What the shape cannot say, scripts/gate/receipt.mjs checks and tests: `result` is "pass" only when no check failed or
// timed out and, for a full run, none was skipped; check ids are unique; `finishedAt` is not before `startedAt`; and the
// receipt belongs to a clean worktree (`clean`) at the commit it names.
import { type } from "arktype";
import { notArray } from "./rules.ts";
import { commit, instant, line, seconds, slug, tier } from "./gate-parts.ts";

const base = { id: slug, seconds } as const;

const passed = type({ ...base, status: "'pass'" }).onUndeclaredKey("reject").narrow(notArray);
const failed = type({ ...base, status: "'fail'", "exitCode?": type("number.integer").and(type("-2147483648 <= number <= 4294967295")) })
  .onUndeclaredKey("reject")
  .narrow(notArray);
const timedOut = type({ ...base, status: "'timeout'" }).onUndeclaredKey("reject").narrow(notArray);
const skipped = type({ id: slug, seconds: "0", status: "'skipped'", reason: line(1, 160) }).onUndeclaredKey("reject").narrow(notArray);

const check = passed.or(failed).or(timedOut).or(skipped);

/** Structural validation of one gate receipt. */
export const receipt = type({
  schemaVersion: "'vaultix.gate-receipt.v1'",
  commit,
  tier,
  startedAt: instant,
  finishedAt: instant,
  /** True when the worktree had no uncommitted changes, so the receipt describes exactly the commit it names. */
  clean: "boolean",
  result: "'pass' | 'fail'",
  checks: check.array().atLeastLength(1).atMostLength(200)
})
  .onUndeclaredKey("reject")
  .narrow(notArray);
export type Receipt = typeof receipt.infer;

export const receiptMeta = {
  title: "Vaultix gate receipt",
  description:
    "The record of one delivery-gate run on one commit (docs/0142): each check with its result and time in seconds, the tier, and whether the worktree was clean. A merge requires a passing full-tier receipt for the exact commit."
};
