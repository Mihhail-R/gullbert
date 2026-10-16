import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { emptyBag } from "./simulation-helpers.mjs";
import {
  cleanupObjects,
  cleanupTarget,
  Cleanup,
} from "../web-dist/simulation/behaviors/cleanup.js";

function bird(level = 1, roll = 0) {
  const sim = new Gullbert(800, 600, () => roll);
  sim.configure({ mischief: level });
  return sim;
}
function advance(sim, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 20); i++) {
    sim.step(0.05);
  }
}
function setup(sim, bag = true, empty = true) {
  const paused = sim.inspect().settings.paused;
  sim.configure({ paused: true });

  if (bag) {
    sim.action("place_bag", { x: 124, y: 124 });

    if (empty) {
      emptyBag(sim);
    }
  }

  sim.action("feed");
  sim.splat({ x: 300, y: 100 });
  sim.configure({ paused });
  sim.action("tidy");
}
function pick(sim, kind) {
  const object = sim
    .present()
    .cleanupObjects.find((object) => object.kind === kind);
  assert.ok(object, `${kind} available for cleanup`);
  sim.action("tidy_pick", {
    x: object.x + object.width / 2,
    y: object.y + object.height / 2,
  });
}
function removeTwo(sim) {
  setup(sim);
  pick(sim, "bag");
  pick(sim, "chip");
}
function cleanupFixture() {
  const sim = {
    facing: 1,
    x: 0,
    y: 0,
    motionTime: 0,
    time: 0,
    mode: "idle",
    scene: null,
    flight: null,
    visible: true,
    settings: { paused: false, mischief: 1 },
    random: () => 0,
    bag: null,
    crumb: null,
    looseChips: [],
    splats: [],
    rubbish: [],
    cones: [],
    serial: 0,
    mood: null,
    bubble: "",
    lastMoodLine: undefined,
    say(text) {
      this.bubble = text;
    },
    exportMemory() {
      return { version: 1, perch: null, collection: {} };
    },
    cleanupTarget(point) {
      return cleanupTarget(this, point);
    },
    action(name, point) {
      if (name === "tidy") {
        this.owner.begin();
      } else if (name === "tidy_pick") {
        this.owner.pick(point);
      } else if (name === "tidy_done") {
        this.owner.finish();
      }
    },
  };
  sim.objects = {
    remove(kind, id) {
      if (kind === "bag") {
        sim.bag = null;
      } else if (kind === "chip" && id == null) {
        sim.crumb = null;
      } else {
        const field = {
          chip: "looseChips",
          splat: "splats",
          cone: "cones",
          rubbish: "rubbish",
        }[kind];
        sim[field] = sim[field].filter((object) => object.id !== id);
      }
    },
    restoreBag(bag) {
      if (sim.bag) {
        return false;
      }

      sim.bag = { ...bag, id: ++sim.serial };
      return true;
    },
  };
  sim.body = {
    face(direction) {
      sim.facing = direction;
    },
  };
  sim.owner = new Cleanup({
    observe() {
      return sim;
    },
    body: sim.body,
    objects: sim.objects,
    moods: {
      set(name, time) {
        sim.mood = { name, until: time + 35 };
      },
      settleOffence() {
        sim.mood = null;
      },
    },
    speech: {
      say(text) {
        sim.say(text);
      },
    },
    random() {
      return sim.random();
    },
    rest() {
      sim.mode = "idle";
    },
    action(name) {
      sim.action(name);
    },
    splat(point) {
      sim.splats.push({ ...point, id: ++sim.serial, born: sim.time });
    },
  });
  Object.defineProperty(sim, "cleanup", {
    get() {
      return sim.owner.snapshot();
    },
  });
  return sim;
}

