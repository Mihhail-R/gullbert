import test from "node:test";
import assert from "node:assert/strict";
import { Habits } from "../web-dist/simulation/habits.js";
import { normalizeMemory } from "../web-dist/simulation/memory.js";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { advance, reach } from "./simulation-helpers.mjs";

function episode(id, kind, detail) {
  return {
    id,
    at: 1000,
    kind,
    detail,
    location: { x: 100, y: 100, width: 900, height: 650 },
  };
}

function selectionCounts(memory, mischief = 1) {
  const counts = { habit_snack: 0, show_spin: 0, show_dead: 0, play_cap: 0, none: 0 };

  // Sweep the draw rather than relying on flaky random samples.
  for (let draw = 0; draw < 1000; draw++) {
    const habits = new Habits();
    const command = habits.choose(memory, 90, mischief, () => draw / 1000);
    counts[command ?? "none"] += 1;
  }

  return counts;
}

test("a first reward influences autonomy without guaranteeing a performance", () => {
  const fresh = selectionCounts(normalizeMemory());
  assert.equal(fresh.none, 1000);
  const first = selectionCounts(normalizeMemory({ learned: { tricks: { spin: 1 } } }));
  const practiced = selectionCounts(normalizeMemory({ learned: { tricks: { spin: 6 } } }));
  assert.ok(first.show_spin > 0);
  assert.ok(practiced.show_spin > first.show_spin);
  assert.ok(practiced.none > 0);
});

test("recent reward outcomes outweigh older success even at equal mastery", () => {
  const episodes = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    episodes.push(episode(episodes.length + 1, "trick", "spin"));

    if (attempt < 6) {
      episodes.push(episode(episodes.length + 1, "reward", "spin"));
    }

    episodes.push(episode(episodes.length + 1, "trick", "dead"));

    if (attempt >= 6) {
      episodes.push(episode(episodes.length + 1, "reward", "dead"));
    }
  }

  const memory = normalizeMemory({
    learned: { tricks: { spin: 6, dead: 6 } },
    episodes,
  });
  const counts = selectionCounts(memory);
  assert.ok(counts.show_dead > counts.show_spin * 1.5);
  assert.ok(counts.show_spin > 0, "old skills can still be tried");
});

test("only completed cap games establish invitations; failed games lower their appeal", () => {
  const completed = normalizeMemory({ episodes: [episode(1, "play", "cap")] });
  const failed = normalizeMemory({ episodes: [episode(1, "activity", "cap")] });
  const unrelated = normalizeMemory({ episodes: [episode(1, "play", "toss")] });
  assert.ok(selectionCounts(completed).play_cap > 0);
  assert.equal(selectionCounts(failed).play_cap, 0);
  assert.equal(selectionCounts(unrelated).play_cap, 0);

  const ignored = normalizeMemory({
    episodes: [...completed.episodes, episode(2, "activity", "cap")],
  });
  assert.ok(selectionCounts(ignored).play_cap < selectionCounts(completed).play_cap);
});

test("unanswered invitations back off and a new completed game restores willingness", () => {
  const habits = new Habits();
  const memory = normalizeMemory({ episodes: [episode(1, "play", "cap")] });
  const random = () => 0;
  assert.equal(habits.choose(memory, 89, 1, random), null);
  assert.equal(habits.choose(memory, 90, 1, random), "play_cap");
  assert.equal(habits.choose(memory, 269, 1, random), null);
  assert.equal(habits.choose(memory, 280, 1, random), "play_cap");
  assert.equal(habits.choose(memory, 460, 1, random), null);
  assert.equal(habits.choose(memory, 640, 1, random), "play_cap");
  assert.equal(habits.choose(memory, 1000, 1, random), null);

  memory.episodes.push(episode(2, "play", "cap"));
  assert.equal(habits.choose(memory, 1010, 1, random), "play_cap");
});

