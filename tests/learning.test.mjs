import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { normalizeMemory } from "../web-dist/simulation/memory.js";
import { advance, reach } from "./simulation-helpers.mjs";

function setup(options = {}) {
  const sim = new Gullbert(900, 650, () => 0.5, options);
  sim.configure({ paused: true, mischief: 0 });
  return sim;
}
function perform(sim, trick = "spin") {
  sim.action(`trick_${trick}`, { x: 300, y: 350 });
  reach(sim, "reward");
}
function feed(sim, point) {
  sim.action("feed_here", point);
  advance(sim, 8);
}
function play(sim) {
  sim.action("play_cap");
  reach(sim, "ready");

  for (let round = 0; round < 3; round++) {
    sim.flickCap(sim.inspect().scene.cap);
    reach(sim, "return");

    if (round < 2) {
      reach(sim, "ready");
    }
  }

  reach(sim, "victory");
  advance(sim, 2);
  assert.equal(sim.inspect().scene, null);
}
function scratch(sim) {
  for (let tick = 0; tick < 20; tick++) {
    const { x, y, facing } = sim.inspect();
    sim.pointer({ x: x + (facing === 1 ? 59 : 37), y: y + 35 });
    sim.step(0.05);
  }

  sim.pointer(null);
}

test(
  "tricks improve only after a completed performance and a consumed chip, and " +
  "survive restart",
  () => {
    for (const trick of ["come", "spin", "dead"]) {
      const sim = setup();

      for (let lesson = 1; lesson <= 7; lesson++) {
        perform(sim, trick);
        assert.equal(
          sim.exportMemory().learned.tricks[trick],
          Math.min(6, lesson - 1),
        );
        assert.equal(sim.inspect().scene.practiced, lesson > 3);
        sim.action("feed");
        assert.equal(
          sim.exportMemory().learned.tricks[trick],
          Math.min(6, lesson - 1),
        );
        advance(sim, 3);
        assert.equal(
          sim.exportMemory().learned.tricks[trick],
          Math.min(6, lesson),
        );
      }

      const restored = setup();
      restored.restoreMemory(JSON.parse(JSON.stringify(sim.exportMemory())));
      assert.deepEqual(restored.exportMemory(), sim.exportMemory());
      assert.equal(restored.inspect().scene, null);
      restored.action("feed");
      advance(restored, 3);
      assert.equal(restored.exportMemory().learned.tricks[trick], 6);
    }
  }
);

test(
  "chip placement preserves a completed performance, but interrupted and expired " +
  "performances cannot earn lessons",
  () => {
    const sim = setup();
    perform(sim);
    sim.action("prepare_chip");
    assert.equal(sim.inspect().scene.phase, "reward");
    feed(sim, { x: 600, y: 400 });
    assert.equal(sim.exportMemory().learned.tricks.spin, 1);

    for (const operation of [
      "early",
      "expired",
      "cancel",
      "clean",
      "hide",
      "pause",
      "nap",
      "restore",
    ]) {
      const bird = setup();
      bird.action("trick_spin");

      if (operation !== "early") {
        reach(bird, "reward");
      }

      if (operation === "expired") {
        advance(bird, 21);
      } else if (operation === "hide") {
        bird.setVisible(false);
        bird.setVisible(true);
      } else if (operation === "pause") {
        bird.configure({ paused: true });
      } else if (operation === "restore") {
        bird.restoreMemory(bird.exportMemory());
      } else if (operation !== "early") {
        bird.action(operation);
      }

      bird.action("feed");
      advance(bird, 3);
      assert.equal(bird.exportMemory().learned.tricks.spin, 0, operation);
      assert.equal(bird.present().rotation, 0, operation);
    }
  }
);

test("replacing a reward chip before he reaches it cannot teach a trick", () => {
  for (const command of ["cancel", "clean", "nap", "feed"]) {
    const sim = setup();
    perform(sim);
    sim.action("feed_here", { x: 850, y: 600 });
    sim.action(command);
    advance(sim, 10);
    assert.equal(sim.exportMemory().learned.tricks.spin, 0, command);
  }
});

test("three meals in one area teach a snack spot; removed or cancelled chips do not", () => {
  const sim = setup();
  sim.action("feed_here", { x: 300, y: 300 });
  assert.equal(sim.exportMemory().learned.snackSpot, null);
  sim.action("cancel");
  advance(sim, 5);
  assert.equal(sim.exportMemory().learned.snackSpot, null);
  sim.action("feed_here", { x: 300, y: 300 });
  const crumb = sim.inspect().crumb;
  sim.action("tidy");
  sim.action("tidy_pick", { x: crumb.x + 9, y: crumb.y + 6 });
  sim.action("tidy_done");
  advance(sim, 5);
  assert.equal(sim.exportMemory().learned.snackSpot, null);

  for (let meal = 0; meal < 3; meal++) {
    feed(sim, { x: 300 + meal * 5, y: 300 });
  }

  assert.equal(sim.exportMemory().learned.snackSpot.meals, 3);
  assert.ok(Math.abs(sim.exportMemory().learned.snackSpot.x - 240) < 10);
  const saved = sim.exportMemory();
  sim.action("clean");
  assert.deepEqual(sim.exportMemory(), saved);
});

