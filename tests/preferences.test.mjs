import test from "node:test";
import assert from "node:assert/strict";
import { Belongings } from "../web-dist/simulation/belongings.js";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { normalizeMemory } from "../web-dist/simulation/memory.js";
import {
  chooseGift, favouriteTreasure, hangoutPosition, normalizePreferences,
} from "../web-dist/simulation/preferences.js";
import { MemoryPersistence } from "../web-dist/platform/roommate-store.js";
import { advance, reach } from "./simulation-helpers.mjs";

function bird(seed = 123) {
  const sim = new Gullbert(900, 650, () => 0);
  sim.configure({ paused: true, mischief: 0 });
  sim.restoreMemory({ preferences: { seed }, collection: { sock: 1 } });
  return sim;
}

test("seeds create repeatable individual tastes without declaring unearned favourites", () => {
  const first = normalizePreferences({ seed: 123 });
  const same = normalizePreferences({ seed: 123 });
  const other = normalizePreferences({ seed: 456 });
  assert.deepEqual(hangoutPosition(first), hangoutPosition(same));
  assert.notDeepEqual(hangoutPosition(first), hangoutPosition(other));
  assert.equal(favouriteTreasure(first, { sock: 1 }), null);
  const spots = new Set();

  for (let seed = 1; seed <= 100; seed++) {
    const spot = hangoutPosition(normalizePreferences({ seed }));
    assert.ok(spot.x >= 0.15 && spot.x <= 0.85);
    assert.ok(spot.y >= 0.2 && spot.y <= 0.8);
    spots.add(JSON.stringify(spot));
  }

  assert.equal(spots.size, 100);
});

test("legacy upgrades get one seed, and initial persistence keeps it across restarts", async () => {
  let saved = { version: 1, collection: { sock: 2 } };
  const sim = new Gullbert();
  const store = new MemoryPersistence({
    storage: {
      load: () => saved,
      save: (memory) => {
        saved = structuredClone(memory);
      },
    },
    clock: { schedule: setTimeout, cancel: clearTimeout },
    restore: (memory) => sim.restoreMemory(memory),
    revision: () => sim.status().memoryRevision,
    snapshot: () => sim.exportMemory(),
    result: (error) => assert.equal(error, null),
  });
  await store.restore();
  store.start();
  await store.dispose();
  const seed = saved.preferences.seed;
  assert.ok(Number.isInteger(seed) && seed > 0 && seed <= 0xffff_ffff);
  assert.deepEqual(saved.collection, { sock: 2 });
  const restarted = new Gullbert();
  restarted.restoreMemory(saved);
  assert.deepEqual(restarted.exportMemory(), saved);
  restarted.resize(1800, 1000);
  restarted.action("forget_learning");
  assert.equal(restarted.exportMemory().preferences.seed, seed);
});

function until(sim, predicate, seconds = 300) {
  for (let tick = 0; tick < seconds * 20; tick++) {
    if (predicate(sim.inspect())) {
      return;
    }

    sim.step(0.05);
  }

  assert.fail("The expected ordinary behaviour did not happen");
}

function hangoutTarget(sim) {
  const point = hangoutPosition(sim.exportMemory().preferences);
  return { x: point.x * (sim.inspect().width - 96), y: point.y * (sim.inspect().height - 96) };
}

function reachHangoutWalk(sim) {
  const target = hangoutTarget(sim);
  until(sim, (view) => view.mode === "walk" && view.goal?.x === target.x);
  assert.deepEqual(sim.inspect().goal, target);
  assert.equal(sim.inspect().scene, null, "visiting uses ordinary walking, not a routine");
  return target;
}

test("ordinary walks discover an independent hangout and return after restart and resize", () => {
  const sim = bird();
  sim.action("place_perch", { x: 50, y: 90 });
  advance(sim, 30);
  assert.equal(sim.exportMemory().preferences.hangout, null, "placed perches do not count");
  sim.configure({ paused: false });
  const target = reachHangoutWalk(sim);
  assert.notDeepEqual(target, sim.exportMemory().perch);
  assert.equal(sim.exportMemory().preferences.hangout, null, "walking there is not arrival");
  until(sim, (view) => view.memory.preferences.hangout?.visits === 1);
  assert.equal(sim.inspect().mode, "idle");
  assert.ok(sim.inspect().until - sim.inspect().time >= 4);
  const saved = sim.exportMemory();
  assert.deepEqual({ x: sim.inspect().x, y: sim.inspect().y }, target);
  const restarted = bird(999);
  restarted.restoreMemory(saved);
  restarted.configure({ paused: false });
  assert.deepEqual(reachHangoutWalk(restarted), target);
  until(restarted, (view) => view.memory.preferences.hangout.visits === 2);
  restarted.resize(1800, 1000);
  const resized = reachHangoutWalk(restarted);
  assert.ok(Math.abs(resized.x / 1704 - saved.preferences.hangout.x) < 0.001);
  assert.ok(Math.abs(resized.y / 904 - saved.preferences.hangout.y) < 0.001);
  until(restarted, (view) => view.memory.preferences.hangout.visits === 3);
  assert.equal(restarted.inspect().bubble, "my usual spot.");
});

