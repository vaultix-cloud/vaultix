// Generates the TypeScript side of the v1 contract from the OpenAPI document the Rust server emits:
// ArkType source (so the validators and their static types come from one place) and a map of every
// operation. The generator is deliberately strict: a construct it does not understand is an error, never a
// quietly weaker validator. (The runtime converter @ark/json-schema 0.0.13 silently ignores `format`, which is
// why this exists; docs/0136.)
//
//   node scripts/generate.mjs            write generated/schemas.ts and generated/operations.ts
//   node scripts/generate.mjs --check    fail if the checked-in files differ from what would be generated
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_KEYS = new Set(["type", "format", "enum", "const", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minLength", "maxLength", "pattern", "minimum", "maximum", "allOf", "anyOf", "oneOf", "$ref", "description", "example", "examples", "title", "readOnly", "writeOnly", "default", "deprecated"]);
// Formats that only describe a number's width or mark a sensitive string; they change no validation.
const ANNOTATION_FORMATS = new Set(["int32", "int64", "int16", "uint32", "uint64", "double", "float", "password"]);
const RFC3339 = String.raw`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/`;

class Unsupported extends Error {}
const fail = (path, what) => { throw new Unsupported(`${path}: ${what}`); };
const refName = ref => {
  const match = /^#\/components\/schemas\/([A-Za-z0-9_]+)$/.exec(ref);
  if (!match) fail(ref, "only #/components/schemas references are supported");
  return match[1];
};
const str = value => JSON.stringify(value);
const regexLiteral = pattern => `new RegExp(${str(pattern)})`;

function lengthDefinition(kind, schema, path) {
  const min = schema[`min${kind === "string" ? "Length" : "Items"}`];
  const max = schema[`max${kind === "string" ? "Length" : "Items"}`];
  if (min !== undefined && !Number.isInteger(min)) fail(path, "a minimum length must be an integer");
  if (max !== undefined && !Number.isInteger(max)) fail(path, "a maximum length must be an integer");
  return { min, max };
}

/** One schema as an ArkType expression; `dependencies` collects the component schemas it refers to. */
export function expression(schema, path, dependencies) {
  if (schema === true || schema === undefined || schema === null || typeof schema !== "object") fail(path, "a schema is required");
  for (const key of Object.keys(schema)) if (!SCHEMA_KEYS.has(key)) fail(path, `unsupported keyword "${key}"`);
  if (schema.$ref) { const name = refName(schema.$ref); dependencies.add(name); return name; }

  if (schema.allOf) {
    const parts = schema.allOf.map((part, i) => expression(part, `${path}.allOf[${i}]`, dependencies));
    // allOf of objects is how flattened structs arrive: merge their fields into one object. Intersecting two
    // strict objects would reject every valid value, since each rejects the other's keys.
    const objects = schema.allOf.every(part => part.$ref || part.type === "object");
    return objects ? `${combine(parts, "merge")}.onUndeclaredKey("reject").narrow(notAnArray)` : combine(parts, "and");
  }
  for (const key of ["oneOf", "anyOf"]) {
    if (schema[key]) return combine(schema[key].map((part, i) => expression(part, `${path}.${key}[${i}]`, dependencies)), "or");
  }
  if (schema.const !== undefined) return `type.enumerated(${str(schema.const)})`;

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.some(t => t === undefined)) fail(path, "a schema needs a type, enum, const, $ref, allOf, oneOf or anyOf");
  const nullable = types.includes("null");
  const concrete = types.filter(t => t !== "null");
  const parts = concrete.map(t => single({ ...schema, type: t }, path, dependencies));
  if (nullable) parts.push(`type("null")`);
  return parts.length === 1 ? parts[0] : combine(parts, "or");
}

function combine(parts, operator) {
  if (parts.length === 0) throw new Unsupported("an empty allOf, oneOf or anyOf");
  return parts.slice(1).reduce((all, part) => `${all}.${operator}(${part})`, parts[0]);
}

function single(schema, path, dependencies) {
  const where = `${path}`;
  switch (schema.type) {
    case "string": {
      let base;
      if (schema.enum) {
        if (!schema.enum.every(v => typeof v === "string")) fail(where, "a string enum may only hold strings");
        base = `type.enumerated(${schema.enum.map(str).join(", ")})`;
      } else {
        const keyword = { "date-time": null, uuid: "string.uuid", email: "string.email", uri: "string.url", url: "string.url" }[schema.format];
        if (schema.format && keyword === undefined && !ANNOTATION_FORMATS.has(schema.format)) fail(where, `unsupported string format "${schema.format}"`);
        base = schema.format === "date-time" ? `type("string.date.iso").and(${regexLiteral(RFC3339.slice(1, -1))})` : `type(${str(keyword || "string")})`;
      }
      const { min, max } = lengthDefinition("string", schema, where);
      if (min !== undefined && max !== undefined) base += `.and(type(${str(`${min} <= string <= ${max}`)}))`;
      else if (min !== undefined) base += `.and(type(${str(`string >= ${min}`)}))`;
      else if (max !== undefined) base += `.and(type(${str(`string <= ${max}`)}))`;
      if (schema.pattern) base += `.and(${regexLiteral(schema.pattern)})`;
      return base;
    }
    case "integer":
    case "number": {
      if (schema.format && !ANNOTATION_FORMATS.has(schema.format)) fail(where, `unsupported number format "${schema.format}"`);
      let base = `type(${str(schema.type === "integer" ? "number.integer" : "number")})`;
      const low = schema.minimum ?? (schema.format === "int32" ? -2147483648 : undefined);
      const high = schema.maximum ?? (schema.format === "int32" ? 2147483647 : undefined);
      if (low !== undefined && high !== undefined) base += `.and(type(${str(`${low} <= number <= ${high}`)}))`;
      else if (low !== undefined) base += `.and(type(${str(`number >= ${low}`)}))`;
      else if (high !== undefined) base += `.and(type(${str(`number <= ${high}`)}))`;
      return base;
    }
    case "boolean": return `type("boolean")`;
    case "null": return `type("null")`;
    case "array": {
      if (!schema.items) fail(where, "an array needs items");
      let base = `${expression(schema.items, `${where}[]`, dependencies)}.array()`;
      const { min, max } = lengthDefinition("array", schema, where);
      if (min !== undefined) base += `.atLeastLength(${min})`;
      if (max !== undefined) base += `.atMostLength(${max})`;
      return base;
    }
    case "object": {
      if (!schema.properties) {
        if (schema.additionalProperties && typeof schema.additionalProperties === "object") return `type.Record("string", ${expression(schema.additionalProperties, `${where}{}`, dependencies)}).narrow(notAnArray)`;
        return `type("object").narrow(notAnArray)`;
      }
      if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) fail(where, "an object with properties may only have additionalProperties: false");
      const required = new Set(schema.required ?? []);
      for (const name of required) if (!(name in schema.properties)) fail(where, `required property "${name}" is not declared`);
      const members = Object.entries(schema.properties).map(([name, property]) => `  ${str(required.has(name) ? name : `${name}?`)}: ${expression(property, `${where}.${name}`, dependencies)}`);
      // Strict: a field the contract does not declare is an error, which is how drift between server and
      // contract shows up in tests. (Relaxing this for clients is a decision for the beta freeze.)
      return `type({\n${members.join(",\n")}\n}).onUndeclaredKey("reject").narrow(notAnArray)`;
    }
    default: return fail(where, `unsupported type "${schema.type}"`);
  }
}

