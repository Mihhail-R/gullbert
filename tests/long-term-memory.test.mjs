import test from "node:test";
import assert from "node:assert/strict";
import {
  createLongTermMemory,
  recordTrickEvidence,
  eligibleRecalls,
  creditActiveTime,
  recordMealEvidence,
  recordAcquisition,
  reserveRecall,
  completeRecall,
  recallPoint,
} from "../web-dist/simulation/long-term-memory.js";
import { normalizeMemory } from "../web-dist/simulation/memory.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const startMs = new Date(2026, 0, 5, 12)
  .getTime();
const activeMs = 5 * 60 * 1000;
const collection = { bent_spoon: 1 };

function eligible(memory, nowMs, owned = collection, width = 1200) {
  return eligibleRecalls(memory, nowMs, owned, width, 800);
}

function teach(memory, trick = "spin") {
  for (let day = 0; day < 3; day++) {
    recordTrickEvidence(memory, trick, startMs + day * DAY_MS);
  }
}

function feed(memory, x, firstDay) {
  for (let day = firstDay; day < firstDay + 3; day++) {
    recordMealEvidence(memory, { x, y: 300 }, 1200, 800, startMs + day * DAY_MS);
  }
}

test("repeated rewards and midnight clicking cannot establish a lasting trick", () => {
  const memory = createLongTermMemory();

  for (let i = 0; i < 50; i++) {
    recordTrickEvidence(memory, "spin", startMs + i * 1000);
  }

  recordTrickEvidence(memory, "spin", startMs + 13 * 60 * 60 * 1000);
  assert.equal(memory.tricks.spin.days, 1);
  recordTrickEvidence(memory, "spin", startMs + DAY_MS);
  recordTrickEvidence(memory, "spin", startMs + 2 * DAY_MS);
  assert.equal(memory.tricks.spin.days, 3);
  assert.deepEqual(eligibleRecalls(memory, startMs + 3 * DAY_MS, {}, 1200, 800), []);
  const recalls = eligibleRecalls(memory, startMs + 4 * DAY_MS, {}, 1200, 800);
  assert.deepEqual(recalls.map((recall) => recall.kind), ["trick"]);
});

test("active progress survives restart and rolls one persisted admission per active day", () => {
  let memory = createLongTermMemory();
  let draws = 0;
  const random = () => {
    draws += 1;
    return 0.399;
  };
  creditActiveTime(memory, 120_123, startMs, random);
  memory = structuredClone(memory);
  creditActiveTime(memory, 179_876, startMs + 180_000, random);
  assert.equal(memory.active.days, 0);
  creditActiveTime(memory, 1, startMs + 180_001, random);
  assert.equal(memory.active.days, 1);
  assert.equal(memory.daily.allowed, true);
  memory = structuredClone(memory);
  creditActiveTime(memory, activeMs, startMs + 13 * 60 * 60 * 1000, random);
  assert.equal(draws, 1);
  creditActiveTime(memory, activeMs, startMs + DAY_MS, () => 0.4);
  assert.equal(memory.active.days, 2);
  assert.equal(memory.daily.allowed, false);
});

test("rollback and timezone day changes cannot duplicate evidence or active credit", () => {
  const memory = createLongTermMemory();
  const oldTimezone = process.env.TZ;

  try {
    process.env.TZ = "UTC";
    const atMs = Date.UTC(2026, 0, 5, 23);
    recordTrickEvidence(memory, "spin", atMs);
    creditActiveTime(memory, activeMs, atMs, () => 0);
    process.env.TZ = "Pacific/Auckland";
    recordTrickEvidence(memory, "spin", atMs + 1000);
    creditActiveTime(memory, activeMs, atMs + 1000, () => 0);
    recordTrickEvidence(memory, "spin", atMs - DAY_MS);
    creditActiveTime(memory, activeMs, atMs - DAY_MS, () => 0);
    assert.equal(memory.tricks.spin.days, 1);
    assert.equal(memory.active.days, 1);
  } finally {
    if (oldTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = oldTimezone;
    }
  }
});

test("absence ages memories without adding active days or queuing callback days", () => {
  const memory = createLongTermMemory();
  teach(memory);
  const laterMs = startMs + 300 * DAY_MS;
  assert.equal(eligible(memory, laterMs).length, 1);
  assert.equal(reserveRecall(memory, eligible(memory, laterMs), laterMs, () => 0), null);
  creditActiveTime(memory, activeMs, laterMs, () => 0);
  assert.equal(memory.active.days, 1);
  const reservation = reserveRecall(memory, eligible(memory, laterMs), laterMs, () => 0);
  assert.equal(reservation.memory.trick, "spin");
  assert.equal(reserveRecall(memory, eligible(memory, laterMs), laterMs, () => 0), null);
});