test(
  "tidying cancels a routine without clearing loose objects; repeated and empty " +
  "clicks are isolated",
  () => {
    const sim = bird();
    sim.action("feed");
    const crumb = { ...sim.inspect().crumb };
    sim.action("tidy");
    assert.deepEqual(sim.inspect().crumb, crumb);
    assert.equal(sim.inspect().goal, null);
    assert.equal(sim.inspect().tidying, true);
    sim.action("tidy_pick", { x: 1, y: 1 });
    assert.deepEqual(sim.inspect().crumb, crumb);
    assert.equal(sim.inspect().cleanup.session.removals, 0);
    sim.action("tidy_pick", crumb);
    assert.equal(sim.inspect().crumb, null);
    assert.equal(sim.inspect().cleanup.session.removals, 1);
    sim.action("tidy_pick", crumb);
    assert.equal(sim.inspect().cleanup.session.removals, 1);
    assert.equal(sim.inspect().tidying, true);
  }
);

test("shared rectangles select topmost eligible object with an eight pixel halo", () => {
  const sim = cleanupFixture();
  sim.bag = { id: 1, x: 100, y: 100, servings: 1, attached: false };
  sim.crumb = { x: 100, y: 100 };
  sim.splats = [
    { id: 2, x: 112, y: 112, born: 0 },
    { id: 3, x: 112, y: 112, born: 0 },
  ];
  sim.cones = [{ id: 4, x: 114, y: 136, born: 0 }];
  const memory = sim.exportMemory();
  sim.action("tidy");
  assert.deepEqual(
    cleanupObjects(sim)
      .map((o) => o.kind),
    ["bag", "chip", "splat", "splat", "cone"],
  );

  for (const id of [4, 3, 2]) {
    assert.equal(sim.cleanupTarget({ x: 105, y: 105 }).id, id);
    sim.action("tidy_pick", { x: 105, y: 105 });
  }

  assert.equal(sim.cleanupTarget({ x: 93, y: 100 }).kind, "chip");
  sim.action("tidy_pick", { x: 105, y: 105 });
  assert.equal(sim.cleanupTarget({ x: 105, y: 105 }).kind, "bag");
  sim.action("tidy_pick", { x: 105, y: 105 });
  sim.action("tidy_pick", { x: 105, y: 105 });
  assert.equal(sim.cleanupTarget({ x: 105, y: 105 }), null);
  assert.deepEqual(sim.exportMemory(), memory);
  assert.equal(sim.cleanup.session.removals, 5);
});

test("removals escalate within twenty visible seconds, supervise the pointer and then sulk", () => {
  const sim = bird(0);
  setup(sim);
  pick(sim, "bag");
  assert.equal(sim.inspect().pose, "tilt");
  pick(sim, "chip");
  assert.equal(sim.inspect().cleanup.level, 2);
  pick(sim, "splat");
  assert.equal(sim.inspect().cleanup.level, 3);
  assert.equal(sim.inspect().mood.name, "offended");
  const x = sim.inspect().x;
  sim.tidyPointer({ x: 20, y: 100 });
  advance(sim, 1);
  assert.ok(sim.inspect().x < x);
  sim.action("tidy_done");
  const away = sim.inspect().cleanup.away;
  assert.equal(sim.inspect().facing, away);
  advance(sim, 2);
  assert.ok(sim.inspect().cleanup.sulkUntil > sim.inspect().time);
  advance(sim, 8.1);
  assert.equal(sim.inspect().cleanup.sulkUntil, 0);
  assert.equal(sim.inspect().bag, null);
  assert.equal(sim.inspect().splats.length, 0);
});

test("twenty second escalation window and thirty second tidy limit use visible time", () => {
  const sim = bird(0);
  setup(sim);
  pick(sim, "bag");
  advance(sim, 20.1);
  pick(sim, "chip");
  assert.equal(sim.inspect().cleanup.level, 1);
  advance(sim, 10);
  assert.equal(sim.inspect().tidying, false);
  const time = sim.inspect().time;
  sim.setVisible(false);
  advance(sim, 50);
  assert.equal(sim.inspect().time, time);
});

