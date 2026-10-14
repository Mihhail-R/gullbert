import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryWriter } from "../web-dist/platform/roommate-store.js";

test("slow saves cannot overwrite newer discoveries or clamped positions", async () => {
  let finish;
  const saved = [];
  const writer = createMemoryWriter(async (value) => {
    if (!saved.length)
      await new Promise((resolve) => {
        finish = resolve;
      });
    saved.push(value);
  });
  const memory = { perch: { x: 100, y: 200 }, collection: {} };
  writer.save(memory);
  memory.collection.sock = 1;
  writer.save(memory);
  memory.perch.x = 20;
  writer.save(memory);
  finish();
  await writer.flush();
  assert.deepEqual(saved, [
    { perch: { x: 100, y: 200 }, collection: {} },
    { perch: { x: 20, y: 200 }, collection: { sock: 1 } },
  ]);
});

test("failed storage reports the error and later snapshots can save", async () => {
  let fail = true;
  const errors = [],
    saved = [];
  const writer = createMemoryWriter(
    async (value) => {
      if (fail) throw new Error("disk unavailable");
      saved.push(value);
    },
    (error) => errors.push(error?.message ?? null),
  );
  await writer.save({ collection: { sock: 1 } });
  fail = false;
  await writer.save({ collection: { sock: 2 } });
  assert.deepEqual(saved, [{ collection: { sock: 2 } }]);
  assert.deepEqual(errors, ["disk unavailable", null]);
});
