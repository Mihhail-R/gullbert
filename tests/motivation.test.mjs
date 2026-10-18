import test from "node:test";
import assert from "node:assert/strict";
import { Motivation, NEUTRAL_MOTIVATION } from "../web-dist/simulation/motivation.js";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { advance, reach } from "./simulation-helpers.mjs";

function spend(motivation, seconds, activity) {
  for (let tick = 0; tick < seconds * 10; tick++) {
    motivation.update(0.1, activity);
  }
}

test("activity uses energy and curiosity, and independent rest restores energy", () => {
  const motivation = new Motivation();
  spend(motivation, 100, "cap");
  const played = motivation.snapshot();
  assert.ok(played.energy < NEUTRAL_MOTIVATION.energy);
  assert.ok(played.curiosity < NEUTRAL_MOTIVATION.curiosity);
  spend(motivation, 10, "nap");
  assert.ok(motivation.snapshot().energy > played.energy + 0.17);
  const curiosity = motivation.snapshot().curiosity;
  spend(motivation, 30, "idle");
  assert.ok(motivation.snapshot().curiosity > curiosity);
  spend(motivation, 30, "walk");
  assert.ok(motivation.snapshot().curiosity < curiosity);
});

test("long stretches without attention stay comfortable and never create loneliness", () => {
  const motivation = new Motivation();
  motivation.enjoyed("scratch");
  assert.ok(motivation.snapshot().socialInterest > 0.5);
  spend(motivation, 3600, "cap");
  assert.equal(motivation.snapshot().energy, 0.2);
  assert.equal(motivation.snapshot().curiosity, 0.2);
  spend(motivation, 3600, "idle");
  const rested = motivation.snapshot();
  assert.equal(rested.energy, 0.8);
  assert.equal(rested.curiosity, 0.8);
  assert.ok(rested.socialInterest >= 0.5);
  assert.ok(rested.socialInterest < 0.501);
});

test("repeated meals and play keep tendencies within comfortable bounds", () => {
  const motivation = new Motivation();

  for (let meal = 0; meal < 10; meal++) {
    motivation.enjoyed("meal");
  }

  assert.equal(motivation.snapshot().energy, 0.8);
  assert.ok(motivation.snapshot().socialInterest <= 0.8);

  for (let game = 0; game < 10; game++) {
    motivation.enjoyed("play");
  }

  assert.equal(motivation.snapshot().energy, 0.2);
  assert.equal(motivation.snapshot().curiosity, 0.2);
  assert.equal(motivation.snapshot().socialInterest, 0.8);
});

test("invalid time and suspension cannot produce a backlog of needs", () => {
  const motivation = new Motivation();

  for (const seconds of [NaN, Infinity, -1, 0]) {
    motivation.update(seconds, "cap");
  }

  assert.deepEqual(motivation.snapshot(), NEUTRAL_MOTIVATION);
  motivation.update(86400, "cap");
  assert.ok(motivation.snapshot().energy > 0.499);
});

test("hidden and paused time freezes tendencies; saved memory carries no care state", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, mischief: 0 });
  sim.action("feed");
  advance(sim, 3);
  const content = sim.inspect().motivation;
  assert.ok(content.energy > 0.5);
  assert.ok(content.socialInterest > 0.5);
  advance(sim, 300);
  assert.deepEqual(sim.inspect().motivation, content);
  sim.setVisible(false);
  sim.configure({ paused: false });
  advance(sim, 300);
  assert.deepEqual(sim.inspect().motivation, content);

  const restored = new Gullbert(900, 650, () => 0.5);
  restored.restoreMemory(JSON.parse(JSON.stringify(sim.exportMemory())));
  assert.deepEqual(restored.inspect().motivation, NEUTRAL_MOTIVATION);
  sim.setVisible(true);
  sim.action("nap");
  advance(sim, 5);
  assert.ok(sim.inspect().motivation.energy > content.energy);
});

for (const [command, energy, socialInterest] of [
  ["feed", 0.54, 0.53],
  ["place_bag", 0.54, 0.53],
  ["chip_toss", 0.46, 0.65],
  ["bring_gift", 0.54, 0.53],
  ["apology", 0.54, 0.53],
]) {
  test(`${command} applies one meal benefit after the food is eaten`, () => {
    const sim = new Gullbert(900, 650, () => 0.95);
    sim.configure({ paused: true, mischief: 0 });
    sim.action(command, { x: 650, y: 480 });
    assert.deepEqual(sim.inspect().motivation, NEUTRAL_MOTIVATION);

    advance(sim, 20);
    assert.equal(sim.inspect().events.filter((event) => event === "munch").length, 1);
    const fed = sim.inspect().motivation;
    assert.ok(Math.abs(fed.energy - energy) < 1e-9);
    assert.ok(Math.abs(fed.socialInterest - socialInterest) < 1e-9);

    advance(sim, 20);
    assert.deepEqual(sim.inspect().motivation, fed, "finished meals cannot pay out again");
  });
}

test("cancelled meals leave energy and social interest unchanged", () => {
  for (const command of ["feed_here", "place_bag", "chip_toss", "bring_gift", "apology"]) {
    const sim = new Gullbert(900, 650, () => 0.95);
    sim.configure({ paused: true, mischief: 0 });
    sim.action(command, { x: 650, y: 480 });
    sim.action("cancel");
    advance(sim, 20);
    assert.equal(sim.inspect().events.includes("munch"), false, command);
    assert.deepEqual(sim.inspect().motivation, NEUTRAL_MOTIVATION, command);
  }
});

test("a completed game changes tendencies, but a cancelled invitation does not", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, mischief: 0 });
  sim.action("play_cap");
  sim.action("cancel");
  assert.deepEqual(sim.inspect().motivation, NEUTRAL_MOTIVATION);
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
  const played = sim.inspect().motivation;
  assert.ok(played.energy < 0.5);
  assert.ok(played.curiosity < 0.5);
  assert.ok(played.socialInterest > 0.5);
  sim.action("trick_spin");
  assert.equal(sim.inspect().scene.trick, "spin", "energy never blocks explicit actions");
});

test("scratches encourage company without supplying energy", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, mischief: 0 });

  for (let tick = 0; tick < 20; tick++) {
    const { x, y, facing } = sim.inspect();
    sim.pointer({ x: x + (facing === 1 ? 59 : 37), y: y + 35 });
    sim.step(0.05);
  }

  assert.equal(sim.present().affection.kind, "scratch");
  sim.pointer(null);
  assert.ok(sim.inspect().motivation.socialInterest > 0.5);
  assert.equal(sim.inspect().motivation.energy, 0.5);
});

test("an unattended gull manages his energy without feeding or play", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ mischief: 0 });
  let recovered = false;
  let previousEnergy = sim.inspect().motivation.energy;

  for (let minute = 0; minute < 15; minute++) {
    advance(sim, 60);
    const state = sim.inspect().motivation;
    recovered ||= state.energy > previousEnergy;
    previousEnergy = state.energy;
    assert.ok(state.energy >= 0.2 && state.energy <= 0.8);
    assert.equal(state.socialInterest, 0.5);
  }

  assert.equal(recovered, true);
});
