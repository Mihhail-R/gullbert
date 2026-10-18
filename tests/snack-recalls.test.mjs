import test from "node:test";
import assert from "node:assert/strict";
import { advance, reach } from "./simulation-helpers.mjs";
import { idleFor, snackRecallFixture } from "./recall-fixture.mjs";

test("old snack recall visits the archived place, tilts for two seconds and returns once", () => {
  const { sim } = snackRecallFixture();
  const before = sim.exportMemory();
  idleFor(sim, 121);
  assert.equal(sim.inspect().scene?.purpose, "old-snack-spot");
  reach(sim, "recall-tilt");
  assert.equal(sim.present().pose, "tilt");
  assert.ok(Math.abs(sim.inspect().x - 100) <= 1);
  advance(sim, 1.9);
  assert.equal(sim.inspect().scene.phase, "recall-tilt");
  assert.equal(sim.exportMemory().episodes.filter((event) => event.kind === "recall").length, 0);
  reach(sim, "recall-current");
  advance(sim, 8);
  const after = sim.exportMemory();
  assert.equal(after.episodes.filter((event) => event.kind === "recall").length, 1);
  assert.deepEqual(after.learned, before.learned);
  assert.deepEqual(after.performances, before.performances);
  assert.equal(after.episodes.filter((event) => event.kind === "meal").length, 6);
  idleFor(sim, 400);
  assert.notEqual(sim.inspect().scene?.purpose, "old-snack-spot");
});

test("launch and show grace counts only visible unpaused time", () => {
  const { sim } = snackRecallFixture();
  sim.configure({ paused: true });
  idleFor(sim, 200);
  assert.equal(sim.inspect().scene, null);
  sim.configure({ paused: false });
  idleFor(sim, 70);
  assert.equal(sim.inspect().scene, null);
  sim.setVisible(false);
  idleFor(sim, 200);
  sim.setVisible(true);
  idleFor(sim, 119);
  assert.equal(sim.inspect().scene, null);
  idleFor(sim, 2);
  assert.equal(sim.inspect().scene?.purpose, "old-snack-spot");
});

test("speech and cleanup block a recall without spending its allowance", () => {
  const { sim } = snackRecallFixture();
  sim.configure({ paused: true });
  idleFor(sim, 121);
  sim.configure({ paused: false });
  idleFor(sim, 119);
  sim.greet();
  advance(sim, 2);
  assert.notEqual(sim.inspect().scene?.purpose, "old-snack-spot");
  sim.action("tidy");
  advance(sim, 10);
  assert.notEqual(sim.inspect().scene?.purpose, "old-snack-spot");
  sim.action("tidy_done");
  idleFor(sim, 30);
  assert.equal(sim.inspect().scene?.purpose, "old-snack-spot");
});

test("interrupted snack recall spends the day but records no successful recall", () => {
  for (const interruption of ["cancel", "hide", "pause", "feed"]) {
    const { sim } = snackRecallFixture();
    idleFor(sim, 121);
    reach(sim, "recall-tilt");

    switch (interruption) {
      case "hide":
        sim.setVisible(false);
        sim.setVisible(true);
        break;

      case "pause":
        sim.configure({ paused: true });
        sim.configure({ paused: false });
        break;

      default:
        sim.action(interruption);
    }

    advance(sim, 10);
    idleFor(sim, 400);
    assert.notEqual(sim.inspect().scene?.purpose, "old-snack-spot", interruption);
    assert.equal(
      sim.exportMemory().episodes.filter((event) => event.kind === "recall").length,
      0,
      interruption,
    );
  }
});

test("snack recall clamps its remaining route after a display resize", () => {
  const { sim } = snackRecallFixture();
  idleFor(sim, 121);
  reach(sim, "recall-tilt");
  sim.resize(100, 100);
  advance(sim, 3);
  assert.ok(sim.inspect().x >= 0 && sim.inspect().x <= 4);
  assert.ok(sim.inspect().y >= 0 && sim.inspect().y <= 4);
  assert.notEqual(sim.inspect().scene?.purpose, "old-snack-spot");
});

test("an unreachable snack recall times out without recording success", () => {
  const { sim } = snackRecallFixture(100_000);
  idleFor(sim, 121);
  assert.equal(sim.inspect().scene?.purpose, "old-snack-spot");
  advance(sim, 25);
  assert.notEqual(sim.inspect().scene?.purpose, "old-snack-spot");
  assert.equal(sim.exportMemory().episodes.filter((event) => event.kind === "recall").length, 0);
});

test("a due recall waits for a commanded activity to finish", () => {
  const { sim } = snackRecallFixture();
  idleFor(sim, 119);
  sim.action("trick_dead");
  advance(sim, 6);
  assert.equal(sim.inspect().scene?.purpose, "lesson");
  assert.equal(sim.inspect().scene?.phase, "reward");
  sim.action("cancel");
  idleFor(sim, 25);
  assert.equal(sim.inspect().scene?.purpose, "old-snack-spot");
});

for (const phase of ["recall-old", "recall-current"]) {
  test(`resizing during ${phase} maps the destination into the new display`, () => {
    const { sim } = snackRecallFixture();
    idleFor(sim, 121);
    reach(sim, phase);
    const memory = sim.inspect().scene.recall.memory;
    const position = phase === "recall-old" ? memory.oldPosition : memory.currentPosition;
    sim.resize(600, 400);
    const expected = { x: position.x * (600 - 96), y: position.y * (400 - 96) };
    assert.deepEqual(sim.inspect().scene.target, expected);

    if (phase === "recall-old") {
      reach(sim, "recall-tilt");
      assert.ok(Math.hypot(sim.inspect().x - expected.x, sim.inspect().y - expected.y) < 1);
    }

    for (let tick = 0; tick < 300 && sim.inspect().scene?.purpose === "old-snack-spot"; tick++) {
      sim.step(0.05);
    }

    assert.equal(sim.exportMemory().episodes.filter((event) => event.kind === "recall").length, 1);

    if (phase === "recall-current") {
      assert.ok(Math.hypot(sim.inspect().x - expected.x, sim.inspect().y - expected.y) < 1);
    }
  });
}
