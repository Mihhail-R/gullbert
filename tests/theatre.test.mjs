import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routineFixture } from "./routine-fixture.mjs";
import { Gullbert } from "../web-dist/simulation/engine.js";
import {
  TheatreRoutine,
  theatreProps,
} from "../web-dist/simulation/behaviors/theatre.js";

function setup(width = 900, height = 650, random = () => 0.5) {
  const sim = new Gullbert(width, height, random);
  sim.configure({ paused: true, mischief: 0, sound: false });
  return sim;
}
function advance(sim, seconds) {
  for (let i = 0; i < seconds * 20; i++) sim.step(0.05);
}
function until(sim, phase) {
  for (let i = 0; i < 400 && sim.inspect().scene?.phase !== phase; i++)
    sim.step(0.05);
  assert.equal(sim.inspect().scene?.phase, phase);
}
const commands = ["blow_bubbles", "bath_time", "chip_toss", "baguette_parade"];

test("bubbles stay bounded, pop on contact, startle and recover within twenty seconds", () => {
  const sim = setup();
  sim.action("blow_bubbles");
  const phases = new Set(),
    poses = new Set();
  for (let i = 0; i < 400; i++) {
    phases.add(sim.inspect().scene?.phase);
    poses.add(sim.inspect().pose);
    const props = sim.present().props;
    assert.ok(props.filter((prop) => prop.asset === "bubble").length <= 6);
    assert.ok(props.length <= 6);
    if (sim.inspect().scene?.kind === "bubbles" && sim.inspect().scene.targetId)
      assert.ok(sim.inspect().scene.targetId > 0);
    sim.step(0.05);
  }
  for (const phase of ["chase", "peck", "startle", "proud"])
    assert.ok(phases.has(phase), phase);
  assert.ok(poses.has("nap-startle"));
  assert.ok(sim.inspect().events.includes("pop"));
  assert.equal(sim.inspect().scene, null);
  assert.deepEqual(sim.present().props, []);
});

test("bath approaches, splashes with eight droplets, shakes and leaves", () => {
  const sim = setup();
  sim.action("bath_time");
  const phases = new Set(),
    poses = new Set();
  for (let i = 0; i < 400; i++) {
    phases.add(sim.inspect().scene?.phase);
    poses.add(sim.inspect().pose);
    const props = sim.present().props;
    assert.ok(props.filter((prop) => prop.asset === "bath").length <= 1);
    assert.ok(props.filter((prop) => prop.asset === "drop").length <= 8);
    sim.step(0.05);
  }
  for (const phase of ["approach", "splash", "shake", "exit"])
    assert.ok(phases.has(phase), phase);
  for (const pose of ["bath-wet", "bath-shake-a", "bath-shake-b"])
    assert.ok(poses.has(pose), pose);
  assert.equal(sim.inspect().scene, null);
  assert.deepEqual(sim.present().props, []);
});

test("a reachable airborne chip is awarded only at real beak contact", () => {
  const sim = setup();
  sim.action("chip_toss", { x: 650, y: 480 });
  until(sim, "land");
  assert.equal(sim.inspect().scene.caught, true);
  const { beak, chip, distance } = sim.inspect().scene.contact;
  assert.equal(distance, Math.hypot(beak.x - chip.x, beak.y - chip.y));
  assert.ok(distance <= 10);
  assert.equal(sim.inspect().scene.chip, null);
  assert.equal(
    sim.inspect().events.filter((event) => event === "munch").length,
    1,
  );
  advance(sim, 5);
  assert.equal(sim.inspect().scene, null);
});

// Opaque beak runs in BOTH original flight frames (11 and 12), in native
// sheet pixels. This checks painted artwork contact, independent of the
// simulation's beak anchor or collision radius.
const flightBeakRuns = [
  [23, 13, 4],
  [23, 14, 6],
  [23, 15, 6],
  [23, 16, 5],
  [23, 17, 4],
];
const chipRuns = [
  ...readFileSync(
    new URL("../web-dist/assets/theatre/chip.svg", import.meta.url),
    "utf8",
  ).matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g),
].map((match) => match.slice(1).map(Number));

function paintedBeakTouchesChip(sim, prop) {
  const angle = (-(prop.rotation ?? 0) * Math.PI) / 180;
  for (const [x, y, width] of flightBeakRuns) {
    for (let px = x * 3 + 0.25; px < (x + width) * 3; px += 0.5) {
      for (let py = y * 3 + 0.25; py < (y + 1) * 3; py += 0.5) {
        const worldX = sim.x + (sim.facing < 0 ? 96 - px : px);
        const dx = worldX - prop.x - prop.width / 2;
        const dy = sim.y + py - prop.y - prop.height / 2;
        const localX =
          ((dx * Math.cos(angle) - dy * Math.sin(angle) + prop.width / 2) *
            16) /
          prop.width;
        const localY =
          ((dx * Math.sin(angle) + dy * Math.cos(angle) + prop.height / 2) *
            16) /
          prop.height;
        if (
          chipRuns.some(([cx, cy, cw, ch]) => {
            const withinWidth = localX >= cx && localX < cx + cw;
            const withinHeight = localY >= cy && localY < cy + ch;
            return withinWidth && withinHeight;
          })
        )
          return true;
      }
    }
  }
  return false;
}

