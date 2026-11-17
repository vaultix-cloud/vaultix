// Building blocks shared by the three delivery-gate documents (docs/0142): the feature manifest, the gate receipt and the
// failure record. Everything here is structural: a shape a schema can say and a JSON Schema validator can check the same
// way. Cross-field and cross-file rules (every capability has a flow, a flow's mutations exist, a receipt's result matches
// its checks) cannot be said in a schema and are enforced, and tested, in scripts/gate/.
//
// Two facts about how these documents are used shaped the text types:
//
//  - A failure record travels by email and into logs. So none of its fields may carry output the gate did not write itself:
//    every text field is short, single-line printable ASCII, and the gate fills it from a fixed message, never from the
//    output of a check. (ArkType's own error text repeats the input, "was ...", so a record is never built from it either;
//    see registry.describe.)
//  - A path or a glob in a manifest is read by a program that opens files. Neither may be absolute or climb out with "..".
import { type } from "arktype";
import { characters, notArray, pattern } from "./rules.ts";

/** A lowercase identifier with single hyphens between parts: `secrets-core`, `redeem-once`. */
export const slug = characters(1, 63).and(pattern(String.raw`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`));

/** A full git commit id, as `git rev-parse HEAD` prints it. */
export const commit = characters(40, 40).and(pattern(String.raw`^[0-9a-f]{40}$`));

/**
 * An RFC 3339 instant in UTC, written the way `Date.toISOString()` writes it. This checks the shape, not the calendar:
 * 2026-02-31 passes. The gate writes these itself, so the shape is what a reader needs to rely on.
 */
export const instant = characters(20, 24).and(
  pattern(String.raw`^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$`)
);

/** One line of printable ASCII: no control characters, no newline, nothing that could carry a hidden instruction. */
export const line = (min: number, max: number) => characters(min, max).and(pattern(String.raw`^[\x20-\x7e]+$`));

/** A path relative to the repository root, with forward slashes, and no `..` segment. */
export const repoPath = characters(1, 300).and(pattern(String.raw`^(?!/)(?!(?:.*/)?\.\.(?:/|$))[A-Za-z0-9._@+\-/]+$`));

/** A glob over repository paths (`kernel/domains/secrets/**`). The same limits as a path, plus the glob characters. */
export const repoGlob = characters(1, 300).and(pattern(String.raw`^(?!/)(?!(?:.*/)?\.\.(?:/|$))[A-Za-z0-9._@+\-/*?\[\]{},]+$`));

/** Where the gate keeps the full output of a check. It stays on the machine; a failure record only points at it. */
export const logPath = characters(1, 120).and(pattern(String.raw`^\.gate/logs/[A-Za-z0-9._\-]+$`));

/** Seconds, to the millisecond, from 0 to a day. */
export const seconds = type("0 <= number <= 86400");

export const tier = type("'fast' | 'full'");

/** The programs a flow may launch. A flow is never a shell string; it is one of these and its arguments. */
export const program = type("'node' | 'cargo' | 'npm' | 'npx'");

const argument = line(1, 200);

/**
 * A command a flow or a check runs: a program and its arguments, no shell. It is an object with a list and not a tuple
 * because ArkType exports a variadic tuple as `prefixItems`, which a strict JSON Schema validator (Ajv, as the repository's
 * contract tests configure it) rejects.
 */
export const command = type({ program, args: argument.array().atMostLength(32) }).onUndeclaredKey("reject").narrow(notArray);

/** A source file or area a gate result is about. */
export const location = type({ file: repoPath, "line?": type("number.integer").and(type("1 <= number <= 10000000")) })
  .onUndeclaredKey("reject")
  .narrow(notArray);

/** One thing a feature can do, named as the gate and the failure record name it. */
export const capabilityRef = type({ feature: slug, capability: slug }).onUndeclaredKey("reject").narrow(notArray);
