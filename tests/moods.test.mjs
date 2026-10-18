import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { Mood } from "../web-dist/simulation/behaviors/moods.js";
import { QuietRoutine } from "../web-dist/simulation/behaviors/quiet.js";
import { dialogue } from "../web-dist/simulation/dialogue.js";
import { advance } from "./simulation-helpers.mjs";

function bird() {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}

test("recent naps, curiosity, successful poop and snack outcomes produce moods", () => {
  const sim = bird();
  sim.action("nap");
  assert.equal(sim.inspect().mood.name, "sleepy");
  sim.action("tilt");
  assert.equal(sim.inspect().mood.name, "curious");
  sim.action("poop");
  advance(sim, 8);
  assert.equal(sim.inspect().mood.name, "smug");
  sim.action("feed");
  advance(sim, 8);
  assert.equal(sim.inspect().mood.name, "snack-minded");
  sim.action("search_snack");
  advance(sim, 4);
  assert.equal(sim.inspect().mood.name, "snack-minded");
});

test("moods expire in visible time and hiding preserves the remaining time", () => {
  const sim = bird();
  sim.action("tilt");
  advance(sim, 4);
  sim.setVisible(false);
  advance(sim, 100);
  sim.setVisible(true);
  advance(sim, 1);
  assert.equal(sim.inspect().mood?.name, "curious");
  advance(sim, 40);
  assert.equal(sim.inspect().mood, null);
});

test("mood remarks rotate within the matching dialogue bank and stop on expiry", () => {
  let spoken;
  const mood = new Mood(
    () => 0.5,
    (line) => {
      spoken = line;
    },
  );

  for (const name of ["sleepy", "curious", "smug", "snack-minded"]) {
    mood.set(name, 0);
    assert.ok(dialogue.gullbert.moods[name].includes(spoken));
    const nextRemark = mood.remark(0);
    assert.ok(dialogue.gullbert.moods[name].includes(nextRemark));
    assert.notEqual(nextRemark, spoken);
  }

  assert.equal(mood.remark(mood.snapshot().mood.until), null);
});

test("moods bias quiet routines only after pause and cooldown permit one", () => {
  let now = 0;
  let paused = true;
  const moods = new Mood(
    () => 0.99,
    () => {},
  );
  moods.set("smug", now, { speak: false });
  const routine = new QuietRoutine({
    clock: {
      get now() {
        return now;
      },
    },
    random: () => 0.99,
    moods,
    isPaused() {
      return paused;
    },
    activity: {
      snapshot() {
        return { mode: "idle", until: 0 };
      },
    },
    speech: { say() {}, clear() {} },
    events: { emit() {} },
  });
  assert.equal(routine.choose(), null);
  paused = false;
  assert.equal(routine.choose(), null, "first slot schedules its own cooldown");
  now = 20;
  assert.equal(routine.choose(), "preen");
});

test("moods never block an explicit feeding request", () => {
  const sim = bird();

  for (const action of ["nap", "tilt", "poop", "search_snack"]) {
    sim.action(action);
    advance(sim, 4);
    sim.action("feed");
    assert.equal(sim.inspect().mode, "fetch");
  }
});