test("awarded catches overlap the painted rotating chip and flight beak", () => {
  let catches = 0;
  for (const target of [
    { x: 650, y: 350 },
    { x: 650, y: 480 },
    { x: 330, y: 480 },
  ]) {
    for (const dt of [0.033, 0.05, 0.1]) {
      const sim = setup();
      sim.action("chip_toss", target);
      for (let i = 0; i < 150 && sim.inspect().scene?.phase !== "land"; i++)
        sim.step(dt);
      if (!sim.inspect().scene?.caught) {
        assert.ok(!sim.inspect().events.includes("munch"));
        continue;
      }
      catches += 1;
      // Reconstruct only the chip consumed on this frame through the real
      // renderer contract, including its spin and SVG aspect ratio.
      const props = theatreProps({
        ...sim.inspect(),
        scene: {
          ...sim.inspect().scene,
          phase: "intercept",
          chip: sim.inspect().scene.contact.chip,
        },
      });
      assert.equal(props[0].width, props[0].height);
      assert.ok(
        paintedBeakTouchesChip(sim.inspect(), props[0]),
        JSON.stringify({ target, dt, contact: sim.inspect().scene.contact }),
      );
    }
  }
  assert.ok(catches >= 6, `Only ${catches} geometry cases reached a catch`);
});

test("a missed chip stays visible and retrievable after a display resize", () => {
  for (const phase of ["miss-flail", "land", "miss", "retrieve"]) {
    const sim = setup(2400, 650, () => 0.1);
    sim.action("chip_toss", { x: 2300, y: 500 });
    until(sim, phase);
    assert.equal(sim.inspect().scene.caught, false);
    sim.resize(400, 250);
    // The immediate render is safe even before physics reclamps the object.
    for (const prop of sim.present().props) {
      assert.ok(prop.x >= 0 && prop.x + prop.width <= sim.inspect().width);
      assert.ok(prop.y >= 0 && prop.y + prop.height <= sim.inspect().height);
    }
    sim.step(0.05);
    for (const prop of sim.present().props) {
      assert.ok(prop.x >= 0 && prop.x + prop.width <= sim.inspect().width);
      assert.ok(prop.y >= 0 && prop.y + prop.height <= sim.inspect().height);
    }
    advance(sim, 12);
    assert.equal(sim.inspect().scene, null);
    assert.ok(sim.inspect().events.includes("munch"), phase);
  }
});

test("an unreachable toss flails, lands, then retrieves its one ground chip", () => {
  const sim = setup(2400, 650, () => 0.1);
  sim.action("chip_toss", { x: 2300, y: 500 });
  until(sim, "miss-flail");
  assert.equal(sim.inspect().scene.caught, false);
  assert.equal(sim.inspect().scene.contact, undefined);
  assert.equal(sim.inspect().events.includes("munch"), false);
  const chip = sim.inspect().scene.chip;
  assert.deepEqual({ x: chip.x, y: chip.y }, { x: 2300, y: 500 });
  until(sim, "miss");
  assert.equal(sim.inspect().pose, "bag-offended");
  until(sim, "retrieve");
  assert.deepEqual(sim.inspect().scene.chip, chip);
  assert.equal(
    sim.present().props.filter((prop) => prop.asset === "chip").length,
    1,
  );
  until(sim, "eat");
  assert.equal(sim.inspect().scene.chip, null);
  assert.ok(sim.inspect().events.includes("munch"));
  advance(sim, 2);
  assert.equal(sim.inspect().scene, null);
});

test("replacement tosses never keep an older airborne chip", () => {
  const sim = setup();
  sim.action("chip_toss");
  const first = sim.inspect().scene.chip.id;
  advance(sim, 0.3);
  sim.action("chip_toss");
  assert.notEqual(sim.inspect().scene.chip.id, first);
  assert.equal(
    sim.present().props.filter((prop) => prop.asset === "chip").length,
    1,
  );
  sim.action("cancel");
  assert.deepEqual(sim.present().props, []);
  assert.equal(sim.inspect().flight, null);
});

test("baguette enters, carries, pauses, leaves completely and returns to its origin", () => {
  const sim = setup();
  const origin = { x: sim.inspect().x, y: sim.inspect().y };
  sim.action("baguette_parade");
  assert.equal(sim.inspect().bubble, "");
  const entrance = sim.present().visualOffset;
  assert.ok(Math.abs(entrance.x) >= 200);
  assert.equal(sim.present().props[0].width, 156);
  const phases = new Set();
  let sawGone = false;
  for (let i = 0; i < 400; i++) {
    phases.add(sim.inspect().scene?.phase);
    if (sim.inspect().scene?.phase === "gone") {
      sawGone = true;
      assert.equal(sim.present().visualOffset.opacity, 0);
      assert.equal(sim.present().props[0].opacity, 0);
    }
    sim.step(0.05);
  }
  for (const phase of ["entrance", "carry", "pause", "exit", "departure"])
    assert.ok(phases.has(phase), phase);
  assert.ok(sawGone);
  assert.equal(sim.inspect().scene, null);
  assert.deepEqual({ x: sim.inspect().x, y: sim.inspect().y }, origin);
});

