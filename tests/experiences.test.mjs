import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { Belongings } from "../web-dist/simulation/belongings.js";
import {
  normalizeMemory,
  MEMORY_LIMIT,
} from "../web-dist/simulation/memory.js";
import {
  memoryDescription,
  memoryLocation,
} from "../web-dist/ui/controls/memory-view.js";
import { advance, reach } from "./simulation-helpers.mjs";

function setup(now = () => 1_792_100_000_000) {
  const sim = new Gullbert(900, 650, () => 0.5, { now });
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}

test("only completed tricks enter local history, with wall time and original display coordinates", () => {
  let now = 1_792_100_000_000;
  const sim = setup(() => now);
  sim.action("trick_spin");
  sim.action("cancel");
  assert.deepEqual(sim.exportMemory().episodes, []);
  assert.equal(sim.exportMemory().performances.spin, 0);
  sim.action("trick_spin");
  reach(sim, "reward");
  const view = sim.inspect();
  assert.equal(view.memory.performances.spin, 1);
  assert.equal(view.memory.learned.tricks.spin, 0);
  const episode = view.memory.episodes[0];
  assert.deepEqual(episode, {
    id: 1,
    at: now,
    kind: "trick",
    detail: "spin",
    location: { x: view.x, y: view.y, width: 900, height: 650 },
  });
  now += 6000;
  sim.action("feed");
  advance(sim, 3);
  const memory = sim.exportMemory();
  assert.equal(memory.learned.tricks.spin, 1);
  assert.deepEqual(
    memory.episodes.map((e) => e.kind),
    ["trick", "meal", "reward"],
  );
  assert.equal(memory.episodes.at(-1).at, now);
  const restarted = setup();
  restarted.restoreMemory(JSON.parse(JSON.stringify(memory)));
  restarted.resize(100, 100);
  assert.deepEqual(restarted.exportMemory().episodes, memory.episodes);
  assert.equal(memoryDescription(episode), "Performed Spin");
  assert.match(memoryLocation(episode), /lower centre/);
  restarted.action("clean");
  assert.deepEqual(restarted.exportMemory().episodes, memory.episodes);
});

test("bounded recent history retains lifetime performance totals and survives serialization", () => {
  const memories = new Belongings(900, 650, () => 1234);
  for (let i = 0; i < MEMORY_LIMIT + 10; i++)
    memories.performed("spin", { x: 100, y: 200 });
  const saved = memories.snapshot().memory;
  assert.equal(saved.episodes.length, MEMORY_LIMIT);
  assert.equal(saved.episodes[0].id, 11);
  assert.equal(saved.performances.spin, MEMORY_LIMIT + 10);
  const restarted = new Belongings(900, 650);
  restarted.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restarted.snapshot().memory, saved);
  restarted.performed("spin", { x: 100, y: 200 });
  assert.equal(
    restarted.snapshot().memory.episodes.at(-1).id,
    MEMORY_LIMIT + 11,
  );
});

test("the local read cache stays immutable and refreshes only when memory changes", () => {
  const memories = new Belongings(900, 650, () => 1234);
  const before = memories.snapshot();
  assert.equal(memories.snapshot(), before);
  assert.throws(() => {
    before.memory.performances.spin = 99;
  }, TypeError);
  memories.performed("spin", { x: 100, y: 200 });
  const after = memories.snapshot();
  assert.notEqual(after, before);
  assert.equal(before.memory.performances.spin, 0);
  assert.equal(after.memory.performances.spin, 1);
  const exported = memories.exportMemory();
  exported.episodes[0].location.x = 0;
  assert.equal(after.memory.episodes[0].location.x, 100);
});

test("forgetting learning clears its experiences and counters without losing visitors or gifts", () => {
  const memories = new Belongings(900, 650, () => 1234);
  const point = { x: 100, y: 200 };
  memories.performed("spin", point);
  memories.rewardTrick("spin", point);
  memories.rememberMeal(point);
  memories.visited("pigeon", point);
  memories.collect("sock", point);
  memories.forgetLearning();
  const saved = normalizeMemory(memories.snapshot().memory);
  assert.deepEqual(saved.performances, { come: 0, spin: 0, dead: 0 });
  assert.equal(saved.learned.tricks.spin, 0);
  assert.deepEqual(
    saved.episodes.map((e) => e.kind),
    ["visit", "gift"],
  );
  assert.equal(saved.visits.pigeon, 1);
  assert.equal(saved.collection.sock, 1);
});

test("legacy learning migrates without inventing dated experiences and malformed history is rejected", () => {
  const legacy = normalizeMemory({
    version: 1,
    learned: { tricks: { spin: 3 } },
  });
  assert.equal(legacy.performances.spin, 3);
  assert.equal(legacy.learned.tricks.spin, 3);
  assert.deepEqual(legacy.episodes, []);
  const event = {
    id: 1,
    at: 1234,
    kind: "trick",
    detail: "spin",
    location: { x: 100, y: 200, width: 900, height: 650 },
  };
  const normalized = normalizeMemory({
    episodes: [
      null,
      event,
      event,
      { ...event, id: 2, at: NaN },
      { ...event, id: 3, kind: "unknown" },
      { ...event, id: 4, location: { ...event.location, width: Infinity } },
    ],
    performances: { come: -1, spin: Infinity, dead: "3" },
    visits: { pigeon: 1e9 },
  });
  assert.deepEqual(normalized.episodes, [event]);
  assert.deepEqual(normalized.performances, { come: 0, spin: 0, dead: 0 });
  assert.equal(normalized.visits.pigeon, 1_000_000);
});

test("visitor recognition and dialogue rotation survive restarting", () => {
  const sim = setup();
  sim.action("invite_pigeon");
  const first = sim.inspect().bubble;
  reach(sim, "inspect");
  assert.equal(sim.exportMemory().visits.pigeon, 1);
  assert.equal(sim.exportMemory().episodes.at(-1).kind, "visit");
  const restarted = setup();
  restarted.restoreMemory(sim.exportMemory());
  restarted.action("invite_pigeon");
  assert.notEqual(restarted.inspect().bubble, first);
  restarted.action("cancel");
  assert.equal(
    restarted.exportMemory().visits.pigeon,
    1,
    "cancelled arrivals do not count as visits",
  );
});
