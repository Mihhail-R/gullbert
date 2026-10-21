import test from "node:test";
import assert from "node:assert/strict";
import { Boredom } from "../web-dist/simulation/boredom.js";
import { Habits } from "../web-dist/simulation/habits.js";
import { normalizeMemory } from "../web-dist/simulation/memory.js";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { advance, reach } from "./simulation-helpers.mjs";

function episode(id, detail, kind = "trick") {
  return {
    id,
    kind,
    detail,
    at: 1000,
    location: { x: 100, y: 100, width: 900, height: 650 },
  };
}

test("repeating a trick raises global boredom and variety lowers it", () => {
  const boredom = new Boredom();
  const events = Array.from({ length: 6 }, (_, index) => episode(index + 1, "spin"));
  boredom.observe(events.slice(0, 1));
  const first = boredom.snapshot();
  boredom.observe(events);
  const repeated = boredom.snapshot();
  assert.ok(repeated.level > first.level);
  assert.equal(repeated.capInterest, 1);
  boredom.observe(events);
  assert.deepEqual(boredom.snapshot(), repeated, "observing again cannot count again");
  boredom.observe([...events, episode(7, "dead")]);
  assert.ok(boredom.snapshot().level < repeated.level);
});

test("rest restores interest in repeated cap games", () => {
  const boredom = new Boredom();
  const events = Array.from({ length: 6 }, (_, index) => episode(index + 1, "cap", "play"));
  boredom.observe(events);

  for (let tick = 0; tick < 18000; tick++) {
    boredom.update(0.1, "nap");
  }

  assert.ok(boredom.snapshot().capInterest > 0.99);
  assert.equal(boredom.snapshot().level, 0);
});

test("restoring experience starts fresh but still notices the next performance", () => {
  const boredom = new Boredom();
  const events = Array.from({ length: 6 }, (_, index) => episode(index + 1, "cap", "play"));
  boredom.observe(events);
  assert.ok(boredom.snapshot().capInterest < 1);
  boredom.reset(events);
  boredom.observe(events);
  assert.deepEqual(boredom.snapshot(), { level: 0, capInterest: 1 });
  boredom.observe([...events, episode(7, "cap", "play")]);
  assert.ok(boredom.snapshot().capInterest < 1);
});

test("completed games provide variety; cancelled games do not", () => {
  const boredom = new Boredom();
  const events = [episode(1, "spin"), episode(2, "spin"), episode(3, "spin")];
  boredom.observe(events);
  const before = boredom.snapshot();
  boredom.observe([...events, episode(4, "cap", "activity")]);
  assert.deepEqual(boredom.snapshot(), before);
  boredom.observe([...events, episode(5, "cap", "play")]);
  assert.ok(boredom.snapshot().level < before.level);
  const completed = boredom.snapshot();
  assert.ok(completed.capInterest < 1);
  boredom.observe([...events, episode(5, "cap", "play")]);
  assert.deepEqual(boredom.snapshot(), completed);
});

test("repeated cap games lower ordinary invitations while preserving the option", () => {
  const boredom = new Boredom();
  const episodes = Array.from({ length: 6 }, (_, index) => episode(index + 1, "cap", "play"));
  boredom.observe(episodes);
  const memory = normalizeMemory({ episodes });
  let freshInvitations = 0;
  let repeatedInvitations = 0;

  for (let draw = 0; draw < 1000; draw++) {
    const random = () => draw / 1000;

    if (new Habits()
      .choose(memory, 100, 1, random) === "play_cap") {
      freshInvitations += 1;
    }

    const choice = new Habits()
      .choose(memory, 100, 1, random, undefined, boredom.snapshot());

    if (choice === "play_cap") {
      repeatedInvitations += 1;
    }
  }

  assert.ok(repeatedInvitations > 0);
  assert.ok(repeatedInvitations < freshInvitations);
});

test("engine counts completed cap games and freezes interest while hidden or paused", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, mischief: 0 });
  sim.action("play_cap");
  sim.action("cancel");
  sim.step(0.05);
  assert.deepEqual(sim.inspect().boredom, { level: 0, capInterest: 1 });
  sim.action("play_cap");

  for (let round = 0; round < 3; round++) {
    reach(sim, "ready");
    assert.equal(sim.flickCap(sim.inspect().scene.cap), true);
  }

  reach(sim, "victory");
  advance(sim, 2);
  const bored = sim.inspect().boredom;
  assert.ok(bored.capInterest < 1);
  advance(sim, 300);
  assert.deepEqual(sim.inspect().boredom, bored);
  sim.setVisible(false);
  sim.configure({ paused: false });
  advance(sim, 300);
  assert.deepEqual(sim.inspect().boredom, bored);
  const restored = new Gullbert(900, 650, () => 0.5);
  restored.configure({ paused: true, mischief: 0 });
  restored.restoreMemory(sim.exportMemory());
  restored.step(0.05);
  assert.deepEqual(restored.inspect().boredom, { level: 0, capInterest: 1 });

  sim.setVisible(true);
  sim.action("forget_learning");
  assert.deepEqual(sim.inspect().boredom, { level: 0, capInterest: 1 });
});
