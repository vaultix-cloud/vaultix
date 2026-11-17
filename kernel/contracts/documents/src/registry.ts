// The registry of versioned documents, and how a version is read, upgraded and frozen.
//
// A document names its own version in `schemaVersion` ("vaultix.ai-connection.v1"). Within a version only
// additive-optional changes are allowed while it is a draft; once it is released its exported JSON Schema is
// pinned by hash and can never change, so a breaking change is a new version with an explicit upgrade
// function, tested, from the one before.
import { createHash } from "node:crypto";
import { type } from "arktype";
import type { Type } from "arktype";
import { connection, connectionMeta } from "./ai-connection.v1.ts";
import { persona, personaMeta } from "./ai-persona.v1.ts";
import { feature, featureMeta } from "./feature.v1.ts";
import { failure, failureMeta } from "./gate-failure.v1.ts";
import { receipt, receiptMeta } from "./gate-receipt.v1.ts";
import { exportJsonSchema } from "./rules.ts";

export type Status = "draft" | "released";
export interface DocumentVersion { id: string; status: Status; schema: Type<any>; title: string; description: string }
export interface DocumentFamily {
  versions: Record<string, DocumentVersion>;
  /** Upgrade functions keyed by the version they read: `upgrades.v1` turns a v1 document into a v2 document. */
  upgrades?: Record<string, (older: any) => unknown>;
}
export type Registry = Record<string, DocumentFamily>;

/** Every document is a draft: nothing is released before the first public release. */
export const documents: Registry = {
  "vaultix.ai-connection": { versions: { v1: { id: "vaultix.ai-connection.v1", status: "draft", schema: connection, ...connectionMeta } } },
  "vaultix.ai-persona": { versions: { v1: { id: "vaultix.ai-persona.v1", status: "draft", schema: persona, ...personaMeta } } },
  "vaultix.feature": { versions: { v1: { id: "vaultix.feature.v1", status: "draft", schema: feature, ...featureMeta } } },
  "vaultix.gate-failure": { versions: { v1: { id: "vaultix.gate-failure.v1", status: "draft", schema: failure, ...failureMeta } } },
  "vaultix.gate-receipt": { versions: { v1: { id: "vaultix.gate-receipt.v1", status: "draft", schema: receipt, ...receiptMeta } } }
};

export type Problem = { path: string; expected: string };
export type Parsed =
  | { ok: true; id: string; value: unknown }
  | { ok: false; code: "not_a_document" | "unknown_document" | "unknown_version" | "invalid" | "upgrade_invalid"; problems: Problem[] };

/**
 * Problems say where and what was expected, never what was sent: a document can hold a credential, and an
 * error that echoed it back would put the credential in a log or a response.
 */
interface Failure { code?: string; path: ReadonlyArray<PropertyKey>; expected?: string; errors?: Iterable<Failure> }

export function describe(errors: Iterable<Failure>): Problem[] {
  const seen = new Set<string>();
  const problems: Problem[] = [];
  const visit = (error: Failure) => {
    // A union or an intersection summarises its branches in text that includes the input ("(was ...)"), so
    // report its branches, which say only what was expected, and never the summary.
    if (error.errors) { for (const branch of error.errors) visit(branch); return; }
    // A key the document should not have is named by the path; keep it short and printable.
    const path = error.path.map(segment => String(segment).replace(/[^\x20-\x7e]/g, "?").slice(0, 64)).join(".") || "(document)";
    const expected = String(error.expected ?? "a valid value").split(" (was ")[0]!;
    const key = `${path}\u0000${expected}`;
    if (!seen.has(key)) { seen.add(key); problems.push({ path, expected }); }
  };
  for (const error of errors) visit(error);
  return problems;
}

const NAME = /^(vaultix\.[a-z][a-z0-9-]*)\.v([1-9][0-9]*)$/;

/** Read a document: pick the validator from its `schemaVersion`, validate, and optionally upgrade it to the newest version. */
export function parseDocument(raw: unknown, registry: Registry = documents, options: { toLatest?: boolean } = {}): Parsed {
  const declared = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).schemaVersion : undefined;
  const match = typeof declared === "string" ? NAME.exec(declared) : null;
  if (!match) return { ok: false, code: "not_a_document", problems: [{ path: "schemaVersion", expected: 'a version such as "vaultix.ai-connection.v1"' }] };
  const family = registry[match[1]!];
  if (!family) return { ok: false, code: "unknown_document", problems: [{ path: "schemaVersion", expected: `a known document (${Object.keys(registry).join(", ")})` }] };
  let version = `v${match[2]}`;
  let current = family.versions[version];
  if (!current) return { ok: false, code: "unknown_version", problems: [{ path: "schemaVersion", expected: `one of ${Object.keys(family.versions).join(", ")}` }] };

  let result = current.schema(raw);
  if (result instanceof type.errors) return { ok: false, code: "invalid", problems: describe(result) };
  let value: unknown = result;
  while (options.toLatest) {
    const upgrade = family.upgrades?.[version];
    if (!upgrade) break;
    const next = `v${Number(version.slice(1)) + 1}`;
    const target = family.versions[next];
    if (!target) break;
    const upgraded = upgrade(value);
    result = target.schema(upgraded);
    if (result instanceof type.errors) return { ok: false, code: "upgrade_invalid", problems: describe(result) };
    value = result; version = next; current = target;
  }
  return { ok: true, id: current.id, value };
}

/** The exported JSON Schema of one version, as the exact text that is committed. */
export const schemaText = (version: DocumentVersion): string => `${JSON.stringify(exportJsonSchema(version.id, version.schema, { title: version.title, description: version.description }), null, 2)}\n`;
export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Every version in a registry, flat. */
export const allVersions = (registry: Registry = documents): DocumentVersion[] => Object.values(registry).flatMap(family => Object.values(family.versions));

/**
 * A released version never changes. `lock` maps each released id to the hash of its exported schema. Returns
 * the problems: a released version that is not locked, a lock for something no longer released, or a released
 * version whose schema no longer matches its hash.
 */
export function verifyReleased(registry: Registry, lock: Record<string, string>): string[] {
  const problems: string[] = [];
  const released = allVersions(registry).filter(version => version.status === "released");
  for (const version of released) {
    const pinned = lock[version.id];
    if (!pinned) problems.push(`${version.id} is released but not locked; run the export with --lock ${version.id}`);
    else if (pinned !== sha256(schemaText(version))) problems.push(`${version.id} is released and its schema has changed; a released version is frozen, so make the change a new version with an upgrade from this one`);
  }
  for (const id of Object.keys(lock)) if (!released.some(version => version.id === id)) problems.push(`${id} is locked but is no longer a released version in the registry`);
  return problems;
}
