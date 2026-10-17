import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { harness, pointerEvent, settle } from "./application-harness.mjs";

for (const native of [false, true]) {
  test(`third cone cleanup moves at display cadence (native=${native})`, async (t) => {
    const sim = new Gullbert(800, 600, () => 0.5);
    const app = harness({ simulation: sim, native });
    t.after(() => app.app.dispose());
    await app.app.start();
    sim.configure({ mischief: 0 });
    sim.action("municipal_gull");

    for (let tick = 0; tick < 1200 && sim.inspect().scene; tick++) {
      sim.step(0.05);
    }

    assert.equal(sim.inspect().scene, null);
    const cones = sim.inspect().cones;
    assert.equal(cones.length, 3);
    const movementCounts = [];

    for (const cone of cones) {
      app.emit("pointerdown", pointerEvent({ x: cone.x, y: cone.y - 18 }));
      let previous = sim.inspect();
      let movementFrames = 0;

      for (let frame = 0; frame < 30; frame++) {
        app.displayFrame();
        await settle();
        const current = sim.inspect();

        if (current.x !== previous.x || current.y !== previous.y) {
          movementFrames++;
        }

        previous = current;
      }

      movementCounts.push(movementFrames);
    }

    assert.equal(sim.inspect().cones.length, 0);
    assert.equal(sim.inspect().cleanup.level, 3);
    assert.deepEqual(movementCounts.slice(0, 2), [0, 0]);
    t.diagnostic(`Position updates in 30 display frames: ${movementCounts.join(", ")}`);
    assert.equal(movementCounts[2], 30, "cleanup movement must run on every display frame");

    for (let frame = 0; frame < 300 && sim.inspect().cleanup.session; frame++) {
      app.displayFrame();
      await settle();
    }

    assert.equal(sim.inspect().cleanup.session, null);
    assert.equal(sim.status().animate, false, "finished cleanup returns to idle cadence");
    assert.equal(app.frames.size, 0);
  });
}