test("interrupted reservations survive restart without rerolls or successful recall", () => {
  let memory = createLongTermMemory();
  teach(memory);
  const nowMs = startMs + 4 * DAY_MS;
  creditActiveTime(memory, activeMs, nowMs, () => 0);
  reserveRecall(memory, eligible(memory, nowMs), nowMs, () => 0);
  memory = structuredClone(memory);
  creditActiveTime(memory, activeMs, nowMs + 1000, () => {
    assert.fail("restart must not reroll today's admission");
  });
  assert.equal(reserveRecall(memory, eligible(memory, nowMs + 1000), nowMs + 1000, () => 0), null);
  assert.equal(memory.tricks.spin.recalledAtMs, null);
  const nextMs = nowMs + DAY_MS;
  creditActiveTime(memory, activeMs, nextMs, () => 0);
  const reservation = reserveRecall(memory, eligible(memory, nextMs), nextMs, () => 0);
  assert.ok(completeRecall(memory, reservation, eligible(memory, nextMs), nextMs));
  assert.equal(completeRecall(memory, reservation, eligible(memory, nextMs), nextMs), false);
  assert.equal(eligible(memory, nextMs + 7 * DAY_MS - 1).length, 0);
  assert.equal(eligible(memory, nextMs + 7 * DAY_MS).length, 1);
});

test("a later reward does not postpone the first encore and come stays command-only", () => {
  const memory = createLongTermMemory();
  teach(memory);
  recordTrickEvidence(memory, "spin", startMs + 3 * DAY_MS);
  recordTrickEvidence(memory, "come", startMs + 3 * DAY_MS);
  assert.equal(eligible(memory, startMs + 4 * DAY_MS).length, 1);
});

test("snack replacement remembers one old place and maps it into the current display", () => {
  const memory = createLongTermMemory();
  feed(memory, 150, 0);
  feed(memory, 900, 3);
  assert.equal(eligible(memory, startMs + 7 * DAY_MS - 1).length, 0);
  const [recall] = eligible(memory, startMs + 7 * DAY_MS);
  assert.equal(recall.kind, "snack");
  assert.deepEqual(recallPoint(recall.oldPosition, 1200, 800), { x: 150, y: 300 });
  assert.equal(eligible(memory, startMs + 7 * DAY_MS, {}, 150).length, 0);
  creditActiveTime(memory, activeMs, startMs + 7 * DAY_MS, () => 0);
  const reservation = reserveRecall(memory, [recall], startMs + 7 * DAY_MS, () => 0);
  completeRecall(memory, reservation, [recall], startMs + 7 * DAY_MS);
  assert.equal(eligible(memory, startMs + 20 * DAY_MS).length, 0);
});

test("returning to the established snack place clears an unfinished competitor", () => {
  const memory = createLongTermMemory();
  feed(memory, 150, 0);
  recordMealEvidence(memory, { x: 900, y: 300 }, 1200, 800, startMs + 3 * DAY_MS);
  recordMealEvidence(memory, { x: 150, y: 300 }, 1200, 800, startMs + 3 * DAY_MS);
  assert.equal(memory.snack.candidate, null);
  feed(memory, 900, 4);
  const firstKey = eligible(memory, startMs + 8 * DAY_MS)[0].key;
  feed(memory, 150, 7);
  const [recall] = eligible(memory, startMs + 11 * DAY_MS);
  assert.notEqual(recall.key, firstKey);
  assert.deepEqual(recallPoint(recall.oldPosition, 1200, 800), { x: 900, y: 300 });
});

test("keepsakes require age, three later active days, ownership and 14-day reuse", () => {
  const memory = createLongTermMemory();
  recordAcquisition(memory, "bent_spoon", startMs);
  recordAcquisition(memory, "bent_spoon", startMs + DAY_MS);

  for (let day = 1; day <= 3; day++) {
    creditActiveTime(memory, activeMs, startMs + day * DAY_MS, () => 0);
  }

  assert.equal(eligible(memory, startMs + 7 * DAY_MS - 1).length, 0);
  const nowMs = startMs + 7 * DAY_MS;
  assert.equal(eligible(memory, nowMs, {}).length, 0);
  creditActiveTime(memory, activeMs, nowMs, () => 0);
  const reservation = reserveRecall(memory, eligible(memory, nowMs), nowMs, () => 0);
  assert.equal(reservation.memory.item, "bent_spoon");
  assert.equal(completeRecall(memory, reservation, eligible(memory, nowMs, {}), nowMs), false);
  assert.ok(completeRecall(memory, reservation, eligible(memory, nowMs), nowMs));
  assert.equal(eligible(memory, nowMs + 14 * DAY_MS - 1).length, 0);
  assert.equal(eligible(memory, nowMs + 14 * DAY_MS).length, 1);
});

test("selection prefers a never-recalled memory and breaks equal-age ties randomly", () => {
  const memory = createLongTermMemory();

  for (let day = 0; day < 3; day++) {
    recordTrickEvidence(memory, "spin", startMs + day * DAY_MS);
    recordTrickEvidence(memory, "dead", startMs + day * DAY_MS);
  }

  let nowMs = startMs + 4 * DAY_MS;
  creditActiveTime(memory, activeMs, nowMs, () => 0);
  const first = reserveRecall(memory, eligible(memory, nowMs), nowMs, () => 0.99);
  assert.equal(first.memory.trick, "dead");
  completeRecall(memory, first, eligible(memory, nowMs), nowMs);
  nowMs += 8 * DAY_MS;
  creditActiveTime(memory, activeMs, nowMs, () => 0);
  const next = reserveRecall(memory, eligible(memory, nowMs), nowMs, () => 0.99);
  assert.equal(next.memory.trick, "spin");
});

test("a trick cooldown saved under a future clock lasts no longer than usual", () => {
  const memory = normalizeMemory(
    { trickCooldownUntilMs: startMs + 365 * DAY_MS },
    1200,
    800,
    startMs,
  );

  assert.ok(memory.trickCooldownUntilMs <= startMs + 2 * 60 * 1000);
});
