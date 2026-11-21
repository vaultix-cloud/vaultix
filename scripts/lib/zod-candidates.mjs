import { execFileSync } from "node:child_process";

// Every import recognised by check-zod-ceiling contains the literal "zod".
// Let Git scan tracked working-tree content in one process, then apply the same
// JavaScript import expression to the candidates. -a preserves matches in files
// containing NUL bytes or marked binary; -z preserves arbitrary path names.
export function zodCandidates(root) {
  const paths = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs"];
  let output;
  try {
    output = execFileSync("git", ["grep", "--no-ext-grep", "-a", "-l", "-z", "-e", "zod", "--", ...paths], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
  return output.split("\0").filter(path => path && !path.startsWith("leftover/"));
}
