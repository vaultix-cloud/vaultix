// The poke: how an unresolved failure reaches the agent working in this repository (docs/0145).
//
// Run as a Claude Code hook (.claude/settings.json), it does three things, none of which cost anything when nothing is wrong:
//   (no argument)  SessionStart and UserPromptSubmit: refresh the hygiene findings (git only, no network) and print every unresolved
//                  alert as context, so the agent sees the failure before it does anything else.
//   --stop         Stop: if a failure is unresolved and has not yet been pushed back on twice, refuse to let the turn end and say why.
//                  A hook that blocks forever would trap the session, so there are two guards: the harness sets `stop_hook_active`
//                  when it is already continuing because of a block (we then let it end), and each alert is pushed back on at most
//                  twice in total. After that it is still shown on every prompt, which is the loud-but-not-looping part.
// Hygiene findings (leftover branches) are advice: they are shown, and never block.
//
// The text names the rule and what clears the alert, and the only way to clear one is for the check to pass or the branch to land.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIX_THE_SOURCE } from "../../kernel/contracts/documents/src/gate-failure.v1.ts";
import { countPoke, isBlocking, list } from "./alerts.mjs";
import { syncHygiene } from "./hygiene.mjs";

export const MAX_POKES = 2;
const SHOWN = 6;

/** The context text for a set of alerts, or "" when there are none. */
export function describe(alerts) {
  if (alerts.length === 0) return "";
  const blocking = alerts.filter(alert => isBlocking(alert.record));
  const lines = [`GATE ALERT: ${blocking.length} failure(s) and ${alerts.length - blocking.length} housekeeping item(s) are unresolved. ${FIX_THE_SOURCE}.`];
  for (const alert of [...blocking, ...alerts.filter(a => !isBlocking(a.record))].slice(0, SHOWN)) {
    const { record } = alert;
    const subject = record.kind === "absorb_failed" ? `${record.branch} (stage ${record.stage})` : record.kind === "leftover_ref" ? record.ref : record.check;
    lines.push(`- ${isBlocking(record) ? "FAIL" : "TIDY"} ${record.kind}: ${subject} @ ${record.commit.slice(0, 8)}, raised ${alert.raisedAt.slice(0, 19)}Z`);
    lines.push(`    expected: ${record.expected}`);
    lines.push(`    observed: ${record.observed}${record.logPath ? `  (log: ${record.logPath})` : ""}`);
  }
  if (alerts.length > SHOWN) lines.push(`- and ${alerts.length - SHOWN} more: node scripts/absorb.mjs --status`);
  lines.push("An alert clears only when its check passes or its branch lands on main: node scripts/gate.mjs (or --full), node scripts/absorb.mjs <branch>. There is no dismiss.");
  return lines.join("\n");
}

/** What a Stop hook should answer: nothing (let the turn end) or a block with the reason. Counts each push-back. */
export function stopDecision(root, { stopHookActive = false } = {}) {
  if (stopHookActive) return null;
  const owed = list(root).filter(alert => isBlocking(alert.record) && alert.pokes < MAX_POKES);
  if (owed.length === 0) return null;
  for (const alert of owed) countPoke(root, alert.key);
  return { decision: "block", reason: `${describe(owed)}\nDo not end the turn with this unresolved: fix the source now, or say plainly why it cannot be fixed here.` };
}

const lower = path => (process.platform === "win32" ? path.toLowerCase() : path);
if (process.argv[1] && lower(resolve(process.argv[1])) === lower(fileURLToPath(import.meta.url))) {
  const root = process.env.CLAUDE_PROJECT_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  try {
    if (process.argv.includes("--stop")) {
      let input = {};
      try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no input */ }
      const decision = stopDecision(root, { stopHookActive: input.stop_hook_active === true });
      if (decision) console.log(JSON.stringify(decision));
    } else {
      try { syncHygiene(root); } catch { /* hygiene is advice; it must never stop the alerts being shown */ }
      const text = describe(list(root));
      if (text) console.log(text);
    }
  } catch {
    // Outside a repository, or the alert directory is unreadable: a hook must never break the session it is meant to help.
  }
}
