import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { reach } from "./simulation-helpers.mjs";
import { contains } from "../web-dist/simulation/behaviors/touch.js";

function captures(sim, point, interactive = true) {
  return sim.present(null, interactive).hitRegions.some((rect) => {
    return contains(rect, point);
  });
}

test("capture includes the cleanup halo and releases it after the object is removed", () => {
  const sim = new Gullbert(800, 600, () => {
    return 0.5;
  });
  sim.splat({ x: 100, y: 100 });
  const edge = { x: 68, y: 77 };
  assert.equal(captures(sim, edge), true);
  assert.equal(captures(sim, { x: 67, y: 77 }), false);
  sim.action("direct_pick", edge);
  assert.equal(sim.inspect().splats.length, 0);
  assert.equal(captures(sim, edge), false);
  assert.equal(
    captures(sim, { x: sim.inspect().x + 48, y: sim.inspect().y + 48 }),
    true,
  );
});

test("targeting and hiding capture nothing; attached props and belongings remain protected", () => {
  const sim = new Gullbert(800, 600, () => {
    return 0.5;
  });
  sim.configure({ paused: true });
  sim.restoreMemory({ perch: { x: 200, y: 200 } });
  sim.action("place_bag", { x: 124, y: 124 });
  sim.action("steal_bag");
  reach(sim, "drag");
  const bag = sim.inspect().bag;
  assert.equal(sim.present({ x: bag.x + 20, y: bag.y + 20 }).highlight, null);
  assert.equal(captures(sim, { x: 233, y: 284 }), false);
  assert.equal(sim.present().hitRegions.length, 1);
  sim.action("feed");
  const crumb = sim.inspect().crumb;
  assert.equal(sim.present(crumb).highlight, null);
  assert.deepEqual(sim.present(null, false).hitRegions, []);
  sim.setVisible(false);
  assert.deepEqual(sim.present().hitRegions, []);
});
