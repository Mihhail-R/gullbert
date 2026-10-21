import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { Belongings } from "../web-dist/simulation/belongings.js";
import { normalizeMemory } from "../web-dist/simulation/memory.js";
import { chooseGift, normalizePreferences } from "../web-dist/simulation/preferences.js";
import { advance, reach } from "./simulation-helpers.mjs";

function bird() {
  const sim = new Gullbert(800, 600, () => 0);
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}

test("a placed nest displays owned treasures, rearranges them and remains after cleanup", () => {
  const sim = bird();
  sim.restoreMemory({ collection: { shell: 1, button: 2, string: 1, foil_ball: 1 } });
  sim.action("place_nest", { x: 350, y: 400 });
  const original = sim.exportMemory().nest;
  assert.equal(original.items.length, 3);
  reach(sim, "sleep");
  assert.notDeepEqual(sim.exportMemory().nest.items, original.items);
  assert.match(sim.present().pose, /^nap-(sleep|wobble)$/);
  advance(sim, 14);
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().mode, "idle");

  const saved = sim.exportMemory();
  sim.action("clean");
  assert.deepEqual(sim.exportMemory(), saved);
  const restored = bird();
  restored.restoreMemory(saved);
  assert.deepEqual(restored.present().nest, saved.nest);
  restored.action("place_nest", { x: 150, y: 200 });
  assert.deepEqual(restored.exportMemory().nest.items, saved.nest.items);
  restored.action("clear_nest");
  assert.equal(restored.present().nest, null);
  assert.deepEqual(restored.exportMemory().collection, saved.collection);
});

test("discoveries are carried home once without duplicating collection counts", () => {
  const sim = bird();
  sim.action("place_nest", { x: 700, y: 500 });
  sim.action("bring_gift");
  reach(sim, "carry-home");
  assert.deepEqual(sim.exportMemory().collection, { bottle_cap: 1 });
  assert.deepEqual(sim.present().nest.items, []);
  assert.equal(sim.present().carriedItem, "bottle_cap");
  reach(sim, "deposit");
  advance(sim, 2);
  assert.deepEqual(sim.present().nest.items, ["bottle_cap"]);
  assert.equal(sim.present().carriedItem, null);
  assert.equal(sim.inspect().scene, null);
  assert.deepEqual(sim.exportMemory().collection, { bottle_cap: 1 });
  assert.equal(sim.inspect().y, sim.present().nest.y);
});

test("canceling a home delivery keeps the find but cannot deposit it later", () => {
  const sim = bird();
  sim.action("place_nest", { x: 700, y: 500 });
  sim.action("bring_gift");
  reach(sim, "carry-home");
  sim.action("cancel");
  advance(sim, 65);
  assert.deepEqual(sim.exportMemory().collection, { bottle_cap: 1 });
  assert.deepEqual(sim.present().nest.items, []);
  assert.equal(sim.present().carriedItem, null);
});

test("removing a nest during the deposit keeps ownership and cancels the placement", () => {
  const sim = bird();
  sim.action("place_nest", { x: 700, y: 500 });
  sim.action("bring_gift");
  reach(sim, "deposit");
  sim.action("clear_nest");
  advance(sim, 5);
  assert.equal(sim.exportMemory().nest, null);
  assert.deepEqual(sim.exportMemory().collection, { bottle_cap: 1 });
  assert.equal(sim.present().carriedItem, null);
});

test("hidden deliveries wait and resume at a resized nest", () => {
  const sim = bird();
  sim.action("place_nest", { x: 700, y: 500 });
  sim.action("bring_gift");
  reach(sim, "carry-home");
  sim.setVisible(false);
  advance(sim, 100);
  assert.deepEqual(sim.exportMemory().nest.items, []);
  sim.resize(100, 100);
  sim.setVisible(true);
  advance(sim, 5);
  assert.deepEqual(sim.exportMemory().nest, { x: 4, y: 4, items: ["bottle_cap"] });
  assert.equal(sim.inspect().x, 4);
  assert.equal(sim.inspect().y, 4);
});

test("full nests protect a favourite and never consume or duplicate stored treasures", () => {
  const belongings = new Belongings(800, 600);
  belongings.restore({
    collection: { shell: 1, button: 1, string: 1, foil_ball: 1 },
    preferences: { treasureAffection: { shell: 8 } },
    nest: { x: 100, y: 200, items: ["shell", "button", "string"] },
  });
  belongings.nestTreasure("foil_ball");
  belongings.nestTreasure("foil_ball");
  belongings.nestTreasure("sock");
  assert.deepEqual(belongings.exportMemory().nest.items, ["shell", "string", "foil_ball"]);
  assert.deepEqual(belongings.exportMemory().collection, {
    shell: 1, button: 1, string: 1, foil_ball: 1,
  });
});

test("legacy memories have no nest and invalid nest contents cannot create ownership", () => {
  assert.equal(normalizeMemory({}).nest, null);
  assert.equal(normalizeMemory({ nest: { x: NaN, y: 10 } }).nest, null);
  const memory = normalizeMemory({
    collection: { shell: 1, button: 1, string: 1, foil_ball: 1 },
    nest: { x: -10, y: 9999, items: ["chip", "unknown", "sock", "shell", "shell",
      "button", "string", "foil_ball"] },
  }, 800, 600);
  assert.deepEqual(memory.nest, { x: 0, y: 504, items: ["shell", "button", "string"] });
});

test("autonomous nest visits respect pause and have a quiet interval between visits", () => {
  const sim = bird();
  sim.restoreMemory({ nest: { x: 400, y: 300, items: [] } });
  advance(sim, 121);
  assert.equal(sim.inspect().scene, null);
  sim.configure({ paused: false });
  advance(sim, 0.1);
  assert.equal(sim.inspect().scene?.kind, "nest");
  reach(sim, "sleep");
  advance(sim, 18);
  assert.notEqual(sim.inspect().scene?.kind, "nest");
});

test("all four new finds participate in ordinary gift selection", () => {
  const preferences = normalizePreferences({ seed: 42 });
  const seen = new Set();

  for (let i = 0; i < 1000; i++) {
    seen.add(chooseGift(preferences, () => i / 1000));
  }

  for (const item of ["shell", "button", "string", "foil_ball"]) {
    assert.ok(seen.has(item), item);
  }
});
