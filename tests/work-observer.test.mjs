import test from "node:test";
import assert from "node:assert/strict";
import { WorkObserver } from "../web-dist/platform/work-observer.js";
import { deferred, harness, settle } from "./application-harness.mjs";

function observer(read) {
  let nowMs = 0;
  let serial = 0;
  const timers = new Map();
  const samples = [];
  let stops = 0;
  const tracker = new WorkObserver({
    read,
    stop() {
      stops++;
    },
    sample: (sample) => samples.push(sample),
    now: () => nowMs,
    schedule(callback, delay) {
      const id = ++serial;
      timers.set(id, { callback, at: nowMs + delay });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
  });
  async function advance(milliseconds) {
    nowMs += milliseconds;

    for (const [id, timer] of [...timers]) {
      if (timer.at <= nowMs) {
        timers.delete(id);
        timer.callback();
      }
    }

    await settle();
  }
  return { tracker, samples, timers, advance, stops: () => stops };
}

test("work polling rejects old replies across restart without overlapping reads", async () => {
  const pending = deferred();
  let reads = 0;
  const fixture = observer(() => {
    reads++;
    return pending.promise;
  });
  fixture.tracker.start();
  fixture.tracker.start();
  await fixture.advance(500);
  fixture.tracker.stop();
  fixture.tracker.stop();
  assert.equal(fixture.stops(), 1);
  fixture.tracker.start();
  await fixture.advance(500);
  assert.equal(reads, 1);
  pending.resolve({ old: true });
  await settle();
  assert.deepEqual(fixture.samples, [null]);
  await fixture.advance(500);
  assert.equal(reads, 2);
  fixture.tracker.stop();
  assert.equal(fixture.timers.size, 0);
});

test("slow and failed work reads produce absence and continue bounded polling", async () => {
  const pending = deferred();
  let reads = 0;
  const fixture = observer(() => {
    reads++;

    if (reads === 1) {
      return pending.promise;
    }

    return Promise.reject(new Error("unavailable"));
  });
  fixture.tracker.start();
  await fixture.advance(500);
  await fixture.advance(2000);
  pending.resolve({ stale: true });
  await settle();
  assert.deepEqual(fixture.samples, [null]);
  await fixture.advance(500);
  assert.deepEqual(fixture.samples, [null, null]);
  assert.equal(fixture.timers.size, 1);
  fixture.tracker.stop();
});

test("the application stops sensing on hide, pause and disposal", async () => {
  let pending = deferred();
  const fixture = harness({
    native: true,
    invoke(name) {
      if (name === "work_activity") {
        return pending.promise;
      }
    },
  });
  const samples = [];
  let enabled = true;
  const status = fixture.simulation.status;
  fixture.simulation.status = () => ({ ...status(), workEnabled: enabled });
  fixture.simulation.observeWork = (sample) => samples.push(sample);
  await fixture.app.start();
  fixture.displayFrame(500);
  await settle();
  assert.equal(fixture.calls.filter(([name]) => name === "work_activity").length, 1);
  fixture.nativeListeners.get("gullbert-visible")({ payload: false });
  pending.resolve({ stale: true });
  await settle();
  assert.deepEqual(samples, [null]);
  assert.equal(fixture.calls.filter(([name]) => name === "stop_work_activity").length, 1);

  pending = deferred();
  fixture.nativeListeners.get("gullbert-visible")({ payload: true });
  fixture.displayFrame(500);
  await settle();
  assert.equal(fixture.calls.filter(([name]) => name === "work_activity").length, 2);
  enabled = false;
  fixture.nativeListeners.get("gullbert-settings")({ payload: { paused: true } });
  pending.resolve({ stale: true });
  await settle();
  assert.deepEqual(samples, [null, null]);
  assert.equal(fixture.calls.filter(([name]) => name === "stop_work_activity").length, 2);
  fixture.displayFrame(1000);
  await settle();
  assert.equal(fixture.calls.filter(([name]) => name === "work_activity").length, 2);

  enabled = true;
  pending = deferred();
  fixture.nativeListeners.get("gullbert-settings")({ payload: { paused: false } });
  fixture.displayFrame(500);
  await settle();
  assert.equal(fixture.calls.filter(([name]) => name === "work_activity").length, 3);
  await fixture.app.dispose();
  pending.resolve({ staleAfterDisposal: true });
  await settle();
  assert.deepEqual(samples, [null, null, null]);
  assert.equal(fixture.calls.filter(([name]) => name === "stop_work_activity").length, 3);
  assert.equal(fixture.timers.size, 0);
});
