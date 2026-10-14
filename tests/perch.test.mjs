import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";

function bird() {
  const sim = new Gullbert(800, 600, () => 0.2);
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}
function advance(sim, seconds) {
  for (let i = 0; i < seconds * 20; i++) sim.step(0.05);
}
function arrive(sim) {
  for (let i = 0; i < 600 && sim.inspect().scene?.phase === "approach"; i++)
    sim.step(0.05);
  assert.equal(sim.inspect().scene?.phase, "settle");
}

test("placing, moving, visiting and clearing one perch update durable memory", () => {
  const sim = bird();
  const revision = sim.inspect().memoryRevision;
  sim.action("place_perch", { x: 300, y: 350 });
  assert.deepEqual(sim.inspect().memory.perch, { x: 252, y: 264 });
  assert.ok(sim.inspect().memoryRevision > revision);
  arrive(sim);
  assert.deepEqual(
    { x: sim.inspect().x, y: sim.inspect().y },
    sim.inspect().memory.perch,
  );
  assert.equal(sim.inspect().pose, "crouch");
  advance(sim, 1.3);
  assert.equal(sim.inspect().scene.phase, "loiter");
  advance(sim, 6.1);
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().mode, "idle");
  sim.action("place_perch", { x: 500, y: 400 });
  assert.deepEqual(sim.inspect().memory.perch, { x: 452, y: 314 });
  sim.action("summon", { x: 100, y: 100 });
  sim.action("perch");
  arrive(sim);
  assert.deepEqual(
    { x: sim.inspect().x, y: sim.inspect().y },
    sim.inspect().memory.perch,
  );
  sim.action("clear_perch");
  assert.equal(sim.inspect().memory.perch, null);
  assert.equal(sim.inspect().scene, null);
  sim.action("perch");
  assert.equal(sim.inspect().mode, "idle");
  assert.match(sim.inspect().bubble, /pick/);
});

test("perch visits suspend while hidden and cleanup retains the remembered spot", () => {
  const sim = bird();
  sim.action("place_perch", { x: 20, y: 20 });
  const snapshot = sim.exportMemory();
  sim.setVisible(false);
  const before = {
    time: sim.inspect().time,
    x: sim.inspect().x,
    y: sim.inspect().y,
  };
  advance(sim, 100);
  assert.deepEqual(
    { time: sim.inspect().time, x: sim.inspect().x, y: sim.inspect().y },
    before,
  );
  sim.setVisible(true);
  arrive(sim);
  sim.action("clean");
  assert.equal(sim.inspect().scene, null);
  assert.deepEqual(sim.exportMemory(), snapshot);
  sim.action("perch");
  sim.action("nap");
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().mode, "nap");
});

test("remembered and moving perches remain reachable after a display shrink", () => {
  const sim = bird();
  sim.action("place_perch", { x: 1e6, y: 1e6 });
  sim.resize(100, 100);
  assert.deepEqual(sim.inspect().memory.perch, { x: 4, y: 4 });
  arrive(sim);
  assert.equal(sim.inspect().x, 4);
  assert.equal(sim.inspect().y, 4);
  const restored = bird();
  restored.restoreMemory(sim.exportMemory());
  restored.action("perch");
  arrive(restored);
  assert.deepEqual(
    { x: restored.inspect().x, y: restored.inspect().y },
    { x: 4, y: 4 },
  );
});

test("settling and its calm grace period suppress overdue random gags", () => {
  const sim = bird();
  advance(sim, 1000);
  sim.action("place_perch", {
    x: sim.inspect().x + 48,
    y: sim.inspect().y + 86,
  });
  sim.configure({ paused: false, mischief: 2, sound: false });
  advance(sim, 10);
  assert.equal(sim.inspect().mode, "idle");
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().splats.length, 0);
  assert.equal(sim.inspect().snackRequestAt, null);
});

test("occasional autonomous visits respect pause, polite mode and their cooldown", () => {
  const sim = bird();
  sim.restoreMemory({ perch: { x: sim.inspect().x, y: sim.inspect().y } });
  advance(sim, sim.inspect().nextPerchVisit + 0.1);
  assert.equal(sim.inspect().scene, null);
  sim.configure({ paused: false, mischief: 0, sound: false });
  advance(sim, 0.1);
  assert.equal(sim.inspect().scene?.kind, "perch");
  advance(sim, 13);
  assert.notEqual(sim.inspect().scene?.kind, "perch");
  assert.ok(sim.inspect().nextPerchVisit > sim.inspect().time + 60);
});
