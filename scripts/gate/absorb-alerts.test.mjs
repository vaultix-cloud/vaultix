// Alerts: shared by every worktree, only valid records, cleared only by the fix, and the optional webhook (docs/0145).
// Real git repositories from absorb-world.mjs; each test file runs in its own process, so they run side by side.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { FIX_THE_SOURCE } from "../../kernel/contracts/documents/src/gate-failure.v1.ts";
import { absorb } from "./absorb.mjs";
import { alertDirectory, announce, clearCheck, list, raise } from "./alerts.mjs";
import { findings, syncHygiene } from "./hygiene.mjs";
import { MAX_POKES, describe, stopDecision } from "./poke.mjs";
import { cli, commitAll, failureRecord, fakeGate, git, gitOk, go, head, here, mentions, world, write } from "./absorb-world.mjs";

test("an alert is shared by every worktree of the repository", { timeout: 60000 }, () => {
  const w = world();
  const wt = w.branch("feat/shared");
  raise(wt, failureRecord());
  assert.equal(list(w.main).length, 1);
  assert.equal(list(wt).length, 1);
});

test("an invalid record is refused, so an alert never holds anything the gate did not write", { timeout: 60000 }, () => {
  const w = world();
  assert.throws(() => raise(w.main, failureRecord({ output: "what the check printed" })), /invalid failure record/);
  assert.throws(() => raise(w.main, failureRecord({ rule: "fix the answer" })), /invalid failure record/);
  assert.deepEqual(list(w.main), []);
});

test("the same alert is one file, a repeat on the same commit keeps its pokes and a new commit starts again", { timeout: 60000 }, () => {
  const w = world();
  raise(w.main, failureRecord());
  const first = list(w.main);
  assert.equal(first.length, 1);
  stopDecision(w.main);
  raise(w.main, failureRecord());
  assert.equal(list(w.main)[0].pokes, 1, "the same failure on the same commit keeps its count");
  raise(w.main, failureRecord({ commit: "b".repeat(40) }));
  assert.equal(list(w.main).length, 1);
  assert.equal(list(w.main)[0].pokes, 0, "a new commit is a new failure");
});

test("a check passing clears its alerts and nobody else's", { timeout: 60000 }, () => {
  const w = world();
  raise(w.main, failureRecord());
  raise(w.main, failureRecord({ check: "documents" }));
  clearCheck(w.main, "kernel-tests");
  assert.deepEqual(list(w.main).map(alert => alert.record.check), ["documents"]);
});

test("a file in the alert directory that is not a valid record is ignored, never trusted", { timeout: 60000 }, () => {
  const w = world();
  raise(w.main, failureRecord());
  writeFileSync(resolve(alertDirectory(w.main), "junk.json"), JSON.stringify({ raisedAt: "x", pokes: 0, record: { kind: "check_failed" } }));
  writeFileSync(resolve(alertDirectory(w.main), "broken.json"), "{ not json");
  assert.equal(list(w.main).length, 1);
});

test("announce writes the alert and the outbox message, and posts to a configured webhook the same gate-written text", { timeout: 60000 }, async () => {
  const w = world();
  const received = [];
  const server = http.createServer((request, response) => { let body = ""; request.on("data", chunk => { body += chunk; }); request.on("end", () => { received.push({ headers: request.headers, body }); response.end("ok"); }); });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  try {
    const url = `http://127.0.0.1:${server.address().port}/topic`;
    const announced = await announce(w.main, failureRecord(), { VX_GATE_NOTIFY_WEBHOOK: url });
    assert.equal(announced.webhook.sent, true);
    assert.equal(list(w.main).length, 1);
    assert.equal(existsSync(announced.message), true);
    assert.equal(received.length, 1);
    assert.match(received[0].headers.title, /kernel-tests/);
    assert.equal(received[0].headers.priority, "urgent");
    assert.ok(received[0].body.includes(FIX_THE_SOURCE));
    assert.equal(mentions(received[0].body, w.dir), false);
  } finally { server.close(); }
});

test("a webhook that is down, or is not http(s), never hides the failure", { timeout: 60000 }, async () => {
  const w = world();
  const down = await announce(w.main, failureRecord(), { VX_GATE_NOTIFY_WEBHOOK: "http://127.0.0.1:9/none" });
  assert.equal(down.webhook.sent, false);
  assert.equal(list(w.main).length, 1, "the alert is written before the webhook is tried");
  const bad = await announce(w.main, failureRecord({ check: "documents" }), { VX_GATE_NOTIFY_WEBHOOK: "file:///etc/passwd" });
  assert.equal(bad.webhook.sent, false);
  const none = await announce(w.main, failureRecord({ check: "lexicon" }), {});
  assert.match(none.webhook.reason, /not set/);
});
