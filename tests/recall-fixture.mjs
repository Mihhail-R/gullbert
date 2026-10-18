import { Belongings } from "../web-dist/simulation/belongings.js";
import { Gullbert } from "../web-dist/simulation/engine.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Actual dated meals establish two places without reaching into durable summary layout. */
export function snackRecallFixture(width = 900) {
  let nowMs = new Date(2026, 0, 5, 12)
    .getTime();
  const belongings = new Belongings(width, 650, () => nowMs);

  for (const point of [{ x: 100, y: 200 }, { x: width - 200, y: 400 }]) {
    for (let day = 0; day < 3; day++) {
      belongings.rememberMeal(point);
      nowMs += DAY_MS;
    }
  }

  nowMs += 2 * DAY_MS;
  belongings.creditActiveTime(300_000, () => 0);
  const sim = new Gullbert(width, 650, () => 0, { now: () => nowMs });
  sim.restoreMemory(belongings.exportMemory());
  sim.configure({ mischief: 0 });
  return { sim, belongings, now: () => nowMs };
}

/** Keep a suitable idle moment while advancing only visible simulation time. */
export function idleFor(sim, seconds) {
  for (let tick = 0; tick < Math.ceil(seconds * 10); tick++) {
    if (sim.inspect().scene?.purpose === "old-snack-spot") {
      return;
    }

    if (sim.inspect().scene?.purpose === "encore") {
      return;
    }

    sim.action("cancel");
    sim.step(0.1);
  }
}

export function encoreFixture(trick) {
  let nowMs = new Date(2026, 0, 5, 12)
    .getTime();
  const belongings = new Belongings(900, 650, () => nowMs);

  for (let day = 0; day < 3; day++) {
    belongings.rewardTrick(trick, { x: 200, y: 300 });
    nowMs += DAY_MS;
  }

  nowMs += DAY_MS;
  belongings.creditActiveTime(300_000, () => 0);
  const sim = new Gullbert(900, 650, () => 0, { now: () => nowMs });
  sim.restoreMemory(belongings.exportMemory());
  sim.configure({ mischief: 0 });
  return {
    sim,
    advanceDays(days) {
      nowMs += days * DAY_MS;
    },
  };
}