test(
  "remembered snack checks are bounded, infrequent and never scheduled while paused " +
  "or hidden",
  () => {
    const sim = setup();

    for (let meal = 0; meal < 3; meal++) {
      feed(sim, { x: 300, y: 300 });
    }

    advance(sim, 200);
    assert.equal(sim.inspect().scene, null);
    sim.setVisible(false);
    const time = sim.inspect().time;
    advance(sim, 200);
    assert.equal(sim.inspect().time, time);
    sim.setVisible(true);
    sim.configure({ paused: false });
    sim.step(0.05);
    assert.equal(sim.inspect().scene.kind, "habit");
    advance(sim, 5);
    assert.notEqual(sim.inspect().scene?.kind, "habit");
    sim.action("cancel");
    sim.step(0.05);
    assert.notEqual(sim.inspect().scene?.kind, "habit");
  }
);

test(
  "one meal elsewhere does not erase an established snack spot, but a repeated new " +
  "ritual replaces it",
  () => {
    const sim = setup();

    for (let meal = 0; meal < 3; meal++) {
      feed(sim, { x: 300, y: 300 });
    }

    const spot = sim.exportMemory().learned.snackSpot;
    feed(sim, { x: 800, y: 550 });
    assert.deepEqual(sim.exportMemory().learned.snackSpot, spot);
    const restored = setup();
    restored.restoreMemory(sim.exportMemory());

    for (let meal = 0; meal < 2; meal++) {
      feed(restored, { x: 800, y: 550 });
    }

    assert.deepEqual(restored.exportMemory().learned.snackSpot, {
      x: 740,
      y: 472,
      meals: 3,
    });
    assert.equal(restored.exportMemory().learned.snackCandidate, null);
  }
);

test("a learned trick is occasionally volunteered and still needs a reward to improve", () => {
  const sim = setup();
  sim.restoreMemory({ learned: { tricks: { spin: 3 } } });
  advance(sim, 100);
  sim.configure({ paused: false, mischief: 1 });
  sim.step(0.05);
  assert.equal(sim.inspect().scene.kind, "trick");
  assert.equal(sim.inspect().scene.unsolicited, true);
  reach(sim, "reward");
  assert.equal(sim.exportMemory().learned.tricks.spin, 3);
  sim.action("feed");
  sim.step(0.05);
  assert.equal(sim.exportMemory().learned.tricks.spin, 4);
});

test(
  "after-play scratches are learned once per completed game and become an expected " +
  "ritual",
  () => {
    const sim = setup();
    scratch(sim);
    assert.equal(sim.exportMemory().learned.scratchesAfterPlay, 0);

    for (let lesson = 1; lesson <= 3; lesson++) {
      play(sim);
      scratch(sim);
      assert.equal(sim.exportMemory().learned.scratchesAfterPlay, lesson);
      scratch(sim);
      assert.equal(sim.exportMemory().learned.scratchesAfterPlay, lesson);
    }

    const restored = setup();
    restored.restoreMemory(sim.exportMemory());
    play(restored);
    assert.equal(restored.inspect().pose, "tilt");
    assert.match(restored.inspect().bubble, /head bit/);
    scratch(restored);
    assert.equal(restored.exportMemory().learned.scratchesAfterPlay, 4);
  }
);

test("cancelled games and stale post-game scratches do not teach rituals", () => {
  for (const interruption of ["cancel", "hide", "expire"]) {
    const sim = setup();

    if (interruption === "cancel") {
      sim.action("play_cap");
      advance(sim, 1);
      sim.action("cancel");
    } else {
      play(sim);

      if (interruption === "hide") {
        sim.setVisible(false);
        sim.setVisible(true);
      } else {
        advance(sim, 20);
      }
    }

    scratch(sim);
    assert.equal(
      sim.exportMemory().learned.scratchesAfterPlay,
      0,
      interruption,
    );
  }
});

test("play-dead rotation resets on all interruptions and small displays keep tricks finite", () => {
  for (const trick of ["come", "spin", "dead"]) {
    const sim = setup();
    sim.action(`trick_${trick}`, { x: 850, y: 600 });
    reach(sim, "perform");
    advance(sim, 0.8);

    if (trick === "dead") {
      assert.ok(Math.abs(sim.present().rotation) > 80);
    }

    sim.resize(100, 100);

    for (let tick = 0; tick < 800; tick++) {
      sim.step(0.05);
      const view = sim.inspect();
      assert.ok(view.x >= 0 && view.x <= 4);
      assert.ok(view.y >= 0 && view.y <= 4);
    }

    assert.equal(sim.inspect().scene, null);
    assert.equal(sim.present().rotation, 0);
  }
});

