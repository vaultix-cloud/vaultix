// vaultix.ai-persona.v1: one persona of the in-app assistant (docs/0126). A persona narrows what the assistant
// does and never grants anything. Default personas are PERSONA.md files whose front matter is this document
// without `instructions`, which is the body.
//
// The hand-written schema said "a router must be enabled, and only a router may name handoffs" as an
// if/then/else. Here a router and a non-router are two object types.
import { type } from "arktype";
import { characters, pattern, unique, notArray } from "./rules.ts";

const named = (min: number, max: number) => characters(min, max).and(pattern(String.raw`\S`));
const slug = type("string").and(pattern(String.raw`^[a-z][a-z0-9-]{1,31}$`));
const domains = ["public", "auth", "workspace", "secrets", "access", "automation", "connect", "pki", "kms", "pam", "detect", "ai", "governance", "operate", "experience"] as const;

const model = type({
  tier: "'fast' | 'standard' | 'deep'",
  "connectionId?": pattern(String.raw`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`),
  "id?": characters(1, 128).and(pattern(String.raw`^[A-Za-z0-9._:/@-]+$`))
}).onUndeclaredKey("reject").narrow(notArray);

const modelSettings = type({
  "temperature?": type("number").and(type("0 <= number <= 2")),
  "topP?": type("number").and(type("0 < number <= 1")),
  "maxOutputTokens?": type("number.integer").and(type("1 <= number <= 32000")),
  "stopSequences?": characters(1, 64).array().atMostLength(4),
  "toolChoice?": "'auto' | 'none'"
}).onUndeclaredKey("reject").narrow(notArray);

const tools = type("null").or(characters(0, 128).and(pattern(String.raw`^vaultix(\.[a-z][a-z0-9-]*)+$`)).array().atMostLength(64).narrow(unique));

const shared = {
  schemaVersion: "'vaultix.ai-persona.v1'",
  slug,
  name: named(1, 64),
  description: named(1, 300),
  domains: type.enumerated(...domains).array().atLeastLength(1).atMostLength(8).narrow(unique),
  instructions: named(1, 16384),
  model,
  "modelSettings?": modelSettings,
  "tools?": tools,
  "memory?": type({ use: "'all' | 'instance' | 'none'" }).onUndeclaredKey("reject").narrow(notArray)
} as const;

const router = type({ ...shared, role: "'router'", "enabled?": "true", "handoffs?": slug.array().atMostLength(16).narrow(unique) }).onUndeclaredKey("reject").narrow(notArray);
const answerer = type({ ...shared, role: "'specialist' | 'guard'", "enabled?": "boolean" }).onUndeclaredKey("reject").narrow(notArray);

/** Structural validation of one AI persona document. */
export const persona = router.or(answerer);
export type Persona = typeof persona.infer;

export const personaMeta = {
  title: "Vaultix AI persona",
  description: "One persona of the in-app assistant (docs/0126). A persona narrows what the assistant does and never grants anything: its tools are the person's own. Every length is in characters."
};
