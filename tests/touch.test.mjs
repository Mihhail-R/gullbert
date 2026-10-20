import test from "node:test";
import assert from "node:assert/strict";
import { Body } from "../web-dist/simulation/body.js";
import { Touch } from "../web-dist/simulation/behaviors/touch.js";
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

for (const samplesPerSecond of [10, 20, 60]) {
  test(`continuous head contact earns one reward at ${samplesPerSecond} Hz`, () => {
    const sim = bird();
    const { x, y } = sim.inspect();
    const head = { x: x + 60, y: y + 35 };

    function hold(seconds) {
      for (let sample = 0; sample < seconds * samplesPerSecond; sample++) {
        sim.pointer(head);
        sim.step(1 / samplesPerSecond);
      }
    }

    hold(1);
    assert.ok(Math.abs(sim.inspect().motivation.socialInterest - 0.58) < 1e-9);
    assert.equal(sim.present().affection.kind, "scratch");

    hold(10);
    assert.ok(Math.abs(sim.inspect().motivation.socialInterest - 0.58) < 1e-9);
    assert.equal(sim.present().affection.kind, "");

    sim.pointer({ x: 0, y: 0 });
    sim.step(1 / samplesPerSecond);
    hold(1);
    assert.ok(Math.abs(sim.inspect().motivation.socialInterest - 0.66) < 1e-9);
  });
}

for (const interruption of ["stale", "unavailable", "reset", "missing"]) {
  test(`${interruption} touch permits a new rewarded scratch`, () => {
    const body = new Body(800, 600);
    const clock = { now: 0 };
    let available = true;
    let rewards = 0;
    const touch = new Touch({
      body,
      clock,
      speech: { say() {} },
      available: () => available,
      sleeping: () => false,
      rest() {},
      scratched() {
        rewards++;
      },
    });
    const head = { x: body.x + 60, y: body.y + 35 };

    function hold() {
      for (let sample = 0; sample < 20; sample++) {
        touch.pointer(head);
        clock.now += 0.05;
        touch.update();
      }
    }

    hold();
    assert.equal(rewards, 1);

    switch (interruption) {
      case "stale":
        clock.now += 0.5;
        touch.update();
        break;

      case "unavailable":
        available = false;
        touch.update();
        available = true;
        break;

      case "reset":
        touch.reset();
        break;

      case "missing":
        touch.pointer(null);
        touch.update();
        break;
    }

    hold();
    assert.equal(rewards, 2);
  });
}

test("a poke wakes a sleeping gull", () => {
  const sim = bird();
  const point = { x: sim.inspect().x + 45, y: sim.inspect().y + 65 };
  sim.action("nap");
  sim.action("direct_pick", point);

  assert.equal(sim.inspect().mode, "idle");
  assert.equal(sim.present().pose, "nap-startle");
});

test("three pokes ruffle Gullbert, and feeding settles the reaction", () => {
  const sim = bird();
  const point = { x: sim.inspect().x + 45, y: sim.inspect().y + 65 };

  for (let poke = 0; poke < 3; poke++) {
    hover(sim, point, 0.4);
    sim.action("direct_pick", point);
  }

  assert.equal(sim.present().pose, "bag-offended");
  sim.action("feed");
  assert.equal(sim.inspect().touch.reaction, "");
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
  dropAt(sim, { x: 300, y: 200 });
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