test("invalid learning data is bounded and forgetting affects only learned habits", () => {
  const memory = normalizeMemory({
    learned: {
      tricks: { come: 999, spin: -1, dead: "3", fly: 5 },
      snackSpot: { x: Infinity, y: 20, meals: 3 },
      scratchesAfterPlay: NaN,
      pendingReward: "spin",
    },
  });
  assert.deepEqual(memory.learned, {
    tricks: { come: 6, spin: 0, dead: 0 },
    snackSpot: null,
    snackCandidate: null,
    scratchesAfterPlay: 0,
  });
  const sim = setup();
  sim.restoreMemory({
    ...memory,
    perch: { x: 30, y: 40 },
    collection: { sock: 2 },
  });
  sim.action("forget_learning");
  assert.deepEqual(sim.exportMemory().learned, normalizeMemory().learned);
  assert.deepEqual(sim.exportMemory().perch, { x: 30, y: 40 });
  assert.deepEqual(sim.exportMemory().collection, { sock: 2 });
});

test("unpaid tricks survive restart until a snack is consumed", () => {
  const sim = setup();
  perform(sim, "spin");
  perform(sim, "dead");
  const restored = setup();
  restored.restoreMemory(sim.exportMemory());
  restored.action("trick_come");
  assert.equal(restored.inspect().scene.phase, "refuse");
  assert.equal(restored.exportMemory().performances.come, 0);
  assert.equal(restored.exportMemory().trickRefusals, 1);
  assert.equal(restored.exportMemory().episodes.at(-1).detail, "trick_refusal");
  restored.action("feed_here", { x: 850, y: 600 });
  restored.action("cancel");
  assert.equal(restored.exportMemory().unpaidTricks, 2);
  restored.action("feed");
  advance(restored, 3);
  assert.equal(restored.exportMemory().unpaidTricks, 0);
  assert.equal(restored.exportMemory().trickRefusals, 0);
  assert.equal(restored.exportMemory().learned.tricks.come, 0);
  perform(restored);
});

test("refusals escalate by mischief, and pause suppresses physical protests", () => {
  for (const mischief of [0, 1, 2]) {
    const sim = setup();
    perform(sim);
    perform(sim);
    sim.configure({ paused: false, mischief });
    sim.action("trick_spin");
    advance(sim, 2.6);
    assert.equal(sim.inspect().scene, null);
    sim.action("trick_spin");
    advance(sim, 2.6);
    assert.equal(sim.inspect().scene?.kind ?? null, mischief > 0 ? "pretend_leave" : null);
    sim.action("trick_dead");
    advance(sim, 2.6);
    const expected = [null, "pretend_leave", "cursor"][mischief];
    assert.equal(sim.inspect().scene?.kind ?? null, expected);
    assert.equal(sim.exportMemory().performances.spin, 2);
    assert.equal(sim.exportMemory().performances.dead, 0);
    sim.action("cancel");
    assert.equal(sim.inspect().scene, null);
    sim.configure({ paused: true });
    sim.action("trick_spin");
    advance(sim, 3);
    assert.equal(sim.inspect().scene, null);
  }
});

test("interrupted tricks and volunteered performances do not incur snack debt", () => {
  const sim = setup();
  sim.action("trick_spin");
  sim.action("cancel");
  assert.equal(sim.exportMemory().unpaidTricks, 0);
  sim.action("show_spin");
  reach(sim, "reward");
  assert.equal(sim.exportMemory().unpaidTricks, 0);
  perform(sim);
  perform(sim);
  sim.action("forget_learning");
  assert.equal(sim.exportMemory().unpaidTricks, 0);
  assert.equal(sim.exportMemory().trickRefusals, 0);
  perform(sim);
});

test("legacy and malformed snack debt normalizes safely", () => {
  assert.equal(normalizeMemory({}).unpaidTricks, 0);
  assert.equal(normalizeMemory({ unpaidTricks: Infinity }).unpaidTricks, 0);
  assert.equal(normalizeMemory({ unpaidTricks: 999 }).unpaidTricks, 2);
  assert.equal(normalizeMemory({ trickRefusals: -2 }).trickRefusals, 0);
});

