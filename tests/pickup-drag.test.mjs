import test from "node:test";
import assert from "node:assert/strict";
import { createPickupDrag } from "../web-dist/platform/pickup-drag.js";
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function harness() {
  const acquisitions = [],
    releases = [],
    armed = [],
    discarded = [],
    finishes = [];
  let current = {};
  const drag = createPickupDrag({
    acquire: () => {
      const request = deferred();
      acquisitions.push(request);
      return request.promise;
    },
    release: (id, retaliate) => {
      const request = deferred();
      releases.push({ id, retaliate, ...request });
      return request.promise;
    },
    begin: () => true,
    move: () => {},
    finish: (cancelled, pointerId) => {
      finishes.push({ cancelled, pointerId });
      return cancelled ? null : current;
    },
    current: (reaction) => reaction === current,
    armed: (reaction, id) => armed.push({ reaction, id }),
    discard: (id) => discarded.push(id),
  });
  const start = () =>
    drag.begin(7, { x: 30, y: 40 }, { x: 0, y: 0, width: 66, height: 66 });
  return {
    drag,
    start,
    acquisitions,
    releases,
    armed,
    discarded,
    finishes,
    replace: () => (current = {}),
  };
}
test("late acquisition after cancellation releases exactly its own lease without revenge", async () => {
  const h = harness();
  h.start();
  h.drag.finish(true);
  h.start();
  h.acquisitions[0].resolve(1);
  await flush();
  assert.equal(h.drag.active, true);
  assert.deepEqual(
    h.releases.map(({ id, retaliate }) => ({ id, retaliate })),
    [{ id: 1, retaliate: false }],
  );
  h.acquisitions[1].resolve(2);
  await flush();
  assert.equal(h.drag.leaseId, 2);
  h.drag.finish(true);
  await flush();
  assert.equal(h.releases[1].id, 2);
});
test("late cursor authorization cannot attach to a replacement reaction", async () => {
  const h = harness();
  h.start();
  h.acquisitions[0].resolve(1);
  await flush();
  h.drag.finish();
  await flush();
  assert.equal(h.releases[0].retaliate, true);
  h.replace();
  h.releases[0].resolve(33);
  await flush();
  assert.deepEqual(h.armed, []);
  assert.deepEqual(h.discarded, [33]);
});
test("capture failure cancels without a pickup, stale failure does not cancel a new gesture", async () => {
  const h = harness();
  h.start();
  h.acquisitions[0].resolve(null);
  await flush();
  assert.equal(h.drag.active, false);
  assert.equal(h.finishes[0].cancelled, true);
  h.start();
  h.drag.finish(true);
  h.start();
  h.acquisitions[1].resolve(null);
  await flush();
  assert.equal(h.drag.active, true);
  h.drag.finish(true);
  h.acquisitions[2].resolve(null);
  await flush();
});
