import test from "node:test";
import assert from "node:assert/strict";
import { advance, reach } from "./simulation-helpers.mjs";
import { encoreFixture, idleFor } from "./recall-fixture.mjs";

for (const trick of ["spin", "dead"]) {
  test(`${trick} encore performs, looks pleased for three seconds and settles without debt`, () => {
    const { sim } = encoreFixture(trick);
    const before = sim.exportMemory();
    idleFor(sim, 121);
    assert.equal(sim.inspect().scene?.purpose, "encore");
    assert.equal(sim.inspect().scene?.trick, trick);
    advance(sim, 1);

    if (trick === "dead") {
      assert.ok(Math.abs(sim.present().rotation) >= 80);
    }

    reach(sim, "pleased");
    assert.equal(sim.present().pose, "blink");
    assert.equal(sim.present().rotation, 0);
    advance(sim, 2.9);
    assert.equal(sim.inspect().scene?.phase, "pleased");
    advance(sim, 0.2);
    assert.equal(sim.inspect().scene, null);
    const after = sim.exportMemory();
    assert.deepEqual(after.performances, before.performances);
    assert.deepEqual(after.learned.tricks, before.learned.tricks);
    assert.equal(after.unpaidTricks, 0);
    assert.equal(after.trickRefusals, 0);
    assert.equal(after.episodes.filter((event) => event.kind === "recall").length, 1);
    assert.equal(after.episodes.filter((event) => event.kind === "trick").length, 0);
    idleFor(sim, 400);
    assert.equal(sim.exportMemory().trickRefusals, 0);
    assert.equal(sim.inspect().scene, null);
  });
}

test("snacking during an encore is an ordinary meal and cannot reinforce it", () => {
  const { sim } = encoreFixture("spin");
  idleFor(sim, 121);
  reach(sim, "pleased");
  const before = sim.exportMemory();
  sim.action("feed");
  advance(sim, 4);
  const after = sim.exportMemory();
  assert.deepEqual(after.learned.tricks, before.learned.tricks);
  assert.deepEqual(after.longTerm.tricks, before.longTerm.tricks);
  assert.equal(after.episodes.filter((event) => event.kind === "recall").length, 0);
  assert.equal(after.episodes.filter((event) => event.kind === "meal").length, 1);
});

test("an encore can repeat after seven elapsed days but not earlier", () => {
  const { sim, advanceDays } = encoreFixture("dead");
  idleFor(sim, 121);
  advance(sim, 8);
  assert.equal(sim.exportMemory().episodes.filter((event) => event.kind === "recall").length, 1);
  advanceDays(6);
  idleFor(sim, 301);
  assert.notEqual(sim.inspect().scene?.purpose, "encore");
  advanceDays(1);
  idleFor(sim, 301);
  assert.equal(sim.inspect().scene?.purpose, "encore");
});

test("an interrupted encore consumes its daily allowance without a recall or invitation", () => {
  for (const command of ["cancel", "forget_learning", "nap"]) {
    const { sim } = encoreFixture("spin");
    idleFor(sim, 121);
    sim.action(command);
    advance(sim, 10);
    idleFor(sim, 400);
    const memory = sim.exportMemory();
    assert.equal(memory.episodes.filter((event) => event.kind === "recall").length, 0);
    assert.equal(memory.unpaidTricks, 0);
    assert.equal(memory.trickRefusals, 0);
  }
});
