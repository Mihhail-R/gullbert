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
  for (let i = 0; i < Math.ceil(seconds * 20); i++) {
    sim.step(0.05);
  }
}
function until(sim, phase) {
  for (let i = 0; i < 1800 && sim.inspect().scene?.phase !== phase; i++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().scene?.phase, phase);
}
function assertGone(sim) {
  assert.notEqual(sim.inspect().scene?.kind, "guest");
  assert.deepEqual(sim.present().props, []);
  assert.equal(sim.present().guestSpeech, null);
}

function drainFixtureBag(sim) {
  const id = sim.bag.id;

  for (let serving = 0; serving < 3; serving++) {
    sim.objects.consumeBag(id);
  }
}
function untilFixture(sim, phase) {
  for (let i = 0; i < 1800 && sim.scene?.phase !== phase; i++) {
    sim.step(0.05);
  }

  assert.equal(sim.scene?.phase, phase);
}
function assertFixtureGone(sim) {
  assert.notEqual(sim.scene?.kind, "guest");
  assert.deepEqual(guestProps(sim), []);
  assert.equal(guestSpeech(sim), null);
}

test("a pigeon asks about an existing snack bag and leaves without eating it", () => {
  const sim = setup();
  sim.action("place_bag", { x: 400, y: 400 });
  const bag = sim.inspect().bag;
  sim.action("invite_pigeon");
  const guestLines = new Set();

  for (let tick = 0; tick < 1800 && sim.inspect().scene; tick++) {
    if (sim.present().guestSpeech) {
      guestLines.add(sim.present().guestSpeech.text);
    }

    sim.step(0.05);
  }

  assert.ok(guestLines.has("communal chips?"));
  assert.deepEqual(sim.inspect().bag, bag);
  assertGone(sim);
});

test("absent, empty, and vanished bags produce judgment without creating snacks", () => {
  for (const state of ["absent", "empty", "vanished", "emptied"]) {
    const sim = routineFixture(GuestRoutine);

    if (state !== "absent") {
      sim.action("place_bag", { x: 400, y: 400 });
    }

    if (state === "empty") {
      drainFixtureBag(sim);
    }

    sim.action("invite_pigeon");
    untilFixture(sim, "inspect");

    if (state === "vanished") {
      sim.objects.remove("bag", sim.bag.id);
    }

    if (state === "emptied") {
      drainFixtureBag(sim);
    }

    untilFixture(sim, "faceoff");
    assert.equal(sim.scene.hasSnack, false);
    assert.equal(guestSpeech(sim), null);

    for (let tick = 0; tick < 200 && !guestSpeech(sim); tick++) {
      sim.step(0.05);
    }

    assert.equal(guestSpeech(sim).text, "clearly.");
    assert.equal(guestProps(sim).length, 1);
    advance(sim, 60);
    assertFixtureGone(sim);
  }
});

test("the gulls argue over one chip and the visitor takes it, leaving the others alone", () => {
  const sim = setup();
  sim.action("gull_argument");
  until(sim, "squawk-main");
  assert.equal(sim.inspect().bubble, "MINE.");
  assert.equal(sim.present().guestSpeech, null);

  until(sim, "squawk-guest");
  assert.equal(sim.inspect().bubble, "");
  assert.equal(sim.present().guestSpeech.text, "MINE, ACTUALLY.");

  until(sim, "snatch");
  advance(sim, 0.65);
  const chip = sim.present().props.find((prop) => prop.id === "disputed-chip");
  assert.ok(Math.abs(sim.inspect().scene.guest.x + 18 - (chip.x + 12)) < 1);
  assert.ok(Math.abs(sim.inspect().scene.guest.y + 47 - (chip.y + 9)) < 1);

  until(sim, "reaction");
  const props = sim.present().props;
  assert.ok(props.some((prop) => prop.id === "snatched-chip"));
  assert.equal(props.filter((prop) => prop.id.startsWith("ignored-chip-")).length, 5);
  assert.equal(props.some((prop) => prop.id === "disputed-chip"), false);

  advance(sim, 60);
  assertGone(sim);
  assert.equal(sim.inspect().bubble, "");
});

test("inviting a pigeon replaces an argument and removes its chips", () => {
  const sim = setup();
  sim.action("gull_argument");
  until(sim, "squawk-guest");
  sim.action("invite_pigeon");

  assert.equal(sim.inspect().scene.species, "pigeon");
  assert.deepEqual(sim.present().props.map((prop) => prop.id), ["visitor"]);
  assert.equal(sim.present().guestSpeech, null);
});

for (const [command, phase, replacement] of [
  ["invite_pigeon", "faceoff", "feed"],
  ["gull_argument", "squawk-guest", "nap"],
  ["gull_argument", "snatch", "clean"],
]) {
  test(`${replacement} interrupts ${command} without deferred dialogue or props`, () => {
    const sim = setup();
    sim.action(command);
    until(sim, phase);
    sim.action(replacement, { x: 750, y: 550 });
    assertGone(sim);

    const nextBubble = sim.inspect().bubble;
    sim.step(0.05);
    assert.equal(sim.inspect().bubble, nextBubble);
    advance(sim, 31);
    assertGone(sim);
  });
}

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
    advance(sim, 60);
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
