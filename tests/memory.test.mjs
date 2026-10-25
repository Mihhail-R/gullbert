import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMemory } from "../web-dist/simulation/memory.js";
import { Belongings } from "../web-dist/simulation/belongings.js";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { createLongTermMemory } from "../web-dist/simulation/long-term-memory.js";

test("missing and malformed snapshots produce fresh, empty durable memories", () => {
  const expected = {
    version: 3,
    longTerm: createLongTermMemory(),
    episodes: [],
    unpaidTricks: 0,
    trickCooldownUntilMs: null,
    trickRefusals: 0,
    performances: { come: 0, spin: 0, dead: 0 },
    visits: { pigeon: 0, gull: 0 },
    learned: {
      tricks: { come: 0, spin: 0, dead: 0 },
      capPlay: { completed: 0, lastCompletedId: 0, outcomes: [] },
      lastMealId: 0,
      snackSpot: null,
      snackCandidate: null,
      scratchesAfterPlay: 0,
    },
    perch: null,
    nest: null,
    collection: {},
    preferences: { seed: 0, treasureAffection: {}, hangout: null },
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
  assert.equal(memory.version, 3);
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
    preferences: { seed: 123 },
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
  const fresh = normalizeMemory(null, 100, 100);
  fresh.preferences.seed = sim.exportMemory().preferences.seed;
  assert.ok(fresh.preferences.seed > 0);
  assert.deepEqual(sim.exportMemory(), fresh);
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
  const expected = { ...legacy, nest: null };
  expected.preferences.seed = sim.exportMemory().preferences.seed;
  assert.deepEqual(sim.exportMemory(), expected);
  sim.action("bring_gift");

  for (let i = 0; i < 400; i++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().memory.collection.bottle_cap, 3);
  sim.action("clean");
  assert.deepEqual(sim.inspect().memory.perch, expected.perch);
  assert.equal(sim.exportMemory().nest, null);
});

test("live resize clamps remembered locations without rewriting other memory", () => {
  const belongings = new Belongings(800, 600, () => 1_792_100_000_000);
  belongings.restore({
    ...normalizeMemory(),
    perch: { x: 600.5, y: 450.5 },
    learned: {
      tricks: { come: 2, spin: 3, dead: 1 },
      snackSpot: { x: 650.5, y: 400.5, meals: 4 },
      snackCandidate: { x: 100.5, y: 200.5, meals: 2 },
      scratchesAfterPlay: 2,
    },
    collection: { sock: 2 },
    preferences: { seed: 123, hangout: { x: 0.7, y: 0.8, visits: 4 } },
  });
  belongings.remember("activity", "a".repeat(100), { x: 600, y: 450 });
  belongings.creditActiveTime(1.5, () => 0);
  const before = belongings.exportMemory();
  const published = belongings.snapshot();
  const revision = published.revision;
  const expected = structuredClone(before);
  expected.perch = { x: 204, y: 154 };
  expected.learned.snackSpot = { x: 204, y: 154, meals: 4 };
  expected.learned.snackCandidate = { x: 100.5, y: 154, meals: 2 };

  belongings.resize(300, 250);
  assert.deepEqual(belongings.exportMemory(), expected);
  assert.equal(belongings.snapshot().revision, revision + 1);
  assert.deepEqual(published.memory, before);

  for (const [width, height] of [[300, 250], [800, 600]]) {
    belongings.resize(width, height);
    assert.deepEqual(belongings.exportMemory(), expected);
    assert.equal(belongings.snapshot().revision, revision + 1);
  }

  belongings.resize(50, 50);
  expected.perch = { x: 0, y: 0 };
  expected.learned.snackSpot = { x: 0, y: 0, meals: 4 };
  expected.learned.snackCandidate = { x: 0, y: 0, meals: 2 };
  assert.deepEqual(belongings.exportMemory(), expected);
  assert.equal(belongings.snapshot().revision, revision + 2);
});

test("live meal and perch locations use the same geometry rules as restored memory", () => {
  for (const [width, height] of [[800, 600], [50, 50], [NaN, Infinity]]) {
    const belongings = new Belongings(width, height, () => 1234);
    const point = { x: 1300.5, y: -20 };
    const expected = normalizeMemory({ perch: point }, width, height).perch;
    belongings.placePerch(point);
    belongings.rememberMeal(point);
    assert.deepEqual(belongings.exportMemory().perch, expected);
    assert.deepEqual(belongings.exportMemory().learned.snackSpot, { ...expected, meals: 1 });
  }

  const belongings = new Belongings(800, 600, () => 1234);
  belongings.placePerch({ x: 200, y: 100 });
  const before = belongings.exportMemory();
  const revision = belongings.snapshot().revision;

  for (const point of [null, [], { x: NaN, y: 1 }, { x: 1, y: Infinity }]) {
    belongings.rememberMeal(point);
    assert.deepEqual(belongings.exportMemory(), before);
    assert.equal(belongings.snapshot().revision, revision);
  }

  belongings.placePerch({ x: NaN, y: 1 });
  assert.equal(belongings.exportMemory().perch, null);
  assert.equal(belongings.snapshot().revision, revision + 1);
});
