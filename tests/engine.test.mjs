import test from "node:test";
import assert from "node:assert/strict";
import { dropAt } from "./simulation-helpers.mjs";
import { Gullbert, SIZE } from "../web-dist/simulation/engine.js";
function advance(g, seconds) {
  for (let i = 0; i < seconds * 20; i++) g.step(0.05);
}
test("roaming stays on screen across tiny and large displays", () => {
  for (const [w, h] of [
    [100, 100],
    [1920, 1080],
    [3840, 2160],
  ]) {
    const g = new Gullbert(w, h, () => 0.4);
    for (let i = 0; i < 5000; i++) {
      g.step(0.05);
      assert.ok(g.inspect().x >= 0 && g.inspect().x <= w - SIZE);
      assert.ok(g.inspect().y >= 0 && g.inspect().y <= h - SIZE);
    }
  }
});
test("summon clamps screen corners and cancels previous tasks", () => {
  const g = new Gullbert();
  g.action("feed");
  g.action("summon", { x: -100, y: 99999 });
  assert.equal(g.inspect().x, 0);
  assert.equal(g.inspect().y, g.inspect().height - SIZE);
  assert.equal(g.inspect().crumb, null);
  assert.equal(g.inspect().goal, null);
});
test("a chip is reached, eaten and removed", () => {
  const g = new Gullbert(800, 600, () => 0.5);
  g.configure({ paused: true, mischief: 0, sound: false });
  g.action("feed");
  assert.ok(g.inspect().crumb);
  advance(g, 12);
  assert.equal(g.inspect().crumb, null);
  assert.equal(g.inspect().mode, "idle");
  assert.ok(g.inspect().events.includes("munch"));
});
test("targeted poop lands at the requested point, then expires", () => {
  const g = new Gullbert(800, 600, () => 0.5);
  g.configure({ paused: true, mischief: 0, sound: false });
  g.action("poop", { x: 600, y: 400 });
  advance(g, 6);
  assert.equal(g.inspect().splats.length, 1);
  assert.equal(g.inspect().splats[0].x, 600);
  assert.equal(g.inspect().splats[0].y, 400);
  advance(g, 41);
  assert.equal(g.inspect().splats.length, 0);
});
test("splats have a hard upper bound and cleaning cancels pending drops", () => {
  const g = new Gullbert();
  g.configure({ paused: true });
  for (let i = 0; i < 20; i++) dropAt(g, { x: 10, y: 100 });
  assert.equal(g.inspect().splats.length, 6);
  g.action("poop");
  g.action("clean");
  advance(g, 1);
  assert.equal(g.inspect().splats.length, 0);
  assert.equal(g.inspect().pendingPoop, null);
});
test("pause stops autonomous movement and mischief but permits explicit actions", () => {
  const g = new Gullbert();
  g.configure({ paused: true, mischief: 2, sound: false });
  const p = [g.inspect().x, g.inspect().y];
  advance(g, 120);
  assert.deepEqual([g.inspect().x, g.inspect().y], p);
  assert.equal(g.inspect().splats.length, 0);
  g.action("squawk");
  assert.equal(g.inspect().mode, "squawk");
});
test("resizing clamps an in-flight destination", () => {
  const g = new Gullbert(1920, 1080);
  g.action("poop", { x: 1800, y: 900 });
  g.resize(400, 300);
  advance(g, 4);
  assert.ok(g.inspect().x <= 304 && g.inspect().y <= 204);
  assert.equal(g.inspect().splats.length, 1);
  assert.ok(g.inspect().splats[0].x <= 400 && g.inspect().splats[0].y <= 300);
});
test("suspension cannot create a backlog of pranks", () => {
  const g = new Gullbert();
  g.step(10000);
  assert.equal(g.inspect().time, 0.1);
  assert.equal(g.inspect().splats.length, 0);
});
test("poop run takes off, flaps, drops and lands at a grounded pose", () => {
  const g = new Gullbert(800, 600, () => 0.5);
  g.configure({ paused: true, mischief: 0, sound: false });
  g.action("poop", { x: 600, y: 400 });
  assert.equal(g.inspect().mode, "takeoff");
  const modes = new Set();
  for (let i = 0; i < 120; i++) {
    modes.add(g.inspect().mode);
    g.step(0.05);
  }
  for (const mode of ["takeoff", "fly", "drop", "land", "proud", "idle"])
    assert.ok(modes.has(mode), mode);
  assert.equal(g.inspect().y, 314);
  assert.equal(g.inspect().flight, null);
  assert.deepEqual(
    [g.inspect().splats[0].x, g.inspect().splats[0].y],
    [600, 400],
  );
});
test("every flight phase can be replaced without a delayed gift", () => {
  for (const phase of ["takeoff", "fly", "drop", "land"]) {
    const g = new Gullbert(800, 600, () => 0.5);
    g.configure({ paused: true, mischief: 0, sound: false });
    g.action("poop", { x: 600, y: 400 });
    for (let i = 0; i < 100 && g.inspect().mode !== phase; i++) g.step(0.05);
    assert.equal(g.inspect().mode, phase);
    const gifts = g.inspect().splats.length;
    g.action("nap");
    assert.equal(g.inspect().flight, null);
    assert.equal(g.inspect().pendingPoop, null);
    advance(g, 20);
    assert.equal(g.inspect().splats.length, gifts);
    assert.equal(g.inspect().mode, "idle");
  }
});
test("explicit commands wake naps and interrupt quiet routines", () => {
  for (const routine of ["nap", "preen", "tilt", "stretch"]) {
    const g = new Gullbert(800, 600, () => 0.5);
    g.configure({ paused: true, mischief: 0, sound: false });
    g.action(routine);
    advance(g, 1);
    assert.equal(g.inspect().mode, routine);
    g.action("feed");
    assert.equal(g.inspect().quiet, null);
    assert.equal(g.inspect().mode, "fetch");
    advance(g, 12);
    assert.equal(g.inspect().mode, "idle");
  }
});
test("walking cadence follows chase speed and stops at idle", () => {
  const g = new Gullbert(1000, 700, () => 0.5);
  g.configure({ paused: false, mischief: 0, sound: false });
  while (g.inspect().mode !== "walk") g.step(0.05);
  g.step(0.1);
  assert.equal(g.inspect().pose, "idle");
  g.action("feed_here", { x: 950, y: 600 });
  g.step(0.1);
  assert.equal(g.inspect().pose, "walkLeft");
  g.action("cancel");
  assert.equal(g.inspect().pose, "idle");
});
test("resizing during landing keeps every landing step inside the screen", () => {
  const g = new Gullbert(1920, 1080, () => 0.5);
  g.configure({ paused: true, mischief: 0, sound: false });
  g.action("poop", { x: 1800, y: 900 });
  for (let i = 0; i < 200 && g.inspect().mode !== "land"; i++) g.step(0.05);
  assert.equal(g.inspect().mode, "land");
  g.resize(400, 300);
  for (let i = 0; i < 20; i++) {
    g.step(0.05);
    assert.ok(g.inspect().y >= 0 && g.inspect().y <= 204);
  }
});
