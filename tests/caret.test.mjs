import test from "node:test";
import assert from "node:assert/strict";
import { CaretTracker } from "../web-dist/platform/caret.js";
function harness(read) {
  const timers = new Map();
  const samples = [];
  let id = 0;
  const tracker = new CaretTracker({
    read,
    sample: (s) => samples.push(s),
    schedule: (callback) => {
      timers.set(++id, callback);
      return id;
    },
    cancel: (key) => timers.delete(key),
  });
  async function poll() {
    const [key, callback] = timers.entries().next().value;
    timers.delete(key);
    callback();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  return { tracker, timers, samples, poll };
}
test("caret polling is serial and stale reads cannot reappear after hide/restart", async () => {
  let resolve;
  let reads = 0;
  const h = harness(() => {
    reads++;
    return new Promise((r) => {
      resolve = r;
    });
  });
  h.tracker.start();
  h.tracker.start();
  assert.equal(h.timers.size, 1);
  await h.poll();
  assert.equal(h.timers.size, 0);
  h.tracker.stop();
  h.tracker.start();
  assert.equal(h.timers.size, 0, "no overlapping native call on restart");
  resolve({ x: 1, y: 2 });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(h.samples, [null]);
  assert.equal(h.timers.size, 1);
  await h.poll();
  assert.equal(reads, 2);
  h.tracker.stop();
  resolve(null);
});
test("failed reads clear the caret and polling recovers; stop removes timers", async () => {
  let fail = true;
  const h = harness(async () => {
    if (fail) throw Error("unavailable");
    return { x: 3, y: 4 };
  });
  h.tracker.start();
  await h.poll();
  assert.deepEqual(h.samples, [null]);
  fail = false;
  await h.poll();
  assert.deepEqual(h.samples.at(-1), { x: 3, y: 4 });
  h.tracker.stop();
  assert.equal(h.samples.at(-1), null);
  assert.equal(h.timers.size, 0);
});
