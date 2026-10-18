import test from "node:test";
import assert from "node:assert/strict";
import { emptyBag } from "./simulation-helpers.mjs";
import { Gullbert } from "../web-dist/simulation/engine.js";

function setup(width = 900, height = 650) {
  const sim = new Gullbert(width, height, () => 0.5);
  sim.configure({ paused: true, mischief: 0, sound: false });
  sim.action("place_bag", { x: width / 2, y: height / 2 });
  return sim;
}
function advance(sim, seconds) {
  for (let i = 0; i < seconds * 20; i++) {
    sim.step(0.05);
  }
}
function until(sim, phase) {
  for (let i = 0; i < 600 && sim.inspect().scene?.phase !== phase; i++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().scene?.phase, phase);
}

test("theft grips the existing bag, freezes when caught, resumes and releases", () => {
  const sim = setup();
  const bagId = sim.inspect().bag.id;
  sim.action("steal_bag");
  until(sim, "drag");
  advance(sim, 0.5);
  assert.equal(sim.inspect().bag.id, bagId);
  assert.equal(sim.inspect().bag.attached, true);
  sim.action("caught");
  const position = [
    sim.inspect().x,
    sim.inspect().y,
    sim.inspect().bag.x,
    sim.inspect().bag.y,
  ];
  advance(sim, 1.5);
  assert.deepEqual(
    [
      sim.inspect().x,
      sim.inspect().y,
      sim.inspect().bag.x,
      sim.inspect().bag.y,
    ],
    position,
  );
  assert.equal(sim.inspect().pose, "theft-innocent");
  advance(sim, 1.2);
  assert.notEqual(sim.inspect().x, position[0]);
  advance(sim, 20);
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().bag.id, bagId);
  assert.equal(sim.inspect().bag.attached, false);
});

test("a bag caper traps Gullbert, sends him running and releases the same empty bag", () => {
  const sim = setup();
  emptyBag(sim);
  const bagId = sim.inspect().bag.id;
  sim.action("bag_caper");
  until(sim, "trapped");
  assert.equal(sim.inspect().bag.attached, true);
  assert.equal(sim.present().pose, "bag-trapped");

  until(sim, "panic");
  const position = sim.inspect().x;
  advance(sim, 0.5);
  assert.notEqual(sim.inspect().x, position);

  advance(sim, 20);
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().bag.id, bagId);
  assert.equal(sim.inspect().bag.attached, false);
  assert.equal(sim.inspect().bag.servings, 0);
});

test("short thefts at either display edge still pause suspiciously", () => {
  for (const x of [20, 880]) {
    const sim = setup();
    sim.action("place_bag", { x, y: 300 });
    sim.action("steal_bag");
    until(sim, "suspicious");
    assert.equal(sim.inspect().bag.attached, true);
    advance(sim, 15);
    assert.equal(sim.inspect().scene, null);
    assert.equal(sim.inspect().bag.attached, false);
  }
});

for (const [action, phase, replacement] of [
  ["steal_bag", "drag", "feed"],
  ["steal_bag", "suspicious", "place_bag"],
  ["bag_caper", "trapped", "clean"],
  ["bag_caper", "panic", "nap"],
]) {
  test(`${replacement} releases the bag during ${action}`, () => {
    const sim = setup();
    sim.action(action);
    until(sim, phase);
    const oldBagId = sim.inspect().bag.id;
    sim.action(replacement);

    if (replacement === "clean") {
      assert.equal(sim.inspect().bag, null);
    } else {
      assert.equal(sim.inspect().bag.attached, false);
    }

    if (replacement === "place_bag") {
      assert.notEqual(sim.inspect().bag.id, oldBagId);
    }

    advance(sim, 20);
    assert.equal(sim.inspect().scene, null);
  });
}

test("crime actions without a bag give feedback without starting a routine", () => {
  const sim = setup();
  sim.action("clean");

  for (const action of ["steal_bag", "bag_caper", "caught"]) {
    sim.action(action);
    assert.equal(sim.inspect().scene, null);
    assert.ok(sim.inspect().bubble);
  }
});

test("resizing while a bag is attached keeps it on screen and eventually releases it", () => {
  for (const action of ["steal_bag", "bag_caper"]) {
    const sim = setup();
    sim.action("place_bag");
    sim.action(action);
    until(sim, action === "steal_bag" ? "drag" : "panic");
    sim.resize(100, 100);

    for (let i = 0; i < 400; i++) {
      sim.step(0.05);
      assert.ok(sim.inspect().x >= 0 && sim.inspect().x <= 4);
      assert.ok(sim.inspect().y >= 0 && sim.inspect().y <= 4);
      assert.ok(sim.inspect().bag.x >= 0 && sim.inspect().bag.x <= 52);
      assert.ok(sim.inspect().bag.y >= 0 && sim.inspect().bag.y <= 52);
    }

    assert.equal(sim.inspect().bag.attached, false);
  }
});
