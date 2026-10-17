import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { projectPresentation } from "../web-dist/simulation/presentation.js";
import { interactionRects } from "../web-dist/simulation/interaction.js";
import { pickupRect, canPickup } from "../web-dist/simulation/behaviors/pickup.js";
import { directCleanupTarget } from "../web-dist/simulation/behaviors/cleanup.js";

function frameCloneCount(command) {
  const sim = new Gullbert(900, 650, () => 0.5, { now: () => 1000 });
  sim.configure({ paused: true, mischief: 0 });

  if (command) {
    sim.action(command, { x: 650, y: 480 });
  }

  const originalClone = globalThis.structuredClone;
  let clones = 0;
  globalThis.structuredClone = (...arguments_) => {
    clones += 1;
    return originalClone(...arguments_);
  };

  try {
    for (let frame = 0; frame < 20; frame++) {
      sim.step(0.05);
      sim.present();
    }
  } finally {
    globalThis.structuredClone = originalClone;
  }

  return clones / 20;
}

test("idle and animated frames stay within a bounded observation clone budget", () => {
  for (const command of [null, "feed_here", "play_cap"]) {
    const clones = frameCloneCount(command);
    assert.ok(clones <= 20, `${command ?? "idle"}: ${clones} clones per frame`);
  }
});

test("narrow presentation and geometry queries match detached full observations", () => {
  const pointer = { x: 300, y: 300 };

  for (const command of ["cancel", "feed_here", "place_bag", "tidy"]) {
    const sim = new Gullbert(900, 650, () => 0.5, { now: () => 1000 });
    sim.configure({ paused: true, mischief: 0, hat: "captain" });
    sim.action("place_bag", pointer);
    sim.action(command, pointer);
    const firstPresentation = sim.present(pointer);
    const savedPresentation = structuredClone(firstPresentation);

    for (let frame = 0; frame < 80; frame++) {
      const inspection = sim.inspect();
      const savedInspection = structuredClone(inspection);
      assert.deepEqual(sim.present(pointer), projectPresentation(inspection, pointer), command);
      assert.deepEqual(sim.interactionRects(), interactionRects(inspection), command);
      assert.deepEqual(sim.pickupRect(), pickupRect(inspection), command);
      assert.equal(sim.canPickup(), canPickup(inspection), command);
      assert.equal(
        sim.directCleanupAt(pointer),
        directCleanupTarget(inspection, pointer) !== null,
        command,
      );
      assert.deepEqual(sim.inspect(), inspection, command);
      sim.step(0.05);
      assert.deepEqual(inspection, savedInspection, command);
    }

    assert.deepEqual(firstPresentation, savedPresentation, command);
    sim.resize(500, 400);
    sim.setVisible(false);
    assert.deepEqual(sim.interactionRects(), []);
    assert.equal(sim.canPickup(), false);
    assert.equal(sim.directCleanupAt(pointer), false);
    assert.deepEqual(firstPresentation, savedPresentation, command);
  }
});
