import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { nestTreasureRects } from "../web-dist/simulation/behaviors/nest-play.js";
import { advance, reach } from "./simulation-helpers.mjs";

function bird(mischief = 2, random = 0) {
  const sim = new Gullbert(800, 600, () => random);
  sim.configure({ mischief });
  sim.restoreMemory({
    collection: { shell: 1 },
    nest: { x: 100, y: 200, items: ["shell"] },
  });
  sim.action("summon", { x: 148, y: 248 });
  return sim;
}

function throwTreasure(sim, destination = { x: 240, y: 280 }) {
  const rect = nestTreasureRects(sim.exportMemory().nest)[0];
  assert.ok(sim.beginPickup({ x: rect.x + 12, y: rect.y + 12 }, 100));
  sim.movePickup(destination);
  return sim.finishPickup(false, 200);
}

function finishNestPlay(sim) {
  for (let tick = 0; tick < 600 && sim.inspect().scene?.kind === "nest_play"; tick++) {
    sim.step(0.05);
  }

  assert.notEqual(sim.inspect().scene?.kind, "nest_play");
}

function disturbTwice(sim) {
  sim.action("nap");
  throwTreasure(sim);
  reach(sim, "home");

  finishNestPlay(sim);

  return throwTreasure(sim);
}

test("throwing a nest treasure plays fetch without changing ownership", () => {
  const sim = bird();
  const saved = sim.exportMemory().collection;
  throwTreasure(sim);
  assert.equal(sim.inspect().scene.phase, "toss");
  assert.equal(sim.present().borrowedNestSlot, 0);
  assert.equal(sim.present().props[0].asset, "shell");
  reach(sim, "ready");
  assert.deepEqual(sim.exportMemory().collection, saved);
  assert.equal(sim.inspect().scene.rounds, 1);
  const point = sim.inspect().scene.point;
  assert.ok(sim.treasureRect(point));
  assert.ok(sim.beginPickup(point, 300));
  sim.movePickup({ x: 380, y: 300 });
  sim.finishPickup(false, 400);
  reach(sim, "ready");
  assert.equal(sim.inspect().scene.rounds, 2);
  advance(sim, 12);
  assert.notEqual(sim.inspect().scene?.kind, "nest_play");
  assert.equal(sim.present().borrowedNestSlot, null);
  assert.deepEqual(sim.exportMemory().collection, saved);
});

test("repeated disturbance after sleepy retrieval causes exactly four flyby drops", () => {
  const sim = bird();
  const reaction = disturbTwice(sim);
  assert.ok(reaction);
  assert.ok(sim.currentReaction(reaction));
  assert.equal(sim.reactionMovesCursor(), false);
  assert.equal(sim.inspect().scene.revenge, "flyby");
  reach(sim, "flyby");
  assert.equal(sim.present().borrowedNestSlot, null);
  advance(sim, 2.5);
  assert.equal(sim.inspect().splats.length, 4);
  assert.equal(sim.inspect().mood.name, "smug");
  assert.equal(sim.currentReaction(reaction), false);
  assert.deepEqual(sim.exportMemory().collection, { shell: 1 });
});

test("cursor revenge preserves authorization and throws for at most two seconds", () => {
  const sim = bird(2, 0.9);
  const reaction = disturbTwice(sim);
  assert.equal(sim.reactionMovesCursor(), true);
  assert.equal(sim.armReaction(reaction, 42), true);
  reach(sim, "stare");
  assert.equal(sim.inspect().scene.kind, "cursor");
  assert.equal(sim.inspect().scene.cursorId, 42);
  assert.equal(sim.currentReaction(reaction), true);
  const view = sim.inspect();
  sim.pointer({ x: view.x + 78, y: view.y + 48 });
  reach(sim, "chew");
  assert.equal(sim.cursorEncounter().holdMs, 2000);
  const caught = sim.cursorEncounter().beak;
  advance(sim, 1.9);
  assert.equal(sim.inspect().scene.phase, "chew");
  assert.ok(sim.cursorEncounter().beak.x > caught.x + 20);
  assert.ok(Math.hypot(
    sim.cursorEncounter().beak.x - caught.x,
    sim.cursorEncounter().beak.y - caught.y,
  ) < 80);
  advance(sim, 0.2);
  assert.equal(sim.inspect().scene.phase, "recoil");
  sim.action("cancel");
  assert.equal(sim.currentReaction(reaction), false);
});

for (const mischief of [0, 1]) {
  test(`mischief ${mischief} retrieves disturbed treasures without a tantrum`, () => {
    const sim = bird(mischief);
    assert.equal(disturbTwice(sim), null);
    assert.equal(sim.inspect().scene.revenge, "none");
    reach(sim, "home");
    advance(sim, 2);
    assert.equal(sim.inspect().splats.length, 0);
    assert.equal(sim.cursorEncounter(), null);
  });
}

for (const [reason, interrupt] of [
  ["cancel", (sim) => sim.action("cancel")],
  ["hide", (sim) => sim.setVisible(false)],
  ["pause", (sim) => sim.configure({ paused: true })],
  ["remove", (sim) => sim.action("clear_nest")],
  ["feed", (sim) => sim.action("feed")],
]) {
  test(`${reason} ends a borrowed treasure's lifecycle without losing it`, () => {
    const sim = bird();
    throwTreasure(sim);
    interrupt(sim);
    assert.notEqual(sim.inspect().scene?.kind, "nest_play");
    assert.equal(sim.present().borrowedNestSlot, null);
    assert.deepEqual(sim.exportMemory().collection, { shell: 1 });
  });
}

test("held treasures cancel cleanly and invalid moves cannot corrupt geometry", () => {
  const sim = bird();
  const point = { x: 115, y: 276 };
  assert.ok(sim.treasureRect(point));
  assert.ok(sim.interactionRects()
    .some((rect) => rect.x === 103));
  assert.ok(sim.beginPickup(point, 100));
  sim.movePickup({ x: NaN, y: 20 });
  assert.ok(Number.isFinite(sim.inspect().scene.point.x));
  sim.resize(100, 100);
  assert.ok(sim.inspect().scene.point.x <= 100);
  sim.finishPickup(true, 200);
  assert.equal(sim.present().borrowedNestSlot, null);
  assert.deepEqual(sim.exportMemory().collection, { shell: 1 });
  sim.configure({ paused: true });
  assert.equal(sim.treasureRect({ x: 19, y: 80 }), null);
});

test("a tantrum cooldown prevents repeated revenge", () => {
  const sim = bird();
  disturbTwice(sim);
  reach(sim, "flyby");
  advance(sim, 2.5);
  sim.action("nap");
  throwTreasure(sim);
  reach(sim, "home");

  finishNestPlay(sim);

  assert.equal(throwTreasure(sim), null);
  assert.equal(sim.inspect().scene.revenge, "none");
});

test("far throws on a large display reserve time for all four flyby drops", () => {
  const sim = bird();
  sim.resize(2560, 1440);
  sim.action("nap");
  throwTreasure(sim);
  finishNestPlay(sim);
  assert.ok(throwTreasure(sim, { x: 2200, y: 1100 }));
  reach(sim, "flyby");
  advance(sim, 2.5);
  assert.equal(sim.inspect().splats.length, 4);
  assert.deepEqual(sim.exportMemory().collection, { shell: 1 });
});
