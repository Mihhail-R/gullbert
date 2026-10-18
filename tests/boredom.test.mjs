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

test("repeating a trick lowers its appeal without banning it or tiring other tricks", () => {
  const boredom = new Boredom();
  const events = Array.from({ length: 6 }, (_, index) => episode(index + 1, "spin"));
  boredom.observe(events.slice(0, 1));
  const first = boredom.snapshot();
  boredom.observe(events);
  const repeated = boredom.snapshot();
  assert.ok(repeated.level > first.level);
  assert.ok(repeated.interest.show_spin > 0);
  assert.ok(repeated.interest.show_spin < first.interest.show_spin);
  assert.equal(repeated.interest.show_dead, undefined);
  boredom.observe(events);
  assert.deepEqual(boredom.snapshot(), repeated, "observing again cannot count again");
  boredom.observe([...events, episode(7, "dead")]);
  assert.ok(boredom.snapshot().level < repeated.level);
});

test("rest restores interest in a repeated trick", () => {
  const boredom = new Boredom();
  const events = Array.from({ length: 6 }, (_, index) => episode(index + 1, "spin"));
  boredom.observe(events);

  for (let tick = 0; tick < 18000; tick++) {
    boredom.update(0.1, "nap");
  }

  assert.ok(boredom.snapshot().interest.show_spin > 0.99);
  assert.equal(boredom.snapshot().level, 0);
});

test("restoring experience starts fresh but still notices the next performance", () => {
  const boredom = new Boredom();
  const events = Array.from({ length: 6 }, (_, index) => episode(index + 1, "spin"));
  boredom.reset(events);
  boredom.observe(events);
  assert.deepEqual(boredom.snapshot(), { level: 0, interest: {} });
  boredom.observe([...events, episode(7, "spin")]);
  assert.ok(boredom.snapshot().interest.show_spin < 1);
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
  assert.ok(boredom.snapshot().interest.play_cap < 1);
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

test("engine observations count actual performances and freeze while hidden or paused", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, mischief: 0 });
  sim.action("trick_spin");
  sim.action("cancel");
  sim.step(0.05);
  assert.deepEqual(sim.inspect().boredom.interest, {});
  sim.action("trick_spin");
  reach(sim, "reward");
  sim.step(0.05);
  const bored = sim.inspect().boredom;
  assert.ok(bored.interest.show_spin < 1);
  sim.action("cancel");
  advance(sim, 300);
  assert.deepEqual(sim.inspect().boredom, bored);
  sim.setVisible(false);
  sim.configure({ paused: false });
  advance(sim, 300);
  assert.deepEqual(sim.inspect().boredom, bored);
  sim.setVisible(true);
  sim.action("forget_learning");
  assert.deepEqual(sim.inspect().boredom, { level: 0, interest: {} });
});
