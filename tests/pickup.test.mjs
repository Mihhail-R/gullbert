import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { directCleanupTarget } from "../web-dist/simulation/behaviors/cleanup.js";
import { reach } from "./simulation-helpers.mjs";
function bird(level = 2, random = 0.9) {
  const sim = new Gullbert(900, 650, () => random);
  sim.configure({ mischief: level });
  return sim;
}
function drag(sim, now, point = { x: 250, y: 250 }) {
  assert.ok(
    sim.beginPickup({ x: sim.inspect().x + 45, y: sim.inspect().y + 45 }, now),
  );
  sim.movePickup(point);
  sim.finishPickup(false, now + 100);
}
function advance(sim, seconds) {
  for (let i = 0; i < seconds * 20; i++) {
    sim.updatePickupClock(sim.inspect().pickup.now + 50);
    sim.step(0.05);
  }
}
test(
  "click and sub-threshold motion remain pokes; completed drag counts once and " +
  "preserves grab offset",
  () => {
    const sim = bird(0);
    const point = { x: sim.inspect().x + 40, y: sim.inspect().y + 50 };
    sim.beginPickup(point, 0);
    sim.movePickup({ x: point.x + 3, y: point.y });
    sim.finishPickup(false, 100);
    assert.equal(sim.inspect().pickup.recent.length, 0);
    assert.equal(sim.inspect().touch.reaction, "poke");
    sim.beginPickup(point, 200);
    sim.movePickup({ x: 200, y: 250 });
    assert.ok(Math.abs(sim.inspect().x - 160) < 1e-9);
    assert.equal(sim.inspect().y, 200);
    assert.equal(sim.inspect().mode, "carried");
    sim.finishPickup(false, 300);
    sim.finishPickup(false, 400);
    assert.deepEqual(sim.inspect().pickup.recent, [300]);
    assert.match(sim.inspect().bubble, /wrong place/);
  }
);
test("five-minute history expires individually even while hidden, never persists", () => {
  const sim = bird(0);
  drag(sim, 0);
  drag(sim, 60000, { x: 500, y: 300 });
  const restored = bird(0);
  restored.restoreMemory(sim.exportMemory());
  assert.deepEqual(restored.inspect().pickup.recent, []);

  sim.setVisible(false);
  sim.updatePickupClock(300100);
  assert.deepEqual(sim.inspect().pickup.recent, [60100]);
  sim.updatePickupClock(360100);
  assert.deepEqual(sim.inspect().pickup.recent, []);
});
test("Polite-ish remains cooperative through repeated handling", () => {
  const sim = bird(0, 0);

  for (let i = 0; i < 6; i++) {
    drag(sim, i * 1000, { x: 150 + i * 50, y: 200 });
  }

  advance(sim, 3);
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().splats.length, 0);
  assert.equal(sim.inspect().rubbish.length, 0);
});
test(
  "Menace fear poop is tiny; third pickup carries cleanable trash back without " +
  "replacing food",
  () => {
    const sim = bird(1, 0);
    sim.action("place_bag", { x: 624, y: 524 });
    drag(sim, 0);
    assert.equal(sim.inspect().splats[0].scale, 0.55);
    drag(sim, 1000, { x: 500, y: 200 });
    const origin = { x: sim.inspect().x, y: sim.inspect().y };
    drag(sim, 2000, { x: 250, y: 300 });
    assert.equal(sim.inspect().scene.revenge, "trash");

    for (let tick = 0; tick < 300 && !sim.inspect().rubbish.length; tick++) {
      advance(sim, 0.05);
    }

    assert.equal(sim.inspect().rubbish.length, 1);
    assert.equal(sim.inspect().rubbish[0].x, origin.x + 24);
    assert.equal(sim.inspect().bag.servings, 3);
    const rubbish = sim.inspect().rubbish[0];
    assert.equal(
      sim.present({ x: rubbish.x + 20, y: rubbish.y + 20 }).highlight.kind,
      "rubbish",
    );
    sim.action("direct_pick", { x: rubbish.x + 20, y: rubbish.y + 20 });
    assert.equal(sim.inspect().rubbish.length, 0);
  }
);
test("repeated handling can escalate a cursor reaction into a larger mess", () => {
  const sim = bird(2, 0.75);
  drag(sim, 0);
  assert.equal(sim.inspect().scene.revenge, "trail");

  for (let pickup = 1; pickup < 4; pickup++) {
    drag(sim, pickup * 500, { x: 200 + (pickup % 2) * 200, y: 250 });
  }

  advance(sim, 1);
  assert.equal(sim.inspect().splats.length, 1);
  assert.equal(sim.inspect().splats[0].scale, 2.5);
});

