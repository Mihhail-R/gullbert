import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../web-dist/actions/catalog.js";
import { Gullbert } from "../web-dist/simulation/engine.js";

const actions = new Set(["eat_cursor"]);

for (const definition of Object.values(catalog)) {
  const command = definition.command ?? definition.purpose;

  if (command) {
    actions.add(command);
  }
}

const needsBag = new Set([
  "steal_bag",
  "bag_caper",
  "search_snack",
  "invite_pigeon",
  "gull_argument",
]);

function renderedPosition(view) {
  return {
    x: view.x + view.visualOffset.x + view.affection.x,
    y: view.y + view.affection.y,
    rotation: view.rotation,
    opacity: view.visualOffset.opacity,
  };
}

for (const action of actions) {
  test(`${action}: visible motion is scheduled and cancellation survives hide/show`, () => {
    for (const roll of [0.1, 0.5, 0.9]) {
      const sim = new Gullbert(800, 600, () => roll);
      sim.configure({ mischief: 0 });
      sim.restoreMemory({ perch: { x: 60, y: 90 }, collection: { bottle_cap: 1 } });

      if (needsBag.has(action)) {
        sim.action("place_bag", { x: 250, y: 250 });
      }

      sim.action(action, { x: 250, y: 250 });

      for (let tick = 0; tick < 600; tick++) {
        const animated = sim.status().animate;
        const before = renderedPosition(sim.present());
        const scene = sim.inspect().scene;

        if (scene?.kind === "cap" && scene.phase === "ready") {
          sim.flickCap(scene.cap);
        }

        sim.pointer({ x: 400, y: 300 });
        sim.step(0.05);

        // Starting or finishing an animation can move on the transition tick.
        if (!animated && !sim.status().animate) {
          assert.deepEqual(
            renderedPosition(sim.present()),
            before,
            `Unscheduled motion in ${action}, random=${roll}, tick=${tick}`,
          );
        }
      }

      // Disable fresh autonomous actions so this checks the cancelled activity only.
      sim.configure({ paused: true });
      sim.action("cancel");
      const time = sim.inspect().time;
      sim.setVisible(false);
      sim.step(0.1);
      assert.equal(sim.inspect().time, time);
      sim.setVisible(true);
      sim.step(0.05);
      assert.equal(sim.inspect().scene, null);
      assert.equal(sim.inspect().flight, null);
      assert.equal(sim.status().animate, false);
    }
  });
}
