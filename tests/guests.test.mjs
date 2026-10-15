import test from "node:test";
import assert from "node:assert/strict";
import { routineFixture } from "./routine-fixture.mjs";
import { Gullbert } from "../web-dist/simulation/engine.js";
import {
  guestProps,
  guestSpeech,
  GuestRoutine,
} from "../web-dist/simulation/behaviors/guests.js";

function setup() {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, sound: false, mischief: 0 });
  return sim;
}
function advance(sim, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 20); i++) sim.step(0.05);
}
function until(sim, phase) {
  for (let i = 0; i < 600 && sim.inspect().scene?.phase !== phase; i++)
    sim.step(0.05);
  assert.equal(sim.inspect().scene?.phase, phase);
}
function assertGone(sim) {
  assert.notEqual(sim.inspect().scene?.kind, "guest");
  assert.deepEqual(sim.present().props, []);
  assert.equal(sim.present().guestSpeech, null);
}

function drainFixtureBag(sim) {
  const id = sim.bag.id;
  for (let serving = 0; serving < 3; serving++) sim.objects.consumeBag(id);
}
function untilFixture(sim, phase) {
  for (let i = 0; i < 600 && sim.scene?.phase !== phase; i++) sim.step(0.05);
  assert.equal(sim.scene?.phase, phase);
}
function assertFixtureGone(sim) {
  assert.notEqual(sim.scene?.kind, "guest");
  assert.deepEqual(guestProps(sim), []);
  assert.equal(guestSpeech(sim), null);
}

test("pigeon inspects the existing usable bag, faces off, judges and leaves", () => {
  const sim = setup();
  sim.action("place_bag", { x: 400, y: 400 });
  const bag = sim.inspect().bag;
  sim.action("invite_pigeon");
  assert.equal(sim.inspect().scene.species, "pigeon");
  assert.equal(sim.inspect().scene.bagId, bag.id);
  assert.equal(sim.inspect().scene.hasSnack, true);
  assert.equal(sim.present().props.length, 1);
  const phases = new Set();
  const guestLines = new Set();
  for (let i = 0; i < 600; i++) {
    phases.add(sim.inspect().scene?.phase);
    if (sim.present().guestSpeech)
      guestLines.add(sim.present().guestSpeech.text);
    sim.step(0.05);
  }
  for (const phase of [
    "arrival",
    "inspect",
    "faceoff",
    "judgment",
    "departure",
  ])
    assert.ok(phases.has(phase), phase);
  assert.ok(guestLines.has("communal chips?"));
  assert.deepEqual(sim.inspect().bag, bag);
  assert.equal(bag.servings, 3);
  assertGone(sim);
  assert.equal(sim.inspect().bubble, "");
  assert.equal(sim.inspect().mode, "idle");
});

test("absent, empty, and vanished bags produce judgment without creating snacks", () => {
  for (const state of ["absent", "empty", "vanished", "emptied"]) {
    const sim = routineFixture(GuestRoutine);
    if (state !== "absent") sim.action("place_bag", { x: 400, y: 400 });
    if (state === "empty") drainFixtureBag(sim);
    sim.action("invite_pigeon");
    untilFixture(sim, "inspect");
    if (state === "vanished") sim.objects.remove("bag", sim.bag.id);
    if (state === "emptied") drainFixtureBag(sim);
    untilFixture(sim, "faceoff");
    assert.equal(sim.scene.hasSnack, false);
    assert.equal(guestSpeech(sim).text, "clearly.");
    assert.equal(guestProps(sim).length, 1);
    advance(sim, 25);
    assertFixtureGone(sim);
  }
});

test("gull argument alternates visual reactions over one chip and ignores five", () => {
  const sim = setup();
  sim.action("gull_argument");
  assert.equal(sim.inspect().scene.species, "gull");
  assert.equal(
    sim.present().props.filter((prop) => prop.asset === "chip").length,
    6,
  );
  const phases = new Set();
  let sawMainSquawk = false;
  let sawGuestSquawk = false;
  let sawSnatchedChip = false;
  let sawContact = false;
  for (let i = 0; i < 600; i++) {
    const phase = sim.inspect().scene?.phase;
    phases.add(phase);
    const props = sim.present().props;
    if (sim.inspect().scene?.kind === "guest") {
      assert.equal(
        props.filter((prop) => prop.id.startsWith("ignored-chip-")).length,
        5,
      );
      assert.equal(props.filter((prop) => prop.id === "visitor").length, 1);
      assert.equal(props.length, 7);
    }
    if (phase === "squawk-main") {
      sawMainSquawk = true;
      assert.equal(sim.inspect().pose, "squawk");
      assert.equal(sim.inspect().bubble, "MINE.");
      assert.equal(sim.present().guestSpeech, null);
    }
    if (phase === "squawk-guest") {
      sawGuestSquawk = true;
      assert.equal(props[0].asset, "guest-squawk");
      assert.equal(sim.inspect().bubble, "");
      assert.equal(sim.present().guestSpeech.text, "MINE, ACTUALLY.");
    }
    if (
      phase === "snatch" &&
      sim.inspect().time - sim.inspect().scene.phaseStarted >= 0.6
    ) {
      const chip = props.find((prop) => prop.id === "disputed-chip");
      assert.ok(Math.abs(sim.inspect().scene.guest.x + 18 - (chip.x + 12)) < 1);
      assert.ok(Math.abs(sim.inspect().scene.guest.y + 47 - (chip.y + 9)) < 1);
      assert.equal(sim.inspect().scene.chipTaken, false);
      sawContact = true;
    }
    if (phase === "reaction") {
      sawSnatchedChip = true;
      assert.ok(props.some((prop) => prop.id === "snatched-chip"));
      assert.ok(!props.some((prop) => prop.id === "disputed-chip"));
    }
    sim.step(0.05);
  }
  for (const phase of [
    "arrival",
    "stare",
    "posture",
    "squawk-main",
    "squawk-guest",
    "snatch",
    "reaction",
    "departure",
  ])
    assert.ok(phases.has(phase), phase);
  assert.ok(sawMainSquawk && sawGuestSquawk && sawSnatchedChip && sawContact);
  assertGone(sim);
  assert.equal(sim.inspect().bubble, "");
});