test("Polite-ish never retaliates; Menace restores one empty bag after five seconds", () => {
  const polite = bird(0);
  removeTwo(polite);
  polite.action("tidy_done");
  assert.equal(polite.inspect().cleanup.retaliation, null);
  const sim = bird(1);
  removeTwo(sim);
  sim.action("tidy_done");
  assert.equal(sim.inspect().cleanup.retaliation.kind, "bag");
  advance(sim, 4.9);
  assert.equal(sim.inspect().bag, null);
  advance(sim, 0.2);
  assert.equal(sim.inspect().bag.servings, 0);
  assert.equal(sim.inspect().cleanup.retaliation, null);
  removeTwo(sim);
  sim.action("tidy_done");
  assert.equal(sim.inspect().cleanup.retaliation, null);
});

test(
  "retaliation probabilities have distinct thresholds and Public enemy can add one " +
  "splat",
  () => {
    const menace = bird(1, 0.4);
    removeTwo(menace);
    menace.action("tidy_done");
    assert.equal(menace.inspect().cleanup.retaliation, null);
    const enemy = bird(2, 0.55);
    removeTwo(enemy);
    enemy.action("tidy_done");
    assert.equal(enemy.inspect().cleanup.retaliation.kind, "splat");
    const before = enemy.inspect().splats.length;
    advance(enemy, 5.1);
    assert.equal(enemy.inspect().splats.length, before + 1);
    advance(enemy, 1);
    assert.equal(enemy.inspect().splats.length, before + 1);
    const no = bird(2, 0.61);
    removeTwo(no);
    no.action("tidy_done");
    assert.equal(no.inspect().cleanup.retaliation, null);
  }
);

test("restoration skips an existing bag and cancellation never schedules replacement mess", () => {
  const fixture = cleanupFixture();
  fixture.bag = { id: 1, x: 100, y: 100, servings: 0, attached: false };
  fixture.crumb = { x: 200, y: 100 };
  fixture.action("tidy");
  fixture.action("tidy_pick", { x: 105, y: 105 });
  fixture.action("tidy_pick", { x: 205, y: 105 });
  fixture.action("tidy_done");
  assert.equal(fixture.cleanup.retaliation.kind, "bag");
  const other = { id: 99, x: 20, y: 20, servings: 3, attached: false };
  fixture.bag = other;
  fixture.time = 5.1;
  fixture.owner.update(0.05);
  assert.equal(fixture.bag, other);

  for (const cancel of [
    (s) => s.action("clean"),
    (s) => s.action("cancel"),
    (s) => s.action("squawk"),
    (s) => s.setVisible(false),
    (s) => s.configure({ paused: true }),
    (s) => s.configure({ mischief: 0 }),
  ]) {
    const sim = bird(1);
    removeTwo(sim);
    sim.action("tidy_done");
    cancel(sim);
    assert.equal(sim.inspect().cleanup.retaliation, null);
    advance(sim, 6);
    assert.equal(sim.inspect().bag, null);
  }
});

test("lowering mischief cancels disallowed splats and feeding settles anger immediately", () => {
  const sim = bird(2, 0.55);
  removeTwo(sim);
  sim.action("tidy_done");
  sim.configure({ mischief: 1 });
  assert.equal(sim.inspect().cleanup.retaliation, null);
  sim.action("feed");
  assert.equal(sim.inspect().mood, null);
  assert.equal(sim.inspect().cleanup.sulkUntil, 0);
  assert.equal(sim.inspect().bubble, "we can settle out of court.");
  assert.equal(sim.inspect().mode, "fetch");
});

test(
  "bulk cleanup clears transient props, preserves belongings, suppresses autonomous " +
  "mess and permits play",
  () => {
    const sim = bird(2);
    sim.configure({ paused: true });
    advance(sim, 1000);
    sim.action("municipal_gull");
    reachPhase(sim, "inspect");
    sim.configure({ paused: false });
    removeTwo(sim);
    sim.restoreMemory({
      perch: { x: 200, y: 200 },
      collection: { bottle_cap: 1 },
    });
    const memory = sim.exportMemory();
    sim.action("clean");
    assert.equal(sim.inspect().tidying, false);
    assert.equal(sim.inspect().bag, null);
    assert.equal(sim.inspect().crumb, null);
    assert.equal(sim.inspect().cones.length, 0);
    assert.equal(sim.inspect().splats.length, 0);
    assert.deepEqual(sim.exportMemory(), memory);
    advance(sim, 29);
    assert.equal(sim.inspect().splats.length, 0);
    sim.action("poop");
    advance(sim, 7);
    assert.equal(sim.inspect().splats.length, 1);
  }
);

