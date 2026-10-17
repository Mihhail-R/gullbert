import test from "node:test";
import assert from "node:assert/strict";
import { deferred, harness, settle } from "./application-harness.mjs";

test("native shutdown freezes changes and waits for queued memory commits", async () => {
  const pending = deferred();
  const h = harness({ native: true, save: () => pending.promise });
  await h.app.start();
  h.changeMemory();
  const prepare = h.nativeListeners.get("gullbert-shutdown-prepare");
  assert.equal(typeof prepare, "function");
  prepare({ payload: 1 });
  prepare({ payload: 1 });
  await settle();
  h.nativeListeners.get("gullbert-action")({ payload: { action: "spin" } });
  assert.equal(h.calls.some(([name]) => name === "shutdown_ready"), false);
  assert.equal(h.calls.some(([name]) => name === "action"), false);
  pending.resolve();
  await settle();
  assert.deepEqual(h.saved.at(-1), { collection: { sock: 1 } });
  assert.deepEqual(h.calls.filter(([name]) => name === "shutdown_ready"), [
    ["shutdown_ready", { id: 1, error: null }],
  ]);
  assert.equal(h.viewDisposed, 0);
  await h.app.dispose();
});

test("failed shutdown leaves memory live and a retry can commit successfully", async () => {
  let fail = false;
  const h = harness({ native: true, save() {
    if (fail) {
      throw new Error("disk full");
    }
  } });
  await h.app.start();
  await settle();
  h.changeMemory();
  fail = true;
  h.nativeListeners.get("gullbert-shutdown-prepare")({ payload: 1 });
  await settle();
  assert.match(h.calls.find(([name]) => name === "shutdown_ready")[1].error, /disk full/);
  h.nativeListeners.get("gullbert-shutdown-cancel")({ payload: 1 });
  h.nativeListeners.get("gullbert-action")({ payload: { action: "spin" } });
  assert.ok(h.calls.some(([name]) => name === "action"));
  fail = false;
  h.nativeListeners.get("gullbert-shutdown-prepare")({ payload: 2 });
  await settle();
  assert.deepEqual(
    h.calls.filter(([name]) => name === "shutdown_ready")
      .at(-1),
    ["shutdown_ready", { id: 2, error: null }]
  );
  await h.app.dispose();
});

test("timeout and late acknowledgments cannot complete a later shutdown", async () => {
  const pending = deferred();
  const h = harness({ native: true, save: () => pending.promise });
  await h.app.start();
  const prepare = h.nativeListeners.get("gullbert-shutdown-prepare");
  const cancel = h.nativeListeners.get("gullbert-shutdown-cancel");
  prepare({ payload: 1 });
  await settle();
  cancel({ payload: 1 });
  h.changeMemory();
  prepare({ payload: 2 });
  cancel({ payload: 1 });
  await settle();
  pending.resolve();
  await settle();
  assert.deepEqual(h.calls.filter(([name]) => name === "shutdown_ready"), [
    ["shutdown_ready", { id: 2, error: null }],
  ]);
  assert.deepEqual(h.saved.at(-1), { collection: { sock: 1 } });
  await h.app.dispose();
});

test("shutdown after unread restoration preserves storage and still permits quitting", async () => {
  const h = harness({ native: true, load() {
    throw new Error("unread database");
  } });
  await h.app.start();
  h.nativeListeners.get("gullbert-shutdown-prepare")({ payload: 1 });
  await settle();
  assert.deepEqual(h.saved, []);
  assert.deepEqual(h.calls.filter(([name]) => name === "shutdown_ready"), [
    ["shutdown_ready", { id: 1, error: null }],
  ]);
  await h.app.dispose();
});

test("aborted shutdown replays the latest native settings and visibility", async () => {
  const pending = deferred();
  const h = harness({ native: true, save: () => pending.promise });
  const configured = [];
  h.simulation.configure = (settings) => configured.push(settings);
  await h.app.start();
  configured.length = 0;
  h.nativeListeners.get("gullbert-shutdown-prepare")({ payload: 1 });
  await settle();
  const latest = { sound: true, paused: true, mischief: 0, hat: "cap" };
  h.nativeListeners.get("gullbert-settings")({ payload: { ...latest, sound: false } });
  h.nativeListeners.get("gullbert-settings")({ payload: latest });
  h.nativeListeners.get("gullbert-visible")({ payload: false });
  assert.deepEqual(configured, []);
  h.nativeListeners.get("gullbert-shutdown-cancel")({ payload: 1 });
  assert.deepEqual(configured, [latest]);
  assert.deepEqual(h.calls.filter(([name]) => name === "visible")
    .at(-1), ["visible", false]);
  pending.resolve();
  await settle();
  await h.app.dispose();
});

test("disposal invalidates a shutdown waiting for its memory commit", async () => {
  const pending = deferred();
  const h = harness({ native: true, save: () => pending.promise });
  await h.app.start();
  h.nativeListeners.get("gullbert-shutdown-prepare")({ payload: 1 });
  await settle();
  const disposal = h.app.dispose();
  pending.resolve();
  await disposal;
  await settle();
  assert.deepEqual(h.calls.filter(([name]) => name === "shutdown_ready"), []);
});

test("an uncertain acknowledgment waits for native cancellation before resuming", async () => {
  const h = harness({ native: true, invoke(name) {
    if (name === "shutdown_ready") {
      throw new Error("IPC reply unavailable");
    }
  } });
  await h.app.start();
  h.nativeListeners.get("gullbert-shutdown-prepare")({ payload: 1 });
  await settle();
  h.nativeListeners.get("gullbert-action")({ payload: { action: "spin" } });
  assert.equal(h.calls.some(([name]) => name === "action"), false);
  assert.match(String(h.errors.at(-1)), /IPC reply unavailable/);
  h.nativeListeners.get("gullbert-shutdown-cancel")({ payload: 1 });
  h.nativeListeners.get("gullbert-action")({ payload: { action: "spin" } });
  assert.ok(h.calls.some(([name]) => name === "action"));
  await h.app.dispose();
});