test("gift deliveries earn favourites and bias later finds while keeping variety", () => {
  const sim = bird();

  for (let delivery = 0; delivery < 3; delivery++) {
    sim.action("bring_gift");
    assert.equal(sim.inspect().scene.item, "bottle_cap");
    advance(sim, 25);
  }

  const memory = sim.exportMemory();
  assert.equal(favouriteTreasure(memory.preferences, memory.collection), "bottle_cap");
  assert.deepEqual(memory.collection, { sock: 1, bottle_cap: 3 });
  const initial = normalizePreferences({ seed: 123 });
  let initialCaps = 0;
  let attachedCaps = 0;
  const alternatives = new Set();

  for (let draw = 0; draw < 1000; draw++) {
    const random = () => draw / 1000;
    initialCaps += chooseGift(initial, random) === "bottle_cap";
    const item = chooseGift(memory.preferences, random);
    attachedCaps += item === "bottle_cap";
    alternatives.add(item);
  }

  assert.ok(attachedCaps > initialCaps);
  assert.equal(alternatives.size, 6, "all other treasures and food remain possible");
  const restarted = bird(999);
  restarted.restoreMemory(memory);
  assert.deepEqual(restarted.exportMemory().preferences, memory.preferences);
  restarted.action("bring_gift");
  reach(restarted, "reveal");
  assert.equal(restarted.inspect().bubble, "my favourite.");
  const belongings = new Belongings(900, 650);
  belongings.restore(memory);

  for (let delivery = 0; delivery < 12; delivery++) {
    belongings.collect("sock", { x: 100, y: 200 });
  }

  assert.equal(belongings.favouriteTreasure(), "sock");
  belongings.forgetLearning();
  assert.equal(belongings.favouriteTreasure(), "sock");
});

test("interrupted gifts, hidden time, pause and cleanup never manufacture attachment", () => {
  const sim = bird();
  const initial = sim.exportMemory().preferences;
  sim.action("bring_gift");
  reach(sim, "reveal");
  sim.setVisible(false);
  advance(sim, 1000);
  assert.deepEqual(sim.exportMemory().preferences, initial);
  sim.setVisible(true);
  sim.action("cancel");
  advance(sim, 300);
  sim.action("clean");
  assert.deepEqual(sim.exportMemory().preferences, initial);
});

test("interrupted or hidden walks cannot earn visits and pause cancels the approach", () => {
  for (const interruption of ["cancel", "pause", "resize"]) {
    const sim = bird();
    sim.configure({ paused: false });
    reachHangoutWalk(sim);
    sim.setVisible(false);
    advance(sim, 300);
    assert.equal(sim.exportMemory().preferences.hangout, null);
    sim.setVisible(true);

    switch (interruption) {
      case "cancel":
        sim.action("cancel");
        sim.configure({ paused: true });
        break;

      case "pause":
        sim.configure({ paused: true });
        break;

      case "resize":
        sim.resize(96, 96);
        break;
    }

    advance(sim, 30);
    assert.equal(sim.exportMemory().preferences.hangout, null, interruption);
  }
});

test("autonomy discovers and revisits a hangout without any user interaction", () => {
  const sim = bird();
  sim.configure({ paused: false });
  advance(sim, 400);
  assert.ok(sim.exportMemory().preferences.hangout?.visits >= 2);
  assert.equal(sim.exportMemory().perch, null);
  const projectEvents = sim.exportMemory().episodes
    .filter((event) => event.detail.startsWith("project_"));
  assert.deepEqual(projectEvents, []);
});

test("normalization bounds preferences and rejects malformed identity and geometry", () => {
  for (const seed of [-1, 0, 1.5, Infinity, NaN, "123", 0x1_0000_0000]) {
    assert.equal(normalizePreferences({ seed }).seed, 0);
  }

  const preferences = normalizeMemory({ preferences: {
    seed: 123, treasureAffection: { sock: 999, bottle_cap: -1, mystery: 8 },
    hangout: { x: -10, y: 10, visits: 9999 },
  } }).preferences;
  assert.deepEqual(preferences, {
    seed: 123, treasureAffection: { sock: 12 }, hangout: { x: 0, y: 1, visits: 1000 },
  });
  assert.equal(normalizePreferences({ hangout: { x: NaN, y: 1, visits: 1 } }).hangout, null);
  assert.equal(favouriteTreasure(preferences, { bottle_cap: 1 }), null);
});
