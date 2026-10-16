import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { reach as reachPhase } from "./simulation-helpers.mjs";
function bird(random = () => 0.5) {
  const sim = new Gullbert(900, 650, random);
  sim.configure({ paused: true });
  return sim;
}
function advance(sim, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 20); i++) {
    sim.step(0.05);
  }
}
function reach(sim, phase) {
  for (let i = 0; i < 600 && sim.inspect().scene?.phase !== phase; i++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().scene?.phase, phase);
}
function hold(sim) {
  const rect = sim.pickupRect();
  const point = { x: rect.x + 30, y: rect.y + 30 };
  assert.equal(sim.beginPickup(point, 1000), true);
  return point;
}
function drag(sim) {
  const point = hold(sim);
  sim.movePickup({ x: point.x + 10, y: point.y });
}
function belongings(sim) {
  sim.restoreMemory({
    perch: { x: 100, y: 200 },
    collection: { bottle_cap: 2 },
  });
  return sim.exportMemory();
}

function looseFood(sim) {
  sim.action("gull_argument");
  sim.action("tidy");
  assert.equal(sim.inspect().looseChips.length, 6);
}

test(
  "Stop and replacement discard food and pending effects, preserving mess and " +
  "belongings",
  () => {
    for (const command of ["cancel", "nap"]) {
      for (const source of ["feed", "poop", "loose-food"]) {
        const sim = bird();
        const memory = belongings(sim);
        sim.splat({ x: 100, y: 100 });
        sim.action("municipal_gull");
        reachPhase(sim, "leave");
        sim.action("place_bag", { x: 74, y: 74 });

        if (source === "loose-food") {
          looseFood(sim);
        } else {
          sim.action(source, { x: 700, y: 200 });
        }

        const mess = structuredClone([
          sim.inspect().splats,
          sim.inspect().cones,
          sim.inspect().rubbish,
          sim.inspect().bag,
        ]);
        sim.action(command);
        assert.equal(sim.inspect().crumb, null);
        assert.deepEqual(sim.inspect().looseChips, []);
        assert.deepEqual(sim.inspect().pendingPoop, null);
        assert.deepEqual(sim.inspect().flight, null);
        assert.deepEqual(sim.inspect().events, []);
        assert.equal(sim.inspect().mode, command === "cancel" ? "idle" : "nap");

        if (command === "cancel") {
          assert.equal(sim.inspect().until, sim.inspect().time + 2);
        }

        advance(sim, 8);
        assert.deepEqual(
          [
            sim.inspect().splats,
            sim.inspect().cones,
            sim.inspect().rubbish,
            sim.inspect().bag,
          ],
          mess,
        );
        assert.deepEqual(sim.exportMemory(), memory);
      }
    }
  }
);

test("an unrecognized replacement retains the current mode and deadline without resting", () => {
  for (const command of ["squawk", "feed"]) {
    const sim = bird();
    sim.action(command);
    const { mode, until } = sim.inspect();
    sim.action("not-a-command");
    assert.equal(sim.inspect().mode, mode);
    assert.equal(sim.inspect().until, until);
    assert.equal(sim.inspect().bubble, "");
    assert.deepEqual(sim.inspect().events, []);
    assert.equal(sim.inspect().crumb, null);
    assert.deepEqual(sim.inspect().looseChips, []);
  }
});

test(
  "tidy retains offered and existing loose chips while harvesting scene chips with a " +
  "six-chip cap",
  () => {
    const sim = bird();
    sim.action("feed");
    const offered = sim.inspect().crumb;
    sim.action("tidy");
    assert.deepEqual(sim.inspect().crumb, offered);
    assert.equal(sim.inspect().cleanup.session.until, sim.inspect().time + 30);
    sim.action("apology");
    sim.action("tidy");
    assert.deepEqual(
      sim.inspect().looseChips,
      [],
      "held apology food is excluded",
    );
    sim.action("gull_argument");
    const chips = sim.present().props.filter((prop) => prop.asset === "chip");
    sim.action("tidy");
    assert.equal(sim.inspect().looseChips.length, 6);
    assert.deepEqual(
      sim.inspect().looseChips.map(({ id, ...geometry }) => geometry),
      chips.map(({ id, ...geometry }) => geometry),
    );
    const existing = sim.inspect().looseChips;
    sim.action("tidy");
    assert.deepEqual(sim.inspect().looseChips, existing);
    assert.deepEqual(sim.inspect().scene, null);
    assert.equal(sim.inspect().mode, "idle");
  }
);

