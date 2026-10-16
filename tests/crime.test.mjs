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

test("caper has inspect, trapped, running, shaking, and offended beats", () => {
  const sim = setup();
  emptyBag(sim);
  const bagId = sim.inspect().bag.id;
  sim.action("bag_caper");
  const phases = new Set(),
    poses = new Set(),
    panicPositions = new Set();

  for (let i = 0; i < 520; i++) {
    phases.add(sim.inspect().scene?.phase);
    poses.add(sim.inspect().pose);

    if (sim.inspect().scene?.phase === "panic") {
      panicPositions.add(Math.round(sim.inspect().x));
    }

    sim.step(0.05);
    assert.ok(
      sim.inspect().x >= 0 && sim.inspect().x <= sim.inspect().width - 96,
    );
    assert.ok(
      sim.inspect().y >= 0 && sim.inspect().y <= sim.inspect().height - 96,
    );
    assert.ok(
      sim.inspect().bag.x >= 0 &&
        sim.inspect().bag.x <= sim.inspect().width - 48,
    );
    assert.ok(
      sim.inspect().bag.y >= 0 &&
        sim.inspect().bag.y <= sim.inspect().height - 48,
    );
  }

  for (const phase of ["inspect", "trapped", "panic", "shake", "offended"]) {
    assert.ok(phases.has(phase), phase);
  }

  for (const pose of [
    "bag-inspect",
    "bag-trapped",
    "bag-panic",
    "bag-shake",
    "bag-offended",
  ]) {
    assert.ok(poses.has(pose), pose);
  }

  assert.ok(panicPositions.size > 20);
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

test("every attached crime beat can be replaced or cleaned without a stale prop", () => {
  for (const [action, phases] of [
    ["steal_bag", ["grab", "drag", "suspicious"]],
    ["bag_caper", ["trapped", "panic", "shake"]],
  ]) {
    for (const phase of phases) {
      for (const replacement of ["feed", "place_bag", "clean", "nap"]) {
        const sim = setup();
        sim.action(action);
        until(sim, phase);
        const oldBag = sim.inspect().bag;
        sim.action(replacement);

        if (sim.inspect().bag) {
          assert.equal(sim.inspect().bag.attached, false);
        }

        assert.notEqual(sim.inspect().scene?.kind, "theft");
        assert.notEqual(sim.inspect().scene?.kind, "caper");

        if (replacement === "clean") {
          assert.equal(sim.inspect().bag, null);
        }

        if (replacement === "place_bag") {
          assert.notEqual(sim.inspect().bag.id, oldBag.id);
        }

        advance(sim, 20);
        assert.notEqual(sim.inspect().scene?.kind, "theft");
        assert.notEqual(sim.inspect().scene?.kind, "caper");
      }
    }
  }
});

test("crime actions without a bag give feedback, and resize bounds attached props", () => {
  const sim = setup();
  sim.action("clean");

  for (const action of ["steal_bag", "bag_caper", "caught"]) {
    sim.action(action);
    assert.equal(sim.inspect().scene, null);
    assert.ok(sim.inspect().bubble);
  }

  for (const action of ["steal_bag", "bag_caper"]) {
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
