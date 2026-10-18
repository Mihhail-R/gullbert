import test from "node:test";
import assert from "node:assert/strict";
import { Belongings } from "../web-dist/simulation/belongings.js";
import { normalizeMemory } from "../web-dist/simulation/memory.js";
import { memoryDescription } from "../web-dist/ui/controls/memory-view.js";
import { MemoryPersistence } from "../web-dist/platform/roommate-store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const startMs = new Date(2026, 0, 5, 12)
  .getTime();
const point = { x: 150, y: 300 };

function episode(id, day, kind, detail, x = 150) {
  return {
    id,
    at: startMs + day * DAY_MS,
    kind,
    detail,
    location: { x, y: 300, width: 1200, height: 800 },
  };
}

function fixture() {
  let nowMs = startMs;
  const belongings = new Belongings(1200, 800, () => nowMs);
  return {
    belongings,
    day(day) {
      nowMs = startMs + day * DAY_MS;
    },
  };
}

test("legacy migration replays dated evidence chronologically and blocks its migration day", () => {
  const episodes = [
    episode(1, 2, "reward", "spin"),
    episode(2, 0, "reward", "spin"),
    episode(3, 0, "gift", "bent_spoon"),
    episode(4, 1, "reward", "spin"),
    episode(5, 3, "activity", "hangout"),
    episode(6, 3, "gift", "bent_spoon"),
  ];
  const saved = normalizeMemory({
    version: 2,
    episodes,
    collection: { bent_spoon: 2 },
    learned: { tricks: { spin: 6, dead: 6 } },
  }, 1200, 800, startMs + 10 * DAY_MS);
  assert.equal(saved.longTerm.tricks.spin.days, 3);
  assert.equal(saved.longTerm.tricks.dead.days, 0);
  assert.equal(saved.longTerm.keepsakes.bent_spoon.acquiredAtMs, startMs);
  assert.equal(saved.longTerm.active.days, 4);
  assert.equal(saved.learned.tricks.dead, 6);

  const { belongings, day } = fixture();
  day(10);
  belongings.restore(saved);
  belongings.creditActiveTime(300_000, () => 0);
  assert.equal(belongings.reserveRecall(() => 0), null);
  day(11);
  belongings.creditActiveTime(300_000, () => 0);
  assert.ok(belongings.reserveRecall(() => 0));
});

test("incomplete history preserves partial evidence without inferring age from counters", () => {
  const memory = normalizeMemory({
    version: 1,
    collection: { sock: 99 },
    performances: { spin: 100 },
    learned: { tricks: { spin: 6 } },
    episodes: [episode(1, 0, "reward", "spin"), episode(2, 0, "reward", "spin")],
  }, 1200, 800, startMs);
  assert.equal(memory.longTerm.tricks.spin.days, 1);
  assert.equal(memory.longTerm.tricks.spin.qualifiedAtMs, null);
  assert.deepEqual(memory.longTerm.keepsakes, {});
  assert.equal(memory.longTerm.active.days, 1);
});

test("evidence survives history eviction and forgetting cannot resurrect it on restore", () => {
  const { belongings, day } = fixture();
  belongings.collect("bent_spoon", point);

  for (let current = 0; current < 3; current++) {
    day(current);
    belongings.rewardTrick("spin", point);
    belongings.rememberMeal(point);
  }

  for (let index = 0; index < 210; index++) {
    belongings.remember("activity", "hangout", point);
  }

  const saved = belongings.exportMemory();
  assert.equal(saved.episodes.length, 200);
  assert.equal(saved.episodes.some((entry) => entry.kind === "reward"), false);
  belongings.restore(saved);
  assert.equal(belongings.exportMemory().longTerm.tricks.spin.days, 3);
  assert.equal(belongings.exportMemory().longTerm.snack.established.days, 3);
  belongings.forgetLearning();
  belongings.restore(belongings.exportMemory());
  const forgotten = belongings.exportMemory();
  assert.equal(forgotten.longTerm.tricks.spin.days, 0);
  assert.equal(forgotten.longTerm.snack.established, null);
  assert.equal(forgotten.longTerm.keepsakes.bent_spoon.acquiredAtMs, startMs);
  assert.equal(forgotten.collection.bent_spoon, 1);
});