test("Public enemy speech follows the chosen reaction and giant poop stays cleanable", () => {
  const reactions = [
    [0, "chase", /Your turn/i],
    [0.65, "trail", /personal/i],
    [0.85, "big", /redecorate/i],
    [0.95, "trash", /redecorate/i],
  ];

  for (const [random, revenge, speech] of reactions) {
    const sim = bird(2, random);
    drag(sim, 0);
    assert.equal(sim.inspect().scene.revenge, revenge);
    assert.match(sim.inspect().bubble, speech);

    if (revenge === "big") {
      advance(sim, 1);
      assert.equal(sim.inspect().splats[0].scale, 2.5);
      const s = sim.inspect().splats[0];
      assert.equal(sim.present({ x: s.x + 55, y: s.y }).highlight.id, s.id);
    }
  }
});
test("regrabbing does not renew revenge and a short cooldown stops endless bouts", () => {
  const sim = bird();
  drag(sim, 0);
  const deadline = sim.inspect().pickup.revengeUntil;
  drag(sim, 8000, { x: 400, y: 200 });
  assert.equal(sim.inspect().pickup.revengeUntil, deadline);
  advance(sim, 3);
  assert.notEqual(sim.inspect().scene?.kind, "cursor");
  drag(sim, 12000, { x: 250, y: 200 });
  assert.equal(sim.inspect().scene.revenge, "none");
  assert.match(sim.inspect().bubble, /not furniture/i);
  drag(sim, 22000, { x: 400, y: 200 });
  assert.ok(sim.inspect().pickup.revengeUntil > deadline);
});
test("chase catches only near beak, tugs briefly, and has a ten-second overall deadline", () => {
  for (const pickupCount of [1, 8]) {
    const sim = bird(2, 0);

    for (let pickup = 0; pickup < pickupCount; pickup++) {
      drag(sim, pickup * 500, { x: 200 + (pickup % 2) * 200, y: 250 });
    }

    advance(sim, 0.75);
    assert.equal(sim.inspect().scene.kind, "cursor");
    sim.pointer({ x: sim.inspect().x + 78, y: sim.inspect().y + 48 });
    advance(sim, 1.1);
    assert.equal(sim.inspect().scene.phase, "chew");
    advance(sim, 1.3);
    assert.notEqual(sim.inspect().scene?.phase, "chew");
    advance(sim, 8);
    assert.notEqual(sim.inspect().scene?.kind, "cursor");
  }
});
test("trail has at most three splats and ends with its chase", () => {
  const sim = bird(2, 0.65);
  drag(sim, 0);
  drag(sim, 1000, { x: 400, y: 200 });

  for (let i = 0; i < 190; i++) {
    sim.pointer({ x: sim.inspect().x < 450 ? 850 : 20, y: 20 });
    advance(sim, 0.05);
  }

  assert.equal(sim.inspect().splats.length, 3);
  assert.notEqual(sim.inspect().scene?.kind, "cursor");
});
// Reach a due trail splat through the real pickup-to-cursor handoff.
function approachingTrailSplat() {
  const sim = bird(2, 0.65);
  drag(sim, 0);
  advance(sim, 0.75);
  sim.pointer({ x: 850, y: 20 });

  while (sim.inspect().time + 0.1 < sim.inspect().scene.nextSplat) {
    advance(sim, 0.05);
  }

  assert.equal(sim.inspect().scene.phase, "stalk");
  assert.equal(sim.inspect().splats.length, 0);
  return sim;
}

test("a due retaliation splat uses the position before cursor movement", () => {
  const sim = approachingTrailSplat();
  const before = sim.inspect();
  sim.step(before.scene.nextSplat - before.time);
  const after = sim.inspect();

  assert.equal(after.splats.length, 1);
  assert.equal(after.splats[0].x, before.x + 48);
  assert.equal(after.splats[0].y, before.y + 86);
  assert.equal(after.splats[0].scale, 0.8);
  assert.notEqual(after.x, before.x);
  assert.equal(after.scene.nextSplat, after.time + 1.8);
});

test("wall-clock expiry cancels retaliation before a due splat or simulation deadline", () => {
  const sim = approachingTrailSplat();
  const before = sim.inspect();
  sim.updatePickupClock(before.pickup.revengeUntil);
  sim.updatePickupClock(before.pickup.now);
  sim.updatePickupClock(NaN);
  sim.step(before.scene.nextSplat - before.time);
  const after = sim.inspect();

  assert.ok(after.time < before.scene.deadline);
  assert.equal(after.scene, null);
  assert.equal(after.splats.length, 0);
  assert.equal(after.mode, "idle");
  assert.equal(after.bubble, before.bubble);
});

test("simulation deadline ends a chase even without new wall-clock samples", () => {
  const sim = approachingTrailSplat();
  const before = sim.inspect();

  while (sim.inspect().time < before.scene.deadline) {
    const current = sim.inspect();
    sim.pointer({ x: current.x < 450 ? 850 : 20, y: 20 });
    sim.step(0.05);
  }

  const after = sim.inspect();
  assert.equal(after.pickup.now, before.pickup.now);
  assert.ok(after.pickup.now < after.pickup.revengeUntil);
  assert.equal(after.scene, null);
  assert.match(after.bubble, /not worth/i);
});

