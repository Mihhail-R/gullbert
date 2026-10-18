import test from "node:test";
import assert from "node:assert/strict";
import { advance, dropAt } from "./simulation-helpers.mjs";
import { Gullbert, SIZE } from "../web-dist/simulation/engine.js";

function bird(width = 800, height = 600) {
  const sim = new Gullbert(width, height, () => 0.5);
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}

test("autonomous roaming fits a display only slightly larger than the bird", () => {
  const sim = bird(100, 100);
  sim.configure({ paused: false });
  advance(sim, 10);
  const { x, y } = sim.present();

  assert.ok(x >= 0 && x <= 100 - SIZE);
  assert.ok(y >= 0 && y <= 100 - SIZE);
});

test("summoning outside the screen clamps the bird and abandons its offered chip", () => {
  const sim = bird();
  sim.action("feed_here", { x: 700, y: 100 });
  sim.action("summon", { x: -100, y: 99999 });
  advance(sim, 8);

  const { x, y } = sim.present();
  assert.deepEqual({ x, y }, { x: 0, y: 600 - SIZE });
  assert.equal(sim.inspect().crumb, null);
  assert.equal(sim.drainSounds()
    .includes("munch"), false);
});

test("an offered chip is reached and eaten once before returning to idle", () => {
  const sim = bird();
  sim.action("feed_here", { x: 700, y: 400 });
  advance(sim, 12);

  assert.equal(sim.inspect().crumb, null);
  assert.equal(sim.inspect().mode, "idle");
  assert.deepEqual(sim.drainSounds(), ["munch"]);
});

test("a targeted drop lands at the requested point and expires after landing", () => {
  const sim = bird();
  sim.action("poop", { x: 600, y: 400 });
  advance(sim, 6);

  assert.deepEqual(sim.inspect().splats.map(({ x, y }) => ({ x, y })), [
    { x: 600, y: 400 },
  ]);
  assert.equal(sim.present().y, 314, "the bird returns to the ground below its flight");
  assert.equal(sim.inspect().mode, "idle");

  advance(sim, 41);
  assert.deepEqual(sim.inspect().splats, []);
});

test("the seventh drop replaces the oldest splat instead of accumulating unlimited mess", () => {
  const sim = bird();
  const first = dropAt(sim, { x: 100, y: 100 });

  for (let drop = 0; drop < 6; drop++) {
    dropAt(sim, { x: 100 + drop * 20, y: 100 });
  }

  const splats = sim.inspect().splats;
  assert.equal(splats.length, 6);
  assert.equal(splats.some((splat) => splat.id === first.id), false);
});

test("Clean removes current mess and prevents an already requested drop from returning", () => {
  const sim = bird();
  sim.splat({ x: 100, y: 100 });
  sim.action("poop", { x: 600, y: 400 });
  sim.action("clean");
  advance(sim, 10);

  assert.deepEqual(sim.inspect().splats, []);
});

test("pause stops autonomous movement and mischief while allowing an explicit squawk", () => {
  const sim = bird();
  sim.configure({ mischief: 2 });
  const { x, y } = sim.present();
  advance(sim, 120);
  const paused = sim.present();

  assert.deepEqual({ x: paused.x, y: paused.y }, { x, y });
  assert.deepEqual(sim.inspect().splats, []);

  sim.action("squawk");
  assert.equal(sim.inspect().mode, "squawk");
  assert.deepEqual(sim.drainSounds(), ["squawk"]);
});

test("a flight started on a larger display lands within its resized destination", () => {
  const sim = bird(1920, 1080);
  sim.action("poop", { x: 1800, y: 900 });
  sim.resize(400, 300);
  advance(sim, 6);

  const { x, y } = sim.present();
  assert.ok(x >= 0 && x <= 400 - SIZE);
  assert.ok(y >= 0 && y <= 300 - SIZE);
  assert.deepEqual(sim.inspect().splats.map(({ x, y }) => ({ x, y })), [
    { x: 392, y: 292 },
  ]);
});

test("resuming after suspension cannot instantly finish a pending flight", () => {
  const sim = bird();
  sim.action("poop", { x: 600, y: 400 });
  sim.step(10000);

  assert.equal(sim.inspect().mode, "takeoff");
  assert.deepEqual(sim.inspect().splats, []);

  advance(sim, 6);
  assert.equal(sim.inspect().splats.length, 1);
});

test("replacing a flight just before its drop prevents a delayed splat", () => {
  const sim = bird();
  sim.action("poop", { x: 600, y: 400 });

  for (let tick = 0; tick < 200 && sim.inspect().mode !== "drop"; tick++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().mode, "drop");
  sim.action("nap");
  advance(sim, 20);
  assert.deepEqual(sim.inspect().splats, []);
  assert.equal(sim.inspect().mode, "idle");
});

test("a chip chase moves faster than roaming, and Stop ends the chase", () => {
  const sim = bird(1000, 700);
  sim.configure({ paused: false });

  for (let tick = 0; tick < 200 && sim.inspect().mode !== "walk"; tick++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().mode, "walk");
  const walkingFrom = sim.present();
  sim.step(0.1);
  const walkedTo = sim.present();
  const walkingDistance = Math.hypot(walkedTo.x - walkingFrom.x, walkedTo.y - walkingFrom.y);

  sim.action("feed_here", { x: 950, y: 600 });
  sim.step(0.1);
  const chasedTo = sim.present();
  const chasingDistance = Math.hypot(chasedTo.x - walkedTo.x, chasedTo.y - walkedTo.y);
  assert.ok(chasingDistance > walkingDistance);

  sim.action("cancel");
  advance(sim, 1);
  const stopped = sim.present();
  assert.deepEqual({ x: stopped.x, y: stopped.y }, { x: chasedTo.x, y: chasedTo.y });
  assert.equal(stopped.pose, "idle");
});

test("shrinking the display during landing keeps the entire descent on screen", () => {
  const sim = bird(1920, 1080);
  sim.action("poop", { x: 1800, y: 900 });

  for (let tick = 0; tick < 200 && sim.inspect().mode !== "land"; tick++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().mode, "land");
  sim.resize(400, 300);

  for (let tick = 0; tick < 20; tick++) {
    sim.step(0.05);
    const { y } = sim.present();
    assert.ok(y >= 0 && y <= 300 - SIZE);
  }
});
