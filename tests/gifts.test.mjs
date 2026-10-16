import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
function bird(random = () => 0.5) {
  const sim = new Gullbert(800, 600, random);
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}
function advance(sim, seconds) {
  for (let i = 0; i < seconds * 20; i++) {
    sim.step(0.05);
  }
}
test(
  "every gift completes its finite flight, reveals distinctly and collects non-food " +
  "exactly once",
  () => {
    const items = [
      "bottle_cap",
      "bent_spoon",
      "sock",
      "glass_diamond",
      "parking_ticket",
      "chip",
    ];

    for (const [index, item] of items.entries()) {
      const sim = bird(() => (index + 0.1) / items.length);
      sim.action("bring_gift");
      const phases = new Set();
      const poses = new Set();

      for (let i = 0; i < 400; i++) {
        if (sim.inspect().scene) {
          phases.add(sim.inspect().scene.phase);
        }

        poses.add(sim.inspect().pose);
        sim.step(0.05);
      }

      for (const phase of [
        "takeoff",
        "depart",
        "away",
        "return",
        "land",
        "reveal",
      ]) {
        assert.ok(phases.has(phase), phase);
      }

      assert.ok(poses.has("wingUp") && poses.has("wingDown"));
      assert.equal(sim.inspect().scene, null);
      assert.deepEqual(
        sim.inspect().memory.collection,
        item === "chip" ? {} : { [item]: 1 },
      );
      assert.equal(sim.inspect().events.includes("munch"), item === "chip");
      advance(sim, 30);
      assert.deepEqual(
        sim.inspect().memory.collection,
        item === "chip" ? {} : { [item]: 1 },
      );
    }
  }
);
test("each gift phase can be replaced or cleaned without a reward, including while away", () => {
  for (const phase of [
    "takeoff",
    "depart",
    "away",
    "return",
    "land",
    "reveal",
  ]) {
    for (const action of ["summon", "nap", "clean"]) {
      const sim = bird(() => 0);
      sim.action("bring_gift");

      for (let i = 0; sim.inspect().scene?.phase !== phase && i < 400; i++) {
        sim.step(0.05);
      }

      assert.equal(sim.inspect().scene?.phase, phase);
      sim.action(action);
      advance(sim, 25);
      assert.deepEqual(sim.inspect().memory.collection, {});
      assert.equal(sim.inspect().scene, null);
      assert.ok(
        sim.inspect().x >= 0 && sim.inspect().x <= sim.inspect().width - 96,
      );
      assert.ok(
        sim.inspect().y >= 0 && sim.inspect().y <= sim.inspect().height - 96,
      );
    }
  }
});
test("hidden gift trips freeze, then resume a single delivery after resizing", () => {
  for (const phase of [
    "takeoff",
    "depart",
    "away",
    "return",
    "land",
    "reveal",
  ]) {
    const sim = bird(() => 0);
    sim.action("bring_gift");

    for (let i = 0; sim.inspect().scene?.phase !== phase && i < 400; i++) {
      sim.step(0.05);
    }

    assert.equal(sim.inspect().scene?.phase, phase);
    sim.setVisible(false);
    const before = JSON.stringify([
      sim.inspect().scene,
      sim.inspect().x,
      sim.inspect().y,
      sim.inspect().time,
    ]);
    advance(sim, 200);
    assert.equal(
      JSON.stringify([
        sim.inspect().scene,
        sim.inspect().x,
        sim.inspect().y,
        sim.inspect().time,
      ]),
      before,
    );
    assert.deepEqual(sim.inspect().memory.collection, {});
    sim.resize(100, 100);
    sim.setVisible(true);
    sim.step(10000);
    advance(sim, 20);
    assert.deepEqual(sim.inspect().memory.collection, { bottle_cap: 1 });
    assert.equal(sim.inspect().scene, null);
    assert.ok(sim.inspect().x >= 0 && sim.inspect().x <= 4);
    assert.ok(sim.inspect().y >= 0 && sim.inspect().y <= 4);
  }
});

test(
  "display expansion during a gift flight still delivers within the original bounded " +
  "outing",
  () => {
    for (const phase of ["takeoff", "depart", "away", "return"]) {
      const sim = bird(() => 0);
      sim.action("bring_gift");

      for (let i = 0; sim.inspect().scene?.phase !== phase && i < 400; i++) {
        sim.step(0.05);
      }

      assert.equal(sim.inspect().scene?.phase, phase);
      sim.resize(16000, 9000);
      advance(sim, 20);
      assert.deepEqual(sim.inspect().memory.collection, { bottle_cap: 1 });
      assert.equal(sim.inspect().scene, null);
      assert.equal(sim.inspect().carriedItem, null);
      assert.ok(
        sim.inspect().x >= 0 && sim.inspect().x <= sim.inspect().width - 96,
      );
      assert.ok(
        sim.inspect().y >= 0 && sim.inspect().y <= sim.inspect().height - 96,
      );
    }
  }
);
