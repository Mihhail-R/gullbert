import test from "node:test";
import assert from "node:assert/strict";
import { routineFixture } from "./routine-fixture.mjs";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { GagRoutine } from "../web-dist/simulation/behaviors/gags.js";

const commands = [
  "pretend_leave",
  "cursor_egg",
  "municipal_gull",
  "apology",
  "postcards",
];
function setup(width = 900, height = 650, random = () => 0.5) {
  const sim = new Gullbert(width, height, random);
  sim.configure({ paused: true, mischief: 0 });
  return sim;
}
function advance(sim, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 20); i++) {
    sim.step(0.05);
  }
}
function until(sim, phase) {
  for (let i = 0; i < 300 && sim.inspect().scene?.phase !== phase; i++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().scene?.phase, phase);
}
function egg(sim) {
  sim.action("cursor_egg");
  sim.pointer({ x: sim.inspect().x + 48, y: sim.inspect().y + 76 });
}

test("postcards emerge from either edge, stay readable during the show, and leave no mess", () => {
  for (const x of [90, 800]) {
    const sim = setup();
    sim.action("summon", { x, y: 550 });
    const memory = sim.exportMemory();
    sim.action("postcards");
    const side = sim.inspect().scene.side;
    assert.equal(side, x < 450 ? -1 : 1);
    assert.equal(sim.inspect().wantsPointer, false);
    assert.deepEqual(sim.present().props, []);
    until(sim, "pull");
    const emerging = sim.present().props[0];
    assert.equal(emerging.x, side < 0 ? -96 : 900);
    advance(sim, 0.5);
    const pulled = sim.present().props[0];
    assert.ok(side < 0 ? pulled.x > emerging.x : pulled.x < emerging.x);
    until(sim, "show");
    const photo = sim.present().props[0];
    assert.match(photo.asset, /^postcard-(liberty|giza|car|eiffel)\.png$/);
    assert.equal(photo.width, 96);
    assert.equal(photo.height, 96);
    assert.ok(photo.x >= 0 && photo.x + photo.width <= 900);
    assert.ok(photo.y >= 0 && photo.y + photo.height <= 650);
    assert.equal(
      photo.flip,
      undefined,
      "souvenir stays readable in both directions",
    );
    assert.equal(sim.inspect().bubble, sim.inspect().scene.caption);
    advance(sim, 4);
    assert.equal(sim.inspect().scene.phase, "show");
    until(sim, "tuck");
    advance(sim, 0.3);
    assert.ok(sim.present().props[0].opacity < 1);
    advance(sim, 1);
    assert.equal(sim.inspect().scene, null);
    assert.deepEqual(sim.present().props, []);
    assert.deepEqual(sim.inspect().splats, []);
    const saved = sim.exportMemory();
    assert.equal(saved.episodes.at(-1).detail, "postcards");
    assert.deepEqual({ ...saved, episodes: [] }, memory);
  }
});

test("every postcard can be selected and consecutive shows choose different photos", () => {
  const seen = new Set();

  for (const random of [0, 0.3, 0.6, 0.99]) {
    const sim = setup(900, 650, () => random);
    sim.action("postcards");
    const first = sim.inspect().scene.photo;
    seen.add(first);
    sim.action("postcards");
    assert.notEqual(sim.inspect().scene.photo, first);
  }

  assert.deepEqual([...seen].sort(), ["car", "eiffel", "giza", "liberty"]);
});

test("postcard startup rolls its schedule before selecting a photo", () => {
  const rolls = [0.25, 0.99, 0.75, 0];
  let randomCalls = 0;
  const sim = routineFixture(GagRoutine, () => {
    assert.ok(randomCalls < rolls.length, "no unexpected random draw");
    return rolls[randomCalls++];
  });
  sim.settings.mischief = 1;
  sim.time = 10;
  sim.action("postcards");
  assert.equal(randomCalls, 2);
  assert.equal(sim.gagSchedule.at, 10 + 240 + 0.25 * 180);
  assert.equal(sim.scene.photo, "eiffel");

  sim.time = 20;
  sim.action("postcards");
  assert.equal(randomCalls, 4);
  assert.equal(sim.gagSchedule.at, 20 + 240 + 0.75 * 180);
  assert.equal(sim.scene.photo, "liberty");
});

