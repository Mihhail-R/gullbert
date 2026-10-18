import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { GREETING_COOLDOWN_MS } from "../web-dist/simulation/belongings.js";
import { dialogue } from "../web-dist/simulation/dialogue.js";
import { advance } from "./simulation-helpers.mjs";

function bird() {
  const sim = new Gullbert(800, 600, () => 0);
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}

test("first launch and ordinary returns vary and persist a wall-time cooldown", () => {
  const sim = bird();
  assert.equal(sim.greet(1000), true);
  assert.ok(dialogue.gullbert.greetings.first.includes(sim.inspect().bubble));
  const restored = bird();
  restored.restoreMemory(sim.exportMemory());
  assert.equal(restored.greet(1001), false);
  assert.equal(restored.greet(1000 + GREETING_COOLDOWN_MS), true);
  const previous = restored.inspect().bubble;
  assert.ok(dialogue.gullbert.greetings.return.includes(previous));
  assert.equal(restored.greet(1000 + GREETING_COOLDOWN_MS * 2), true);
  assert.notEqual(restored.inspect().bubble, previous);
});

test("a return after delivery refers only to an actually owned treasure", () => {
  const sim = bird();
  sim.greet(0);
  sim.action("bring_gift");
  advance(sim, 26);
  assert.equal(sim.inspect().memory.collection.bottle_cap, 1);
  const restored = bird();
  restored.restoreMemory(sim.exportMemory());
  restored.greet(GREETING_COOLDOWN_MS);
  assert.match(restored.inspect().bubble, /bottle cap/);
  assert.deepEqual(restored.inspect().memory.collection, { bottle_cap: 1 });
});

test("stale discovery history falls back to an ordinary return greeting", () => {
  const sim = bird();
  sim.restoreMemory({
    collection: {},
    greetings: { seen: true, lastDiscovery: "sock" },
  });
  sim.greet(10 ** 12);
  assert.ok(dialogue.gullbert.greetings.return.includes(sim.inspect().bubble));
  assert.deepEqual(sim.inspect().memory.collection, {});
});

test("owned treasure can be mentioned without a recorded discovery", () => {
  const sim = bird();
  sim.restoreMemory({ collection: { glass_diamond: 1 } });
  sim.greet(100);
  sim.greet(100 + GREETING_COOLDOWN_MS);
  assert.match(sim.inspect().bubble, /diamond/);
  assert.equal(sim.inspect().memory.collection.glass_diamond, 1);
});

test("hiding and repeated summons do not bypass cooldown or record hidden greetings", () => {
  const sim = bird();
  sim.setVisible(false);
  const memory = sim.exportMemory();
  assert.equal(sim.greet(), false);
  assert.deepEqual(sim.exportMemory(), memory);
  sim.setVisible(true);
  assert.equal(sim.greet(), true);
  const lastAt = sim.inspect().memory.greetings.lastAt;

  for (let i = 0; i < 5; i++) {
    sim.setVisible(false);
    sim.setVisible(true);
    sim.action("summon");
    assert.equal(sim.inspect().memory.greetings.lastAt, lastAt);
    assert.equal(sim.inspect().bubble, "");
  }
});

test("a backward wall clock recovers once and never removes belongings", () => {
  const sim = bird();
  sim.restoreMemory({
    collection: { sock: 2 },
    greetings: { seen: true, lastAt: 9000 },
  });
  assert.equal(sim.greet(100), true);
  assert.equal(sim.greet(101), false);
  assert.deepEqual(sim.inspect().memory.collection, { sock: 2 });
  assert.equal(sim.greet(Number.NaN), false);
});