test("each theatre command permits explicit play while autonomy is paused or polite", () => {
  for (const command of commands) {
    const sim = setup();
    sim.action(command);
    assert.ok(sim.inspect().scene);
    advance(sim, 20);
    assert.equal(sim.inspect().scene, null);
    assert.equal(sim.inspect().mode, "idle");
  }
});

test("hide suspends ordinary theatre without accumulating props or elapsed time", () => {
  for (const command of commands) {
    const sim = setup();
    sim.action(command);
    advance(sim, 0.5);
    const scene = structuredClone(sim.inspect().scene),
      time = sim.inspect().time;
    sim.setVisible(false);
    advance(sim, 100);
    assert.equal(sim.inspect().time, time);
    assert.deepEqual(sim.inspect().scene, scene);
    assert.deepEqual(sim.present().props, []);
    sim.setVisible(true);
    advance(sim, 20);
    assert.equal(sim.inspect().scene, null);
  }
});

test("commands and Clean replace every active theatre phase with normal state", () => {
  for (const [command, phases] of [
    ["blow_bubbles", ["chase", "peck", "startle", "proud"]],
    ["bath_time", ["approach", "splash", "shake", "exit"]],
    ["chip_toss", ["takeoff", "intercept", "land", "eat"]],
    [
      "baguette_parade",
      ["entrance", "carry", "pause", "exit", "departure", "gone"],
    ],
  ]) {
    for (const phase of phases)
      for (const replacement of ["nap", "clean", "cancel"]) {
        const sim = setup();
        sim.action(
          command,
          command === "chip_toss" ? { x: 650, y: 480 } : undefined,
        );
        until(sim, phase);
        sim.action(replacement);
        assert.equal(
          sim.inspect().scene,
          null,
          `${command}/${phase}/${replacement}`,
        );
        assert.equal(sim.inspect().flight, null);
        assert.deepEqual(sim.present().props, []);
        assert.ok(!sim.inspect().pose.startsWith("bath-"));
        assert.equal(sim.present().visualOffset.x, 0);
        advance(sim, 20);
        assert.equal(sim.inspect().scene, null);
      }
  }
});

test("resizing all theatre scenes keeps Gullbert and finite effects safe", () => {
  for (const command of commands) {
    const sim = setup(2400, 1400);
    sim.action(command);
    advance(sim, 0.5);
    sim.resize(100, 100);
    for (let i = 0; i < 400; i++) {
      sim.step(0.05);
      assert.ok(
        sim.inspect().x >= 0 && sim.inspect().x <= 4,
        `${command}: x=${sim.inspect().x}`,
      );
      assert.ok(
        sim.inspect().y >= 0 && sim.inspect().y <= 4,
        `${command}: y=${sim.inspect().y}`,
      );
      assert.ok(sim.present().props.length <= 9);
    }
    assert.equal(sim.inspect().scene, null);
  }
});

test("rare autonomy waits twenty visible minutes and uses a chance at bounded intervals", () => {
  const sim = routineFixture(TheatreRoutine);
  sim.settings = { paused: false, mischief: 1, sound: false };
  sim.random = () => 0;
  sim.time = 1199.99;
  assert.equal(sim.routine.maybeTheatre(), false);
  sim.time = 1200;
  sim.random = () => 0.99;
  assert.equal(sim.routine.maybeTheatre(), false);
  sim.random = () => 0;
  sim.time = 1259.99;
  assert.equal(sim.routine.maybeTheatre(), false);
  sim.time = 1260;
  assert.equal(sim.routine.maybeTheatre(), true);
  assert.equal(sim.scene.kind, "baguette");
  sim.action("cancel");
  sim.time = 2459.99;
  assert.equal(sim.routine.maybeTheatre(), false);
  sim.time = 2460;
  assert.equal(sim.routine.maybeTheatre(), true);
});

test("rare autonomy obeys hide, pause and mischief, with bounded recent memory", () => {
  const sim = routineFixture(TheatreRoutine);
  sim.time = 5000;
  sim.random = () => 0;
  assert.equal(sim.routine.maybeTheatre(), false);
  sim.settings.paused = false;
  assert.equal(sim.routine.maybeTheatre(), false);
  sim.settings.mischief = 1;
  sim.setVisible(false);
  assert.equal(sim.routine.maybeTheatre(), false);
  sim.setVisible(true);
  for (let i = 0; i < 10; i++) sim.action("baguette_parade");
  assert.deepEqual(sim.rareTheatre.recent, [
    "baguette",
    "baguette",
    "baguette",
  ]);
  sim.action("cancel");
  assert.equal(sim.routine.maybeTheatre(), false);
  assert.equal(sim.rareTheatre.nextAllowed, 6200);
});