test("quiet mode and unpaid work restrict choices without erasing preferences", () => {
  const memory = normalizeMemory({
    unpaidTricks: 2,
    learned: { tricks: { spin: 6 } },
    episodes: [episode(1, "play", "cap")],
  });
  assert.equal(selectionCounts(memory).show_spin, 0);
  assert.ok(selectionCounts(memory).play_cap > 0);
  assert.equal(selectionCounts(memory, 0).none, 1000);
});

test("finishing a manual game gives a quiet interval before any learned invitation", () => {
  const habits = new Habits();
  const memory = normalizeMemory({ episodes: [episode(1, "play", "cap")] });
  habits.played(200);
  assert.equal(habits.choose(memory, 289, 1, () => 0), null);
  assert.equal(habits.choose(memory, 290, 1, () => 0), "play_cap");
});

test("meals delay choices and reduce snack checks before appetite recovers", () => {
  const memory = normalizeMemory({
    learned: { snackSpot: { x: 100, y: 100, meals: 3 } },
  });
  const habits = new Habits();
  habits.ate(60);
  assert.equal(habits.choose(memory, 149, 0, () => 0), null);
  assert.equal(habits.choose(memory, 150, 0, () => 0.7), null);
  const hungry = new Habits();
  assert.equal(hungry.choose(memory, 150, 0, () => 0.7), "habit_snack");
  assert.equal(habits.choose(memory, 333, 0, () => 0.7), "habit_snack");
});

test("preferences survive a JSON save round trip and decisions do not mutate memory", () => {
  const memory = normalizeMemory({
    learned: { tricks: { spin: 2 }, snackSpot: { x: 100, y: 100, meals: 1 } },
    episodes: [episode(1, "play", "cap")],
  });
  const saved = JSON.stringify(memory);
  const restored = normalizeMemory(JSON.parse(saved));
  assert.deepEqual(selectionCounts(restored), selectionCounts(memory));
  assert.equal(JSON.stringify(memory), saved);
});

test("one completed game can lead to a bounded autonomous invitation", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, mischief: 1 });
  sim.action("play_cap");
  reach(sim, "ready");

  for (let round = 0; round < 3; round++) {
    sim.flickCap(sim.inspect().scene.cap);
    reach(sim, "return");

    if (round < 2) {
      reach(sim, "ready");
    }
  }

  reach(sim, "victory");
  advance(sim, 2);
  assert.equal(sim.exportMemory().episodes.at(-1).kind, "play");
  advance(sim, 100);
  assert.equal(sim.inspect().scene, null, "pause prevents invitations");
  sim.setVisible(false);
  sim.configure({ paused: false });
  const time = sim.inspect().time;
  advance(sim, 100);
  assert.equal(sim.inspect().time, time);
  sim.setVisible(true);
  sim.step(0.05);
  assert.equal(sim.inspect().scene.kind, "cap");
  advance(sim, 25);
  assert.notEqual(sim.inspect().scene?.kind, "cap", "unanswered game ends on its own");
  assert.equal(sim.exportMemory().episodes.filter((event) => event.kind === "play").length, 1);
});

test("forgetting and restoring clear session choices without manufacturing experience", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, mischief: 1 });
  sim.restoreMemory({ episodes: [episode(1, "play", "cap")] });
  advance(sim, 100);
  sim.configure({ paused: false });
  sim.step(0.05);
  assert.equal(sim.inspect().scene.kind, "cap");
  sim.action("forget_learning");
  sim.configure({ paused: true });
  assert.equal(selectionCounts(sim.exportMemory()).none, 1000);

  sim.restoreMemory({ learned: { tricks: { spin: 1 } } });
  advance(sim, 100);
  sim.configure({ paused: false });
  sim.step(0.05);
  assert.equal(sim.inspect().scene.trick, "spin");
  assert.equal(sim.inspect().scene.unsolicited, true);
  assert.equal(sim.inspect().scene.practiced, false);
  sim.action("nap");
  assert.equal(sim.inspect().scene, null, "explicit commands immediately take priority");
  assert.equal(sim.inspect().mode, "nap");
});