test("fake departure walks to the nearest edge, disappears two seconds, peeks and returns", () => {
  for (const x of [30, 750]) {
    const sim = setup();
    sim.action("summon", { x, y: sim.inspect().y });
    const origin = { x: sim.inspect().x, y: sim.inspect().y };
    sim.action("pretend_leave");
    assert.equal(sim.inspect().scene.side, x < 400 ? -1 : 1);
    const phases = new Set();
    let awayStart, awayEnd;

    for (let i = 0; i < 300; i++) {
      const phase = sim.inspect().scene?.phase;
      phases.add(phase);

      if (phase === "away") {
        awayStart ??= sim.inspect().time;
        awayEnd = sim.inspect().time;
        assert.equal(sim.present().visualOffset.opacity, 0);
      }

      if (phase === "peek") {
        assert.equal(sim.inspect().facing, -sim.inspect().scene.side);
        assert.equal(Math.abs(sim.present().visualOffset.x), 64);
        assert.equal(sim.inspect().bubble, "forgot something.");
      }

      sim.step(0.05);
    }

    for (const phase of [
      "approach",
      "depart",
      "away",
      "peek",
      "reenter",
      "return",
    ]) {
      assert.ok(phases.has(phase), phase);
    }

    assert.ok(awayEnd - awayStart >= 1.9);
    assert.equal(sim.inspect().scene, null);
    assert.deepEqual({ x: sim.inspect().x, y: sim.inspect().y }, origin);
    assert.deepEqual(sim.present().visualOffset, { x: 0, opacity: 1 });
  }
});

test(
  "manual egg samples pointer while paused, settles after a stable second and " +
  "notices hatching",
  () => {
    const sim = setup();
    egg(sim);
    const point = { ...sim.inspect().scene.pointer };
    assert.equal(sim.inspect().wantsPointer, true);
    advance(sim, 0.8);
    assert.equal(sim.inspect().scene.phase, "approach");
    sim.pointer({ x: point.x + 7, y: point.y });
    advance(sim, 0.3);
    assert.equal(sim.inspect().scene.phase, "settle");
    assert.equal(sim.inspect().pose, "crouch");
    sim.pointer({ x: sim.inspect().scene.nest.x + 24, y: point.y });
    assert.equal(sim.inspect().scene.phase, "settle");
    sim.pointer({ x: sim.inspect().scene.nest.x + 25, y: point.y });
    assert.equal(sim.inspect().scene.phase, "inspect");
    assert.equal(sim.inspect().bubble, "it hatched.");
    advance(sim, 1.4);
    assert.equal(sim.inspect().scene, null);
    assert.equal(sim.inspect().wantsPointer, false);
    assert.equal(sim.inspect().events.includes("munch"), false);
  }
);

test("egg stability resets beyond eight pixels and ends if it never settles", () => {
  const sim = setup();
  egg(sim);
  const origin = { ...sim.inspect().scene.pointer };

  for (let i = 0; i < 17; i++) {
    sim.pointer({ x: origin.x + (i % 2) * 12, y: origin.y });
    advance(sim, 0.5);
    assert.notEqual(sim.inspect().scene?.phase, "settle");
  }

  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().bubble, "not ready for parenthood.");
});

test(
  "egg gives up with no sample, a lost pointer, an invalid pointer, or a five-second " +
  "incubation",
  () => {
    for (const sample of [
      null,
      { x: 12, y: 12, inside: false },
      { x: NaN, y: 12 },
      { x: -1, y: 12 },
      { x: 10000, y: 20 },
    ]) {
      const sim = setup();
      egg(sim);
      until(sim, "settle");
      sim.pointer(sample);
      assert.equal(sim.inspect().scene, null);
      assert.equal(sim.inspect().wantsPointer, false);
    }

    const sim = setup();
    sim.action("cursor_egg");
    advance(sim, 1.6);
    assert.equal(sim.inspect().scene, null);
    egg(sim);
    until(sim, "settle");
    advance(sim, 5.1);
    assert.equal(sim.inspect().scene, null);
    assert.equal(sim.inspect().bubble, "incubation postponed.");
  }
);

