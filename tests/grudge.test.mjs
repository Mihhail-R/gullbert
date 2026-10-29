import test from "node:test";
import assert from "node:assert/strict";
import { Grudge } from "../web-dist/simulation/grudge.js";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { dialogue } from "../web-dist/simulation/dialogue.js";
import { advance } from "./simulation-helpers.mjs";

function bird(level, random = 0.9) {
  const sim = new Gullbert(900, 650, () => random);
  sim.configure({ mischief: level });
  return sim;
}

let wallMs = 0;
function handle(sim) {
  const { x, y } = sim.inspect();
  wallMs += 1000;
  assert.ok(sim.beginPickup({ x: x + 45, y: y + 45 }, wallMs));
  sim.movePickup({ x: 250 + (wallMs % 300), y: 250 });
  sim.finishPickup(false, wallMs + 100);
  sim.action("cancel");
}

test("offences escalate the grudge and visible time alone forgives them", () => {
  const grudge = new Grudge();
  grudge.offend("handled", 0);
  assert.equal(grudge.level(0), 0);
  grudge.offend("ignored", 0);
  assert.equal(grudge.level(0), 1);
  grudge.offend("ignored", 0);
  assert.equal(grudge.level(0), 2);

  assert.equal(grudge.level(200), 1);
  assert.equal(grudge.level(500), 0);
});

test("scratches and chips soothe a grudge without going below calm", () => {
  const grudge = new Grudge();

  for (let i = 0; i < 6; i++) {
    grudge.offend("tidied", 0);
  }

  grudge.soothe(2, 0);
  assert.equal(grudge.level(0), 1);
  grudge.soothe(10, 0);
  assert.equal(grudge.snapshot(0).points, 0);
});

test("repeated handling builds a grudge only when mischief is enabled", () => {
  const polite = bird(0);
  const menace = bird(1);

  for (let i = 0; i < 5; i++) {
    handle(polite);
    handle(menace);
  }

  assert.equal(polite.inspect().grudge.level, 0);
  assert.equal(menace.inspect().grudge.level, 2);
});

test("hiding, pausing or restoring memory settles the grudge", () => {
  for (const settle of [
    (sim) => sim.setVisible(false),
    (sim) => sim.configure({ paused: true }),
    (sim) => sim.restoreMemory(sim.exportMemory()),
  ]) {
    const sim = bird(1);

    for (let i = 0; i < 5; i++) {
      handle(sim);
    }

    settle(sim);
    assert.equal(sim.inspect().grudge.points, 0);
  }
});

test("a furious grudge brings unprompted mischief sooner and names it", () => {
  const calm = bird(1);
  const furious = bird(1);

  // Extra handling outlasts the fading during the wait for the next mischief.
  for (let i = 0; i < 7; i++) {
    handle(furious);
  }

  calm.configure({ mischief: 1 });
  furious.configure({ mischief: 1 });

  for (const sim of [calm, furious]) {
    const due = sim.inspect().nextMischief;
    advance(sim, due - sim.inspect().time + 0.1);
  }

  const calmDelay = calm.inspect().nextMischief - calm.inspect().time;
  const furiousDelay = furious.inspect().nextMischief - furious.inspect().time;
  assert.ok(furiousDelay < calmDelay * 0.6, `${furiousDelay} vs ${calmDelay}`);
  assert.ok(dialogue.gullbert.grudge.furious.includes(furious.inspect().bubble));
});
