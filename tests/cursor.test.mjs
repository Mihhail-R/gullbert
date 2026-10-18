import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { createPointerTracker } from "../web-dist/platform/pointer.js";
function bird() {
  const g = new Gullbert(800, 600, () => 0.5);
  g.configure({ paused: false, mischief: 0, sound: false });
  return g;
}
function advance(g, t) {
  for (let i = 0; i < t * 20; i++) {
    g.step(0.05);
  }
}
test("nibbling a stationary cursor ends with disappointment and releases tracking", () => {
  const sim = bird();
  sim.action("nibble_cursor");
  sim.pointer({ x: sim.inspect().x + 90, y: sim.inspect().y + 48 });
  let complained = false;

  for (let tick = 0; tick < 160; tick++) {
    if (sim.inspect().bubble.includes("not a chip")) {
      complained = true;
    }

    sim.step(0.05);
  }

  assert.ok(complained);
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().wantsPointer, false);
});

test(
  "escaping pointer and unavailable tracking terminate gracefully, with a strict " +
  "deadline",
  () => {
    for (const point of [null, { x: -1, y: 3, inside: false }]) {
      const g = bird();
      g.action("nibble_cursor");
      g.pointer(point);
      assert.equal(g.inspect().scene, null);
    }

    const g = bird();
    g.action("nibble_cursor");

    for (let i = 0; i < 161; i++) {
      g.pointer({ x: 0, y: 0 });
      g.step(0.05);
    }

    assert.equal(g.inspect().scene, null);
  }
);
test("food, commands, hiding and pausing cancel cursor sampling immediately", () => {
  for (const command of ["feed", "place_bag", "nap", "clean"]) {
    const g = bird();
    g.action("nibble_cursor");
    assert.equal(g.inspect().wantsPointer, true);
    g.action(command);
    assert.equal(g.inspect().wantsPointer, false);
  }

  const g = bird();
  g.action("nibble_cursor");
  g.setVisible(false);
  const t = g.inspect().time;
  advance(g, 50);
  assert.equal(g.inspect().time, t);
  assert.equal(g.inspect().wantsPointer, false);
  g.setVisible(true);
  assert.equal(g.inspect().scene, null);
  g.action("nibble_cursor");
  g.configure({ ...g.inspect().settings, paused: true });
  assert.equal(g.inspect().wantsPointer, false);
  assert.equal(g.inspect().scene, null);
});
test(
  "an unanswered snack request waits fifteen visible seconds before a cursor attempt",
  () => {
    const g = bird();
    g.configure({ mischief: 1 });

    for (
      let tick = 0;
      tick < 8000 && g.inspect().snackRequestAt === null;
      tick++
    ) {
      g.step(0.05);
    }

    const requestedAt = g.inspect().snackRequestAt;
    assert.notEqual(requestedAt, null);

    for (let tick = 0; tick < 296; tick++) {
      g.step(0.05);
      assert.notEqual(g.inspect().scene?.kind, "cursor");
    }

    for (
      let tick = 0;
      tick < 1600 && g.inspect().scene?.kind !== "cursor";
      tick++
    ) {
      g.step(0.05);
    }

    assert.equal(g.inspect().scene?.kind, "cursor");
    assert.ok(g.inspect().time >= requestedAt + 15);
  }
);
test(
  "browser pointer listener exists only while active and throttles to ten samples " +
  "per second",
  () => {
    let time = 0,
      listener = null,
      removed = 0;
    const points = [];
    const tracker = createPointerTracker({
      now: () => time,
      listen: (fn) => {
        listener = fn;
        return () => {
          listener = null;
          removed++;
        };
      },
      sample: (p) => points.push(p),
    });
    tracker.start();

    for (let i = 0; i < 100; i++) {
      time = i * 10;
      listener({ x: i, y: 0 });
    }

    assert.equal(points.length, 10);
    tracker.stop();
    assert.equal(listener, null);
    assert.equal(removed, 1);
    tracker.start();
    listener({ x: 999, y: 0 });
    assert.equal(points.length, 10);
    tracker.stop();
  }
);
test("native pointer polling is bounded and in-flight results are discarded on stop", async () => {
  let time = 0,
    next = null,
    reads = 0,
    resolve;
  const points = [];
  const tracker = createPointerTracker({
    now: () => time,
    read: () => {
      reads++;
      return new Promise((r) => (resolve = r));
    },
    sample: (p) => points.push(p),
    schedule: (fn, ms) => {
      next = { fn, ms };
      return 1;
    },
    cancel: () => {
      next = null;
    },
  });
  tracker.start();
  assert.equal(next.ms, 0);
  const pending = next.fn();
  assert.equal(reads, 1);
  tracker.stop();
  resolve({ x: 2, y: 3 });
  await pending;
  assert.equal(points.length, 0);
  assert.equal(next, null);
  tracker.start();
  assert.equal(next.ms, 100);
  time = 100;
  const second = next.fn();
  resolve({ x: 2, y: 3 });
  await second;
  assert.equal(points.length, 1);
  assert.equal(next.ms, 100);
  tracker.stop();
});

test("a browser exit inside the throttle window is delivered without a later pointer event", () => {
  let time = 0,
    listener,
    timer = null;
  const points = [];
  const tracker = createPointerTracker({
    now: () => time,
    listen: (fn) => {
      listener = fn;
      return () => {};
    },
    sample: (p) => points.push(p),
    schedule: (fn, ms) => {
      timer = { fn, ms };
      return 1;
    },
    cancel: () => {
      timer = null;
    },
  });
  tracker.start();
  listener({ x: 10, y: 10, inside: true });
  time = 30;
  listener({ x: -1, y: -1, inside: false });
  assert.equal(points.length, 1);
  assert.equal(timer.ms, 70);
  time = 100;
  timer.fn();
  assert.equal(points.length, 2);
  assert.equal(points[1].inside, false);
  tracker.stop();
});

test("a failed search triggers a cursor attempt, but another search respects its cooldown", () => {
  const g = bird();
  g.configure({ ...g.inspect().settings, mischief: 1 });
  g.action("search_snack");
  advance(g, 4);
  assert.equal(g.inspect().scene?.phase, "disappointed");
  advance(g, 2.2);
  assert.equal(g.inspect().scene?.kind, "cursor");
  g.pointer(null);
  const cooldown = g.inspect().nextNibble;
  g.action("search_snack");
  advance(g, 7);
  assert.notEqual(g.inspect().scene?.kind, "cursor");
  assert.equal(g.inspect().nextNibble, cooldown);
});

test("polite mode does not turn a failed snack search into a cursor encounter", () => {
  const sim = bird();
  sim.action("search_snack");
  advance(sim, 7);
  assert.notEqual(sim.inspect().scene?.kind, "cursor");
});
