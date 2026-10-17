import test from "node:test";
import assert from "node:assert/strict";
import { Pettiness } from "../web-dist/simulation/pettiness.js";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { advance } from "./simulation-helpers.mjs";

const settings = { paused: false, mischief: 1 };

function ignore(pettiness, now, preferences = settings, roll = 0) {
  const identity = {};
  pettiness.invited(identity);
  pettiness.completed(identity, { kind: "cap", rounds: 0 }, now, preferences, () => roll);
}

test("two actual ignored invitations allow one protest scaled by behavior level", () => {
  for (const level of [0, 1, 2]) {
    const pettiness = new Pettiness();
    const preferences = { ...settings, mischief: level };
    ignore(pettiness, 100, preferences);
    assert.equal(pettiness.take(104, preferences), null);
    ignore(pettiness, 300, preferences);
    assert.equal(pettiness.take(303, preferences), null);
    const expected = [null, "pretend_leave", "poop"][level];
    assert.equal(pettiness.take(304, preferences), expected);
    assert.equal(pettiness.take(305, preferences), null);
  }
});

test("behavior level changes the odds, and declining a protest consumes its cooldown", () => {
  for (const level of [1, 2]) {
    const pettiness = new Pettiness();
    const preferences = { ...settings, mischief: level };
    ignore(pettiness, 100, preferences, 0.4);
    ignore(pettiness, 300, preferences, 0.4);
    assert.equal(pettiness.take(304, preferences), level === 2 ? "poop" : null);
    ignore(pettiness, 400, preferences);
    ignore(pettiness, 500, preferences);
    assert.equal(pettiness.take(504, preferences), null);
  }
});

test("interruptions, stale identities and partial participation are not snubs", () => {
  const pettiness = new Pettiness();

  for (let attempt = 0; attempt < 3; attempt++) {
    const identity = {};
    pettiness.invited(identity);
    pettiness.interrupt();
    pettiness.completed(identity, { kind: "cap", rounds: 0 }, 100, settings, () => 0);
    pettiness.invited({});
    pettiness.completed(identity, { kind: "cap", rounds: 0 }, 100, settings, () => 0);
    pettiness.invited(identity);
    pettiness.completed(identity, { kind: "cap", rounds: 1 }, 100, settings, () => 0);
  }

  assert.equal(pettiness.take(104, settings), null);
  ignore(pettiness, 200);
  assert.equal(pettiness.take(204, settings), null);
});

test("only an expired trick reward window counts, and completion cannot count twice", () => {
  const pettiness = new Pettiness();
  const identity = {};
  pettiness.invited(identity);
  pettiness.completed(identity, { kind: "trick", phase: "perform" }, 100, settings, () => 0);
  pettiness.invited(identity);
  pettiness.completed(identity, { kind: "trick", phase: "reward" }, 200, settings, () => 0);
  pettiness.completed(identity, { kind: "trick", phase: "reward" }, 200, settings, () => 0);
  assert.equal(pettiness.take(204, settings), null);
  ignore(pettiness, 400);
  assert.equal(pettiness.take(404, settings), "pretend_leave");
});

test("offence fades, queued reactions expire, and settling needs no payment", () => {
  const pettiness = new Pettiness();
  ignore(pettiness, 100);
  ignore(pettiness, 701);
  assert.equal(pettiness.take(705, settings), null);
  ignore(pettiness, 800);
  assert.equal(pettiness.take(821, settings), null);
  const settled = new Pettiness();
  ignore(settled, 100);
  ignore(settled, 300);
  settled.settle();
  assert.equal(settled.take(304, settings), null);
  ignore(settled, 1000);
  assert.equal(settled.take(1004, settings), null);
});

test("pause and lower behavior levels discard queued protests", () => {
  for (const preferences of [
    { paused: true, mischief: 2 },
    { paused: false, mischief: 0 },
    { paused: false, mischief: 1 },
  ]) {
    const pettiness = new Pettiness();
    const enemy = { ...settings, mischief: 2 };
    ignore(pettiness, 100, enemy);
    ignore(pettiness, 300, enemy);
    assert.equal(pettiness.take(304, preferences), null);
    assert.equal(pettiness.take(305, enemy), null);
  }
});

function waitFor(sim, predicate, seconds = 500) {
  for (let tick = 0; tick < seconds * 20; tick++) {
    if (predicate(sim.inspect())) {
      return;
    }

    sim.step(0.05);
  }

  assert.fail("Expected behavior did not occur");
}

function remainUnprotested(sim, seconds) {
  for (let tick = 0; tick < seconds * 20; tick++) {
    sim.step(0.05);
    assert.doesNotMatch(sim.inspect().bubble, /audience is elsewhere|receive a response/);
  }
}

function secondInvitation(level, kind = "trick") {
  const sim = new Gullbert(900, 650, () => 0);
  sim.configure({ paused: true, mischief: level });
  let phase = "reward";

  if (kind === "cap") {
    phase = "ready";
    sim.restoreMemory({
      episodes: [{
        id: 1,
        kind: "play",
        detail: "cap",
        at: 1000,
        location: { x: 100, y: 100, width: 900, height: 650 },
      }],
    });
  } else {
    sim.restoreMemory({ learned: { tricks: { spin: 3 } } });
  }

  advance(sim, 100);
  sim.configure({ paused: false });
  waitFor(sim, (view) => view.scene?.kind === kind && view.scene.phase === phase);
  advance(sim, 21);
  waitFor(sim, (view) => view.scene?.kind === kind && view.scene.phase === phase);
  return sim;
}

test("accepting a cap invitation clears a snub even before the first round finishes", () => {
  const sim = secondInvitation(1, "cap");
  assert.equal(sim.flickCap(sim.inspect().scene.cap), true);
  assert.equal(sim.inspect().scene.rounds, 0);
  sim.action("cancel");
  waitFor(sim, (view) => view.scene?.kind === "cap" && view.scene.phase === "ready");
  remainUnprotested(sim, 30);
});

test("naturally ignored autonomous tricks produce a finite, interruptible protest", () => {
  for (const level of [1, 2]) {
    const sim = secondInvitation(level);
    waitFor(sim, (view) => /audience is elsewhere|receive a response/.test(view.bubble), 30);
    assert.equal(sim.inspect().mood.name, "offended");
    assert.equal(sim.exportMemory().unpaidTricks, 0);

    if (level === 1) {
      assert.equal(sim.inspect().scene.kind, "pretend_leave");
    } else {
      assert.equal(sim.inspect().mode, "takeoff");
    }

    sim.action("nap");
    assert.equal(sim.inspect().mode, "nap");
    assert.equal(sim.inspect().scene, null);
  }
});

test("hiding or cancelling an unanswered invitation never leaves a deferred protest", () => {
  for (const operation of ["hide", "cancel", "pause", "forget_learning"]) {
    const sim = secondInvitation(1);

    if (operation === "hide") {
      sim.setVisible(false);
      advance(sim, 1000);
      sim.setVisible(true);
    } else if (operation === "pause") {
      sim.configure({ paused: true });
    } else {
      sim.action(operation);
    }

    remainUnprotested(sim, 30);
  }
});