test(
  "only the first finite six-pixel drag interrupts, retaining gesture, offset, loose " +
  "chips and histories",
  () => {
    for (const source of ["poop", "loose-food"]) {
      const sim = bird();
      drag(sim);
      sim.finishPickup(false, 1100);
      sim.clean();

      if (source === "loose-food") {
        looseFood(sim);
      } else {
        sim.action("poop", { x: 700, y: 200 });
      }

      // Focused tidying deliberately excludes pickup; ending it preserves its chips.
      if (source === "loose-food") {
        sim.action("tidy_done");
      }

      const before = sim.inspect();
      const point = hold(sim);
      const held = sim.inspect().pickup.held;

      for (const invalid of [
        { x: NaN, y: point.y },
        { x: point.x, y: Infinity },
        { x: point.x + 5.9, y: point.y },
      ]) {
        sim.movePickup(invalid);
      }

      assert.deepEqual(sim.inspect().flight, before.flight);
      assert.equal(sim.inspect().pickup.held.dragged, false);
      sim.movePickup({ x: point.x + 6, y: point.y });
      const moved = sim.inspect();
      assert.equal(moved.pickup.held.dragged, true);
      assert.deepEqual(moved.pickup.held.offset, held.offset);
      assert.equal(moved.x, point.x + 6 - held.offset.x);
      assert.equal(moved.y, point.y - held.offset.y);
      assert.equal(moved.mode, "carried");
      assert.equal(moved.flight, null);
      assert.equal(moved.pendingPoop, null);
      assert.equal(moved.crumb, null);
      assert.deepEqual(moved.events, []);
      assert.deepEqual(moved.looseChips, before.looseChips);
      assert.equal(moved.bubble, "excuse me?!");
      assert.deepEqual(moved.pickup.recent, before.pickup.recent);
      assert.equal(moved.pickup.nextRevenge, before.pickup.nextRevenge);
      assert.equal(moved.cleanup.suppressUntil, before.cleanup.suppressUntil);
      assert.equal(
        moved.cleanup.retaliationAllowedAt,
        before.cleanup.retaliationAllowedAt,
      );
      sim.movePickup({ x: point.x + 20, y: point.y + 10 });
      assert.equal(sim.inspect().bubble, moved.bubble);
      sim.finishPickup(true, 1200);
      advance(sim, 8);
      assert.deepEqual(sim.inspect().splats, []);
    }
  }
);

test("tidy and drag cancel every reachable gift phase without a later reward", () => {
  for (const phase of [
    "takeoff",
    "depart",
    "away",
    "return",
    "land",
    "reveal",
  ]) {
    for (const interruption of ["tidy", "drag"]) {
      const sim = bird(() => 0);
      sim.action("bring_gift");
      reach(sim, phase);

      if (interruption === "drag" && phase === "away") {
        const rect = sim.pickupRect();
        assert.equal(
          sim.beginPickup({ x: rect.x + 30, y: rect.y + 30 }, 0),
          false,
        );
        continue;
      }

      if (interruption === "tidy") {
        sim.action("tidy");
      } else {
        drag(sim);
        sim.finishPickup(true, sim.inspect().pickup.now);
      }

      assert.deepEqual(sim.inspect().scene, null);
      advance(sim, 35);
      assert.deepEqual(
        sim.inspect().memory.collection,
        {},
        `${interruption}: ${phase}`,
      );
    }
  }
});

test("tidy and Stop interrupt takeoff and flight before any pending drop appears", () => {
  for (const seconds of [0, 0.6]) {
    for (const command of ["tidy", "cancel"]) {
      const sim = bird();
      sim.action("poop", { x: 800, y: 100 });
      advance(sim, seconds);
      assert.ok(sim.inspect().flight);
      assert.ok(sim.inspect().pendingPoop);
      sim.action(command);
      advance(sim, 10);
      assert.deepEqual(sim.inspect().splats, []);
      assert.deepEqual(sim.inspect().pendingPoop, null);
      assert.deepEqual(sim.inspect().flight, null);
    }
  }
});

