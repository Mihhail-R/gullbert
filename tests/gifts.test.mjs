import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { advance, reach } from "./simulation-helpers.mjs";

function bird(random = () => 0) {
  const sim = new Gullbert(800, 600, random);
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}

for (const [item, random] of [["bottle_cap", 0], ["chip", 0.99]]) {
  test(`a delivered ${item} is collected or eaten exactly once`, () => {
    const sim = bird(() => random);
    sim.action("bring_gift");
    reach(sim, "reveal");
    assert.equal(sim.inspect().carriedItem, item);

    advance(sim, 30);
    assert.equal(sim.inspect().scene, null);
    assert.deepEqual(sim.exportMemory().collection, item === "chip" ? {} : { [item]: 1 });
    assert.equal(
      sim.inspect().events.filter((event) => event === "munch").length,
      item === "chip" ? 1 : 0,
    );
  });
}

for (const phase of ["away", "reveal"]) {
  test(`canceling a gift during ${phase} cannot deliver a delayed reward`, () => {
    const sim = bird();
    sim.action("bring_gift");
    reach(sim, phase);
    sim.action("clean");
    advance(sim, 25);

    assert.deepEqual(sim.exportMemory().collection, {});
    assert.equal(sim.inspect().scene, null);
    assert.equal(sim.inspect().carriedItem, null);
    assert.deepEqual(sim.present().visualOffset, { x: 0, opacity: 1 });
  });
}

test("a hidden gift trip resumes one delivery on a smaller display", () => {
  const sim = bird();
  sim.action("bring_gift");
  reach(sim, "away");
  sim.setVisible(false);
  advance(sim, 200);
  assert.deepEqual(sim.exportMemory().collection, {});
  assert.equal(sim.inspect().scene.phase, "away");

  sim.resize(100, 100);
  sim.setVisible(true);
  sim.step(10000);
  advance(sim, 20);

  assert.deepEqual(sim.exportMemory().collection, { bottle_cap: 1 });
  assert.equal(sim.inspect().scene, null);
  assert.ok(sim.inspect().x >= 0 && sim.inspect().x <= 4);
  assert.ok(sim.inspect().y >= 0 && sim.inspect().y <= 4);
});

for (const phase of ["depart", "return"]) {
  test(`expanding the display during gift ${phase} cannot strand the delivery`, () => {
    const sim = bird();
    sim.action("bring_gift");
    reach(sim, phase);
    sim.resize(16000, 9000);
    advance(sim, 20);

    assert.deepEqual(sim.exportMemory().collection, { bottle_cap: 1 });
    assert.equal(sim.inspect().scene, null);
    assert.equal(sim.inspect().carriedItem, null);
  });
}
