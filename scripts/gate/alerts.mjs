// Alerts: failures that stay loud until the source is fixed (docs/0145).
//
// An alert is a failure record (vaultix.gate-failure.v1) kept in ONE place for every worktree of the repository: the git common
// directory (`.git/vx-alerts/`), which is not committed and is shared by the main checkout and each linked worktree. So a failure
// raised while working in one worktree is seen by whoever opens any other.
//
// An alert is cleared by one thing only: the check that raised it passing, or the branch it names landing on main. There is no
// acknowledge and no dismiss, because an alert that can be dismissed is one the answer can be changed to silence (docs/0142).
//
// The record holds only text the gate wrote (see failure.mjs). Delivery is best effort and never hides the failure: the alert is
// written first, the outbox message second, and the optional webhook last; a webhook that is down is reported, not thrown.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "../../kernel/contracts/documents/src/registry.ts";
import { messageFor, writeFailure } from "./failure.mjs";

/** The git common directory of the repository `root` belongs to (the same from the main checkout and from every linked worktree). */
export function commonDir(root) {
  const out = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8", windowsHide: true });
  if (out.status !== 0) throw new Error(`${root} is not inside a git repository`);
  return out.stdout.trim();
}

export const alertDirectory = root => resolve(commonDir(root), "vx-alerts");

const slugify = text => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "x";

/** The file an alert lives in: one per thing that can be wrong, so raising it again updates it and never piles up copies. */
export function alertKey(record) {
  if (record.kind === "absorb_failed") return `absorb-${slugify(record.branch)}`;
  if (record.kind === "leftover_ref") return `ref-${slugify(record.problem)}-${slugify(record.ref)}`;
  return `${record.kind}-${slugify(record.check)}`;
}

/** Hygiene findings are advice, and never stop a session from ending; everything else is a failure that does. */
export const isBlocking = record => record.kind !== "leftover_ref";

const readJson = path => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

/** Record an alert. A repeat of the same alert on the same commit keeps its poke count; a new commit is a new failure and starts again. */
export function raise(root, record) {
  const parsed = parseDocument(record);
  if (!parsed.ok || parsed.id !== "vaultix.gate-failure.v1") throw new Error(`refusing to raise an alert for an invalid failure record: ${parsed.ok ? "not a gate failure" : parsed.problems.map(p => `${p.path}: ${p.expected}`).join("; ")}`);
  const directory = alertDirectory(root);
  mkdirSync(directory, { recursive: true });
  const key = alertKey(record);
  const path = resolve(directory, `${key}.json`);
  const before = readJson(path);
  const same = before?.record?.commit === record.commit;
  const alert = { raisedAt: same && before?.raisedAt ? before.raisedAt : new Date().toISOString(), pokes: same ? before.pokes ?? 0 : 0, record: parsed.value };
  writeFileSync(path, `${JSON.stringify(alert, null, 2)}\n`);
  return key;
}

/** Every alert that is a valid record, oldest first. A file that is not one is ignored here and never trusted. */
export function list(root) {
  const directory = alertDirectory(root);
  let names;
  try { names = readdirSync(directory); } catch { return []; }
  const alerts = [];
  for (const name of names.filter(file => file.endsWith(".json"))) {
    const raw = readJson(resolve(directory, name));
    const parsed = raw && typeof raw === "object" ? parseDocument(raw.record) : null;
    if (parsed?.ok && parsed.id === "vaultix.gate-failure.v1") alerts.push({ key: name.slice(0, -5), raisedAt: String(raw.raisedAt ?? ""), pokes: Number.isInteger(raw.pokes) ? raw.pokes : 0, record: parsed.value });
  }
  return alerts.sort((a, b) => a.raisedAt.localeCompare(b.raisedAt) || a.key.localeCompare(b.key));
}

export function clear(root, key) {
  rmSync(resolve(alertDirectory(root), `${key}.json`), { force: true });
}

/** A check passed: every alert it raised is cleared. This is the only way a check's alert goes away. */
export function clearCheck(root, checkId) {
  for (const alert of list(root)) if (alert.record.check === checkId && isBlocking(alert.record) && alert.record.kind !== "absorb_failed") clear(root, alert.key);
}

/** A branch landed: its absorb alert goes. */
export function clearBranch(root, branch) {
  for (const alert of list(root)) if (alert.record.kind === "absorb_failed" && alert.record.branch === branch) clear(root, alert.key);
}

export function countPoke(root, key) {
  const path = resolve(alertDirectory(root), `${key}.json`);
  const alert = readJson(path);
  if (!alert) return;
  alert.pokes = (Number.isInteger(alert.pokes) ? alert.pokes : 0) + 1;
  writeFileSync(path, `${JSON.stringify(alert, null, 2)}\n`);
}

/**
 * Post the message to a webhook the operator configured (VX_GATE_NOTIFY_WEBHOOK). ntfy.sh, Slack and Discord incoming hooks all accept
 * a POST; the body is the same text as the outbox message, which holds only what the gate wrote. Off unless configured.
 */
export async function webhook(record, env = process.env) {
  const target = env.VX_GATE_NOTIFY_WEBHOOK;
  if (!target) return { sent: false, reason: "VX_GATE_NOTIFY_WEBHOOK is not set" };
  try {
    const url = new URL(target);
    if (url.protocol !== "https:" && url.protocol !== "http:") return { sent: false, reason: "the webhook is not an http(s) URL" };
    const subject = `Vaultix gate failed: ${record.check} on ${record.commit.slice(0, 8)} (${record.tier})`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8", title: subject, priority: "urgent", tags: "rotating_light" },
      body: messageFor(record, { from: env.VX_GATE_NOTIFY_FROM, to: env.VX_GATE_NOTIFY_TO }),
      signal: AbortSignal.timeout(5000)
    });
    return response.ok ? { sent: true } : { sent: false, reason: `the webhook answered ${response.status}` };
  } catch (error) {
    return { sent: false, reason: `the webhook could not be reached (${error?.name ?? "error"})` };
  }
}

/** Make a failure loud: the alert (for the next session), the outbox message (for the owner), and the webhook if configured. */
export async function announce(root, record, env = process.env) {
  const written = writeFailure(root, record, { from: env.VX_GATE_NOTIFY_FROM, to: env.VX_GATE_NOTIFY_TO });
  const key = raise(root, record);
  const delivered = await webhook(record, env);
  return { ...written, key, webhook: delivered };
}
