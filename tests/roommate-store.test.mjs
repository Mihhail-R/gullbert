import test from "node:test";
import assert from "node:assert/strict";
import { MemoryPersistence } from "../web-dist/platform/roommate-store.js";
import { deferred, settle } from "./application-harness.mjs";

function persistence(options = {}) {
  let revision = 0;
  let serial = 0;
  const memory = { collection: { sock: 0 } };
  const saved = [];
  const restored = [];
  const results = [];
  const timers = new Map();
  const store = new MemoryPersistence({
    storage: {
      load: options.load ?? (() => null),
      save(snapshot) {
        saved.push(snapshot);
        return options.save?.(snapshot);
      },
    },
    clock: {
      schedule(callback, delay) {
        const id = ++serial;
        timers.set(id, { callback, delay });
        return id;
      },
      cancel(id) {
        timers.delete(id);
      },
    },
    restore(value) {
      options.restore?.(value);
      restored.push(value);
    },
    revision: () => revision,
    snapshot: () => memory,
    result: (error) => results.push(error?.message ?? null),
  });
  return {
    store,
    memory,
    saved,
    restored,
    results,
    timers,
    change() {
      memory.collection.sock = ++revision;
    },
    retry() {
      assert.equal(timers.size, 1);
      const [id, timer] = timers.entries()
        .next().value;
      assert.equal(timer.delay, 5000);
      timers.delete(id);
      timer.callback();
    },
  };
}

test("restoration is shared and saving waits for application readiness", async () => {
  const h = persistence();
  assert.equal(h.store.restore(), h.store.restore());
  h.store.start();
  h.store.remember();
  assert.deepEqual(h.saved, []);
  await h.store.restore();
  assert.deepEqual(h.restored, [null]);
  h.store.remember();
  assert.deepEqual(h.saved, []);
  h.store.start();
  h.store.start();
  await settle();
  h.store.remember();
  await h.store.dispose();
  assert.deepEqual(h.saved, [{ collection: { sock: 0 } }]);
});

test("slow writes serialize immutable snapshots and coalesce pending changes", async () => {
  const pending = deferred();
  let first = true;
  const h = persistence({
    save() {
      if (first) {
        first = false;
        return pending.promise;
      }
    },
  });
  await h.store.restore();
  h.store.start();
  h.change();
  h.store.remember();
  h.change();
  h.store.remember();
  assert.deepEqual(h.saved, [{ collection: { sock: 0 } }]);
  const shutdown = h.store.dispose();
  pending.resolve();
  await shutdown;
  assert.deepEqual(h.saved, [
    { collection: { sock: 0 } },
    { collection: { sock: 2 } },
  ]);
  assert.deepEqual(h.results, []);
});

test("retry reads the latest memory without another change notification", async () => {
  let fail = true;
  const h = persistence({
    save() {
      if (fail) {
        throw new Error("disk unavailable");
      }
    },
  });
  await h.store.restore();
  h.store.start();
  await settle();
  assert.deepEqual(h.results, ["disk unavailable"]);
  h.change();
  h.store.remember();
  assert.equal(h.saved.length, 1);
  h.change();
  fail = false;
  h.retry();
  await settle();
  assert.deepEqual(h.saved[1], { collection: { sock: 2 } });
  assert.deepEqual(h.results, ["disk unavailable", null]);
  assert.equal(h.timers.size, 0);
  await h.store.dispose();
  assert.equal(h.saved.length, 2);
});

test("failed writes retry even when the memory revision has not changed", async () => {
  let fail = true;
  const h = persistence({
    save() {
      if (fail) {
        throw new Error("disk busy");
      }
    },
  });
  await h.store.restore();
  h.store.start();
  await settle();
  fail = false;
  h.retry();
  await settle();
  assert.equal(h.saved.length, 2);
  assert.deepEqual(h.results, ["disk busy", null]);
  await h.store.dispose();
});

test("load and restore failures prevent all subsequent writes", async (t) => {
  for (const stage of ["load", "restore"]) {
    await t.test(stage, async () => {
      const h = persistence({
        [stage]() {
          throw new Error("unread memory");
        },
      });
      await assert.rejects(h.store.restore(), /unread memory/);
      h.store.start();
      h.change();
      h.store.remember();
      await h.store.dispose();
      assert.deepEqual(h.saved, []);
      assert.equal(h.timers.size, 0);
    });
  }
});

test("disposal invalidates a pending restoration", async () => {
  const pending = deferred();
  const h = persistence({ load: () => pending.promise });
  const loading = h.store.restore();
  await h.store.dispose();
  pending.resolve({ collection: { sock: 9 } });
  await loading;
  h.store.start();
  h.store.remember();
  await h.store.restore();
  assert.deepEqual(h.restored, []);
  assert.deepEqual(h.saved, []);
});

test("shutdown bypasses backoff once and prevents retries even after failure", async () => {
  const h = persistence({
    save() {
      throw new Error("disk unavailable");
    },
  });
  await h.store.restore();
  h.store.start();
  await settle();
  const staleRetry = [...h.timers.values()][0].callback;
  h.change();
  const shutdown = h.store.dispose();
  assert.equal(h.store.dispose(), shutdown);
  await shutdown;
  assert.equal(h.saved.length, 2);
  assert.deepEqual(h.saved[1], { collection: { sock: 1 } });
  // Preserve the existing synchronous final-failure notification.
  assert.deepEqual(h.results, ["disk unavailable", "disk unavailable"]);
  staleRetry();
  h.store.start();
  h.store.remember();
  assert.equal(h.timers.size, 0);
  assert.equal(h.saved.length, 2);
});

test("shutdown waits for writes but ignores their late failures", async () => {
  const pending = deferred();
  const h = persistence({ save: () => pending.promise });
  await h.store.restore();
  h.store.start();
  let finished = false;
  const shutdown = h.store.dispose()
    .then(() => {
      finished = true;
    });
  await settle();
  assert.equal(finished, false);
  pending.reject(new Error("late failure"));
  await shutdown;
  assert.deepEqual(h.results, []);
  assert.equal(h.timers.size, 0);
});