function order(schemas) {
  const found = new Map();
  for (const [name, schema] of Object.entries(schemas)) {
    const dependencies = new Set();
    const text = expression(schema, `components.schemas.${name}`, dependencies);
    found.set(name, { text, dependencies });
  }
  const sorted = [];
  const state = new Map();
  const visit = (name, trail) => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") fail(`components.schemas.${name}`, `recursive schemas are not supported yet (${[...trail, name].join(" -> ")})`);
    if (!found.has(name)) fail(`components.schemas.${name}`, "refers to a schema that does not exist");
    state.set(name, "visiting");
    for (const dependency of found.get(name).dependencies) visit(dependency, [...trail, name]);
    state.set(name, "done");
    sorted.push(name);
  };
  for (const name of Object.keys(schemas)) visit(name, []);
  return sorted.map(name => ({ name, text: found.get(name).text, description: schemas[name].description }));
}

const BANNER = (source) => `// GENERATED by scripts/generate.mjs from ${source}. Do not edit: change the Rust contract and regenerate.\n// ArkType ${"2.2"} source, so each validator and its static type come from the same definition.\n`;

export function generate(document, source = "openapi.json") {
  if (!/^3\.1\./.test(document.openapi ?? "")) throw new Unsupported(`expected OpenAPI 3.1, got ${document.openapi}`);
  const schemas = order(document.components?.schemas ?? {});
  const names = new Set(schemas.map(s => s.name));

  // ArkType treats an array as an object, so an object type whose keys are all optional accepts []. JSON Schema's
  // `type: object` does not, so every object type the generator emits carries this guard (docs/0136).
  let schemasTs = `${BANNER(source)}import { type } from "arktype";\n\nconst notAnArray = (value: unknown) => !Array.isArray(value);\n\n`;
  for (const { name, text, description } of schemas) {
    if (description) schemasTs += `/** ${description.replace(/\*\//g, "* /").replace(/\n/g, " ")} */\n`;
    schemasTs += `export const ${name} = ${text};\nexport type ${name} = typeof ${name}.infer;\n\n`;
  }

  const operations = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!["get", "put", "post", "delete", "patch"].includes(method)) fail(`paths.${path}`, `unsupported key "${method}"`);
      if (!operation.operationId) fail(`${method} ${path}`, "an operation needs an operationId");
      const where = `${method.toUpperCase()} ${path}`;
      const dependencies = new Set();
      const parameters = (operation.parameters ?? []).map(parameter => {
        if (!["query", "path", "header"].includes(parameter.in)) fail(where, `unsupported parameter location "${parameter.in}"`);
        return `{ name: ${str(parameter.name)}, in: ${str(parameter.in)}, required: ${Boolean(parameter.required)}, schema: ${expression(parameter.schema, `${where} parameter ${parameter.name}`, dependencies)} }`;
      });
      const body = operation.requestBody?.content?.["application/json"]?.schema;
      if (operation.requestBody && !body) fail(where, "a request body must be application/json");
      const responses = Object.entries(operation.responses ?? {}).map(([status, response]) => {
        const schema = response.content?.["application/json"]?.schema;
        if (!/^\d{3}$/.test(status)) fail(where, `unsupported response key "${status}"`);
        return schema ? `${status}: ${expression(schema, `${where} ${status}`, dependencies)}` : `${status}: undefined`;
      });
      operations.push({ id: operation.operationId, text: `  ${str(operation.operationId)}: {\n    method: ${str(method.toUpperCase())},\n    path: ${str(path)},\n    secured: ${Boolean(operation.security?.length)},\n    parameters: [${parameters.join(", ")}],\n    request: ${body ? expression(body, `${where} body`, dependencies) : "undefined"},\n    responses: { ${responses.join(", ")} }\n  }`, dependencies });
    }
  }
  const used = new Set(operations.flatMap(o => [...o.dependencies]));
  for (const name of used) if (!names.has(name)) throw new Unsupported(`an operation refers to missing schema ${name}`);
  operations.sort((a, b) => a.id.localeCompare(b.id));
  const imports = [...used].sort();
  const operationsTs = `${BANNER(source)}import { type } from "arktype";\nimport { ${imports.join(", ")} } from "./schemas.ts";\n\nexport const operations = {\n${operations.map(o => o.text).join(",\n")}\n} as const;\n\nexport type OperationId = keyof typeof operations;\n`;
  return { schemasTs, operationsTs };
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const root = resolve(here, "..");
  const document = JSON.parse(readFileSync(resolve(root, "openapi.json"), "utf8"));
  const { schemasTs, operationsTs } = generate(document, "kernel/contracts/v1/openapi.json");
  const targets = { "generated/schemas.ts": schemasTs, "generated/operations.ts": operationsTs };
  if (process.argv.includes("--check")) {
    const stale = Object.entries(targets).filter(([file, text]) => { try { return readFileSync(resolve(root, file), "utf8") !== text; } catch { return true; } });
    if (stale.length) { console.error(`generated TypeScript is out of date: ${stale.map(([f]) => f).join(", ")}. Run: node scripts/generate.mjs`); process.exit(1); }
    console.log("generated TypeScript matches openapi.json");
  } else {
    mkdirSync(resolve(root, "generated"), { recursive: true });
    for (const [file, text] of Object.entries(targets)) writeFileSync(resolve(root, file), text);
    console.log(`generated ${Object.keys(targets).join(", ")}`);
  }
}