test("strike cools off in real time without requests extending it", () => {
  let nowMs = 1000;
  const sim = setup({ now: () => nowMs });
  perform(sim);
  perform(sim);
  const deadlineMs = sim.exportMemory().trickCooldownUntilMs;
  assert.equal(deadlineMs, nowMs + 120_000);
  nowMs = deadlineMs - 1;
  sim.action("trick_dead");
  assert.equal(sim.inspect().scene.phase, "refuse");
  assert.equal(sim.exportMemory().trickCooldownUntilMs, deadlineMs);
  nowMs = deadlineMs;
  sim.action("trick_dead");
  assert.equal(sim.inspect().scene.phase, "consider");
  assert.equal(sim.exportMemory().trickRefusals, 0);
  assert.equal(sim.exportMemory().unpaidTricks, 0);
  assert.equal(sim.exportMemory().performances.spin, 2);
});

test("time away clears a strike and legacy debt receives a bounded cooldown", () => {
  let nowMs = 5000;
  const sim = setup({ now: () => nowMs });
  perform(sim);
  perform(sim);
  const saved = sim.exportMemory();
  nowMs += 120_000;
  const restored = setup({ now: () => nowMs });
  restored.restoreMemory(saved);
  perform(restored);
  assert.equal(restored.exportMemory().unpaidTricks, 1);

  restored.restoreMemory({ unpaidTricks: 2, trickRefusals: 3 });
  assert.equal(restored.exportMemory().trickCooldownUntilMs, nowMs + 120_000);
  nowMs += 120_000;
  assert.equal(restored.exportMemory().unpaidTricks, 0);
  assert.equal(restored.exportMemory().trickRefusals, 0);
});

test("a snack forgives immediately without waiting for the cooldown", () => {
  const sim = setup({ now: () => 1000 });
  perform(sim);
  perform(sim);
  sim.action("trick_spin");
  sim.action("feed");
  advance(sim, 3);
  assert.equal(sim.exportMemory().unpaidTricks, 0);
  assert.equal(sim.exportMemory().trickCooldownUntilMs, null);
  perform(sim);
});

test("the second unpaid trick is deliberately slow and still earns a real reward", () => {
  for (const trick of ["come", "spin", "dead"]) {
    const sim = setup();
    perform(sim);
    sim.action(`trick_${trick}`, { x: 850, y: 600 });
    assert.equal(sim.inspect().scene.reluctant, true);
    reach(sim, "perform");
    const scene = sim.inspect().scene;
    const durations = { come: 43.2, spin: 6, dead: 8.4 };
    assert.ok(Math.abs(scene.until - scene.phaseStarted - durations[trick]) < 0.001);
    advance(sim, 3);
    assert.equal(sim.inspect().scene.phase, "perform");
    assert.equal(sim.exportMemory().unpaidTricks, 1);
    reach(sim, "reward");
    assert.equal(sim.exportMemory().unpaidTricks, 2);
    assert.match(sim.inspect().bubble, /expectant gull/);
    assert.equal(sim.present().pose, "tilt");
    sim.action("feed");
    advance(sim, 3);
    assert.equal(sim.exportMemory().learned.tricks[trick], 1);
    sim.action(`trick_${trick}`);
    assert.equal(sim.inspect().scene.reluctant, false);
  }
});

test("volunteered tricks keep their normal pace even with an unpaid trick", () => {
  const sim = setup();
  perform(sim);
  sim.action("show_spin");
  assert.equal(sim.inspect().scene.reluctant, false);
  reach(sim, "perform");
  advance(sim, 2.6);
  assert.equal(sim.inspect().scene.phase, "reward");
  assert.equal(sim.exportMemory().unpaidTricks, 1);
});

test("refusal drags an invoice, pecks it, and removes it on interruption", () => {
  for (const command of ["cancel", "feed", "forget_learning"]) {
    const sim = setup();
    perform(sim);
    perform(sim);
    sim.action("trick_spin");
    const first = sim.present().props.find((prop) => prop.id === "snack-invoice");
    assert.match(first.text, /2 tricks unpaid\nCHIP DUE/);
    advance(sim, 0.5);
    const dragged = sim.present().props.find((prop) => prop.id === "snack-invoice");
    assert.notEqual(dragged.x, first.x);
    advance(sim, 0.55);
    assert.equal(sim.present().pose, "nibble");
    assert.equal(sim.present().props[0].rotation, 0);
    sim.action(command);
    assert.equal(sim.present().props.some((prop) => prop.id === "snack-invoice"), false);
    assert.equal(sim.present().rotation, 0);
  }
});

test("invoice stays within a resized display and disappears when the debt expires", () => {
  let nowMs = 1000;
  const sim = setup({ now: () => nowMs });
  perform(sim);
  perform(sim);
  sim.action("trick_spin");
  sim.resize(100, 100);
  const invoice = sim.present().props[0];
  assert.ok(invoice.x >= 0 && invoice.y >= 0);
  assert.ok(invoice.x + invoice.width <= 100);
  assert.ok(invoice.y + invoice.height <= 100);
  nowMs += 120_000;
  sim.step(0.05);
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.present().props.length, 0);
});
