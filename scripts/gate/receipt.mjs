// A gate receipt: what ran on which commit and how it went. Built from results, validated against vaultix.gate-receipt.v1,
// checked for the rules a schema cannot say, and written under `.gate/receipts/`. A merge to main requires a passing full-tier
// receipt for the exact head commit (`node scripts/gate.mjs --verify-receipt full`).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "../../kernel/contracts/documents/src/registry.ts";

export const RECEIPT_VERSION = "vaultix.gate-receipt.v1";

export const receiptPath = (root, commit, tier) => resolve(root, ".gate/receipts", `${commit}.${tier}.json`);

/**
 * A result is "pass" only when every check passed. A skipped check did not run, so it is not a pass; a timeout is a hung check,
 * not a disagreement, and is not one either.
 */
export const overall = results => (results.every(result => result.status === "pass") ? "pass" : "fail");

export function buildReceipt({ commit, tier, startedAt, finishedAt, clean, results }) {
  return { schemaVersion: RECEIPT_VERSION, commit, tier, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), clean, result: overall(results), checks: results };
}

/**
 * Everything wrong with a receipt: it must be a valid document, and then say what a schema cannot: its result follows from its
 * checks, its ids are unique, time runs forward, it is about the commit and tier asked for, it ran every check that tier has, and
 * the worktree was clean. Returns problems; an empty list means the receipt can stand for `commit` at `tier`.
 */
export function verifyReceipt(raw, { commit, tier, expectedIds, requireClean = true }) {
  const parsed = parseDocument(raw);
  if (!parsed.ok || parsed.id !== RECEIPT_VERSION) return parsed.ok ? ["not a gate receipt"] : parsed.problems.map(problem => `${problem.path}: ${problem.expected}`);
  const receipt = parsed.value;
  const problems = [];
  if (receipt.commit !== commit) problems.push("it is about a different commit");
  // A full receipt includes every fast check, so it can stand in for a fast one; a fast receipt cannot stand in for a full one.
  if (tier === "full" && receipt.tier !== "full") problems.push("it is a fast-tier receipt and the merge needs a full-tier one");
  if (receipt.result !== overall(receipt.checks)) problems.push(`its result is ${receipt.result} but its checks say ${overall(receipt.checks)}`);
  const ids = receipt.checks.map(check => check.id);
  if (new Set(ids).size !== ids.length) problems.push("a check appears more than once");
  if (Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)) problems.push("it finished before it started");
  for (const id of expectedIds) if (!ids.includes(id)) problems.push(`check ${id} did not run`);
  if (requireClean && !receipt.clean) problems.push("the worktree had uncommitted changes, so it does not describe the commit");
  if (receipt.result !== "pass") problems.push("it did not pass");
  return problems;
}

export function writeReceipt(root, receipt) {
  const path = receiptPath(root, receipt.commit, receipt.tier);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return path;
}

export function readReceipt(root, commit, tier) {
  try { return JSON.parse(readFileSync(receiptPath(root, commit, tier), "utf8")); } catch { return null; }
}

/** A receipt must be a valid document before it is written: a gate that wrote an invalid receipt is itself broken. */
export function assertValidReceipt(receipt) {
  const parsed = parseDocument(receipt);
  if (!parsed.ok) throw new Error(`the gate built an invalid receipt: ${parsed.problems.map(problem => `${problem.path}: ${problem.expected}`).join("; ")}`);
}

