import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { harness, pointerEvent, settle } from "./application-harness.mjs";

for (const native of [false, true]) {
  test(`head scratches animate smoothly and settle afterward (native=${native})`, async (t) => {
    const sim = new Gullbert(800, 600, () => 0.5);
    let pointer = { x: sim.inspect().x + 60, y: sim.inspect().y + 35 };
    const app = harness({
      simulation: sim,
      native,
      invoke(command) {
        if (command === "sync_interaction") {
          return pointer;
        }
      },
    });
    t.after(() => app.app.dispose());
    await app.app.start();
    sim.configure({ paused: true });
    app.emit("pointermove", pointerEvent(pointer));

    for (let frame = 0; frame < 60 && sim.inspect().touch.reaction !== "pet"; frame++) {
      app.displayFrame();
      await settle();
    }

    assert.equal(sim.present().affection.kind, "scratch");
    let ticks = 0;
    let previousTime = sim.inspect().time;

    for (let frame = 0; frame < 30; frame++) {
      app.displayFrame();
      await settle();
      const time = sim.inspect().time;

      if (time !== previousTime) {
        ticks++;
      }

      previousTime = time;
    }

    assert.equal(ticks, 30, "scratch animation must advance on every display frame");

    for (let frame = 0; frame < 240; frame++) {
      app.displayFrame();
      await settle();
    }

    assert.equal(sim.present().affection.kind, "", "a parked cursor cannot hold him forever");
    assert.equal(sim.status().animate, false);
    assert.equal(app.frames.size, 0);

    pointer = null;
    app.emit("pointerleave");

    for (let frame = 0; frame < 30; frame++) {
      app.displayFrame();
      await settle();
    }

    assert.equal(sim.inspect().touch.reaction, "");
    assert.equal(app.frames.size, 0);
  });
}