test("guests replace each other with only one visitor and no previous props", () => {
  const sim = setup();
  for (const command of [
    "invite_pigeon",
    "gull_argument",
    "invite_pigeon",
    "gull_argument",
  ]) {
    const previous = sim.inspect().scene;
    sim.action(command);
    assert.notDeepEqual(sim.inspect().scene, previous);
    assert.equal(sim.inspect().scene.phase, "arrival");
    assert.equal(
      sim.present().props.filter((prop) => prop.id === "visitor").length,
      1,
    );
    assert.equal(
      sim.present().props.length,
      command === "invite_pigeon" ? 1 : 7,
    );
    advance(sim, 4);
  }
});

test("commands and Clean interrupt every guest beat without lingering dialogue or props", () => {
  for (const [command, phases] of [
    [
      "invite_pigeon",
      ["arrival", "inspect", "faceoff", "judgment", "departure"],
    ],
    [
      "gull_argument",
      [
        "arrival",
        "stare",
        "posture",
        "squawk-main",
        "squawk-guest",
        "snatch",
        "reaction",
        "departure",
      ],
    ],
  ]) {
    for (const phase of phases) {
      for (const replacement of [
        "feed",
        "clean",
        "cancel",
        "nap",
        "place_bag",
      ]) {
        const sim = setup();
        sim.action(command);
        until(sim, phase);
        sim.action(replacement, { x: 750, y: 550 });
        assertGone(sim);
        const nextBubble = sim.inspect().bubble;
        sim.step(0.05);
        assertGone(sim);
        assert.equal(sim.inspect().bubble, nextBubble);
        advance(sim, 31);
        assertGone(sim);
      }
    }
  }
});

test("hide cancels both guests, freezes time and cannot revive their scenes", () => {
  for (const command of ["invite_pigeon", "gull_argument"]) {
    const sim = setup();
    sim.action(command);
    until(sim, command === "invite_pigeon" ? "faceoff" : "squawk-guest");
    const time = sim.inspect().time;
    sim.setVisible(false);
    assertGone(sim);
    assert.equal(sim.inspect().bubble, "");
    advance(sim, 60);
    assert.equal(sim.inspect().time, time);
    sim.setVisible(true);
    sim.step(0.1);
    assertGone(sim);
  }
});

test("explicit visits work paused and a new pause does not strand an active guest", () => {
  for (const command of ["invite_pigeon", "gull_argument"]) {
    const sim = setup();
    sim.action(command);
    until(sim, command === "invite_pigeon" ? "faceoff" : "posture");
    sim.configure({ paused: false, sound: false, mischief: 1 });
    sim.configure({ paused: true, sound: false, mischief: 0 });
    advance(sim, 25);
    assertGone(sim);
  }
});

test("autonomous appearances require idle, visible, unpaused mischief and a long cooldown", () => {
  const sim = routineFixture(GuestRoutine);
  assert.equal(sim.routine.maybeGuest(), false);
  assert.ok(sim.nextGuest >= sim.time + 180);
  sim.time = sim.nextGuest;
  assert.equal(sim.routine.maybeGuest(), false);
  sim.configure({ paused: false, sound: false, mischief: 0 });
  assert.equal(sim.routine.maybeGuest(), false);
  sim.configure({ paused: false, sound: false, mischief: 1 });
  sim.mode = "walk";
  assert.equal(sim.routine.maybeGuest(), false);
  sim.rest();
  sim.setVisible(false);
  assert.equal(sim.routine.maybeGuest(), false);
  sim.setVisible(true);
  assert.equal(sim.routine.maybeGuest(), true);
  const visit = sim.scene;
  sim.time = sim.nextGuest;
  assert.equal(sim.routine.maybeGuest(), false);
  assert.deepEqual(sim.scene, visit);
  sim.action("cancel");
  assert.ok(sim.nextGuest >= sim.time + 240);
  assert.equal(sim.routine.maybeGuest(), false);
});

test("deadline bounds unusual visits and resizing leaves readable props on screen", () => {
  for (const command of ["invite_pigeon", "gull_argument"]) {
    const sim = routineFixture(GuestRoutine);
    sim.action(command);
    untilFixture(sim, command === "invite_pigeon" ? "faceoff" : "posture");
    sim.resize(100, 100);
    sim.step(0.05);
    assert.ok(sim.x >= 0 && sim.x <= 4);
    assert.ok(sim.y >= 0 && sim.y <= 4);
    for (const prop of guestProps(sim)) {
      assert.ok(Number.isFinite(prop.x) && Number.isFinite(prop.y));
      assert.ok(prop.x >= 0 && prop.x + prop.width <= sim.width, prop.id);
      assert.ok(prop.y >= 0 && prop.y + prop.height <= sim.height, prop.id);
    }
    sim.time = sim.scene.deadline;
    sim.step(0.05);
    assertFixtureGone(sim);
  }
});