test("completion records recall history and forgetting removes learned callbacks", () => {
  const { belongings, day } = fixture();

  for (let current = 0; current < 3; current++) {
    day(current);
    belongings.rewardTrick("spin", point);
  }

  day(4);
  belongings.creditActiveTime(300_000, () => 0);
  assert.equal(belongings.reserveRecall(() => 0, ["treasure"]), null);
  const reservation = belongings.reserveRecall(() => 0, ["trick"]);
  assert.ok(reservation);
  assert.equal(belongings.exportMemory().episodes.some((entry) => entry.kind === "recall"), false);
  assert.ok(belongings.completeRecall(reservation, point));
  assert.equal(belongings.completeRecall(reservation, point), false);
  const recalled = belongings.exportMemory().episodes.at(-1);
  assert.equal(memoryDescription(recalled), "Remembered Spin");
  assert.equal(recalled.detail, "encore:spin");
  belongings.remember("recall", "keepsake:bent_spoon", point);
  belongings.forgetLearning();
  assert.deepEqual(
    belongings.exportMemory().episodes.filter((entry) => entry.kind === "recall")
      .map((entry) => entry.detail),
    ["keepsake:bent_spoon"],
  );
});

test("restore invalidates transient completion while preserving the spent daily allowance", () => {
  const { belongings, day } = fixture();

  for (let current = 0; current < 3; current++) {
    day(current);
    belongings.rewardTrick("dead", point);
  }

  day(4);
  belongings.creditActiveTime(300_000, () => 0);
  const reservation = belongings.reserveRecall(() => 0);
  belongings.restore(belongings.exportMemory());
  assert.equal(belongings.completeRecall(reservation, point), false);
  assert.equal(belongings.reserveRecall(() => 0), null);
});

test("a newly allowed day still waits twenty hours after the previous callback start", () => {
  const { belongings, day } = fixture();

  for (let current = 0; current < 3; current++) {
    day(current);
    belongings.rewardTrick("spin", point);
  }

  day(4);
  belongings.creditActiveTime(300_000, () => 0);
  day(4.4);
  assert.ok(belongings.reserveRecall(() => 0));
  day(5);
  belongings.creditActiveTime(300_000, () => 0);
  assert.equal(belongings.reserveRecall(() => 0), null);
  day(5.3);
  assert.ok(belongings.reserveRecall(() => 0));
});

test("normalization rejects malformed evidence, dates, coordinates and recall details", () => {
  const saved = normalizeMemory(null);
  saved.longTerm.tricks.spin = {
    days: 0,
    lastDay: { day: "2026-02-31", atMs: startMs },
    qualifiedAtMs: startMs,
    recalledAtMs: Infinity,
  };
  saved.longTerm.snack.established = {
    days: 3,
    lastDay: { day: "2026-01-05", atMs: startMs },
    position: { x: 1.1, y: 0.3 },
  };
  saved.longTerm.keepsakes.bent_spoon = {
    acquiredAtMs: -1,
    activeDaysAtAcquisition: 0,
    recalledAtMs: null,
  };
  saved.longTerm.lastStart = { key: "snack:", atMs: startMs };
  saved.episodes = [
    episode(1, 0, "recall", "encore:come"),
    episode(2, 0, "recall", "keepsake:chip"),
    episode(3, 0, "recall", "encore:dead"),
    episode(4, 0, "recall", "keepsake:sock"),
    episode(5, 0, "recall", "snack_spot"),
  ];
  const normalized = normalizeMemory(saved);
  assert.equal(normalized.longTerm.tricks.spin.qualifiedAtMs, null);
  assert.equal(normalized.longTerm.snack.established, null);
  assert.equal(normalized.longTerm.keepsakes.bent_spoon, undefined);
  assert.equal(normalized.longTerm.lastStart, null);
  assert.deepEqual(normalized.episodes.map((entry) => entry.id), [3, 4, 5]);
});

test("shutdown preserves partial active progress without saving every frame", async () => {
  const { belongings } = fixture();
  let saved;
  let writes = 0;
  const persistence = new MemoryPersistence({
    storage: {
      load: () => null,
      save(memory) {
        writes += 1;
        saved = memory;
      },
    },
    clock: { schedule: setTimeout, cancel: clearTimeout },
    restore: (memory) => belongings.restore(memory),
    revision: () => belongings.snapshot().revision,
    snapshot: () => belongings.exportMemory(),
    checkpoint: () => belongings.checkpointActiveTime(),
    result: () => {},
  });
  await persistence.restore();
  persistence.start();

  for (let index = 0; index < 59; index++) {
    belongings.creditActiveTime(100, () => 0);
    persistence.remember();
  }

  assert.equal(writes, 1);
  await persistence.flush();
  assert.equal(saved.longTerm.active.progressMs, 5900);
  belongings.restore(saved);
  belongings.creditActiveTime(294_100, () => 0);
  assert.equal(belongings.exportMemory().longTerm.active.days, 1);
  await persistence.dispose();
});
