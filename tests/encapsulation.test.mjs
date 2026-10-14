import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";

function assertFrozen(value) {
  if (value && typeof value === "object") {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
      assertFrozen(child);
    }
  }
}

test("diagnostic and presentation snapshots cannot change owned state", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.action("place_bag", { x: 600, y: 400 });
  const inspection = sim.inspect();
  const presentation = sim.present();
  assertFrozen(inspection);
  assertFrozen(presentation);
  assert.throws(() => {
    inspection.bag.servings = 0;
  }, TypeError);
  assert.throws(() => {
    presentation.bag.x = -500;
  }, TypeError);
  assert.throws(() => {
    inspection.settings.paused = true;
  }, TypeError);
  assert.equal(sim.inspect().bag.servings, 3);
  assert.deepEqual(Object.keys(sim), []);
});

test("published snapshots remain stable while a routine advances", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.action("bring_gift");
  const inspection = sim.inspect();
  const presentation = sim.present();
  const savedInspection = structuredClone(inspection);
  const savedPresentation = structuredClone(presentation);
  for (let tick = 0; tick < 30; tick++) {
    sim.step(0.05);
  }
  assert.notEqual(sim.inspect().scene.phase, inspection.scene.phase);
  assert.deepEqual(inspection, savedInspection);
  assert.deepEqual(presentation, savedPresentation);
});

test("command arguments and preferences are copied at the runtime boundary", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  const point = { x: 300, y: 300 };
  const settings = { paused: false, sound: true, mischief: 1, hat: "none" };
  sim.configure(settings);
  sim.action("feed", point);
  const before = sim.inspect();
  point.x = -500;
  point.y = -500;
  settings.paused = true;
  assert.deepEqual(sim.inspect().goal, before.goal);
  assert.deepEqual(sim.inspect().crumb, before.crumb);
  assert.equal(sim.inspect().settings.paused, false);
});
