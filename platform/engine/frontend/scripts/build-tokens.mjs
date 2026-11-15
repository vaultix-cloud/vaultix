// Builds Vaultix design tokens (docs/0130 phase 1) from src/design-system/tokens/source/*.json,
// written in the W3C Design Tokens format, into tokens.css (custom properties) and tokens.ts (a
// typed map). Every declared contrast pair is checked against WCAG 2.2 in every theme; a palette
// that fails does not build. `--check` changes nothing and fails when the generated files are stale.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src/design-system/tokens");
const read = name => JSON.parse(readFileSync(resolve(root, "source", name), "utf8"));
const check = process.argv.includes("--check");

// Flattens a token tree into { "a.b.c": { value, type } }, inheriting $type from groups.
function flatten(tree, path = [], inherited, out = {}) {
  for (const [key, node] of Object.entries(tree)) {
    if (key.startsWith("$")) continue;
    const type = node.$type ?? inherited;
    if (node && typeof node === "object" && "$value" in node) out[[...path, key].join(".")] = { value: String(node.$value), type };
    else if (node && typeof node === "object") flatten(node, [...path, key], type, out);
  }
  return out;
}

const primitive = flatten(read("primitive.json"));
const component = flatten(read("component.json"));
const themes = { dark: flatten(read("semantic.dark.json")), light: flatten(read("semantic.light.json")) };
const contrast = read("contrast.json").pairs;

const layerOf = name => (name in primitive ? "primitive" : name in component ? "component" : "semantic");
const cssVar = name => `--vx-${name.replaceAll(".", "-")}`;
const reference = /\{([^{}]+)\}/g;

const problems = [];
for (const [theme, semantic] of Object.entries(themes)) {
  const names = new Set([...Object.keys(primitive), ...Object.keys(component), ...Object.keys(semantic)]);
  for (const [name, token] of Object.entries({ ...semantic, ...component })) {
    for (const [, target] of token.value.matchAll(reference)) {
      if (!names.has(target)) problems.push(`${theme}: ${name} refers to ${target}, which does not exist`);
    }
  }
  const semanticKeys = Object.keys(semantic).sort().join(",");
  if (semanticKeys !== Object.keys(themes.dark).sort().join(",")) problems.push(`${theme}: its semantic names differ from the dark theme's`);
}

// Fully resolved values per theme, for the contrast check and the Storybook reference.
function resolveAll(semantic) {
  const all = { ...primitive, ...semantic, ...component };
  const done = {};
  const visit = (name, seen = []) => {
    if (name in done) return done[name];
    if (seen.includes(name)) throw new Error(`reference cycle: ${[...seen, name].join(" -> ")}`);
    done[name] = all[name].value.replace(reference, (_, target) => visit(target, [...seen, name]));
    return done[name];
  };
  for (const name of Object.keys(all)) visit(name);
  return done;
}

// OKLCH -> linear sRGB (Björn Ottosson's OKLab), then WCAG relative luminance.
function luminance(color) {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(color.trim());
  if (!match) throw new Error(`contrast needs an oklch() color, got ${color}`);
  const [L, C, h] = match.slice(1).map(Number);
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = x => Math.min(1, Math.max(0, x));
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}
const ratio = (x, y) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const resolved = {};
const contrastReport = [];
for (const [theme, semantic] of Object.entries(themes)) {
  resolved[theme] = resolveAll(semantic);
  for (const pair of contrast) {
    const value = ratio(resolved[theme][pair.fg], resolved[theme][pair.bg]);
    contrastReport.push({ theme, ...pair, ratio: Math.round(value * 100) / 100 });
    if (value < pair.min) problems.push(`${theme}: ${pair.fg} on ${pair.bg} is ${value.toFixed(2)}:1, needs ${pair.min}:1`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

// CSS: primitives are literal; semantic and component tokens point at other tokens through var().
// A custom property is computed where it is declared and inherited already resolved, so component
// tokens are declared again inside each theme scope to pick up that theme's semantic values.
// Either theme can be nested inside the other with data-theme.
const declare = tokens => Object.entries(tokens)
  .map(([name, token]) => `  ${cssVar(name)}: ${token.value.replace(reference, (_, target) => `var(${cssVar(target)})`)};`).join("\n");
const header = "/* Generated by scripts/build-tokens.mjs from src/design-system/tokens/source. Do not edit. */";
const css = `${header}
:root {
  color-scheme: dark;
${declare(primitive)}
${declare(themes.dark)}
${declare(component)}
}

[data-theme="light"] {
  color-scheme: light;
${declare(themes.light)}
${declare(component)}
}

/* Dark again inside a light area, e.g. a code panel on a light page. */
[data-theme="dark"] {
  color-scheme: dark;
${declare(themes.dark)}
${declare(component)}
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --vx-duration-fast: 0ms;
    --vx-duration-base: 0ms;
    --vx-duration-slow: 0ms;
  }
}
`;

// TS: a nested map of var() references for components, and a flat list for the reference pages.
const nested = {};
const list = [];
for (const name of [...Object.keys(primitive), ...Object.keys(themes.dark), ...Object.keys(component)]) {
  const parts = name.split(".");
  let node = nested;
  parts.slice(0, -1).forEach(part => { node = node[part] ??= {}; });
  node[parts.at(-1)] = `var(${cssVar(name)})`;
  const token = primitive[name] ?? themes.dark[name] ?? component[name];
  list.push({ name, cssVar: cssVar(name), type: token.type, layer: layerOf(name), dark: resolved.dark[name], light: resolved.light[name] });
}
const ts = `// Generated by scripts/build-tokens.mjs from src/design-system/tokens/source. Do not edit.
export const vx = ${JSON.stringify(nested, null, 2)} as const;

export type TTokenEntry = {
  name: string;
  cssVar: string;
  type: string;
  layer: "primitive" | "semantic" | "component";
  dark: string;
  light: string;
};

export const tokenList: TTokenEntry[] = ${JSON.stringify(list, null, 2)};

export const contrastReport = ${JSON.stringify(contrastReport, null, 2)} as const;
`;

const outputs = { "tokens.css": css, "tokens.ts": ts };
let stale = false;
for (const [file, content] of Object.entries(outputs)) {
  const path = resolve(root, file);
  let current = "";
  try { current = readFileSync(path, "utf8").replace(/\r\n/g, "\n"); } catch { /* first build */ }
  if (current === content) continue;
  if (check) { console.error(`${file} is out of date; run node scripts/build-tokens.mjs`); stale = true; }
  else writeFileSync(path, content);
}
if (stale) process.exit(1);
const weakest = contrastReport.reduce((min, entry) => (entry.ratio / entry.min < min.ratio / min.min ? entry : min));
console.log(JSON.stringify({ tokens: list.length, contrastPairs: contrastReport.length, weakest, mode: check ? "check" : "write" }));
