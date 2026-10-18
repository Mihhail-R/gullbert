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

test("interrupted or replaced invitations cannot add a snub", () => {
  for (const interruption of ["interrupt", "replace"]) {
    const pettiness = new Pettiness();
    ignore(pettiness, 100);
    const identity = {};
    pettiness.invited(identity);

    if (interruption === "interrupt") {
      pettiness.interrupt();
    } else {
      pettiness.invited({});
    }

    pettiness.completed(identity, { kind: "cap", rounds: 0 }, 200, settings, () => 0);
    assert.equal(pettiness.take(204, settings), null, interruption);
    ignore(pettiness, 300);
    assert.equal(pettiness.take(304, settings), "pretend_leave", interruption);
  }
});

test("playing a round clears an earlier ignored invitation", () => {
  const pettiness = new Pettiness();
  ignore(pettiness, 100);
  const identity = {};
  pettiness.invited(identity);
  pettiness.completed(identity, { kind: "cap", rounds: 1 }, 200, settings, () => 0);
  ignore(pettiness, 300);
  assert.equal(pettiness.take(304, settings), null);
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

test("old snubs fade before they can combine with a new ignored invitation", () => {
  const pettiness = new Pettiness();
  ignore(pettiness, 100);
  ignore(pettiness, 701);
  assert.equal(pettiness.take(705, settings), null);
  ignore(pettiness, 800);
  assert.equal(pettiness.take(804, settings), "pretend_leave");
});

test("a protest expires when the bird cannot act on it soon enough", () => {
  const pettiness = new Pettiness();
  ignore(pettiness, 100);
  ignore(pettiness, 300);
  assert.equal(pettiness.take(321, settings), null);
});

test("settling discards both queued protests and earlier ignored invitations", () => {
  const pending = new Pettiness();
  ignore(pending, 100);
  ignore(pending, 300);
  pending.settle();
  assert.equal(pending.take(304, settings), null);

  const earlier = new Pettiness();
  ignore(earlier, 100);
  earlier.settle();
  ignore(earlier, 300);
  assert.equal(earlier.take(304, settings), null);
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

function assertNoPettyExit(sim, seconds) {
  for (let tick = 0; tick < seconds * 20; tick++) {
    sim.step(0.05);
    const view = sim.inspect();
    const protesting = view.scene?.kind === "pretend_leave" && view.mood?.name === "offended";
    assert.equal(protesting, false);
  }
}

function invitationBird(level) {
  const sim = new Gullbert(900, 650, () => 0);
  sim.configure({ paused: true, mischief: level });
  sim.restoreMemory({
    episodes: [{
      id: 1,
      kind: "play",
      detail: "cap",
      at: 1000,
      location: { x: 100, y: 100, width: 900, height: 650 },
    }],
  });
  advance(sim, 100);
  sim.configure({ paused: false });
  waitFor(sim, (view) => view.scene?.kind === "cap" && view.scene.phase === "ready");
  return sim;
}

function secondInvitation(level) {
  const sim = invitationBird(level);
  advance(sim, 21);
  waitFor(sim, (view) => view.scene?.kind === "cap" && view.scene.phase === "ready");
  return sim;
}

test("accepting a cap invitation clears a snub even before the first round finishes", () => {
  const sim = secondInvitation(1);
  assert.equal(sim.flickCap(sim.inspect().scene.cap), true);
  assert.equal(sim.inspect().scene.rounds, 0);
  sim.action("cancel");
  waitFor(sim, (view) => view.scene?.kind === "cap" && view.scene.phase === "ready");
  assertNoPettyExit(sim, 30);
});

test("an apology meal clears earlier ignored invitations before the next snub", () => {
  const sim = invitationBird(1);
  advance(sim, 21);
  const ignoredAt = sim.inspect().time;

  sim.action("apology");
  waitFor(sim, (view) => view.memory.learned.snackSpot?.meals === 1, 20);
  waitFor(sim, (view) => view.scene?.kind === "cap" && view.scene.phase === "ready");
  advance(sim, 21);
  assert.ok(sim.inspect().time - ignoredAt < 570, "the earlier snub has not expired");
  assertNoPettyExit(sim, 30);
});

test("ignored cap invitations produce protests that commands can interrupt", () => {
  for (const level of [1, 2]) {
    const sim = secondInvitation(level);
    waitFor(sim, (view) => view.mood?.name === "offended", 30);
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

    switch (operation) {
      case "hide":
        sim.setVisible(false);
        advance(sim, 1000);
        sim.setVisible(true);
        break;

      case "pause":
        sim.configure({ paused: true });
        break;

      default:
        sim.action(operation);
    }

    assertNoPettyExit(sim, 30);
  }
});
