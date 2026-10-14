import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { Mood } from "../web-dist/simulation/behaviors/moods.js";
import { QuietRoutine } from "../web-dist/simulation/behaviors/quiet.js";

function bird() {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}
function advance(sim, seconds) {
  for (let i = 0; i < seconds * 20; i++) sim.step(0.05);
}

test("recent naps, curiosity, successful poop and snack outcomes produce moods", () => {
  const sim = bird();
  sim.action("nap");
  assert.equal(sim.inspect().mood.name, "sleepy");
  sim.action("tilt");
  assert.equal(sim.inspect().mood.name, "curious");
  sim.action("poop");
  advance(sim, 8);
  assert.equal(sim.inspect().splats.length, 1);
  assert.equal(sim.inspect().mood.name, "smug");
  sim.action("feed");
  advance(sim, 8);
  assert.equal(sim.inspect().mood.name, "snack-minded");
  sim.action("search_snack");
  advance(sim, 4);
  assert.equal(sim.inspect().snackSearch, "failed");
  assert.equal(sim.inspect().mood.name, "snack-minded");
});

test("moods expire in visible time and hiding preserves the remaining time", () => {
  const sim = bird();
  sim.action("tilt");
  advance(sim, 4);
  const until = sim.inspect().mood.until;
  const time = sim.inspect().time;
  sim.setVisible(false);
  advance(sim, 100);
  assert.equal(sim.inspect().time, time);
  assert.equal(sim.inspect().mood.until, until);
  sim.setVisible(true);
  advance(sim, 40);
  assert.equal(sim.inspect().mood, null);
});

test("every mood offers an existing idle pose and nonrepeating relevant remarks", () => {
  let spoken;
  const mood = new Mood(
    () => 0.5,
    (line) => {
      spoken = line;
    },
  );
  for (const name of ["sleepy", "curious", "smug", "snack-minded"]) {
    mood.set(name, 0);
    assert.equal(typeof spoken, "string");
    assert.notEqual(mood.remark(0), spoken);
    assert.ok(mood.pose("idle", 0));
    assert.equal(mood.pose("fly", 0), null);
  }
  mood.update(mood.snapshot().mood.until);
  assert.equal(mood.remark(100), null);
  assert.equal(mood.pose("idle", 100), null);
});

test("moods bias only eligible quiet slots and never block explicit actions", () => {
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
  const sim = bird();
  for (const action of ["nap", "tilt", "poop", "search_snack"]) {
    sim.action(action);
    advance(sim, 4);
    sim.action("feed");
    assert.equal(sim.inspect().mode, "fetch");
  }
});
