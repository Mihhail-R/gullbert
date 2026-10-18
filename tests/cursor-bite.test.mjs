import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
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
