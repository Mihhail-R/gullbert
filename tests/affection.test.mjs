import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { advance } from "./simulation-helpers.mjs";

function bird() {
  const sim = new Gullbert(800, 600, () => 0.9);
  sim.configure({ paused: true, hat: "beanie" });
  return sim;
}

function untilHop(sim) {
  for (let tick = 0; tick < 800; tick++) {
    sim.step(0.05);

    if (sim.present().affection.kind === "hop") {
      return;
    }
  }

  assert.fail("meal never reached its happy hop");
}

test("chips finish with a bounded hop and retain their hat", () => {
  for (const command of ["feed", "place_bag", "chip_toss"]) {
    const sim = bird();
    sim.action(command, { x: 400, y: 400 });
    untilHop(sim);
    const ground = sim.inspect().y;
    advance(sim, 0.2);
    const view = sim.present();
    assert.equal(view.affection.kind, "hop");
    assert.ok(view.affection.y < 0);
    assert.equal(view.pose, "wingUp");
    assert.equal(view.hatPlacement.asset, "beanie");
    assert.equal(
      sim.inspect().y,
      ground,
      "cosmetic hop preserves the landing spot",
    );
    advance(sim, 0.6);
    assert.equal(sim.present().affection.kind, "");
  }
});

test("a new command cancels a hop and hidden time does not advance it", () => {
  const sim = bird();
  sim.action("feed");
  untilHop(sim);
  const before = sim.present().affection;
  sim.setVisible(false);
  advance(sim, 10);
  sim.setVisible(true);
  assert.deepEqual(sim.present().affection, before);
  sim.action("nap");
  assert.equal(sim.present().affection.kind, "");
});

test("scratches lean and fluff, then briefly look offended on release", () => {
  const sim = bird();
  const point = { x: sim.inspect().x + 60, y: sim.inspect().y + 35 };
  const frames = [];

  for (let tick = 0; tick < 30; tick++) {
    sim.pointer(point);
    sim.step(0.05);

    if (sim.present().affection.kind === "scratch") {
      frames.push(sim.present());
    }
  }

  assert.ok(frames.some((view) => view.affection.fluff));
  assert.ok(frames.some((view) => !view.affection.fluff));
  assert.ok(frames.every((view) => view.affection.x === 3));
  sim.pointer(null);
  sim.step(0.05);
  assert.equal(sim.present().pose, "bag-offended");
  assert.equal(sim.present().affection.kind, "");
  advance(sim, 0.8);
  assert.equal(sim.inspect().touch.reaction, "");
});
