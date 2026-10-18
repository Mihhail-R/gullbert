import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { advance } from "./simulation-helpers.mjs";

test("a chip chase keeps display animation active through eating, then returns to idle", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ paused: true });
  sim.action("feed_here", { x: 100, y: 100 });
  assert.equal(sim.status().animate, true);

  for (let tick = 0; tick < 200 && sim.inspect().mode !== "eat"; tick++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().mode, "eat");
  assert.equal(sim.status().animate, true, "eating still animates after travel stops");
  advance(sim, 3);
  assert.equal(sim.inspect().crumb, null);
  assert.equal(sim.status().animate, false);
});

test("a stationary nap requests animation until it is cancelled", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ paused: true });
  sim.action("nap");
  const { x, y, pose } = sim.present();

  advance(sim, 1);
  const sleeping = sim.present();
  assert.deepEqual({ x: sleeping.x, y: sleeping.y }, { x, y });
  assert.notEqual(sleeping.pose, pose);
  assert.equal(sim.status().animate, true);

  sim.action("cancel");
  assert.equal(sim.status().animate, false);
});