test(
  "municipal gull places three stable cones, moves one, leaves and expires them " +
  "after visible time",
  () => {
    const sim = setup();
    sim.action("municipal_gull");
    until(sim, "inspect");
    const placed = structuredClone(sim.inspect().cones);
    assert.equal(placed.length, 3);
    assert.equal(new Set(placed.map((c) => c.id)).size, 3);
    until(sim, "leave");
    assert.deepEqual(
      sim.inspect().cones.map((c) => c.id),
      placed.map((c) => c.id),
    );
    assert.notDeepEqual(sim.inspect().cones[0], placed[0]);
    assert.deepEqual(sim.inspect().cones.slice(1), placed.slice(1));
    advance(sim, 4);
    assert.equal(sim.inspect().scene, null);
    assert.equal(sim.inspect().cones.length, 3);
    sim.setVisible(false);
    advance(sim, 100);
    assert.equal(sim.inspect().cones.length, 3);
    sim.setVisible(true);
    advance(sim, 91);
    assert.equal(sim.inspect().cones.length, 0);
  }
);

test(
  "one municipal arrangement maximum, clean removes cones and cancellation never " +
  "adds delayed cones",
  () => {
    const sim = setup();
    sim.action("municipal_gull");
    until(sim, "inspect");
    const previous = sim.inspect().cones.map((c) => c.id);
    sim.action("municipal_gull");
    until(sim, "inspect");
    assert.equal(sim.inspect().cones.length, 3);
    assert.ok(sim.inspect().cones.every((c) => !previous.includes(c.id)));
    sim.action("cancel");
    const snapshot = structuredClone(sim.inspect().cones);
    advance(sim, 16);
    assert.deepEqual(sim.inspect().cones, snapshot);
    sim.action("clean");
    assert.deepEqual(sim.inspect().cones, []);
  }
);

test("apology carries and offers one chip for two seconds then eats it without a reward", () => {
  const sim = setup();
  const memory = sim.exportMemory(),
    revision = sim.inspect().memoryRevision;
  sim.action("apology");
  assert.equal(sim.present().props.length, 1);
  until(sim, "offer");
  advance(sim, 1.9);
  assert.equal(sim.inspect().scene.phase, "offer");
  assert.equal(sim.present().props.length, 1);
  until(sim, "eat");
  assert.deepEqual(sim.present().props, []);
  advance(sim, 1.1);
  assert.equal(sim.inspect().scene, null);
  assert.equal(sim.inspect().bubble, "glad we resolved that.");
  const saved = sim.exportMemory();
  assert.equal(saved.episodes.at(-1).detail, "apology");
  assert.equal(saved.episodes.filter((episode) => episode.kind === "meal").length, 1);
  assert.equal(saved.learned.snackSpot.meals, 1);
  assert.deepEqual(saved.learned.tricks, memory.learned.tricks);
  assert.deepEqual({ ...saved, episodes: [], learned: memory.learned }, memory);
  assert.ok(sim.inspect().memoryRevision > revision);
  assert.deepEqual(sim.inspect().events, ["munch"]);
});

test(
  "all gags permit explicit play with autonomy paused, remain bounded and cancel on " +
  "hide or replacement",
  () => {
    for (const command of commands) {
      for (const replacement of ["hide", "cancel", "nap", "clean", "feed"]) {
        const sim = setup();
        sim.action(command);
        assert.equal(sim.inspect().scene.kind, command);
        advance(sim, 0.5);

        if (replacement === "hide") {
          sim.setVisible(false);
        } else {
          sim.action(replacement);
        }

        assert.equal(sim.inspect().scene, null, `${command}/${replacement}`);
        assert.deepEqual(sim.present().props, []);
        assert.equal(sim.present().visualOffset.x, 0);
        advance(sim, 16);
        assert.equal(sim.inspect().scene, null);
      }

      const sim = setup();
      sim.action(command);
      advance(sim, command === "apology" ? 10 : 15);
      assert.equal(sim.inspect().scene, null, command);
    }
  }
);

test(
  "resize during each gag keeps all coordinates safe and pointer loss cancels " +
  "immediately",
  () => {
    for (const command of commands) {
      const sim = setup(2400, 1400);
      sim.action(command);

      if (command === "cursor_egg") {
        sim.pointer({ x: sim.inspect().x + 48, y: sim.inspect().y + 76 });
      }

      advance(sim, 0.5);
      sim.resize(100, 100);

      for (let i = 0; i < 300; i++) {
        assert.ok(sim.inspect().x >= 0 && sim.inspect().x <= 4);
        assert.ok(sim.inspect().y >= 0 && sim.inspect().y <= 4);

        for (const cone of sim.inspect().cones) {
          assert.ok(cone.x >= 14 && cone.x <= 86);
          assert.ok(cone.y >= 36 && cone.y <= 100);
        }

        sim.step(0.05);
      }

      assert.equal(sim.inspect().scene, null, command);
    }
  }
);

