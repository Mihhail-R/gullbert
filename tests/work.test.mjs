import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { dialogue } from "../web-dist/simulation/dialogue.js";

function workplace(random = () => 0.6) {
  const sim = new Gullbert(1000, 700, random);
  sim.configure({ paused: true });

  for (let i = 0; i < 100; i++) {
    sim.step(0.1);
  }

  sim.configure({ paused: false });
  let nowMs = 10000;
  let count = 9000;
  let idleSeconds = 0;
  const window = { id: 42, x: 100, y: 200, width: 700, height: 400 };
  function sample() {
    sim.observeWork({ window, keyDownCount: count, idleSeconds }, nowMs);
  }
  function advance(seconds, keys = 4) {
    for (let i = 0; i < seconds * 2; i++) {
      nowMs += 500;
      count += keys;
      idleSeconds = keys > 0 ? 0 : idleSeconds + 0.5;
      sample();

      for (let frame = 0; frame < 10; frame++) {
        sim.step(0.05);
      }
    }
  }
  function arrive() {
    for (let i = 0; i < 100; i++) {
      if (sim.inspect().scene?.kind === "work" && sim.inspect().scene.phase === "watch") {
        return;
      }

      advance(0.5);
    }

    assert.fail("Fresh work should eventually attract an idle bird");
  }

  sample();
  return { sim, window, advance, sample, arrive };
}

test("new activity prompts a visit, follows window movement and stays out of memory", () => {
  const { sim, window, advance, arrive } = workplace();
  const memory = sim.exportMemory();
  arrive();
  const perched = { x: sim.inspect().x, y: sim.inspect().y };
  assert.ok(perched.x >= window.x && perched.x <= window.x + window.width);
  assert.ok(perched.y < window.y);
  window.x += 30;
  window.y += 20;
  advance(0.5);
  assert.deepEqual(
    { x: sim.inspect().x - perched.x, y: sim.inspect().y - perched.y },
    { x: 30, y: 20 },
  );
  assert.deepEqual(sim.exportMemory(), memory);
});

test("old counter totals and idle input do not count as fresh work", () => {
  const { sim, advance } = workplace();
  advance(15, 0);
  assert.notEqual(sim.inspect().scene?.kind, "work");
});

test("mockery reacts to speed and a pause without knowing typed characters", () => {
  const { sim, advance, arrive } = workplace(() => 0.9);
  arrive();
  advance(sim.inspect().scene.nextRemark - sim.inspect().time + 0.1);
  assert.ok(dialogue.gullbert.work.fast.includes(sim.inspect().bubble));
  const nextRemark = sim.inspect().scene.nextRemark;

  while (sim.inspect().time < nextRemark - 2) {
    advance(0.5);
  }

  advance(2.5, 0);
  assert.ok(dialogue.gullbert.work.pause.includes(sim.inspect().bubble));
});

test("window switches, missing observations and paused or polite settings end the visit", () => {
  const interruptions = [
    (fixture) => {
      fixture.window.id++;
      fixture.advance(0.5);
    },
    ({ sim }) => sim.observeWork(null, 20000),
    ({ sim }) => sim.configure({ paused: true }),
    ({ sim }) => sim.configure({ mischief: 0 }),
    ({ sim }) => sim.setVisible(false),
    ({ sim }) => sim.resize(500, 400),
  ];

  for (const interrupt of interruptions) {
    const fixture = workplace();
    fixture.arrive();
    interrupt(fixture);
    assert.notEqual(fixture.sim.inspect().scene?.kind, "work");
    assert.equal(fixture.sim.inspect().mode, "idle");
  }
});

test("stalled sensing expires and feeding or cancellation takes priority", () => {
  const { sim, advance, arrive } = workplace();
  arrive();

  for (let i = 0; i < 60; i++) {
    sim.step(0.05);
  }

  assert.notEqual(sim.inspect().scene?.kind, "work");
  advance(5);
  assert.notEqual(sim.inspect().scene?.kind, "work");
  sim.action("watch_work");
  sim.action("feed");
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().mode, "fetch");
  advance(2);
  assert.notEqual(sim.inspect().scene?.kind, "work");
});

test("long gaps and counter resets establish a new baseline", () => {
  const { sim, window, arrive } = workplace();
  arrive();
  sim.observeWork({ window, keyDownCount: 50000, idleSeconds: 0 }, 90000);
  assert.notEqual(sim.inspect().scene?.kind, "work");
  sim.observeWork({ window, keyDownCount: 1, idleSeconds: 0 }, 90500);
  sim.step(0.1);
  assert.notEqual(sim.inspect().scene?.kind, "work");
});

test("work visits request chips, nibble cosmetically or poop in public enemy", () => {
  const chips = workplace(() => 0.9);
  chips.arrive();
  chips.advance(chips.sim.inspect().scene.until - chips.sim.inspect().time + 0.1);
  assert.notEqual(chips.sim.inspect().scene?.kind, "work");
  assert.equal(chips.sim.inspect().bubble, dialogue.gullbert.work.chips);

  const nibble = workplace(() => 0.3);
  nibble.arrive();
  nibble.advance(nibble.sim.inspect().scene.until - nibble.sim.inspect().time + 0.1);
  assert.equal(nibble.sim.inspect().scene?.kind, "cursor");
  assert.equal(nibble.sim.inspect().scene.takeover, false);

  const messy = workplace(() => 0.1);
  messy.sim.configure({ mischief: 2 });
  messy.arrive();
  messy.advance(messy.sim.inspect().scene.until - messy.sim.inspect().time + 0.1);
  assert.ok(messy.sim.inspect().pendingPoop || messy.sim.inspect().splats.length > 0);
  const point = messy.sim.inspect().pendingPoop ?? messy.sim.inspect().splats[0];
  assert.ok(point.x >= messy.window.x && point.x <= messy.window.x + messy.window.width);
  assert.ok(point.y >= messy.window.y && point.y <= messy.window.y + messy.window.height);
});
