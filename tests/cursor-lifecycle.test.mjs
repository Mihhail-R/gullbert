import test from "node:test";
import assert from "node:assert/strict";
import { createCursorBiteBridge } from "../web-dist/platform/cursor-bite.js";
import { deferred, settle } from "./application-harness.mjs";

function encounter(cursorId = 1) {
  return { token: {}, phase: "chew", cursorId, beak: { x: 10, y: 20 } };
}

function lifecycle(options = {}) {
  let current = encounter();
  let reaction = null;
  let serial = 0;
  let elapsedMs = 0;
  const timers = new Map();
  const releases = [];
  const tugs = [];
  const recoils = [];
  const bridge = createCursorBiteBridge({
    simulation: {
      cursorEncounter: () => current && { ...current },
      currentReaction: (token) => token === reaction,
      armReaction(token, id) {
        if (token !== reaction) {
          return false;
        }

        if (current) {
          current.cursorId = id;
        }

        return true;
      },
      releaseCursor(reason, token) {
        if (current?.token === token) {
          recoils.push(token);
          current.phase = "recoil";
        }
      },
    },
    schedule(callback, delay) {
      const id = ++serial;
      timers.set(id, { callback, delay, at: elapsedMs + delay });
      return id;
    },
    cancel: (id) => timers.delete(id),
    tug: options.preview ? null : async (id, point) => {
      tugs.push([id, point]);
      return options.tug ? options.tug() : true;
    },
    release: async (id) => releases.push(id),
    changed() {
      bridge.sync();
    },
  });
  return {
    bridge, timers, releases, tugs, recoils,
    set encounter(value) {
      current = value;
    },
    set reaction(value) {
      reaction = value;
    },
    advance(milliseconds) {
      elapsedMs += milliseconds;

      for (const [id, timer] of [...timers]) {
        if (timer.at <= elapsedMs) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    deadline() {
      const entry = [...timers].find(([, timer]) => timer.delay === 1200);
      assert.ok(entry, "chewing must have a wall-clock deadline");
      timers.delete(entry[0]);
      return entry[1].callback;
    },
  };
}

test("fresh encounter snapshots do not extend the chewing deadline", () => {
  const h = lifecycle({ preview: true });
  h.bridge.sync();
  h.advance(1199);
  h.bridge.sync();
  assert.deepEqual(h.recoils, []);
  h.advance(1);
  assert.equal(h.recoils.length, 1);
  assert.deepEqual(h.tugs, []);
});

test("a replaced encounter ignores both its old deadline and a pending failed tug", async () => {
  const pending = deferred();
  const h = lifecycle({ tug: () => pending.promise });
  h.bridge.sync();
  await settle();

  for (let count = 0; count < 10; count++) {
    h.bridge.sync();
  }

  assert.equal(h.tugs.length, 1, "a pending tug must not allow more IPC requests");
  const expire = h.deadline();
  const replacement = encounter(2);
  h.encounter = replacement;
  h.bridge.sync();
  expire();
  pending.resolve(false);
  await settle();
  assert.deepEqual(h.recoils, []);
  assert.deepEqual(h.releases, [1]);
  h.bridge.sync();
  await settle();
  assert.equal(h.tugs.at(-1)[0], 2);
  assert.deepEqual(h.recoils, [replacement.token]);
  h.bridge.sync();
  await settle();
  assert.equal(h.tugs.length, 2, "a failed encounter cannot tug again");
  assert.deepEqual(h.releases, [1, 2]);
});

test("suspending an encounter cancels queued tugs and stale deadlines", async () => {
  const h = lifecycle();
  h.bridge.sync();
  const expire = h.deadline();
  h.bridge.sync(false);
  expire();
  await settle();
  assert.deepEqual(h.tugs, []);
  assert.deepEqual(h.recoils, []);
  assert.deepEqual(h.releases, [1]);
  h.bridge.sync();
  await settle();
  assert.deepEqual(h.tugs, [], "resuming must not reopen a released authorization");
});

test("shutdown releases reaction authorization before it becomes a cursor encounter", () => {
  const h = lifecycle();
  const reaction = {};
  h.encounter = null;
  h.reaction = reaction;
  h.bridge.trackReaction(reaction);
  h.bridge.sync();
  h.bridge.armReaction(reaction, 7);
  h.bridge.stop();
  h.bridge.armReaction(reaction, 8);
  assert.deepEqual(h.releases, [7, 8]);
  assert.equal(h.timers.size, 0);
});

test("reaction authorization survives relocation and releases once after recoil", async () => {
  const h = lifecycle();
  const reaction = {};
  h.encounter = null;
  h.reaction = reaction;
  h.bridge.trackReaction(reaction);
  h.bridge.sync();
  h.bridge.armReaction(reaction, 7);
  h.bridge.sync();
  assert.deepEqual(h.releases, []);
  h.encounter = encounter(7);
  h.bridge.sync();
  await settle();
  assert.equal(h.tugs[0][0], 7);
  h.deadline()();
  h.reaction = null;
  h.encounter = null;
  h.bridge.sync();
  h.bridge.stop();
  assert.deepEqual(h.releases, [7]);
});

test("obsolete reaction authorization is released without arming a new reaction", () => {
  const h = lifecycle();
  h.encounter = null;
  h.reaction = {};
  h.bridge.sync();
  h.bridge.armReaction({}, 7);
  assert.deepEqual(h.releases, [7]);
});

test("authorization arriving after recoil is released immediately", () => {
  const h = lifecycle();
  const scene = encounter();
  scene.cursorId = undefined;
  scene.phase = "recoil";
  const reaction = {};
  h.encounter = scene;
  h.reaction = reaction;
  h.bridge.trackReaction(reaction);
  h.bridge.sync();
  h.bridge.armReaction(reaction, 7);
  h.bridge.sync();
  assert.deepEqual(h.releases, [7]);
});

test("revenge snapshots use a fixed two-second wall-clock hold", () => {
  const h = lifecycle({ preview: true });
  h.encounter = { ...encounter(), holdMs: 2000 };
  h.bridge.sync();
  h.advance(1200);
  h.bridge.sync();
  assert.deepEqual(h.recoils, []);
  h.advance(799);
  assert.deepEqual(h.recoils, []);
  h.advance(1);
  assert.equal(h.recoils.length, 1);
  assert.deepEqual(h.releases, [1]);
});
