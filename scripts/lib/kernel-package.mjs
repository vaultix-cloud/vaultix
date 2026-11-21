// A small, explicit build input set. No repository-wide Docker COPY and no local
// target, credentials, inherited frontend, backend, fixtures or node_modules.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function kernelInput(path) {
  if (typeof path !== "string" || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) return false;
  if (/^kernel\/(Cargo\.(toml|lock)|clippy\.toml|Dockerfile\.standalone-vaultix)$/.test(path)) return true;
  const crate = "(?:foundation/[^/.]+|domains/[^/.]+/[^/.]+|server|clients/[^/.]+)";
  return new RegExp(`^kernel/${crate}/(?:Cargo\\.toml|src/(?:[^/.][^/]*\\/)*[^/]+\\.rs|migrations/[^/]+\\.sql)$`).test(path);
}

export function exportKernel(root, destination, paths, inheritedBlobs = new Set()) {
  const files = [];
  for (const path of [...new Set(paths)].sort()) {
    if (!kernelInput(path)) throw new Error(`Not a kernel build input: ${path}`);
    // Refuse symlinks in every component, not only the final file.
    let source = root;
    for (const part of path.split("/")) {
      source = resolve(source, part);
      if (lstatSync(source).isSymbolicLink()) throw new Error(`Symlink in kernel build input: ${path}`);
    }
    if (!lstatSync(source).isFile()) throw new Error(`Not a regular file: ${path}`);
    const bytes = readFileSync(source);
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (inheritedBlobs.has(blob)) throw new Error(`Byte-identical inherited build input: ${path}`);
    const target = resolve(destination, path.slice("kernel/".length));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: "wx" });
    files.push({ path, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  }
  return files;
}