test("successful cleanup lines do not repeat across each category's four-line cycle", () => {
  const sim = cleanupFixture();
  sim.action("tidy");

  for (const kind of ["splat", "chip", "bag", "cone"]) {
    const said = new Set();

    for (let i = 0; i < 4; i++) {
      const id = ++sim.serial;

      if (kind === "splat") {
        sim.splats.push({ id, x: 100, y: 100, born: sim.time });
      }

      if (kind === "chip") {
        sim.crumb = { x: 100, y: 100 };
      }

      if (kind === "bag") {
        sim.bag = { id, x: 100, y: 100, servings: 0, attached: false };
      }

      if (kind === "cone") {
        sim.cones.push({ id, x: 100, y: 120, born: sim.time });
      }

      sim.action("tidy_pick", { x: 100, y: 100 });
      said.add(sim.bubble);
    }

    assert.equal(said.size, 4, kind);
  }
});

test(
  "apology follows a completed sulk only without retaliation and without an " +
  "intervening command",
  () => {
    const sim = bird(0);
    setup(sim, false);
    pick(sim, "chip");
    sim.action("tidy_done");
    advance(sim, 10.1);
    assert.equal(sim.inspect().scene.kind, "apology");
    const canceled = bird(0);
    setup(canceled, false);
    pick(canceled, "chip");
    canceled.action("tidy_done");
    canceled.action("cancel");
    advance(canceled, 11);
    assert.notEqual(canceled.inspect().scene?.kind, "apology");
  }
);

test("Menace restores only a removed empty bag, never converts a full bag into retaliation", () => {
  const sim = bird(1);
  setup(sim, true, false);
  pick(sim, "bag");
  pick(sim, "chip");
  sim.action("tidy_done");
  assert.equal(sim.inspect().cleanup.retaliation, null);
  advance(sim, 5.1);
  assert.equal(sim.inspect().bag, null);
});

test(
  "cones expire during active tidying, while hidden time cannot consume retaliation " +
  "cooldown",
  () => {
    const sim = bird(1);
    sim.configure({ paused: true });
    sim.action("municipal_gull");
    reachPhase(sim, "inspect");
    const expiry = Math.max(...sim.inspect().cones.map((cone) => cone.born)) + 90;
    advance(sim, expiry - sim.inspect().time - 0.5);
    sim.configure({ paused: false });
    sim.action("tidy");
    advance(sim, 1.1);
    assert.equal(sim.inspect().cones.length, 0);
    removeTwo(sim);
    sim.action("tidy_done");
    const cooldown = sim.inspect().cleanup.retaliationAllowedAt;
    sim.setVisible(false);
    advance(sim, 100);
    assert.ok(sim.inspect().time < cooldown);
    sim.setVisible(true);
    removeTwo(sim);
    sim.action("tidy_done");
    assert.equal(sim.inspect().cleanup.retaliation, null);
    advance(sim, 91);
    removeTwo(sim);
    sim.action("tidy_done");
    assert.equal(sim.inspect().cleanup.retaliation.kind, "bag");
  }
);

function reachPhase(sim, phase) {
  for (let i = 0; i < 600 && sim.inspect().scene?.phase !== phase; i++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().scene?.phase, phase);
}
const geometry = ({ id, ...prop }) => prop;

