import test from "node:test";
import assert from "node:assert/strict";
import { harness, settle, pointerEvent, deferred } from "./application-harness.mjs";

for (const [reason, interrupt] of [
  ["hiding", (h) => h.nativeListeners.get("gullbert-visible")({ payload: false })],
  ["targeting", (h) => h.nativeListeners.get("gullbert-target")({
    payload: { outcome: "started", id: 2, purpose: "poop", preparation: "cancel" },
  })],
  ["disposal", (h) => h.app.dispose()],
]) {
  test(`${reason} cancels a queued cursor tug`, async () => {
    const h = harness({ native: true });
    const scene = { token: {}, phase: "chew", cursorId: 9, beak: { x: 10, y: 20 } };
    await h.app.start();
    h.simulation.cursorEncounter = () => ({ ...scene });
    h.nativeListeners.get("gullbert-action")({ payload: { action: "eat_cursor" } });
    await interrupt(h);
    await settle();
    assert.equal(h.calls.some(([name]) => name === "tug_cursor"), false);
    assert.deepEqual(h.calls.filter(([name]) => name === "release_cursor"), [
      ["release_cursor", { id: 9 }],
    ]);
    await h.app.dispose();
  });
}

test("shutdown cancellation cannot restart a previously released cursor hold", async () => {
  const h = harness({
    native: true,
    invoke(name) {
      if (name === "tug_cursor") {
        return true;
      }
    },
  });
  await h.app.start();
  const scene = { token: {}, phase: "chew", cursorId: 9, beak: { x: 10, y: 20 } };
  h.simulation.cursorEncounter = () => ({ ...scene });
  h.nativeListeners.get("gullbert-action")({ payload: { action: "eat_cursor" } });
  await settle();
  h.nativeListeners.get("gullbert-shutdown-prepare")({ payload: 1 });
  await settle();
  const tugs = h.calls.filter(([name]) => name === "tug_cursor").length;
  h.nativeListeners.get("gullbert-shutdown-cancel")({ payload: 1 });
  await settle();
  assert.equal(h.calls.filter(([name]) => name === "tug_cursor").length, tugs);
  assert.deepEqual(h.calls.filter(([name]) => name === "release_cursor"), [
    ["release_cursor", { id: 9 }],
  ]);
  await h.app.dispose();
});

test("pickup reaction authorization is handed to cursor cleanup during shutdown", async () => {
  const h = harness({
    native: true,
    invoke(name) {
      if (name === "begin_pickup") {
        return 4;
      }

      if (name === "end_pickup") {
        return 7;
      }
    },
  });
  const reaction = {};
  const armed = [];
  h.simulation.finishPickup = () => reaction;
  h.simulation.currentReaction = (token) => token === reaction;
  h.simulation.armReaction = (token, id) => {
    armed.push([token, id]);
    return true;
  };
  await h.app.start();
  h.emit("pointerdown", pointerEvent());
  await settle();
  h.emit("pointerup", pointerEvent());
  await settle();
  assert.deepEqual(armed, [[reaction, 7]]);
  h.nativeListeners.get("gullbert-shutdown-prepare")({ payload: 1 });
  await settle();
  assert.deepEqual(h.calls.filter(([name]) => name === "release_cursor"), [
    ["release_cursor", { id: 7 }],
  ]);
  await h.app.dispose();
});

test("a pickup authorization arriving after shutdown resumes stays cancelled", async () => {
  const pending = deferred();
  const h = harness({
    native: true,
    invoke(name) {
      if (name === "begin_pickup") {
        return 4;
      }

      if (name === "end_pickup") {
        return pending.promise;
      }
    },
  });
  const reaction = {};
  const armed = [];
  h.simulation.finishPickup = () => reaction;
  h.simulation.currentReaction = (token) => token === reaction;
  h.simulation.armReaction = (token, id) => {
    armed.push(id);
    return true;
  };
  await h.app.start();
  h.emit("pointerdown", pointerEvent());
  await settle();
  h.emit("pointerup", pointerEvent());
  await settle();
  h.nativeListeners.get("gullbert-shutdown-prepare")({ payload: 1 });
  await settle();
  h.nativeListeners.get("gullbert-shutdown-cancel")({ payload: 1 });
  pending.resolve(7);
  await settle();
  assert.deepEqual(armed, []);
  assert.deepEqual(h.calls.filter(([name]) => name === "release_cursor"), [
    ["release_cursor", { id: 7 }],
  ]);
  await h.app.dispose();
});
