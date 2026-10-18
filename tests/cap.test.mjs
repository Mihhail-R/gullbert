import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";

function setup(width = 900, height = 650) {
  const sim = new Gullbert(width, height, () => 0.5);
  sim.configure({ paused: true, mischief: 0 });
  return sim;
}

function advance(sim, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 20); i++) {
    sim.step(0.05);
  }
}

function until(sim, phase) {
  for (let i = 0; i < 400 && sim.inspect().scene?.phase !== phase; i++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().scene?.phase, phase);
}

function ready(sim) {
  sim.action("play_cap");
  until(sim, "ready");
}

function click(sim) {
  const cap = sim.inspect().scene.cap;
  assert.equal(sim.flickCap(cap), true);
}

function reachPhase(sim, phase) {
  sim.action("play_cap");

  if (phase === "drop") {
    return;
  }

  until(sim, "ready");

  if (phase === "ready") {
    return;
  }

  click(sim);

  if (["chase", "peck", "return"].includes(phase)) {
    until(sim, phase);
    return;
  }

  for (let round = 1; round < 3; round++) {
    until(sim, "ready");
    click(sim);
  }

  until(sim, phase);
}

test("cap football waits for a click on the cap before starting an exchange", () => {
  const sim = setup();
  sim.action("play_cap");
  assert.equal(sim.flickCap(sim.inspect().scene.cap), false, "the cap is still dropping");
  until(sim, "ready");
  const cap = sim.inspect().scene.cap;
  assert.equal(sim.present().props[0].asset, "bottle_cap");

  for (const point of [
    { x: cap.x + 25, y: cap.y },
    { x: NaN, y: cap.y },
    { x: cap.x, y: Infinity },
  ]) {
    assert.equal(sim.flickCap(point), false);
  }

  advance(sim, 3);
  assert.equal(sim.inspect().scene.phase, "ready");
  assert.deepEqual(sim.inspect().scene.cap, cap);
  assert.equal(sim.flickCap(cap), true);
  assert.equal(sim.inspect().scene.phase, "chase");
});

test(
  "a flick slides the cap, the gull runs after it, and his peck returns it toward " +
  "the latest pointer",
  () => {
    const sim = setup();
    ready(sim);
    const cap = sim.inspect().scene.cap;
    click(sim);
    assert.equal(sim.inspect().scene.phase, "chase");
    assert.equal(
      sim.flickCap(cap),
      false,
      "in-flight cap cannot be clicked again",
    );
    assert.equal(
      sim.present().hitRegions.some((rect) => rect.width === 48),
      false,
      "the in-flight cap releases its input region",
    );
    const before = sim.inspect();
    sim.step(0.1);
    const after = sim.inspect();
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) >= 30);
    assert.ok(
      Math.hypot(after.scene.cap.x - cap.x, after.scene.cap.y - cap.y) >= 50,
    );
    sim.pointer({ x: 180, y: 160 });
    until(sim, "peck");
    assert.equal(sim.inspect().pose, "nibble");
    const pointer = { x: 240, y: 220 };
    sim.pointer(pointer);
    until(sim, "return");
    assert.equal(sim.inspect().scene.rounds, 1);
    assert.deepEqual(sim.inspect().scene.target, pointer);
    const returnFrom = sim.inspect().scene.cap;
    sim.step(0.1);
    const returning = sim.inspect().scene.cap;
    assert.ok(
      Math.hypot(returning.x - pointer.x, returning.y - pointer.y) <
      Math.hypot(returnFrom.x - pointer.x, returnFrom.y - pointer.y),
    );
    until(sim, "ready");
    assert.deepEqual(sim.inspect().scene.cap, pointer);
    advance(sim, 3);
    assert.equal(sim.inspect().scene.phase, "ready");
    assert.equal(sim.inspect().scene.rounds, 1);
  }
);

