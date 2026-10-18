import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { advance, reach } from "./simulation-helpers.mjs";

function bird() {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, mischief: 0 });
  return sim;
}

function drag(sim) {
  const rect = sim.pickupRect();
  const point = { x: rect.x + 30, y: rect.y + 30 };
  assert.equal(sim.beginPickup(point, 1000), true);
  sim.movePickup({ x: point.x + 20, y: point.y });
  sim.finishPickup(true, 1100);
}

test("Stop cancels a pending drop while preserving existing mess and remembered belongings", () => {
  const sim = bird();
  sim.restoreMemory({ perch: { x: 100, y: 200 }, collection: { bottle_cap: 2 } });
  const memory = sim.exportMemory();
  sim.splat({ x: 100, y: 100 });
  sim.action("place_bag", { x: 250, y: 350 });
  const bag = sim.inspect().bag;
  sim.action("poop", { x: 700, y: 200 });

  sim.action("cancel");
  advance(sim, 8);

  assert.deepEqual(sim.inspect().splats.map(({ x, y }) => ({ x, y })), [
    { x: 100, y: 100 },
  ]);
  assert.deepEqual(sim.inspect().bag, bag);
  assert.deepEqual(sim.exportMemory(), memory);
  assert.equal(sim.inspect().mode, "idle");
});

test("replacing an offered chip with a nap cannot finish the abandoned meal", () => {
  const sim = bird();
  sim.action("feed_here", { x: 800, y: 100 });
  sim.action("nap");
  advance(sim, 15);

  assert.equal(sim.inspect().crumb, null);
  assert.equal(sim.drainSounds()
    .includes("munch"), false);
  assert.equal(sim.exportMemory().episodes.some((episode) => episode.kind === "meal"), false);
});

test("tidying during a gift reveal removes the gift before it enters the collection", () => {
  const sim = bird();
  sim.action("bring_gift");
  reach(sim, "reveal");
  sim.action("tidy");
  advance(sim, 35);

  assert.deepEqual(sim.exportMemory().collection, {});
  assert.deepEqual(sim.present().props, []);
});

test("dragging a returning gift cancels delivery without leaving a reward behind", () => {
  const sim = bird();
  sim.action("bring_gift");
  reach(sim, "land");
  drag(sim);
  advance(sim, 30);

  assert.deepEqual(sim.exportMemory().collection, {});
  assert.deepEqual(sim.present().props, []);
});

test("entering tidy mode during takeoff prevents a delayed drop", () => {
  const sim = bird();
  sim.action("poop", { x: 800, y: 100 });
  sim.action("tidy");
  advance(sim, 10);

  assert.deepEqual(sim.inspect().splats, []);
});

test("picking loose objects during a flight allows the requested drop to finish", () => {
  const sim = bird();
  sim.splat({ x: 100, y: 100 });
  sim.splat({ x: 200, y: 100 });
  sim.action("poop", { x: 800, y: 100 });
  sim.action("direct_pick", { x: 100, y: 100 });
  sim.action("tidy_pick", { x: 200, y: 100 });
  sim.action("tidy_done");
  advance(sim, 8);

  assert.deepEqual(sim.inspect().splats.map(({ x, y }) => ({ x, y })), [
    { x: 800, y: 100 },
  ]);
});

test("ending a guest visit starts one cooldown that repeated Stop commands cannot extend", () => {
  const sim = bird();
  sim.action("gull_argument");
  sim.action("cancel");
  const nextGuest = sim.inspect().nextGuest;
  assert.ok(nextGuest > sim.inspect().time);

  advance(sim, 10);
  sim.action("cancel");
  assert.equal(sim.inspect().nextGuest, nextGuest);
  assert.deepEqual(sim.present().props, []);
});

test("reapplying the same mischief level preserves dragging and the resulting cursor chase", () => {
  const sim = bird();
  sim.configure({ paused: false, mischief: 2 });
  const rect = sim.pickupRect();
  const point = { x: rect.x + 30, y: rect.y + 30 };
  sim.beginPickup(point, 1000);
  sim.movePickup({ x: point.x + 20, y: point.y });

  sim.configure({ mischief: 2 });
  assert.equal(sim.status().dragged, true);
  sim.finishPickup(false, 1100);
  advance(sim, 0.75);
  assert.equal(sim.inspect().scene?.kind, "cursor");

  sim.configure({ mischief: 2 });
  assert.equal(sim.reactionMovesCursor(), true);

  sim.configure({ mischief: 1 });
  assert.equal(sim.reactionMovesCursor(), false);
});
