import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { TypingRoutine } from "../web-dist/simulation/behaviors/typing.js";
import { routineFixture } from "./routine-fixture.mjs";

const caret = { x: 470, y: 300, height: 20, context: "field-a", position: "1" };
function make(level = 2, random = () => 0.5) {
  const sim = new Gullbert(900, 650, random);
  sim.configure({ mischief: level });
  sim.caret(caret);
  sim.action("caret_fishing");
  return sim;
}
function tick(sim, seconds, sample = caret, pointer = null) {
  for (let i = 0; i < seconds * 20; i++) {
    if (sample) sim.caret(sample);
    if (pointer) sim.pointer(pointer(sim.inspect()));
    sim.step(0.05);
  }
}
function reach(sim, phase) {
  for (let i = 0; i < 600 && sim.inspect().scene?.phase !== phase; i++) {
    tick(sim, 0.05);
  }
  assert.equal(sim.inspect().scene?.phase, phase);
}
function nest(sim) {
  return sim
    .present()
    .props.filter((p) => String(p.id).startsWith("nest-letter-"));
}

test("public enemy catches punctuation and deposits a bounded session nest", () => {
  const sim = make();
  reach(sim, "carry");
  assert.equal(
    sim.present().props.find((p) => p.id === "stolen-letter").text,
    ";",
  );
  tick(sim, 5);
  assert.equal(nest(sim).length, 1);
  for (let i = 0; i < 14; i++) {
    sim.caret(caret);
    sim.action("caret_fishing");
    tick(sim, 10);
  }
  assert.equal(nest(sim).length, 12);
  sim.resize(240, 160);
  for (const prop of sim.present().props) {
    assert.ok(prop.x >= 0 && prop.y >= 0);
    assert.ok(prop.x + prop.width <= 240 && prop.y + prop.height <= 160);
  }
  sim.clean();
  assert.equal(nest(sim).length, 0);
});

test("nearby pointer freezes him, hides loot, then resumes after an innocent pause", () => {
  const sim = make();
  reach(sim, "carry");
  const before = sim.inspect();
  tick(sim, 2, caret, (s) => ({ x: s.x + 48, y: s.y + 48 }));
  assert.equal(sim.inspect().scene.phase, "innocent");
  assert.equal(sim.inspect().x, before.x);
  assert.equal(sim.inspect().y, before.y);
  assert.equal(
    sim.present().props.some((p) => p.id === "stolen-letter"),
    false,
  );
  sim.pointer({ x: -1, y: -1, inside: false });
  tick(sim, 0.6);
  assert.equal(sim.inspect().scene.phase, "innocent");
  tick(sim, 0.6);
  assert.equal(sim.inspect().scene.phase, "carry");
  tick(sim, 5);
  assert.equal(nest(sim).length, 1);
});

test("watching him indefinitely cannot extend the caper deadline", () => {
  const sim = make();
  tick(sim, 23, caret, (s) => ({ x: s.x + 48, y: s.y + 48 }));
  assert.notEqual(sim.inspect().scene?.kind, "typing");
  assert.equal(nest(sim).length, 0);
});

test("menace fishes with occasional letter theft; polite leaves text alone", () => {
  const miss = make(1, () => 0.9);
  tick(miss, 8);
  assert.equal(nest(miss).length, 0);
  assert.notEqual(miss.inspect().scene?.kind, "typing");
  const thief = make(1, () => 0.1);
  reach(thief, "carry");
  assert.equal(
    thief.present().props.find((p) => p.id === "stolen-letter").text,
    "o",
  );
  tick(thief, 5);
  assert.equal(nest(thief).length, 0);
  assert.equal(make(0).inspect().scene, null);
});

test("lost, stale or switched caret abandons fishing before awarding loot", () => {
  for (const replacement of [
    null,
    { ...caret, context: "field-b" },
    { ...caret, x: NaN },
    { ...caret, x: 9999 },
  ]) {
    const sim = make();
    sim.caret(replacement);
    sim.step(0.1);
    assert.equal(sim.inspect().scene, null);
    assert.equal(nest(sim).length, 0);
  }
  const stale = make();
  tick(stale, 1.3, null);
  assert.equal(stale.inspect().scene, null);
});

