import test from "node:test";
import assert from "node:assert/strict";
import { idleFor, keepsakeRecallFixture } from "./recall-fixture.mjs";
import { advance, reach } from "./simulation-helpers.mjs";
import { GiftRoutine } from "../web-dist/simulation/behaviors/gifts.js";
import { routineFixture } from "./routine-fixture.mjs";

function keepsakeFixture(item = "bent_spoon") {
  const { belongings, now } = keepsakeRecallFixture(item);
  const recall = belongings.reserveRecall(() => 0, ["treasure"]);
  assert.equal(recall?.memory.item, item);
  const sim = routineFixture(class extends GiftRoutine {
    constructor(environment) {
      environment.belongings = belongings;
      super(environment);
    }
  });
  return { sim, belongings, recall, now };
}

function reachPhase(sim, phase) {
  for (let tick = 0; tick < 500; tick++) {
    if (sim.scene?.phase === phase) {
      return;
    }

    sim.step(0.05);
  }

  assert.fail(`Keepsake retrieval did not reach ${phase}`);
}

function finish(sim) {
  for (let tick = 0; tick < 500 && sim.scene; tick++) {
    sim.step(0.05);
  }

  assert.equal(sim.scene, null);
}

test("retrieving an owned spoon carries its old item without another acquisition", () => {
  const { sim, belongings, recall } = keepsakeFixture();
  const before = structuredClone(belongings.snapshot().memory);
  assert.equal(sim.startRecall(recall), true);
  reachPhase(sim, "return");
  assert.equal(sim.scene.carrying, true);
  assert.equal(sim.scene.item, "bent_spoon");
  assert.equal(sim.bubble, "kept this.");
  reachPhase(sim, "reveal");
  assert.equal(sim.bubble, "still an excellent spoon.");
  assert.equal(belongings.snapshot().memory.episodes.at(-1).kind, "gift");
  finish(sim);

  const after = belongings.snapshot().memory;
  assert.deepEqual(after.collection, before.collection);
  assert.deepEqual(after.preferences.treasureAffection, before.preferences.treasureAffection);
  assert.equal(after.greetings.lastDiscovery, before.greetings.lastDiscovery);
  assert.deepEqual(after.episodes.filter((event) => event.kind === "gift"), before.episodes);
  assert.equal(after.episodes.filter((event) => event.kind === "recall").length, 1);
  assert.equal(after.episodes.some((event) => event.kind === "meal"), false);
});

for (const phase of ["away", "reveal"]) {
  test(`interrupting a keepsake in ${phase} consumes the reservation without a recall`, () => {
    const { sim, belongings, recall } = keepsakeFixture("sock");
    assert.equal(sim.startRecall(recall), true);
    reachPhase(sim, phase);
    sim.action("cancel");
    finish(sim);
    const memory = belongings.snapshot().memory;
    assert.deepEqual(memory.collection, { sock: 1 });
    assert.equal(memory.episodes.some((event) => event.kind === "recall"), false);
    assert.equal(belongings.reserveRecall(() => 0, ["treasure"]), null);
  });
}

test("a gift deadline does not record a successful keepsake recall", () => {
  const { sim, belongings, recall } = keepsakeFixture();
  sim.startRecall(recall);
  sim.time = 21;
  sim.step(0.05);
  assert.equal(sim.scene, null);
  assert.equal(
    belongings.snapshot().memory.episodes.some((event) => event.kind === "recall"),
    false,
  );
});

test("a keepsake removed before departure cannot start retrieval", () => {
  const { sim, belongings, recall } = keepsakeFixture();
  belongings.restore({ ...belongings.snapshot().memory, collection: {} });
  assert.equal(sim.startRecall(recall), false);
  assert.equal(sim.scene, null);
});

test("hidden retrieval resumes on a resized display with one successful recall", () => {
  const { sim, belongings, recall } = keepsakeFixture("parking_ticket");
  sim.startRecall(recall);
  reachPhase(sim, "away");
  sim.setVisible(false);
  sim.step(1000);
  assert.equal(sim.scene.phase, "away");
  sim.resize(100, 100);
  sim.setVisible(true);
  finish(sim);
  assert.ok(sim.x >= 0 && sim.x <= 4);
  assert.ok(sim.y >= 0 && sim.y <= 4);
  const memory = belongings.snapshot().memory;
  assert.deepEqual(memory.collection, { parking_ticket: 1 });
  assert.equal(memory.episodes.filter((event) => event.kind === "recall").length, 1);
});

test("removing a keepsake during its reveal cannot complete the old reservation", () => {
  const { sim, belongings, recall } = keepsakeFixture();
  sim.startRecall(recall);
  reachPhase(sim, "reveal");
  belongings.restore({ ...belongings.snapshot().memory, collection: {} });
  finish(sim);
  const memory = belongings.snapshot().memory;
  assert.deepEqual(memory.collection, {});
  assert.equal(memory.episodes.some((event) => event.kind === "recall"), false);
});

test("the idle scheduler retrieves the selected owned keepsake after launch grace", () => {
  const { sim, belongings } = keepsakeRecallFixture();
  const memory = belongings.exportMemory();
  idleFor(sim, 119);
  assert.notEqual(sim.inspect().scene?.purpose, "retrieve-keepsake");
  idleFor(sim, 2);
  assert.equal(sim.inspect().scene?.purpose, "retrieve-keepsake");
  assert.equal(sim.inspect().scene?.item, "bent_spoon");
  reach(sim, "reveal");
  assert.equal(sim.inspect().carriedItem, "bent_spoon");
  assert.equal(sim.present().bubble, "still an excellent spoon.");
  advance(sim, 3);
  const after = sim.exportMemory();
  assert.deepEqual(after.collection, memory.collection);
  assert.deepEqual(after.preferences.treasureAffection, memory.preferences.treasureAffection);
  assert.equal(after.greetings.lastDiscovery, memory.greetings.lastDiscovery);
  assert.equal(after.episodes.filter((event) => event.kind === "recall").length, 1);
});