test(
  "direct and tidy picks preserve an unrelated flight and completion reaction " +
  "scheduling",
  () => {
    const sim = bird(() => 0);
    sim.configure({ paused: false, mischief: 2 });
    sim.splat({ x: 100, y: 100 });
    sim.splat({ x: 200, y: 100 });
    sim.splat({ x: 300, y: 100 });
    const lastId = sim.inspect().splats.at(-1).id;
    sim.action("poop", { x: 800, y: 100 });
    const flight = sim.inspect().flight;
    const pending = sim.inspect().pendingPoop;
    sim.action("direct_pick", { x: 100, y: 100 });
    sim.action("tidy_pick", { x: 200, y: 100 });
    assert.deepEqual(
      sim.inspect().splats.map((splat) => splat.id),
      [lastId],
    );
    assert.deepEqual(sim.inspect().flight, flight);
    assert.deepEqual(sim.inspect().pendingPoop, pending);
    assert.deepEqual(sim.inspect().events, []);
    sim.action("tidy_done");
    assert.deepEqual(sim.inspect().flight, flight);
    assert.equal(sim.inspect().cleanup.session, null);
    assert.equal(sim.inspect().cleanup.sulkUntil, sim.inspect().time + 10);
    assert.deepEqual(sim.inspect().cleanup.retaliation, {
      at: sim.inspect().time + 5,
      kind: "splat",
      bag: null,
    });
  }
);

test("caught preserves theft deadline and bag before generic replacement", () => {
  const sim = bird();
  sim.action("place_bag", { x: 300, y: 300 });
  sim.action("steal_bag");
  const { scene, bag } = sim.inspect();
  sim.action("caught");
  assert.equal(sim.inspect().scene.kind, "theft");
  assert.equal(sim.inspect().scene.phase, "innocent");
  assert.equal(sim.inspect().scene.deadline, scene.deadline);
  assert.deepEqual(sim.inspect().bag, bag);
  advance(sim, 1);
  sim.action("caught");
  assert.equal(sim.inspect().scene.deadline, scene.deadline);
});

test(
  "direct Clean preserves touch while command Clean resets it; both retain queued " +
  "sounds and belongings",
  () => {
    for (const command of [false, true]) {
      const sim = bird();
      const memory = belongings(sim);
      sim.splat({ x: 10, y: 20 });
      sim.action("cancel");
      sim.action("direct_pick", {
        x: sim.inspect().x + 45,
        y: sim.inspect().y + 65,
      });
      assert.equal(sim.inspect().touch.reaction, "poke");
      const beforeTouch = sim.inspect().touch;
      const events = sim.inspect().events;

      if (command) {
        sim.action("clean");
      } else {
        sim.clean();
      }

      if (command) {
        assert.equal(sim.inspect().touch.reaction, "");
        assert.deepEqual(sim.inspect().touch.pokes, []);
      } else {
        assert.deepEqual(sim.inspect().touch, beforeTouch);
      }

      assert.deepEqual(sim.inspect().events, events);
      assert.deepEqual(sim.exportMemory(), memory);
      assert.equal(sim.inspect().crumb, null);
      assert.deepEqual(sim.inspect().looseChips, []);
      assert.equal(sim.inspect().cleanup.level, 2);
      assert.equal(sim.inspect().cleanup.reactionUntil, sim.inspect().time + 2);
      assert.equal(sim.inspect().cleanup.suppressUntil, sim.inspect().time + 30);
      assert.equal(sim.inspect().bubble, "you've ruined the atmosphere.");
    }
  }
);

