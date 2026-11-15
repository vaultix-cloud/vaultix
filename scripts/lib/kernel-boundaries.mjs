// The kernel's dependency and folder rules (docs/0136 section 1 and 2), as code.
//
//   foundation/*        depends only on foundation
//   domains/<d>/<role>  depends on foundation and on its own domain
//   server, clients/*, services/*   may assemble anything inside the kernel
//   nothing in the kernel may reach outside the kernel (platform, control, the inherited engine)
//   no folder named utils, common, shared, misc or helpers; no loose crate outside the layout
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const FORBIDDEN_FOLDERS = new Set(["utils", "common", "shared", "misc", "helpers", "core-utils"]);

function crateDirs(kernel) {
  const found = [];
  const walk = (dir, depth) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "target" || entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (existsSync(join(full, "Cargo.toml"))) found.push(full);
      if (depth < 4) walk(full, depth + 1);
    }
  };
  walk(kernel, 0);
  return found;
}

function packageName(dir) {
  const text = readFileSync(join(dir, "Cargo.toml"), "utf8");
  return /^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;
}

function pathDependencies(dir) {
  const text = readFileSync(join(dir, "Cargo.toml"), "utf8");
  return [...text.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*\bpath\s*=\s*"([^"]+)"/gm)].map(m => ({ name: m[1], path: m[2] }));
}

/** Where a crate sits in the layout: { zone: "foundation" | "domain" | "assembly", domain? } or null if it is misplaced. */
export function zoneOf(relativeDir) {
  const parts = relativeDir.split("/");
  if (parts[0] === "foundation" && parts.length === 2) return { zone: "foundation" };
  if (parts[0] === "domains" && parts.length === 3) return { zone: "domain", domain: parts[1] };
  if (["server"].includes(parts[0]) && parts.length === 1) return { zone: "assembly" };
  if (["clients", "services"].includes(parts[0]) && parts.length === 2) return { zone: "assembly" };
  return null;
}

export function checkKernel(root) {
  const kernel = resolve(root, "kernel");
  const problems = [];
  if (!existsSync(kernel)) return ["kernel/ does not exist"];

  const crates = crateDirs(kernel).filter(dir => packageName(dir));
  const byDir = new Map(crates.map(dir => [dir, { dir, rel: relative(kernel, dir).split("\\").join("/"), name: packageName(dir) }]));

  for (const { dir, rel, name } of byDir.values()) {
    const place = zoneOf(rel);
    if (!place) { problems.push(`${name}: ${rel} is outside the layout (foundation/<crate>, domains/<domain>/<role>, server, clients/<crate>, services/<crate>)`); continue; }
    for (const dependency of pathDependencies(dir)) {
      const target = resolve(dir, dependency.path);
      const targetRel = relative(kernel, target).split("\\").join("/");
      if (targetRel.startsWith("..")) { problems.push(`${name} depends on ${dependency.name} outside the kernel (${dependency.path}); the kernel never depends on platform, control or the inherited engine`); continue; }
      const targetPlace = zoneOf(targetRel);
      if (!targetPlace) { problems.push(`${name} depends on ${dependency.name}, which is outside the layout (${targetRel})`); continue; }
      if (place.zone === "foundation" && targetPlace.zone !== "foundation") problems.push(`${name} (foundation) depends on ${dependency.name} (${targetPlace.zone}); foundation depends only on foundation`);
      if (place.zone === "domain" && targetPlace.zone === "assembly") problems.push(`${name} (domain) depends on ${dependency.name} (assembly); a domain never depends on the server or a client`);
      if (place.zone === "domain" && targetPlace.zone === "domain" && targetPlace.domain !== place.domain) problems.push(`${name} (domain ${place.domain}) depends on ${dependency.name} (domain ${targetPlace.domain}); domains meet only through foundation or the server`);
    }
  }

  const walkFolders = (dir, depth) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "target" || entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (FORBIDDEN_FOLDERS.has(entry)) problems.push(`${relative(kernel, full).split("\\").join("/")}: a folder named "${entry}" collects unrelated code; give it a domain or a purpose`);
      if (depth < 3) walkFolders(full, depth + 1);
    }
  };
  walkFolders(kernel, 0);

  const manifest = readFileSync(join(kernel, "Cargo.toml"), "utf8");
  const members = /members\s*=\s*\[([^\]]*)\]/.exec(manifest)?.[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean) ?? [];
  const matches = (rel, pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+")}$`).test(rel);
  for (const { rel, name } of byDir.values()) if (!members.some(pattern => matches(rel, pattern))) problems.push(`${name} (${rel}) is not in the workspace members, so it is never built or tested`);

  // A test that installs a log subscriber must be the only test in its file (docs/0139): tracing keeps process-wide state
  // about which log sites are enabled, and a neighbouring test on another thread made such a test fail every time.
  for (const { dir, rel } of byDir.values()) {
    const testsDir = join(dir, "tests");
    if (!existsSync(testsDir)) continue;
    for (const file of readdirSync(testsDir)) {
      if (!file.endsWith(".rs") || !statSync(join(testsDir, file)).isFile()) continue;
      const source = readFileSync(join(testsDir, file), "utf8");
      if (!/\b(set_default|with_default|set_global_default)\s*\(/.test(source)) continue;
      const tests = (source.match(/#\[(tokio::)?test\b/g) ?? []).length;
      if (tests > 1) problems.push(`${rel}/tests/${file}: installs a log subscriber and has ${tests} tests; keep it to one test per file so no neighbour shares its process`);
    }
  }
  return problems;
}
