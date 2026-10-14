import test from "node:test";
import assert from "node:assert/strict";
import { QuietRoutine } from "../web-dist/simulation/behaviors/quiet.js";
import { Mood } from "../web-dist/simulation/behaviors/moods.js";

function bird(random = () => 0.5) {
  const sim = {
    time: 0,
    mode: "idle",
    until: 0,
    goal: null,
    bubble: "",
    settings: { paused: false, sound: false },
    events: [],
  };
  const speech = {
    say(text) {
      sim.bubble = text;
    },
    clear() {
      sim.bubble = "";
    },
  };
  const moods = new Mood(random, speech.say);
  const routine = new QuietRoutine({
    clock: {
      get now() {
        return sim.time;
      },
    },
    random,
    speech,
    moods,
    events: {
      emit(sound) {
        sim.events.push(sound);
      },
    },
    isPaused() {
      return sim.settings.paused;
    },
    activity: {
      beginQuiet(name, until) {
        sim.mode = name;
        sim.until = until;
        sim.goal = null;
      },
      rest() {
        sim.mode = "idle";
      },
      snapshot() {
        return { mode: sim.mode, until: sim.until };
      },
    },
  });
  return Object.assign(sim, { routine });
}

test("standing nap settles, wobbles, wakes and finishes without moving", () => {
  const sim = bird();
  sim.goal = { x: 500, y: 500 };
  sim.routine.start("nap");
  assert.equal(sim.goal, null);
  assert.equal(sim.routine.presentation().pose ?? null, "nap-settle");
  sim.time = 1;
  assert.equal(sim.routine.presentation().pose ?? null, "nap-sleep");
  sim.time = 3.7;
  assert.equal(sim.routine.presentation().pose ?? null, "nap-wobble");
  sim.time = 10;
  sim.routine.update(0);
  assert.equal(sim.routine.presentation().pose ?? null, "nap-wake");
  assert.deepEqual(sim.events, []);
  sim.time = sim.until;
  sim.routine.update(0);
  assert.equal(sim.mode, "idle");
  assert.equal(sim.routine.snapshot().quiet, null);
});

test("self-startled wake squawks once, then gives an accusing look", () => {
  const sim = bird(() => 0);
  sim.routine.start("nap");
  sim.time = 7.9;
  sim.routine.update(0);
  assert.equal(sim.routine.presentation().pose ?? null, "nap-startle");
  sim.routine.update(0);
  assert.deepEqual(sim.events, ["squawk"]);
  sim.time = 8.5;
  sim.routine.update(0);
  assert.equal(sim.routine.presentation().pose ?? null, "nap-accuse");
  assert.equal(sim.bubble, "who did that?");
});

test("an interrupted nap cannot produce a deferred wake event", () => {
  const sim = bird(() => 0);
  sim.routine.start("nap");
  sim.routine.interrupt();
  sim.mode = "fetch";
  sim.time = 100;
  assert.equal(sim.routine.update(0), "complete");
  assert.equal(sim.routine.presentation().pose ?? null, null);
  assert.deepEqual(sim.events, []);
});

test("each mannerism has a beginning, active pose, finish and idle return", () => {
  for (const name of ["preen", "tilt", "stretch"]) {
    const sim = bird();
    sim.routine.start(name);
    assert.equal(sim.routine.presentation().pose ?? null, `${name}-start`);
    sim.time = 0.7;
    assert.equal(sim.routine.presentation().pose ?? null, name);
    sim.time = sim.until - 0.2;
    assert.equal(sim.routine.presentation().pose ?? null, `${name}-finish`);
    sim.time = sim.until;
    sim.routine.update(0);
    assert.equal(sim.mode, "idle");
  }
});

test("preening alternates feather-tidying pecks with recovery", () => {
  const sim = bird();
  sim.routine.start("preen");
  const poses = [0.7, 1.2, 1.7, 2.2, 2.7].map((time) => {
    sim.time = time;
    return sim.routine.presentation().pose ?? null;
  });
  assert.deepEqual(poses, [
    "preen",
    "preen-start",
    "preen",
    "preen-start",
    "preen",
  ]);
});

test("autonomy respects cooldown, pause and no immediate repetition", () => {
  const sim = bird(() => 0);
  assert.equal(sim.routine.choose(), null);
  sim.time = 20;
  assert.equal(sim.routine.choose(), "nap");
  sim.routine.start("nap");
  sim.time = sim.until;
  sim.routine.update(0);
  assert.equal(sim.routine.choose(), null);
  sim.time = sim.routine.snapshot().nextQuiet;
  assert.equal(sim.routine.choose(), "preen");
  sim.settings.paused = true;
  assert.equal(sim.routine.choose(), null);
});
