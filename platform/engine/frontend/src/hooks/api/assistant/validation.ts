import { AxiosError } from "axios";

// The subset of JSON Schema (draft 2020-12) the AI v1 schemas use. The schemas come from
// GET /api/vx/v1/ai/schema, so form rules follow the server's single source of truth.
export type TJsonSchema = {
  $ref?: string;
  $defs?: Record<string, TJsonSchema>;
  title?: string;
  description?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  items?: TJsonSchema;
  properties?: Record<string, TJsonSchema>;
  required?: string[];
  minProperties?: number;
  allOf?: TJsonSchema[];
  anyOf?: TJsonSchema[];
  oneOf?: TJsonSchema[];
  not?: TJsonSchema;
  if?: TJsonSchema;
  then?: TJsonSchema;
  else?: TJsonSchema;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodePointer = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

export const resolveSchema = (root: TJsonSchema, schema: TJsonSchema): TJsonSchema => {
  let current = schema;
  for (let depth = 0; current.$ref && depth < 16; depth += 1) {
    if (!current.$ref.startsWith("#/")) return current;
    let target: unknown = root;
    current.$ref
      .slice(2)
      .split("/")
      .forEach((segment) => {
        target = isObject(target) ? target[decodePointer(segment)] : undefined;
      });
    if (!isObject(target)) return current;
    current = target as TJsonSchema;
  }
  return current;
};

const combine = (schemas: TJsonSchema[]): TJsonSchema | undefined => {
  if (schemas.length === 0) return undefined;
  if (schemas.length === 1) return schemas[0];
  return { allOf: schemas };
};

const members = (root: TJsonSchema, schema: TJsonSchema): TJsonSchema[] => {
  const resolved = resolveSchema(root, schema);
  return [resolved, ...(resolved.allOf ?? []).flatMap((member) => members(root, member))];
};

const childSchema = (
  root: TJsonSchema,
  schema: TJsonSchema,
  segment: string
): TJsonSchema | undefined => {
  const found = members(root, schema).flatMap((member) => {
    if (/^\d+$/.test(segment)) return member.items ? [member.items] : [];
    const property = member.properties?.[segment];
    return property ? [property] : [];
  });
  return combine(found);
};

// The sub-schema for a dotted form path such as "models.standard" or "headers.2.value".
export const schemaAt = (root: TJsonSchema, path: string): TJsonSchema | undefined => {
  let current: TJsonSchema | undefined = root;
  path.split(".").forEach((segment) => {
    current = current ? childSchema(root, current, segment) : undefined;
  });
  return current;
};

// The first title or description found on a sub-schema, through $ref and allOf.
export const schemaText = (
  root: TJsonSchema | undefined,
  path: string,
  key: "title" | "description"
): string | undefined => {
  if (!root) return undefined;
  const schema = schemaAt(root, path);
  if (!schema) return undefined;
  return members(root, schema).find((member) => member[key])?.[key];
};

export const isRequiredAt = (root: TJsonSchema, path: string): boolean => {
  const segments = path.split(".");
  const name = segments.pop() as string;
  const parent = segments.length ? schemaAt(root, segments.join(".")) : root;
  if (!parent) return false;
  return members(root, parent).some((member) => member.required?.includes(name));
};

const matchesKind = (condition: TJsonSchema | undefined, field: string, value: string) => {
  const rule = condition?.properties?.[field];
  if (!rule) return false;
  if ("const" in rule) return rule.const === value;
  return Boolean(rule.enum?.includes(value));
};

// Applies the schema's allOf rules that depend only on one field (such as the connection's kind),
// so a form for one kind gets that kind's extra required fields and patterns.
export const specializeSchema = (root: TJsonSchema, field: string, value: string): TJsonSchema => {
  const properties: Record<string, TJsonSchema> = { ...(root.properties ?? {}) };
  const required = new Set(root.required ?? []);
  (root.allOf ?? []).forEach((rule) => {
    const keys = Object.keys(rule.if?.properties ?? {});
    if (rule.if?.required?.length || keys.length !== 1 || keys[0] !== field) return;
    const branch = matchesKind(rule.if, field, value) ? rule.then : rule.else;
    if (!branch) return;
    branch.required?.forEach((name) => required.add(name));
    Object.entries(branch.properties ?? {}).forEach(([name, extra]) => {
      properties[name] = properties[name] ? { allOf: [properties[name], extra] } : extra;
    });
  });
  return { ...root, properties, required: [...required] };
};

const typeOf = (value: unknown) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
};

const matchesType = (expected: string, value: unknown) => {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  return actual === expected;
};

const compiled = new Map<string, RegExp | null>();
const patternOf = (pattern: string) => {
  if (!compiled.has(pattern)) {
    try {
      compiled.set(pattern, new RegExp(pattern, "u"));
    } catch {
      compiled.set(pattern, null);
    }
  }
  return compiled.get(pattern) ?? null;
};

const characters = (value: string) => [...value].length;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type TCheckOptions = {
  // Shown instead of the generic message when a value does not match the pattern.
  patternHint?: string;
};