test(
  "cancel, food, hide, pause and lowering level stop reactions; paused dragging " +
  "remains available",
  () => {
    for (const cancel of [
      (s) => s.action("cancel"),
      (s) => s.action("feed"),
      (s) => s.setVisible(false),
      (s) => s.configure({ paused: true }),
      (s) => s.configure({ mischief: 0 }),
    ]) {
      const sim = bird();
      drag(sim, 0);
      cancel(sim);
      assert.notEqual(sim.inspect().scene?.kind, "relocation");
      assert.notEqual(sim.inspect().scene?.kind, "cursor");
    }

    const sim = bird();
    sim.configure({ paused: true });
    drag(sim, 0);
    assert.equal(sim.inspect().scene.revenge, "none");
    assert.equal(sim.inspect().pickup.recent.length, 1);
  }
);
test(
  "drag interrupts a flight without dropping its pending poop; cancellation and " +
  "screen clamps are safe",
  () => {
    const sim = bird();
    sim.action("poop", { x: 700, y: 200 });
    sim.beginPickup({ x: sim.inspect().x + 45, y: sim.inspect().y + 45 }, 0);
    sim.movePickup({ x: 9999, y: -999 });
    assert.equal(sim.inspect().x, 804);
    assert.equal(sim.inspect().y, 0);
    assert.equal(sim.inspect().flight, null);
    assert.equal(sim.inspect().pendingPoop, null);
    sim.finishPickup(true, sim.inspect().pickup.now);
    advance(sim, 1);
    assert.equal(sim.inspect().pickup.recent.length, 0);
    assert.equal(sim.inspect().splats.length, 0);
  }
);
test("bulk cleanup removes every new mess type and preserves remembered belongings", () => {
  const sim = bird();
  sim.restoreMemory({ perch: { x: 10, y: 10 } });

  for (let i = 0; i < 4; i++) {
    drag(sim, i * 1000, { x: 200 + i * 60, y: 250 });
  }

  advance(sim, 8);
  sim.splat({ x: 200, y: 100 });
  assert.equal(sim.inspect().rubbish.length, 1);
  sim.clean();
  assert.equal(sim.inspect().rubbish.length + sim.inspect().splats.length, 0);
  assert.deepEqual(sim.inspect().memory.perch, { x: 10, y: 10 });
});

test("pickup hitboxes follow animated entrances and invisible gags are excluded", () => {
  const sim = bird();
  sim.action("baguette_parade");
  assert.equal(sim.inspect().scene?.kind, "baguette");
  advance(sim, 0.6);
  const rect = sim.pickupRect();
  assert.notEqual(rect.x, sim.inspect().x + 15);
  assert.ok(sim.beginPickup({ x: rect.x + 30, y: rect.y + 30 }, 0));
  const expectedX = rect.x - 15 + 10;
  sim.movePickup({ x: rect.x + 40, y: rect.y + 30 });
  assert.ok(
    Math.abs(sim.inspect().x - Math.max(0, Math.min(804, expectedX))) < 1e-8,
  );
  sim.finishPickup(true, sim.inspect().pickup.now);
  sim.action("baguette_parade");
  reach(sim, "gone");
  assert.equal(sim.canPickup(), false);
});
test("cleanup respects the foreground chip over rubbish", () => {
  // A geometry fixture exercises the selector independently of how props arrive.
  const source = {
    visible: true,
    scene: null,
    bag: null,
    crumb: null,
    rubbish: [{ id: 1, x: 200, y: 200, born: 0 }],
    looseChips: [
      { id: 2, asset: "chip", x: 210, y: 210, width: 18, height: 12 },
    ],
    splats: [],
    cones: [],
  };
  assert.equal(directCleanupTarget(source, { x: 215, y: 215 }).kind, "chip");
  source.looseChips = [];
  assert.equal(directCleanupTarget(source, { x: 215, y: 215 }).kind, "rubbish");
});

test("a click on overlapping mess cleans it while a drag still carries the gull", () => {
  const sim = bird(0);
  const point = { x: sim.inspect().x + 45, y: sim.inspect().y + 65 };
  sim.splat(point);
  sim.beginPickup(point, 0);
  sim.finishPickup(false, 100);
  assert.equal(sim.inspect().splats.length, 0);
  assert.equal(sim.inspect().pickup.recent.length, 0);
  sim.splat(point);
  sim.beginPickup(point, 200);
  sim.movePickup({ x: 250, y: 250 });
  sim.finishPickup(false, 300);
  assert.equal(sim.inspect().splats.length, 1);
  assert.equal(sim.inspect().pickup.recent.length, 1);
});

test("revenge rubbish stays reachable after a display shrink", () => {
  const littered = bird(1, 0);
  drag(littered, 0, { x: 800, y: 600 });
  drag(littered, 1000, { x: 750, y: 550 });
  drag(littered, 2000, { x: 250, y: 250 });
  advance(littered, 8);
  littered.resize(300, 200);
  assert.deepEqual(
    { x: littered.inspect().rubbish[0].x, y: littered.inspect().rubbish[0].y },
    { x: 252, y: 152 },
  );
});
