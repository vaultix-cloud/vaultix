// Fails if the kernel breaks its layout or dependency rules (docs/0136). See scripts/lib/kernel-boundaries.mjs.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkKernel } from "./lib/kernel-boundaries.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = checkKernel(root);
if (problems.length) {
  for (const problem of problems) console.error(`kernel boundaries: ${problem}`);
  process.exit(1);
}
console.log("kernel boundaries: the layout and every dependency follow the rules");