test("automatic gags use visible 4–7/2–4 minute intervals and avoid immediate repeats", () => {
  for (const [level, min, max] of [
    [1, 240, 420],
    [2, 120, 240],
  ]) {
    for (const random of [0, 0.999]) {
      const sim = routineFixture(GagRoutine, () => random);
      sim.settings.paused = false;
      sim.settings.mischief = level;
      assert.equal(sim.routine.maybeGag(), false);
      assert.ok(sim.gagSchedule.at >= min && sim.gagSchedule.at <= max);
      const start = sim.gagSchedule.at;
      sim.time = start - 0.01;
      assert.equal(sim.routine.maybeGag(), false);
      sim.time = start;
      assert.equal(sim.routine.maybeGag(), true);
      const first = sim.scene.kind;
      sim.action("cancel");
      sim.time = sim.gagSchedule.at;
      assert.equal(sim.routine.maybeGag(), true);
      assert.notEqual(sim.scene.kind, first);
    }
  }
});

test("autonomous gags respect pause, polite, hide, tidying, and bulk suppression", () => {
  const sim = routineFixture(GagRoutine);
  sim.settings.paused = false;
  sim.settings.mischief = 1;
  sim.routine.maybeGag();
  sim.time = sim.gagSchedule.at;
  sim.settings.paused = true;
  assert.equal(sim.routine.maybeGag(), false);
  sim.settings.paused = false;
  sim.setVisible(false);
  assert.equal(sim.routine.maybeGag(), false);
  sim.setVisible(true);
  sim.cleanup.suppressUntil = sim.time + 30;
  assert.equal(sim.routine.maybeGag(), false);
  sim.cleanup.suppressUntil = 0;
  sim.action("tidy");
  assert.equal(sim.routine.maybeGag(), false);
  sim.action("cancel");
  sim.settings.mischief = 0;
  assert.equal(sim.routine.maybeGag(), false);
});

test("every gag phase releases its visuals immediately on interruption or resize", () => {
  const phases = {
    pretend_leave: ["approach", "depart", "away", "peek", "reenter", "return"],
    cursor_egg: ["approach", "settle", "inspect"],
    municipal_gull: ["place", "inspect", "retrieve", "move", "leave"],
    apology: ["carry", "offer", "eat"],
    postcards: ["approach", "reach", "pull", "carry", "show", "tuck"],
  };

  for (const [command, steps] of Object.entries(phases)) {
    for (const phase of steps) {
      for (const operation of ["hide", "clean", "cancel", "resize"]) {
        const sim = setup();

        if (command === "cursor_egg") {
          egg(sim);

          if (phase === "inspect") {
            until(sim, "settle");
            sim.pointer({
              x: sim.inspect().scene.nest.x + 25,
              y: sim.inspect().scene.nest.y,
            });
          }
        } else {
          sim.action(command);
        }

        until(sim, phase);

        if (operation === "hide") {
          sim.setVisible(false);
        } else if (operation === "resize") {
          sim.resize(100, 100);
        } else {
          sim.action(operation);
        }

        if (operation !== "resize") {
          assert.equal(
            sim.inspect().scene,
            null,
            `${command}/${phase}/${operation}`,
          );
          assert.deepEqual(sim.present().props, []);
          assert.equal(sim.present().visualOffset.x, 0);
        }

        advance(sim, 16);
        assert.equal(
          sim.inspect().scene,
          null,
          `${command}/${phase}/${operation}`,
        );
        assert.ok(
          sim.inspect().x >= 0 && sim.inspect().x <= sim.inspect().width - 96,
        );
        assert.ok(
          sim.inspect().y >= 0 && sim.inspect().y <= sim.inspect().height - 96,
        );
      }
    }
  }
});

test("municipal cones expire during tidying and are never kept alive by reactions", () => {
  const sim = setup();
  sim.action("municipal_gull");
  until(sim, "inspect");
  const expiry = Math.max(...sim.inspect().cones.map((cone) => cone.born)) + 90;
  advance(sim, expiry - sim.inspect().time - 0.5);
  sim.action("tidy");
  assert.equal(sim.inspect().tidying, true);
  advance(sim, 1);
  assert.deepEqual(sim.inspect().cones, []);
});