test("three clicked exchanges end with him carrying the cap away and declaring victory", () => {
  const sim = setup();
  ready(sim);

  for (let round = 1; round <= 3; round++) {
    const cap = sim.inspect().scene.cap;
    sim.action("direct_pick", cap);
    assert.equal(sim.inspect().scene.phase, "chase");
    sim.pointer({ x: 250 + round * 90, y: 350 });
    until(sim, "return");
    assert.equal(sim.inspect().scene.rounds, round);

    if (round < 3) {
      until(sim, "ready");
    }
  }

  until(sim, "collect");
  until(sim, "victory");
  assert.equal(sim.inspect().scene.carrying, true);
  assert.equal(sim.inspect().bubble, "i win.");
  const position = sim.inspect().x;
  advance(sim, 0.4);
  assert.ok(Math.abs(sim.inspect().x - position) > 50);
  const carried = sim.present().props[0];
  const beakX = sim.inspect().facing === 1 ? 78 : 18;
  assert.equal(carried.x + carried.width / 2, sim.inspect().x + beakX);
  assert.equal(carried.y + carried.height / 2, sim.inspect().y + 42);

  advance(sim, 1.2);
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().wantsPointer, false);
  assert.deepEqual(sim.present().props, []);
  assert.equal(sim.inspect().bubble, "i win.");
  const saved = sim.exportMemory();
  assert.equal(saved.episodes.at(-1).kind, "play");
  assert.equal(saved.episodes.at(-1).detail, "cap");
});

test("click side controls the flick and a kick at a screen edge rebounds inward", () => {
  for (const side of [-1, 1]) {
    const sim = setup();
    ready(sim);
    const cap = sim.inspect().scene.cap;
    assert.equal(sim.flickCap({ x: cap.x + side * 10, y: cap.y }), true);
    assert.equal(Math.sign(sim.inspect().scene.target.x - cap.x), -side);
  }

  const sim = setup();
  sim.action("summon", { x: 900, y: 500 });
  ready(sim);
  const cap = sim.inspect().scene.cap;
  assert.equal(cap.x, 876);
  assert.equal(sim.flickCap({ x: cap.x - 10, y: cap.y }), true);
  assert.ok(sim.inspect().scene.target.x < cap.x);
  until(sim, "ready");
  assert.equal(sim.inspect().scene.rounds, 1);
});

test("missing or invalid pointer samples retain the last valid return destination", () => {
  const sim = setup();
  ready(sim);
  click(sim);
  const pointer = { x: 160, y: 260 };
  sim.pointer(pointer);

  for (const sample of [
    null,
    { x: 100, y: 200, inside: false },
    { x: NaN, y: 10 },
    { x: -1, y: 100 },
    { x: 2000, y: 100 },
  ]) {
    sim.pointer(sample);
  }

  until(sim, "ready");
  assert.deepEqual(sim.inspect().scene.cap, pointer);
});

for (const [phase, operation] of [
  ["ready", "cancel"],
  ["chase", "hide"],
  ["return", "feed"],
  ["victory", "pause"],
]) {
  test(`${operation} ends cap football during ${phase} and releases its input`, () => {
    const sim = setup();
    reachPhase(sim, phase);
    const cap = sim.inspect().scene.cap;

    switch (operation) {
      case "hide":
        sim.setVisible(false);
        break;

      case "pause":
        sim.configure({ paused: true });
        break;

      default:
        sim.action(operation);
        break;
    }

    assert.deepEqual(sim.present().props, []);
    assert.equal(sim.inspect().wantsPointer, false);
    assert.equal(sim.flickCap(cap), false);
    sim.setVisible(true);
    advance(sim, 20);
    assert.notEqual(sim.inspect().scene?.kind, "cap");
  });
}

test("resizing a waiting or moving cap keeps it on screen until the game ends", () => {
  for (const phase of ["ready", "return"]) {
    const sim = setup(2400, 1400);
    reachPhase(sim, phase);
    sim.resize(100, 100);
    const cap = sim.present().props[0];
    assert.ok(cap.x >= 0 && cap.x + cap.width <= 100, phase);
    assert.ok(cap.y >= 0 && cap.y + cap.height <= 100, phase);

    for (let i = 0; i < 400; i++) {
      sim.step(0.05);
      const view = sim.inspect();
      assert.ok(view.x >= 0 && view.x <= 4, phase);
      assert.ok(view.y >= 0 && view.y <= 4, phase);

      for (const prop of sim.present().props) {
        assert.ok(prop.x >= 0 && prop.x + prop.width <= 100, phase);
        assert.ok(prop.y >= 0 && prop.y + prop.height <= 100, phase);
      }
    }

    assert.equal(sim.inspect().scene, null, phase);
    assert.deepEqual(sim.present().props, []);
  }
});

test("an untouched game times out, and restarting never preserves its old cap or rounds", () => {
  const sim = setup();
  ready(sim);
  click(sim);
  until(sim, "ready");
  assert.equal(sim.inspect().scene.rounds, 1);
  sim.action("play_cap");
  assert.equal(sim.inspect().scene.rounds, 0);
  assert.equal(sim.present().props.length, 1);
  advance(sim, 25);
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().wantsPointer, false);
  assert.deepEqual(sim.present().props, []);
});