// Returns the first rule the value breaks, as a sentence, or undefined when it passes.
export const checkValue = (
  root: TJsonSchema,
  schema: TJsonSchema,
  value: unknown,
  options: TCheckOptions = {}
): string | undefined => {
  const s = resolveSchema(root, schema);

  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((type) => matchesType(type, value))) {
      if (types.includes("integer")) return "Enter a whole number.";
      if (types.includes("number")) return "Enter a number.";
      return "This value has the wrong type.";
    }
  }
  if ("const" in s && !sameValue(s.const, value)) return "This value cannot be used here.";
  if (s.enum && !s.enum.some((option) => sameValue(option, value)))
    return `Choose one of: ${s.enum.join(", ")}.`;

  if (typeof value === "string") {
    const length = characters(value);
    if (s.minLength !== undefined && length < s.minLength)
      return s.minLength === 1
        ? "Enter a value."
        : `Use at least ${plural(s.minLength, "character")}.`;
    if (s.maxLength !== undefined && length > s.maxLength)
      return `Use at most ${plural(s.maxLength, "character")} (now ${length}).`;
    if (s.pattern) {
      const regex = patternOf(s.pattern);
      if (regex && !regex.test(value))
        return options.patternHint ?? "This value is not in the expected format.";
    }
  }

  if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) return `Use ${s.minimum} or more.`;
    if (s.maximum !== undefined && value > s.maximum) return `Use ${s.maximum} or less.`;
    if (s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum)
      return `Use more than ${s.exclusiveMinimum}.`;
    if (s.exclusiveMaximum !== undefined && value >= s.exclusiveMaximum)
      return `Use less than ${s.exclusiveMaximum}.`;
  }

  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems)
      return s.minItems === 1 ? "Choose at least one." : `Choose at least ${s.minItems}.`;
    if (s.maxItems !== undefined && value.length > s.maxItems)
      return `Use at most ${s.maxItems} (now ${value.length}).`;
    if (s.uniqueItems) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) return "Each entry must be different.";
    }
    if (s.items) {
      const { items } = s;
      const itemError = value
        .map((item) => checkValue(root, items, item, options))
        .find((message) => message !== undefined);
      if (itemError) return itemError;
    }
  }

  if (isObject(value)) {
    const missing = (s.required ?? []).find((name) => value[name] === undefined);
    if (missing) return `${missing} is required.`;
    if (s.minProperties !== undefined && Object.keys(value).length < s.minProperties)
      return "Fill in at least one field.";
    const propertyError = Object.entries(s.properties ?? {})
      .filter(([name]) => value[name] !== undefined)
      .map(([name, property]) => checkValue(root, property, value[name], options))
      .find((message) => message !== undefined);
    if (propertyError) return propertyError;
  }

  const allError = (s.allOf ?? [])
    .map((member) => checkValue(root, member, value, options))
    .find((message) => message !== undefined);
  if (allError) return allError;

  if (s.anyOf && s.anyOf.every((member) => checkValue(root, member, value, options))) {
    return checkValue(root, s.anyOf[0], value, options);
  }
  if (s.oneOf) {
    const errors = s.oneOf.map((member) => checkValue(root, member, value, options));
    const passing = errors.filter((message) => message === undefined).length;
    if (passing === 0) {
      const sameType = s.oneOf.findIndex((member) => {
        const { type } = resolveSchema(root, member);
        return typeof type === "string" && matchesType(type, value);
      });
      return errors[sameType >= 0 ? sameType : 0] as string;
    }
    if (passing > 1) return "This value matches more than one allowed form.";
  }
  if (s.not && checkValue(root, s.not, value) === undefined)
    return "This value is reserved and cannot be used here.";
  if (s.if) {
    const branch = checkValue(root, s.if, value) === undefined ? s.then : s.else;
    if (branch) {
      const branchError = checkValue(root, branch, value, options);
      if (branchError) return branchError;
    }
  }
  return undefined;
};

export type TFieldRuleOptions = TCheckOptions & {
  // Overrides whether the schema's parent object requires the field.
  required?: boolean;
  // How the raw form value becomes the document value.
  as?: "string" | "number" | "lines";
};

// A react-hook-form validate function for one path of a schema. An empty optional value passes;
// the document leaves it out.
export const schemaRule =
  (root: TJsonSchema | undefined, path: string, options: TFieldRuleOptions = {}) =>
  (raw: unknown): string | true => {
    const empty =
      raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
    const required = options.required ?? (root ? isRequiredAt(root, path) : false);
    if (empty) return required ? "Required." : true;
    if (!root) return true;
    const schema = schemaAt(root, path);
    if (!schema) return true;
    let value: unknown = raw;
    if (options.as === "number" && typeof raw === "string") {
      value = Number(raw);
      if (Number.isNaN(value)) return "Enter a number.";
    }
    if (options.as === "lines" && typeof raw === "string") {
      value = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
    return checkValue(root, schema, value, options) ?? true;
  };

export type TServerFieldError = { path: string; message: string };

export type TServerRefusal = { message: string; fields: TServerFieldError[] };

// A 400 from the AI routes: { message, error, details?: { fields: [{ path, message }] } }.
export const readServerRefusal = (error: unknown): TServerRefusal | undefined => {
  const response = (error as AxiosError<Record<string, unknown>>)?.response;
  if (!response || response.status !== 400 || !isObject(response.data)) return undefined;
  const { data } = response;
  const details = isObject(data.details) ? data.details : {};
  const fields = Array.isArray(details.fields)
    ? (details.fields as unknown[]).filter(
        (field): field is TServerFieldError =>
          isObject(field) && typeof field.path === "string" && typeof field.message === "string"
      )
    : [];
  return {
    message: typeof data.message === "string" ? data.message : "The server refused this.",
    fields
  };
};

// "headers[2].value" becomes "headers.2.value", the form's path for the same field.
export const formPath = (serverPath: string) => serverPath.replace(/\[(\d+)\]/g, ".$1");

export const serverMessage = (error: unknown) =>
  (error as AxiosError<{ message?: string }>)?.response?.data?.message;
