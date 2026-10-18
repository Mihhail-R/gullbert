import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { createCursorBiteBridge } from "../web-dist/platform/cursor-bite.js";
import { advance, reach } from "./simulation-helpers.mjs";

function catchPointer() {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ paused: false, mischief: 0 });
  sim.action("eat_cursor");
  sim.pointer({ x: sim.inspect().x + 78, y: sim.inspect().y + 48 });

  reach(sim, "chew");
  return sim;
}

test("a caught pointer is only tugged briefly before recoiling", () => {
  const sim = catchPointer();
  const initialX = sim.inspect().x;
  const start = sim.inspect().time;
  reach(sim, "recoil", 30);
  assert.ok(sim.inspect().time - start <= 1.25);
  assert.notEqual(sim.inspect().x, initialX, "the bird tugs while holding the pointer");
});

test("a pointer that escapes mid-peck is never caught remotely", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.action("eat_cursor");
  sim.pointer({ x: sim.inspect().x + 78, y: sim.inspect().y + 48 });

  reach(sim, "peck");
  sim.pointer({ x: 790, y: 590 });
  advance(sim, 0.4);
  assert.equal(sim.inspect().scene.phase, "stalk");
});

for (const [reason, interrupt] of [
  ["hiding", (sim) => sim.setVisible(false)],
  ["pausing", (sim) => sim.configure({ paused: true })],
  ["Stop", (sim) => sim.action("cancel")],
  ["feeding", (sim) => sim.action("feed")],
]) {
  test(`${reason} releases a caught pointer`, () => {
    const sim = catchPointer();
    interrupt(sim);
    assert.equal(sim.cursorEncounter(), null);
  });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
test("late failed tugs cannot cancel a replacement encounter or pile up IPC", async () => {
  let resolve,
    calls = 0,
    failures = 0;
  const releases = [];
  const bridge = createCursorBiteBridge({
    tug: () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
    release: async (id) => {
      releases.push(id);
    },
    failed: () => failures++,
  });
  const first = { phase: "chew", cursorId: 1 };
  bridge.sync(first, { x: 10, y: 10 });
  await flush();

  for (let i = 0; i < 10; i++) {
    bridge.sync(first, { x: 20, y: 10 });
  }

  assert.equal(calls, 1);
  const next = { phase: "stare", cursorId: 2 };
  bridge.sync(next);
  assert.deepEqual(releases, [1]);
  resolve(false);
  await flush();
  assert.equal(failures, 0);
  next.phase = "chew";
  bridge.sync(next, { x: 30, y: 10 });
  await flush();
  assert.equal(calls, 2);
  resolve(false);
  await flush();
  assert.equal(failures, 1);
  bridge.sync(next, { x: 30, y: 10 });
  assert.equal(calls, 2);
  assert.deepEqual(releases, [1, 2]);
});
test("stopping before dispatch prevents an obsolete tug", async () => {
  let calls = 0;
  const bridge = createCursorBiteBridge({
    tug: async () => {
      calls++;
    },
    release: async () => {},
    failed: () => {},
  });
  bridge.sync({ phase: "chew", cursorId: 1 }, { x: 10, y: 10 });
  bridge.stop();
  await flush();
  assert.equal(calls, 0);
});
