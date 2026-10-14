import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { GREETING_COOLDOWN_MS } from "../web-dist/simulation/belongings.js";

function bird() {
  const sim = new Gullbert(800, 600, () => 0);
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}
function advance(sim, seconds) {
  for (let i = 0; i < seconds * 20; i++) sim.step(0.05);
}

test("first launch and ordinary returns vary and persist a wall-time cooldown", () => {
  const sim = bird();
  assert.equal(sim.greet(1000), true);
  assert.match(sim.inspect().bubble, /Gullbert/);
  const restored = bird();
  restored.restoreMemory(sim.exportMemory());
  assert.equal(restored.greet(1001), false);
  assert.equal(restored.greet(1000 + GREETING_COOLDOWN_MS), true);
  const previous = restored.inspect().bubble;
  assert.match(previous, /hello again/);
  assert.equal(restored.greet(1000 + GREETING_COOLDOWN_MS * 2), true);
  assert.notEqual(restored.inspect().bubble, previous);
});

test("a return after delivery refers only to an actually owned treasure", () => {
  const sim = bird();
  sim.greet(0);
  sim.action("bring_gift");
  advance(sim, 26);
  assert.equal(sim.inspect().memory.collection.bottle_cap, 1);
  assert.equal(sim.inspect().memory.greetings.lastDiscovery, "bottle_cap");
  const restored = bird();
  restored.restoreMemory(sim.exportMemory());
  restored.greet(GREETING_COOLDOWN_MS);
  assert.match(restored.inspect().bubble, /bottle cap/);
  assert.deepEqual(restored.inspect().memory.collection, { bottle_cap: 1 });
});

test("missing or stale history cannot invent discoveries or punish absence", () => {
  const sim = bird();
  sim.restoreMemory({
    collection: {},
    greetings: { seen: true, lastDiscovery: "sock" },
  });
  sim.greet(10 ** 12);
  assert.doesNotMatch(sim.inspect().bubble, /sock|missed|hungry|neglect/);
  assert.deepEqual(sim.inspect().memory.collection, {});
  sim.restoreMemory({ collection: { glass_diamond: 1 } });
  assert.equal(sim.greet(100), true);
  assert.equal(sim.inspect().memory.greetings.seen, true);
  assert.equal(sim.inspect().memory.collection.glass_diamond, 1);
  assert.equal(sim.greet(100 + GREETING_COOLDOWN_MS), true);
  assert.match(sim.inspect().bubble, /diamond/);
});

test("hiding and repeated summons do not bypass cooldown or record hidden greetings", () => {
  const sim = bird();
  sim.setVisible(false);
  const revision = sim.inspect().memoryRevision;
  assert.equal(sim.greet(), false);
  assert.equal(sim.inspect().memoryRevision, revision);
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
