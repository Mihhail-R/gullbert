import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { createCursorBiteBridge } from "../web-dist/platform/cursor-bite.js";

function catchPointer(action = "eat_cursor") {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ paused: false, mischief: 0 });
  sim.action(action);
  sim.pointer({ x: sim.inspect().x + 78, y: sim.inspect().y + 48 });
  for (let i = 0; i < 30; i++) sim.step(0.05);
  return sim;
}
test("explicit eating catches, tugs briefly and spits out the pointer", () => {
  const sim = catchPointer();
  assert.equal(sim.inspect().scene.phase, "chew");
  assert.equal(sim.inspect().wantsPointer, false);
  const x = sim.inspect().x;
  const facing = sim.inspect().facing;
  const start = sim.inspect().time;
  while (sim.inspect().scene.phase === "chew") {
    sim.step(0.05);
    assert.equal(sim.inspect().facing, facing);
  }
  assert.ok(sim.inspect().time - start <= 1.25);
  assert.ok(
    Math.abs(sim.inspect().x - x) > 20 && Math.abs(sim.inspect().x - x) < 40,
  );
  assert.equal(sim.inspect().scene.phase, "recoil");
  assert.match(sim.inspect().bubble, /not a chip/);
  assert.equal(catchPointer("nibble_cursor").inspect().scene.phase, "recoil");
});
test("a pointer that escapes mid-peck is never caught remotely", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.action("eat_cursor");
  sim.pointer({ x: sim.inspect().x + 78, y: sim.inspect().y + 48 });
  while (sim.inspect().scene.phase !== "peck") sim.step(0.05);
  sim.pointer({ x: 790, y: 590 });
  for (let i = 0; i < 8; i++) sim.step(0.05);
  assert.equal(sim.inspect().scene.phase, "stalk");
});
test("every interruption drops a caught pointer", () => {
  for (const interrupt of [
    (sim) => sim.setVisible(false),
    (sim) => sim.configure({ ...sim.inspect().settings, paused: true }),
    ...["cancel", "clean", "feed", "nap", "summon", "place_bag"].map(
      (name) => (sim) => sim.action(name),
    ),
  ]) {
    const sim = catchPointer();
    interrupt(sim);
    assert.notEqual(sim.inspect().scene?.phase, "chew");
  }
});
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
  for (let i = 0; i < 10; i++) bridge.sync(first, { x: 20, y: 10 });
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
