// vaultix.feature.v1: a feature as the delivery standard defines it (docs/0142, section 1).
//
// A feature is delivered whole. It names the capabilities it has, the source it owns, and for every capability the flow that
// proves it works by driving the real thing (section 3). A capability with no flow is not a valid manifest: that rule is in
// the shape (`flows` needs at least one), so an unfinished capability cannot be written down, only left out.
//
// The shape says what a schema can say. The gate checks the rest, with tests (scripts/gate/manifest.mjs): every mutation a
// flow names exists, flow ids are unique within a feature, a parity proof names a real flow, and every path the manifest owns
// matches a file.
import { type } from "arktype";
import { notArray, unique } from "./rules.ts";
import { command, line, repoGlob, slug } from "./gate-parts.ts";

/** What a flow drives: the real server process over HTTP, the real command line, or the real browser build. */
const flowKind = type("'process' | 'cli' | 'browser'");

/**
 * The proof that a capability works. `mutations` lists the planted bugs the gate must see this flow fail on; a flow that
 * cannot fail proves nothing, so a flow with no mutation is refused here.
 */
const flow = type({
  id: slug,
  kind: flowKind,
  command,
  timeoutSeconds: type("number.integer").and(type("5 <= number <= 1800")),
  mutations: slug.array().atLeastLength(1).atMostLength(16).narrow(unique)
})
  .onUndeclaredKey("reject")
  .narrow(notArray);

const capability = type({
  id: slug,
  summary: line(1, 200),
  flows: flow.array().atLeastLength(1).atMostLength(8)
})
  .onUndeclaredKey("reject")
  .narrow(notArray);

/** Where a capability replaces one the upstream product has, and which flow shows Vaultix does at least as much (docs/0127). */
const parity = type({ capability: slug, upstream: line(1, 120), claim: line(1, 300), proof: slug })
  .onUndeclaredKey("reject")
  .narrow(notArray);

/** Structural validation of one feature manifest. */
export const feature = type({
  schemaVersion: "'vaultix.feature.v1'",
  name: slug,
  title: line(1, 80),
  capabilities: capability.array().atLeastLength(1).atMostLength(64),
  owns: repoGlob.array().atLeastLength(1).atMostLength(64).narrow(unique),
  "parity?": parity.array().atMostLength(64)
})
  .onUndeclaredKey("reject")
  .narrow(notArray);
export type Feature = typeof feature.infer;

export const featureMeta = {
  title: "Vaultix feature manifest",
  description:
    "A feature as the delivery standard defines it (docs/0142): its capabilities, the source it owns, and for each capability the flow that proves it by driving the real thing. A flow lists the planted bugs it must fail on. Every length is in characters."
};
