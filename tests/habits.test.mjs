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

function selectionCounts(memory, mischief = 1, motivation) {
  const counts = { habit_snack: 0, play_cap: 0, none: 0 };

  // Sweep the draw rather than relying on flaky random samples.
  for (let draw = 0; draw < 1000; draw++) {
    const habits = new Habits();
    const command = habits.choose(memory, 90, mischief, () => draw / 1000, motivation);
    counts[command ?? "none"] += 1;
  }

  return counts;
}

test("ordinary habits never select spin or play-dead despite mastery and rewards", () => {
  const memory = normalizeMemory({
    learned: { tricks: { spin: 6, dead: 6 } },
    episodes: [episode(1, "reward", "spin"), episode(2, "reward", "dead")],
  });
  const counts = selectionCounts(memory);
  assert.equal(counts.none, 1000);
});

test("energy and social interest change learned choices without overriding their evidence", () => {
  const memory = normalizeMemory({ episodes: [episode(1, "play", "cap")] });
  const neutral = { energy: 0.5, curiosity: 0.5, socialInterest: 0.5 };
  const rested = selectionCounts(memory, 1, { ...neutral, energy: 0.8 });
  const tired = selectionCounts(memory, 1, { ...neutral, energy: 0.2 });
  const sociable = selectionCounts(memory, 1, { ...neutral, socialInterest: 0.8 });
  assert.ok(rested.play_cap > tired.play_cap);
  assert.ok(sociable.play_cap > selectionCounts(memory, 1, neutral).play_cap);
  assert.ok(sociable.none > 0, "even a sociable gull can leave you alone");
});

test("eagerness cannot invent experience or bypass the invitation cooldown", () => {
  const memory = normalizeMemory({ episodes: [episode(1, "play", "cap")] });
  const neutral = { energy: 0.5, curiosity: 0.5, socialInterest: 0.5 };
  assert.equal(selectionCounts(normalizeMemory(), 1, neutral).play_cap, 0);
  assert.equal(selectionCounts(memory, 0, neutral).play_cap, 0);

  const habits = new Habits();
  assert.equal(habits.choose(memory, 90, 1, () => 0, neutral), "play_cap");
  const eager = { energy: 0.8, curiosity: 0.8, socialInterest: 0.8 };
  assert.equal(habits.choose(memory, 200, 1, () => 0, eager), null);
});

test("curiosity encourages checking familiar places", () => {
  const memory = normalizeMemory({
    learned: { snackSpot: { x: 100, y: 100, meals: 3 } },
  });
  const content = { energy: 0.5, curiosity: 0.2, socialInterest: 0.5 };
  const curious = { ...content, curiosity: 0.8 };
  assert.ok(
    selectionCounts(memory, 0, curious).habit_snack >
    selectionCounts(memory, 0, content).habit_snack,
  );
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

test("unpaid tricks allow invitations, while quiet mode suppresses them", () => {
  const memory = normalizeMemory({
    unpaidTricks: 2,
    learned: { tricks: { spin: 6 } },
    episodes: [episode(1, "play", "cap")],
  });
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

test("a bag meal postpones autonomous snack checks for ninety visible seconds", () => {
  const sim = new Gullbert(900, 650, () => 0);
  sim.configure({ paused: true, mischief: 0 });
  advance(sim, 100);
  sim.action("place_bag", { x: 300, y: 300 });
  reach(sim, "eat");
  const mealTime = sim.inspect().time;
  assert.equal(sim.exportMemory().learned.snackSpot.meals, 1);
  sim.clean();

  advance(sim, mealTime + 89 - sim.inspect().time);
  sim.configure({ paused: false });
  sim.step(0.05);
  assert.notEqual(sim.inspect().scene?.kind, "habit");
  sim.configure({ paused: true });

  advance(sim, 1.1);
  sim.action("cancel");
  sim.configure({ paused: false });
  sim.step(0.05);
  assert.equal(sim.inspect().scene.kind, "habit");
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
  const performances = sim.exportMemory().performances.spin;
  advance(sim, 100);
  sim.configure({ paused: false });
  sim.step(0.05);
  assert.notEqual(sim.inspect().scene?.kind, "trick");
  assert.equal(sim.exportMemory().learned.tricks.spin, 1);
  assert.equal(sim.exportMemory().performances.spin, performances);

  sim.action("nap");
  assert.equal(sim.inspect().scene, null, "explicit commands immediately take priority");
  assert.equal(sim.inspect().mode, "nap");
});
