import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { reach } from "./simulation-helpers.mjs";

function setup() {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, sound: false, mischief: 0 });
  return sim;
}

test("visitors take readable turns throughout a conversation", () => {
  for (const command of ["invite_pigeon", "gull_argument"]) {
    const sim = setup();
    sim.action(command);
    const turns = [];
    let previous = "";
    let started = 0;

    for (let tick = 0; tick < 1600; tick++) {
      const view = sim.inspect();
      const guest = sim.present().guestSpeech?.text ?? "";
      assert.ok(
        !(view.bubble && guest),
        `both speaking during ${view.scene?.phase}`,
      );
      let current = "";

      if (view.bubble) {
        current = `gullbert:${view.bubble}`;
      } else if (guest) {
        current = `visitor:${guest}`;
      }

      if (current !== previous) {
        if (previous) {
          assert.ok(
            view.time - started >= 2.4,
            `${previous} disappeared too soon`,
          );
          turns.push(previous);
        }

        previous = current;
        started = view.time;
      }

      sim.step(0.05);
    }

    assert.ok(turns.some((line) => line.startsWith("visitor:")));
    assert.equal(sim.inspect().scene, null);
  }
});

test("repeated tricks acknowledge previous performances, including after restart", () => {
  let sim = setup();
  const openings = [];
  const rewards = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    sim.action("trick_spin");
    openings.push(sim.inspect().bubble);
    reach(sim, "reward");
    rewards.push(sim.inspect().bubble);
    const saved = sim.exportMemory();
    sim = setup();
    sim.restoreMemory(saved);
  }

  assert.equal(new Set(openings).size, 3, "the same opening is repeated");
  assert.equal(new Set(rewards).size, 3, "the same reward request is repeated");
});
