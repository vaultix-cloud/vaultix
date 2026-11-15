// vaultix.ai-connection.v1: how the instance reaches one AI model provider (docs/0126).
//
// This is the structural half of the document: everything a schema can say. The two rules a schema cannot say
// (an extra header must not carry a credential; a Vertex key must be a whole service-account file) stay in the
// server, which already has them, rather than becoming a third copy here. The fixtures mark such cases
// `schemaValid: true, valid: false`.
//
// The hand-written JSON Schema expressed "which fields this kind allows" as ten if/then conditions. Here each
// kind is its own object type that declares exactly its fields and rejects every other, which says the same
// thing once, reads top to bottom, and exports as plain `anyOf`.
import { type } from "arktype";
import { characters, pattern, notArray } from "./rules.ts";

const text = characters;
const named = (min: number, max: number) => characters(min, max).and(pattern(String.raw`\S`));
const modelId = characters(1, 128).and(pattern(String.raw`^[A-Za-z0-9._:/@-]+$`));
const reserved = (words: string[]) => pattern(String.raw`^(?!(?:${words.join("|")})$)[a-z0-9-]{1,64}$`);
const endpoint = characters(0, 512).and(pattern(String.raw`^https?://[A-Za-z0-9.\-\[\]:]+(/[A-Za-z0-9._~!$&'()*+,;=:@%/\-]*)?$`));
const https = pattern(String.raw`^https://`);
const httpsOrLoopback = pattern(String.raw`^(?:https://|http://(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?(?:/|$))`);

const models = type({ standard: modelId, "fast?": modelId, "deep?": modelId }).onUndeclaredKey("reject").narrow(notArray);
const timeout = type("number.integer").and(type("5 <= number <= 120"));

const header = type({
  name: reserved(["authorization", "cookie", "proxy-authorization", "x-api-key", "api-key", "host", "content-length", "content-type", "x-hf-bill-to"]),
  value: text(1, 256)
}).onUndeclaredKey("reject").narrow(notArray);

const headerName = reserved(["authorization", "cookie", "proxy-authorization", "host", "content-length", "content-type"]);
const keyedAuth = type({ type: "'bearer'" }).onUndeclaredKey("reject").narrow(notArray).or(type({ type: "'header'", headerName }).onUndeclaredKey("reject").narrow(notArray));
const noAuth = type({ type: "'none'" }).onUndeclaredKey("reject").narrow(notArray);

const apiKey = type({ apiKey: text(1, 4096) }).onUndeclaredKey("reject").narrow(notArray);
// AWS: an access key and its secret go together, and a session token belongs to them (it was issued for that key).
// The first draft of this schema let a lone session token through, which names no identity; tightened 2026-11-15,
// in the hand-written schema, the Go rule and the fixtures at the same time.
const awsCredential = type({ accessKeyId: pattern(String.raw`^[A-Z0-9]{16,128}$`), secretAccessKey: text(1, 4096), "sessionToken?": text(1, 4096) })
  .onUndeclaredKey("reject").narrow(notArray);
const serviceAccount = type({ serviceAccountJson: text(1, 16384) }).onUndeclaredKey("reject").narrow(notArray);

const common = { schemaVersion: "'vaultix.ai-connection.v1'", name: named(1, 64), models, "timeoutSeconds?": timeout, "active?": "boolean" } as const;
const awsRegion = characters(1, 32).and(pattern(String.raw`^[a-z]{2}(-[a-z]+)+-[0-9]$`));
const gcpRegion = characters(1, 32).and(pattern(String.raw`^(global|[a-z]+-[a-z]+[0-9])$`));

const vendorApi = type({ ...common, kind: "'anthropic' | 'openai'", "credential?": apiKey }).onUndeclaredKey("reject").narrow(notArray);
const huggingface = type({ ...common, kind: "'huggingface'", "billTo?": pattern(String.raw`^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$`), "credential?": apiKey }).onUndeclaredKey("reject").narrow(notArray);
const huggingfaceEndpoint = type({ ...common, kind: "'huggingface-endpoint'", endpoint: endpoint.and(https), "credential?": apiKey }).onUndeclaredKey("reject").narrow(notArray);
const bedrock = type({ ...common, kind: "'bedrock'", region: awsRegion, "credential?": awsCredential }).onUndeclaredKey("reject").narrow(notArray);
const vertex = type({ ...common, kind: "'vertex'", region: gcpRegion, cloudProject: pattern(String.raw`^[a-z][a-z0-9-]{4,28}[a-z0-9]$`), "credential?": serviceAccount }).onUndeclaredKey("reject").narrow(notArray);

// A custom endpoint that sends a key must be https or on loopback. One that sends none may be any http(s) URL,
// and then has no credential to send: "no key over plain http" and "no credential without auth" are one rule.
const customKeyed = type({ ...common, kind: "'custom'", endpoint: endpoint.and(httpsOrLoopback), apiStyle: "'openai-chat' | 'anthropic-messages'", auth: keyedAuth, "headers?": header.array().atMostLength(8), "credential?": apiKey }).onUndeclaredKey("reject").narrow(notArray);
const customKeyless = type({ ...common, kind: "'custom'", endpoint, apiStyle: "'openai-chat' | 'anthropic-messages'", auth: noAuth, "headers?": header.array().atMostLength(8) }).onUndeclaredKey("reject").narrow(notArray);

/** Structural validation of one AI connection document. */
export const connection = vendorApi.or(huggingface).or(huggingfaceEndpoint).or(bedrock).or(vertex).or(customKeyed).or(customKeyless);
export type Connection = typeof connection.infer;

export const connectionMeta = {
  title: "Vaultix AI connection",
  description: "How the instance reaches one AI model provider (docs/0126). Every length is in characters. The credential is write-only: it is encrypted on save and never returned."
};