test(
  "tidying preserves a missed toss chip at its exact painted size and removes it " +
  "only on click",
  () => {
    const sim = new Gullbert(2400, 650, () => 0.1);
    sim.configure({ paused: true, mischief: 0 });
    sim.action("chip_toss", { x: 2300, y: 500 });
    reachPhase(sim, "miss");
    const props = sim.present().props;
    assert.equal(props.length, 1);
    sim.action("tidy");
    assert.equal(sim.inspect().scene, null);
    assert.equal(sim.inspect().crumb, null);
    assert.deepEqual(sim.inspect().looseChips.map(geometry), props.map(geometry));
    const chip = sim.inspect().looseChips[0];
    assert.equal(sim.cleanupTarget({ x: chip.x - 7, y: chip.y }).id, chip.id);
    sim.action("tidy_pick", { x: 1, y: 1 });
    assert.equal(sim.inspect().looseChips.length, 1);
    sim.action("tidy_pick", { x: chip.x + 12, y: chip.y + 12 });
    assert.deepEqual(sim.inspect().looseChips, []);
    assert.equal(sim.inspect().cleanup.session.removals, 1);
    sim.action("tidy_pick", { x: chip.x + 12, y: chip.y + 12 });
    assert.equal(sim.inspect().cleanup.session.removals, 1);
  }
);

test("tidying a gull argument preserves all six loose chips, including the disputed chip", () => {
  const sim = bird(0);
  sim.configure({ paused: true });
  sim.action("gull_argument");
  reachPhase(sim, "stare");
  const props = sim.present().props.filter((prop) => prop.asset === "chip");
  assert.equal(props.length, 6);
  sim.action("tidy");
  assert.deepEqual(sim.inspect().looseChips.map(geometry), props.map(geometry));
  assert.equal(
    new Set(sim.inspect().looseChips.map((chip) => chip.id)).size,
    6,
  );
  assert.equal(
    sim.present().cleanupObjects.filter((object) => object.kind === "chip")
      .length,
    6,
  );
  const ids = sim.inspect().looseChips.map((chip) => chip.id);
  sim.action("tidy_done");
  sim.action("tidy");
  assert.deepEqual(
    sim.inspect().looseChips.map((chip) => chip.id),
    ids,
  );

  while (sim.inspect().looseChips.length) {
    const chip = sim.inspect().looseChips.at(-1);
    sim.action("tidy_pick", {
      x: chip.x + chip.width / 2,
      y: chip.y + chip.height / 2,
    });
    assert.ok(!sim.inspect().looseChips.some((other) => other.id === chip.id));
  }

  assert.equal(sim.inspect().cleanup.session.removals, 6);
});

test(
  "tidying excludes the guest's snatched chip, eaten toss chips and the held apology " +
  "chip",
  () => {
    const sim = bird(0);
    sim.configure({ paused: true });
    sim.action("gull_argument");
    reachPhase(sim, "reaction");
    const props = sim.present().props;
    assert.ok(props.some((prop) => prop.id === "snatched-chip"));
    const ignored = props.filter((prop) =>
      String(prop.id)
        .startsWith("ignored-chip-"),);
    sim.action("tidy");
    assert.equal(sim.inspect().looseChips.length, 5);
    assert.deepEqual(
      sim.inspect().looseChips.map(geometry),
      ignored.map(geometry),
    );
    sim.action("apology");
    sim.action("tidy");
    assert.deepEqual(sim.inspect().looseChips, []);
    sim.action("chip_toss", { x: 600, y: 450 });
    reachPhase(sim, "eat");
    assert.deepEqual(sim.present().props, []);
    sim.action("tidy");
    assert.deepEqual(sim.inspect().looseChips, []);
  }
);

test(
  "preserved chips clamp on resize, survive hide, and clear on bulk or replacement " +
  "commands",
  () => {
    for (const command of ["clean", "feed", "cancel", "municipal_gull"]) {
      const sim = bird(0);
      sim.configure({ paused: true });
      sim.action("gull_argument");
      sim.action("tidy");
      const ids = sim.inspect().looseChips.map((chip) => chip.id);
      sim.setVisible(false);
      sim.setVisible(true);
      assert.deepEqual(
        sim.inspect().looseChips.map((chip) => chip.id),
        ids,
      );
      sim.resize(100, 100);

      for (const chip of sim.inspect().looseChips) {
        assert.ok(chip.x >= 0 && chip.x + chip.width <= 100);
        assert.ok(chip.y >= 0 && chip.y + chip.height <= 100);
      }

      assert.deepEqual(
        sim.inspect().looseChips.map((chip) => chip.id),
        ids,
      );
      sim.action(command);
      assert.deepEqual(sim.inspect().looseChips, [], command);
    }
  }
);
