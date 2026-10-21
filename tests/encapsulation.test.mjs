import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { reach } from "./simulation-helpers.mjs";

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

  assert.notEqual(sim.present().y, presentation.y);
  assert.deepEqual(inspection, savedInspection);
  assert.deepEqual(presentation, savedPresentation);
});

test("command arguments and preferences are copied at the runtime boundary", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  const point = { x: 300, y: 300 };
  const settings = { paused: false, sound: true, mischief: 1, hat: "none" };
  sim.configure(settings);
  sim.action("feed_here", point);
  const before = sim.inspect();
  point.x = -500;
  point.y = -500;
  settings.paused = true;
  assert.deepEqual(sim.inspect().crumb, before.crumb);
  assert.equal(sim.inspect().settings.paused, false);
});

test("cap observations detach pointer input and remain stable through a flick", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ mischief: 0 });
  sim.action("play_cap");
  reach(sim, "ready");
  const pointer = { x: 200, y: 150 };
  sim.pointer(pointer);
  const inspection = sim.inspect();
  const presentation = sim.present();
  const savedInspection = structuredClone(inspection);
  const savedPresentation = structuredClone(presentation);

  pointer.x = -500;
  pointer.y = -500;
  assert.deepEqual(sim.inspect().scene.pointer, { x: 200, y: 150 });
  assert.equal(sim.wantsPointer, true);
  assert.equal(sim.flickCap(inspection.scene.cap), true);
  sim.pointer({ x: 300, y: 200 });
  sim.step(0.1);

  assert.notDeepEqual(sim.inspect().scene.cap, inspection.scene.cap);
  assert.notDeepEqual(sim.present().props, presentation.props);
  assert.deepEqual(inspection, savedInspection);
  assert.deepEqual(presentation, savedPresentation);
});

test("standalone getters follow scene replacement and gift delivery", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ mischief: 0 });
  sim.action("play_cap");
  assert.equal(sim.wantsPointer, true);
  assert.equal(sim.carriedItem, null);

  sim.action("bring_gift");
  assert.equal(sim.wantsPointer, false);
  assert.equal(sim.carriedItem, null);
  reach(sim, "reveal");
  const delivered = sim.inspect();
  assert.equal(sim.carriedItem, delivered.scene.item);
  assert.equal(sim.present().carriedItem, sim.carriedItem);
  assert.equal(sim.present().pose, sim.pose);
  assert.equal(sim.present().frame, sim.frame);

  sim.action("clean");
  assert.equal(sim.carriedItem, null);
  assert.equal(sim.wantsPointer, false);
  assert.equal(delivered.carriedItem, delivered.scene.item);
});