test("feed, cancel, hide, pause, and mischief changes discard in-flight rewards", () => {
  for (const phase of ["approach", "watch", "pounce", "carry", "deposit"]) {
    for (const stop of [
      (s) => s.action("feed"),
      (s) => s.action("cancel"),
      (s) => s.setVisible(false),
      (s) => s.configure({ paused: true }),
      (s) => s.configure({ mischief: 0 }),
    ]) {
      const sim = make();
      reach(sim, phase);
      stop(sim);
      tick(sim, 2);
      assert.notEqual(sim.inspect().scene?.kind, "typing", phase);
      assert.equal(nest(sim).length, 0, phase);
      assert.equal(sim.cursorEncounter(), null);
    }
  }
});

test("autonomy requires recent caret movement and higher mischief shortens cooldown", () => {
  const delays = [];
  for (const level of [0, 1, 2]) {
    const sim = routineFixture(TypingRoutine);
    sim.configure({ paused: false, mischief: level });
    sim.time = 10;
    sim.routine.sample(caret);
    assert.equal(sim.routine.maybeStart(), false, "focus alone is not typing");
    sim.routine.sample({ ...caret, position: "2" });
    assert.equal(sim.routine.maybeStart(), level > 0);
    if (level === 0) continue;
    sim.action("cancel");
    let at = 11;
    for (; at < 120; at++) {
      sim.time = at;
      sim.routine.sample({ ...caret, position: String(at) });
      if (sim.routine.maybeStart()) break;
    }
    delays.push(at);
  }
  assert.ok(delays[1] < delays[0]);
});

test("completed nest survives commands and hiding but never enters saved belongings", () => {
  const sim = make();
  tick(sim, 10);
  const saved = sim.exportMemory();
  sim.action("feed");
  assert.equal(nest(sim).length, 1);
  sim.setVisible(false);
  assert.equal(nest(sim).length, 0);
  sim.setVisible(true);
  assert.equal(nest(sim).length, 1);
  const restored = new Gullbert(900, 650);
  restored.restoreMemory(saved);
  assert.equal(nest(restored).length, 0);
});

test("vision grazes on stationary text without a typing event", () => {
  const sim = routineFixture(TypingRoutine);
  sim.configure({ paused: false, mischief: 2, vision: true });
  sim.time = 10;
  sim.routine.sample({ ...caret, source: "vision", glyph: "s" });
  assert.equal(sim.routine.maybeStart(), true);
  assert.equal(sim.scene.glyph, "s");
  assert.equal(sim.scene.visual, true);
});

test("a parked pointer near a vision target does not permanently scare him away", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ mischief: 2, vision: true });
  const sample = { ...caret, source: "vision", glyph: "s" };
  sim.caret(sample);
  sim.pointer({ x: caret.x, y: caret.y });
  sim.action("caret_fishing");
  let caught = false;
  for (let i = 0; i < 240; i++) {
    sim.caret(sample);
    sim.pointer({ x: caret.x, y: caret.y });
    sim.step(0.05);
    if (sim.inspect().scene?.phase === "carry") {
      caught = true;
      break;
    }
  }
  assert.equal(caught, true);
  assert.equal(
    sim.present().props.find((p) => p.id === "stolen-letter").text,
    "s",
  );
});

test("vision locks the spotted word so moving the pointer away does not move his target", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ mischief: 2, vision: true });
  sim.caret({ ...caret, source: "vision", glyph: "x" });
  sim.action("caret_fishing");
  const target = sim.inspect().scene.target;
  sim.caret({ ...caret, x: 100, y: 100, source: "vision", glyph: "y" });
  sim.step(0.1);
  assert.deepEqual(sim.inspect().scene.target, target);
  sim.caret(null);
  tick(sim, 5, null);
  assert.notEqual(sim.inspect().scene?.phase, "approach");
  sim.configure({ vision: false });
  assert.equal(sim.inspect().scene, null);
});
