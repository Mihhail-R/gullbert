import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { memoryDescription } from "../web-dist/ui/controls/memory-view.js";
import { advance, reach } from "./simulation-helpers.mjs";

const phases = [
  "inspect", "carry-first", "fetch-second", "carry-second", "adjust", "admire",
  "sit", "collapse", "blame", "tidy-first", "tidy-second", "leave",
];
const collection = { shell: 2, bent_spoon: 1, button: 1 };

function bird() {
  const sim = new Gullbert(800, 600, () => 0);
  sim.configure({ paused: true, mischief: 0, sound: false });
  sim.restoreMemory({
    collection,
    nest: { x: 300, y: 300, items: ["shell", "bent_spoon", "button"] },
  });
  sim.action("build_something");
  return sim;
}

test("chair has a successful sit, collapse, delayed stare and completed memory", () => {
  const sim = bird();
  const started = sim.inspect().time;
  reach(sim, "sit");
  advance(sim, 1.5);
  const sitting = sim.present();
  assert.equal(sitting.pose, "crouch");
  assert.deepEqual(sitting.borrowedNestSlots, [0, 1]);
  assert.deepEqual(sitting.props.map((prop) => prop.asset), ["shell", "bent_spoon"]);
  const sittingY = sim.inspect().y;
  reach(sim, "collapse");
  advance(sim, 0.5);
  assert.equal(sim.inspect().y, sittingY + 9);
  assert.equal(sim.present().pose, "nap-startle");
  assert.ok(sim.present().props[1].x - sim.present().props[0].x > 50);
  reach(sim, "blame");
  assert.equal(sim.present().pose, "nap-startle");
  sim.pointer({ x: 0, y: 300 });
  advance(sim, 1);
  assert.equal(sim.present().pose, "nap-accuse");
  assert.equal(sim.inspect().facing, -1);
  reach(sim, "leave");
  advance(sim, 2.1);
  assert.equal(sim.inspect().scene, null);
  assert.ok(sim.inspect().time - started < 35);
  assert.deepEqual(sim.exportMemory().collection, collection);
  assert.deepEqual(sim.present().borrowedNestSlots, []);
  const event = sim.exportMemory().episodes.at(-1);
  assert.equal(event.detail, "construction_chair");
  assert.match(memoryDescription(event), /chair/);
  const restored = bird();
  restored.action("cancel");
  restored.restoreMemory(sim.exportMemory());
  assert.equal(restored.exportMemory().episodes.at(-1).detail, "construction_chair");
});

for (const phase of phases) {
  const interruptions = phase === "blame"
    ? ["feed", "pickup", "hide", "clear_nest", "build_something"] : ["feed"];

  for (const interruption of interruptions) {
    test(`${interruption} during ${phase} preserves ownership and earns no memory`, () => {
      const sim = bird();
      reach(sim, phase);

      switch (interruption) {
        case "hide":
          sim.setVisible(false);
          break;

        case "pickup": {
          const state = sim.inspect();
          sim.beginPickup({ x: state.x + 45, y: state.y + 45 }, 0);
          sim.movePickup({ x: 100, y: 100 });
          break;
        }

        default:
          sim.action(interruption);
      }

      assert.deepEqual(sim.exportMemory().collection, collection);
      assert.deepEqual(sim.present().borrowedNestSlots, []);
      assert.equal(sim.exportMemory().episodes.length, 0);
      assert.equal(sim.present().props.filter((prop) => String(prop.id)
        .startsWith("construction-")).length, 0);
      const restored = new Gullbert(800, 600);
      restored.restoreMemory(sim.exportMemory());
      assert.equal(restored.inspect().scene, null);
      assert.deepEqual(restored.exportMemory().collection, collection);
    });
  }
}

test("resizing every phase retains owned treasures and completes cleanup", () => {
  const sim = bird();

  for (const [index, phase] of phases.entries()) {
    reach(sim, phase);
    sim.resize(index % 2 ? 800 : 160, index % 2 ? 600 : 140);
    advance(sim, 0.1);
    const state = sim.inspect();
    assert.ok(state.x >= 0 && state.x <= state.width - 96);
    assert.ok(state.y >= 0 && state.y <= state.height - 96);
    assert.deepEqual(sim.exportMemory().collection, collection);
  }

  advance(sim, 3);
  assert.deepEqual(sim.present().borrowedNestSlots, []);
});

test("manual construction requires two displayed owned treasures", () => {
  for (const nest of [null, { x: 100, y: 100, items: ["shell"] }]) {
    const sim = new Gullbert(800, 600);
    sim.restoreMemory({ collection, nest });
    sim.action("build_something");
    assert.equal(sim.inspect().scene, null);
  }
});

test("automatic construction respects pause and ten-minute cooldown; replay is immediate", () => {
  const sim = bird();
  sim.action("cancel");
  advance(sim, 599);
  sim.configure({ paused: false });
  advance(sim, 0.1);
  assert.notEqual(sim.inspect().scene?.kind, "construction");
  sim.configure({ paused: true });
  sim.action("cancel");
  advance(sim, 5);
  assert.equal(sim.inspect().scene, null);
  sim.configure({ paused: false });
  advance(sim, 0.1);
  assert.equal(sim.inspect().scene?.kind, "construction");
  sim.action("cancel");
  sim.action("build_something");
  assert.equal(sim.inspect().scene?.kind, "construction");
});

test("admiration begins continuously and faces the direction he walks", () => {
  const sim = bird();
  reach(sim, "adjust");
  advance(sim, 2.9);
  let previousX = sim.inspect().x;
  reach(sim, "admire");
  assert.ok(Math.abs(sim.inspect().x - previousX) < 2);

  for (let tick = 0; tick < 70; tick += 1) {
    previousX = sim.inspect().x;
    sim.step(0.05);
    const state = sim.inspect();

    if (Math.abs(state.x - previousX) > 0.01) {
      assert.equal(state.facing, state.x > previousX ? 1 : -1);
    }
  }
});

test("borrowed nest slots stop accepting treasure grabs", () => {
  const sim = bird();
  sim.configure({ paused: false });
  reach(sim, "adjust");
  assert.equal(sim.treasureRect({ x: 315, y: 376 }), null);
  assert.equal(sim.treasureRect({ x: 348, y: 383 }), null);
  assert.ok(sim.treasureRect({ x: 381, y: 376 }));
  sim.action("cancel");
  assert.ok(sim.treasureRect({ x: 315, y: 376 }));
});
