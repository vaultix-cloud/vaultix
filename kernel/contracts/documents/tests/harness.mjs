// Shared by the document tests: the existing hand-written schemas and fixtures (the oracle), the ArkType
// versions under test, and the exported JSON Schema compiled by Ajv the way the repository's own contract
// test compiles it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connection } from "../src/ai-connection.v1.ts";
import { persona } from "../src/ai-persona.v1.ts";
import { allVersions, documents, schemaText } from "../src/registry.ts";
import { type } from "arktype";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020");
const spec = new URL("../../../../platform/engine/backend-go/internal/services/assistant/spec/", import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, spec), "utf8"));
const compile = schema => new Ajv({ strict: true, strictTypes: false, strictRequired: false, allErrors: true, unicodeRegExp: true }).compile(schema);

export const subjects = {
  connection: { label: "ai-connection", arktype: connection, handWritten: compile(read("schema/vaultix.ai-connection.v1.schema.json")), fixtures: read("testdata/connections.json").cases },
  persona: { label: "ai-persona", arktype: persona, handWritten: compile(read("schema/vaultix.ai-persona.v1.schema.json")), fixtures: read("testdata/personas.json").cases }
};
const exported = Object.fromEntries(allVersions(documents).map(version => [version.id, JSON.parse(schemaText(version))]));
subjects.connection.exported = compile(exported["vaultix.ai-connection.v1"]);
subjects.persona.exported = compile(exported["vaultix.ai-persona.v1"]);

export const accepts = (arktypeSchema, document) => !(arktypeSchema(document) instanceof type.errors);
export { compile };