test("Hide cancels selected encounters and suspends other activities until Return", () => {
  for (const [command, cancels] of [
    ["pretend_leave", true],
    ["cursor_egg", true],
    ["municipal_gull", true],
    ["apology", true],
    ["nibble_cursor", true],
    ["invite_pigeon", true],
    ["gull_argument", true],
    ["bring_gift", false],
    ["bath_time", false],
    ["steal_bag", false],
    ["bag_caper", false],
    ["poop", false],
    ["feed", false],
    ["nap", false],
  ]) {
    const sim = bird();
    sim.action("place_bag", { x: 200, y: 200 });
    sim.action(command);
    const scene = sim.inspect().scene;
    const flight = sim.inspect().flight;
    const mode = sim.inspect().mode;
    sim.setVisible(false);
    assert.deepEqual(sim.inspect().scene, cancels ? null : scene, command);
    assert.deepEqual(sim.inspect().flight, flight, command);
    assert.equal(sim.inspect().mode, cancels ? "idle" : mode, command);
    assert.deepEqual(sim.inspect().events, []);
    const frozen = structuredClone([
      sim.inspect().time,
      sim.inspect().scene,
      sim.inspect().flight,
      sim.inspect().x,
      sim.inspect().y,
    ]);
    advance(sim, 60);
    assert.deepEqual(
      [
        sim.inspect().time,
        sim.inspect().scene,
        sim.inspect().flight,
        sim.inspect().x,
        sim.inspect().y,
      ],
      frozen,
      command,
    );
    sim.setVisible(true);
    assert.deepEqual(sim.inspect().scene, cancels ? null : scene, command);
    sim.step(0.05);
    assert.equal(sim.inspect().time, frozen[0] + 0.05);
  }
});

test("increased mischief cancels holding and relocation; unchanged mischief preserves them", () => {
  for (const released of [false, true]) {
    for (const level of [1, 2]) {
      const sim = bird();
      drag(sim);

      if (released) {
        sim.finishPickup(false, 1100);
      }

      const held = sim.inspect().pickup.held;
      const scene = sim.inspect().scene;
      const recent = [...sim.inspect().pickup.recent];
      sim.configure({ mischief: level });
      assert.deepEqual(sim.inspect().pickup.held, level === 1 ? held : null);
      assert.deepEqual(sim.inspect().scene, level === 1 ? scene : null);
      assert.deepEqual(sim.inspect().pickup.recent, recent);

      if (level === 2) {
        assert.equal(sim.inspect().mode, "idle");
      }
    }
  }
});

test(
  "unchanged settings preserve retaliation, changed levels cancel it, and pause " +
  "cancels ordinary cursor encounters",
  () => {
    const sim = bird();
    sim.configure({ paused: false, mischief: 2 });
    drag(sim);
    sim.finishPickup(false, 1100);
    advance(sim, 0.75);
    assert.equal(sim.inspect().scene.kind, "cursor");
    assert.equal(sim.inspect().scene.retaliation, true);
    const scene = sim.inspect().scene;
    sim.configure({ mischief: 2 });
    assert.deepEqual(sim.inspect().scene, scene);
    sim.configure({ mischief: 1 });
    assert.deepEqual(sim.inspect().scene, null);
    assert.equal(sim.inspect().nextNibble, sim.inspect().time + 90);
    sim.action("nibble_cursor");
    const ordinary = sim.inspect().scene;
    assert.equal(ordinary.kind, "cursor");
    sim.configure({ mischief: 2 });
    assert.deepEqual(sim.inspect().scene, ordinary);
    sim.configure({ paused: true });
    assert.deepEqual(sim.inspect().scene, null);
  }
);

test(
  "guest interruption draws exactly once for cooldown and repeated teardown leaves " +
  "it intact",
  () => {
    for (const interrupt of [
      (sim) => sim.action("cancel"),
      (sim) => sim.action("tidy"),
      (sim) => drag(sim),
      (sim) => sim.clean(),
      (sim) => sim.setVisible(false),
    ]) {
      let draws = 0;
      const sim = bird(() => {
        draws += 1;
        return draws / 100;
      });
      sim.action("gull_argument");
      const before = draws;
      interrupt(sim);
      assert.deepEqual(sim.inspect().scene, null);
      assert.equal(draws, before + 1);
      assert.equal(
        sim.inspect().nextGuest,
        sim.inspect().time + 240 + ((before + 1) / 100) * 180,
      );
      const cooldown = sim.inspect().nextGuest;
      sim.action("cancel");
      assert.equal(draws, before + 1);
      assert.equal(sim.inspect().nextGuest, cooldown);
    }
  }
);
