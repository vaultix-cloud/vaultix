// node scripts/build-kernel.mjs [--prepare-only]
// Creates a fresh, isolated source context and optionally builds the kernel image.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportKernel, kernelInput } from "./lib/kernel-package.mjs";
import { proveKernelImage } from "./lib/kernel-image-proof.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true });
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--prepare-only")) throw new Error("usage: node scripts/build-kernel.mjs [--prepare-only]");
const baseline = "1da705e0";
const inherited = new Set(git(["ls-tree", "-r", baseline]).trim().split("\n").map(line => line.split(/\s+/)[2]));
const paths = git(["ls-files", "-z", "--", "kernel"]).split("\0").filter(kernelInput);
// The recipe can be new in an uncommitted candidate. Other inputs must be tracked.
if (!paths.includes("kernel/Dockerfile.standalone-vaultix")) paths.push("kernel/Dockerfile.standalone-vaultix");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const work = mkdtempSync(resolve(root, ".cache/kernel-build-"));
const context = resolve(work, "source");
const report = { baseline, revision: git(["rev-parse", "HEAD"]).trim(), dirty: Boolean(git(["status", "--porcelain"]).trim()), context, files: [], imageBuilt: false, openapiSmoke: false };
const save = () => writeFileSync(resolve(work, "result.json"), JSON.stringify(report, null, 2) + "\n");
try {
  report.files = exportKernel(root, context, paths, inherited);
  save();
  console.log(`Kernel context: ${context}\nInputs: ${report.files.length}; no byte-identical import blobs. This is not an authorship or licence clearance.`);
  if (!args.includes("--prepare-only")) {
    const tag = `vaultix-kernel:candidate-${work.split(/[\\/]/).pop().toLowerCase()}`;
    const built = spawnSync("docker", ["build", "-f", resolve(context, "Dockerfile.standalone-vaultix"), "-t", tag, context], { cwd: root, stdio: "inherit", windowsHide: true });
    if (built.error || built.status !== 0) throw new Error(built.error?.message ?? `Docker build failed (${built.status})`);
    report.imageId = execFileSync("docker", ["image", "inspect", "--format", "{{.Id}}", tag], { encoding: "utf8", windowsHide: true }).trim();
    report.imageBuilt = true;
    const document = JSON.parse(execFileSync("docker", ["run", "--rm", "--network=none", report.imageId, "openapi"], { encoding: "utf8", windowsHide: true }));
    if (!document.paths?.["/api/vx/v1/auth/setup"] || !document.paths?.["/api/vx/v1/secrets"]) throw new Error("Image does not expose the expected auth and secrets contract");
    report.openapiSmoke = true;
    report.flowChecks = await proveKernelImage(report.imageId);
    console.log(`Kernel image: ${report.flowChecks.length} real-container checks passed.`);
  }
} catch (error) {
  report.error = error.message;
  console.error(`Kernel candidate incomplete: ${error.message}`);
  process.exitCode = 1;
} finally {
  save();
  console.log(`Evidence: ${resolve(work, "result.json")}`);
}
