import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { dropAt, reach } from "./simulation-helpers.mjs";
function bird() {
  const sim = new Gullbert(800, 600, () => 0.9);
  sim.configure({ paused: true });
  return sim;
}
function hover(sim, point, seconds) {
  for (let i = 0; i < seconds * 20; i++) {
    sim.pointer(point);
    sim.step(0.05);
  }
}
test("pointing notices, head contact relaxes, a parked cursor eventually releases him", () => {
  const sim = bird();
  hover(sim, { x: sim.inspect().x + 110, y: sim.inspect().y + 40 }, 0.4);
  assert.equal(sim.inspect().pose, "tilt");
  hover(sim, { x: sim.inspect().x + 60, y: sim.inspect().y + 35 }, 0.8);
  assert.equal(sim.inspect().pose, "nap-sleep");
  assert.match(sim.inspect().bubble, /head scratch/);
  hover(sim, { x: sim.inspect().x + 60, y: sim.inspect().y + 35 }, 4);
  assert.notEqual(sim.inspect().pose, "nap-sleep");
  sim.pointer(null);
  sim.step(0.1);
  assert.equal(sim.inspect().touch.zone, "");
});
test("three pokes ruffle him, a poke wakes a nap, commands and hiding reset touch", () => {
  const sim = bird();
  const point = { x: sim.inspect().x + 45, y: sim.inspect().y + 65 };
  sim.action("nap");
  sim.action("direct_pick", point);
  assert.equal(sim.inspect().mode, "idle");
  assert.equal(sim.inspect().pose, "nap-startle");

  for (let n = 0; n < 2; n++) {
    hover(sim, point, 0.4);
    sim.action("direct_pick", point);
  }

  assert.equal(sim.inspect().touch.reaction, "ruffled");
  assert.equal(sim.inspect().pose, "bag-offended");
  sim.action("feed");
  assert.equal(sim.inspect().touch.reaction, "");
  sim.setVisible(false);
  assert.equal(sim.inspect().touch.point, null);
});
test("hover and pokes do not replace an active show, including paused play", () => {
  const sim = bird();
  sim.action("bath_time");
  const scene = sim.inspect().scene;
  assert.ok(scene);
  const point = { x: sim.inspect().x + 60, y: sim.inspect().y + 35 };
  hover(sim, point, 0.8);
  sim.action("direct_pick", point);
  assert.equal(sim.inspect().scene.kind, scene.kind);
  assert.equal(sim.inspect().touch.reaction, "");
});
test(
  "direct cleanup removes only the clicked loose object, without targeting or " +
  "canceling flight",
  () => {
    const sim = bird();
    sim.restoreMemory({ perch: { x: 20, y: 20 } });
    dropAt(sim, { x: 200, y: 200 });
    const second = dropAt(sim, { x: 300, y: 200 });
    sim.action("poop", { x: 500, y: 250 });
    const flight = sim.inspect().flight;
    sim.action("direct_pick", { x: 200, y: 200 });
    assert.equal(sim.inspect().tidying, false);
    assert.deepEqual(
      sim.inspect().splats.map((s) => s.id),
      [second.id],
    );
    assert.deepEqual(sim.inspect().flight, flight);
    const y = sim.inspect().y;
    sim.step(0.1);
    assert.notEqual(sim.inspect().y, y, "cleanup must not freeze the flight");
    sim.action("direct_pick", { x: 50, y: 90 });
    assert.deepEqual(sim.inspect().memory.perch, { x: 20, y: 20 });
    assert.equal(sim.inspect().cleanup.session.removals, 1);
  }
);
test("direct cleanup ignores empty space and carried/scene-owned objects", () => {
  const sim = bird();
  sim.action("direct_pick", { x: 0, y: 0 });
  assert.equal(sim.inspect().cleanup.session, null);
  sim.action("place_bag", { x: 120, y: 120 });
  sim.action("steal_bag");
  reach(sim, "drag");
  const bag = sim.inspect().bag;
  assert.equal(sim.present({ x: bag.x + 20, y: bag.y + 20 }).highlight, null);
  sim.action("direct_pick", { x: bag.x + 20, y: bag.y + 20 });
  assert.ok(sim.inspect().bag);
  sim.action("feed");
  assert.equal(sim.present(sim.inspect().crumb).highlight, null);
});
test("direct cleanup groups quick clicks, finishes automatically, and hide clears it", () => {
  const sim = bird();
  dropAt(sim, { x: 200, y: 200 });
  const second = dropAt(sim, { x: 300, y: 200 });
  sim.action("direct_pick", { x: 200, y: 200 });
  sim.action("direct_pick", { x: 300, y: 200 });
  assert.equal(sim.inspect().cleanup.session.removals, 2);

  for (let i = 0; i < 85; i++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().cleanup.session, null);
  assert.ok(sim.inspect().cleanup.sulkUntil > sim.inspect().time);
  sim.setVisible(false);
  assert.equal(sim.inspect().cleanup.sulkUntil, 0);
});
