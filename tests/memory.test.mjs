import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMemory } from "../web-dist/simulation/memory.js";
import { Gullbert } from "../web-dist/simulation/engine.js";

test("missing and malformed snapshots produce fresh, empty durable memories", () => {
  const expected = {
    version: 2,
    episodes: [],
    unpaidTricks: 0,
    trickCooldownUntilMs: null,
    trickRefusals: 0,
    performances: { come: 0, spin: 0, dead: 0 },
    visits: { pigeon: 0, gull: 0 },
    learned: {
      tricks: { come: 0, spin: 0, dead: 0 },
      snackSpot: null,
      snackCandidate: null,
      scratchesAfterPlay: 0,
    },
    perch: null,
    collection: {},
    greetings: { seen: false, lastAt: 0, lastLine: "", lastDiscovery: null },
  };

  for (const input of [undefined, null, false, 7, "bad", [], { perch: [] }]) {
    assert.deepEqual(normalizeMemory(input), expected);
  }

  const first = normalizeMemory();
  first.collection.sock = 9;
  first.greetings.seen = true;
  assert.deepEqual(normalizeMemory(), expected);
});

test("normalization rejects malformed locations and clamps remembered belongings", () => {
  const result = normalizeMemory({ perch: { x: 1e9, y: -20 } }, 800, 600);
  assert.deepEqual(result.perch, { x: 704, y: 0 });

  for (const value of [
    null,
    [],
    { x: "1", y: 2 },
    { x: Infinity, y: 2 },
    { x: 1, y: NaN },
  ]) {
    assert.equal(normalizeMemory({ perch: value }).perch, null);
  }

  assert.deepEqual(normalizeMemory({ perch: { x: 80, y: 90 } }, 10, 20).perch, {
    x: 0,
    y: 0,
  });
});

test("only finite supported treasure counts and bounded greeting data survive", () => {
  const memory = normalizeMemory({
    version: 900,
    collection: {
      bottle_cap: 3.8,
      bent_spoon: 1e20,
      sock: -1,
      glass_diamond: Infinity,
      parking_ticket: "6",
      mystery: 10,
    },
    greetings: {
      seen: 1,
      lastAt: -20,
      lastLine: "a".repeat(1000),
      lastDiscovery: "mystery",
    },
    scene: { kind: "gift" },
    settings: { paused: true },
  });
  assert.equal(memory.version, 2);
  assert.deepEqual(memory.collection, { bottle_cap: 3, bent_spoon: 999 });
  assert.equal(memory.greetings.seen, false);
  assert.equal(memory.greetings.lastAt, 0);
  assert.equal(memory.greetings.lastLine.length, 240);
  assert.equal(memory.greetings.lastDiscovery, null);
  assert.equal(memory.scene, undefined);
  assert.equal(memory.settings, undefined);
});

test("simulation restoration exports an independent snapshot and preserves preferences", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ paused: true, sound: true, mischief: 2, hat: "captain" });
  const saved = {
    version: 1,
    perch: { x: 600, y: 450 },
    collection: { sock: 2 },
    greetings: {
      seen: true,
      lastAt: 1234,
      lastLine: "hello",
      lastDiscovery: "sock",
    },
  };
  sim.restoreMemory(saved);
  assert.deepEqual(sim.exportMemory(), normalizeMemory(saved, 800, 600));
  saved.perch.x = 1;
  saved.collection.sock = 3;
  const exported = sim.exportMemory();
  exported.perch.y = 1;
  exported.greetings.lastLine = "changed";
  assert.equal(sim.inspect().memory.perch.x, 600);
  assert.equal(sim.inspect().memory.collection.sock, 2);
  assert.equal(sim.inspect().memory.perch.y, 450);
  assert.equal(sim.inspect().memory.greetings.lastLine, "hello");
  assert.deepEqual(sim.inspect().settings, {
    paused: true,
    sound: true,
    mischief: 2,
    hat: "captain",
  });
  sim.resize(100, 100);
  assert.deepEqual(sim.inspect().memory.perch, { x: 4, y: 4 });
  sim.restoreMemory(null);
  assert.deepEqual(sim.exportMemory(), normalizeMemory(null, 100, 100));
});

test("legacy nest snapshots retain gifts, perch and greetings without restoring the nest", () => {
  const sim = new Gullbert(800, 600, () => 0);
  const legacy = {
    ...normalizeMemory(),
    nest: { x: 100, y: 200 },
    perch: { x: 300, y: 400 },
    collection: { bottle_cap: 2, sock: 1 },
    greetings: {
      seen: true,
      lastAt: 1234,
      lastLine: "hello",
      lastDiscovery: "sock",
    },
  };
  sim.restoreMemory(legacy);
  const { nest, ...expected } = legacy;
  assert.deepEqual(sim.exportMemory(), expected);
  sim.action("bring_gift");

  for (let i = 0; i < 400; i++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().memory.collection.bottle_cap, 3);
  sim.action("clean");
  assert.deepEqual(sim.inspect().memory.perch, expected.perch);
  assert.equal(Object.hasOwn(sim.exportMemory(), "nest"), false);
});
