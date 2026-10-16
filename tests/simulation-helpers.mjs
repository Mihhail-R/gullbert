import assert from "node:assert/strict";

export function advance(sim, seconds) {
  for (let tick = 0; tick < Math.ceil(seconds * 20); tick++) {
    sim.step(0.05);
  }
}

export function reach(sim, phase, ticks = 1200) {
  for (
    let tick = 0;
    tick < ticks && sim.inspect().scene?.phase !== phase;
    tick++
  ) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().scene?.phase, phase);
}

/** Produce real mess through the same command used by the application. */
export function dropAt(sim, point) {
  const previous = sim.inspect().splats.at(-1)?.id;
  sim.action("poop", point);

  for (let tick = 0; tick < 1200; tick++) {
    sim.step(0.05);
    const splat = sim.inspect().splats.at(-1);

    if (splat && splat.id !== previous) {
      sim.action("cancel");
      return splat;
    }
  }

  throw new Error("Gullbert did not complete the requested drop");
}

export function emptyBag(sim) {
  for (let serving = 0; serving < 3; serving++) {
    sim.action("search_snack");

    for (let tick = 0; tick < 600 && sim.inspect().scene; tick++) {
      sim.step(0.05);
    }
  }

  assert.equal(sim.inspect().bag.servings, 0);
}
