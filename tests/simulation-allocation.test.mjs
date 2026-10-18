import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";

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
