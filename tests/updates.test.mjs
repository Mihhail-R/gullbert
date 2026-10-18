import { test } from "node:test";
import assert from "node:assert/strict";
import { UpdateController } from "../web-dist/ui/controls/update-controller.js";

test("update checks show notes, progress, and restart only on explicit install", async () => {
  let state;
  let installs = 0;
  const checkedChannels = [];
  const controller = new UpdateController({
    check: async (beta) => {
      checkedChannels.push(beta);
      return { version: "0.4.0-beta.1", notes: "New hats" };
    },
    install: async () => {
      installs++;
      controller.progress(25, 100, false);
      assert.equal(state.progress, 0.25);
      controller.progress(100, 100, true);
      assert.match(state.status, /Verifying/);
    },
    render: (next) => {
      state = next;
    },
  });
  await controller.install();
  assert.equal(installs, 0);
  await controller.check(true);
  assert.deepEqual(checkedChannels, [true]);
  assert.equal(installs, 0);
  assert.equal(state.notes, "New hats");
  assert.equal(state.available, true);
  await controller.install();
  assert.equal(installs, 1);
  assert.match(state.status, /Restarting/);
});

test("a failed install requires a fresh check and allows retry", async () => {
  let state;
  let installs = 0;
  const controller = new UpdateController({
    check: async () => ({ version: "0.4.0", notes: "" }),
    install: async () => {
      installs++;

      if (installs === 1) {
        throw new Error("Invalid signature");
      }
    },
    render: (next) => {
      state = next;
    },
  });
  await controller.check(false);
  await controller.install();
  assert.equal(state.busy, false);
  assert.equal(state.available, false);
  assert.match(state.status, /Invalid signature/);
  await controller.install();
  assert.equal(installs, 1);
  await controller.check(false);
  await controller.install();
  assert.equal(installs, 2);
  assert.match(state.status, /Restarting/);
});

test("changing update channels clears the old offer before another check", async () => {
  let state;
  let installs = 0;
  const controller = new UpdateController({
    check: async () => ({ version: "0.4.0", notes: "Stable release" }),
    install: async () => {
      installs++;
    },
    render: (next) => {
      state = next;
    },
  });
  await controller.check(false);
  controller.reset();
  await controller.install();

  assert.equal(installs, 0);
  assert.equal(state.available, false);
  assert.equal(state.notes, "");
});

test("overlapping checks make one request and show its result", async () => {
  let resolve;
  let state;
  let checks = 0;
  const controller = new UpdateController({
    check: () => {
      checks++;
      return new Promise((done) => {
        resolve = done;
      });
    },
    install: async () => {},
    render: (next) => {
      state = next;
    },
  });
  const pending = controller.check(false);
  await controller.check(true);
  assert.equal(checks, 1);
  resolve(null);
  await pending;
  assert.equal(state.available, false);
  assert.match(state.status, /up to date/);
});

test("network failure clears an earlier offer instead of reporting up to date", async () => {
  let state;
  let calls = 0;
  const controller = new UpdateController({
    check: async () => {
      if (calls++ === 0) {
        return { version: "0.4.0", notes: "New release" };
      }

      throw new Error("GitHub unavailable");
    },
    install: async () => {},
    render: (next) => {
      state = next;
    },
  });
  await controller.check(false);
  assert.equal(state.available, true);
  await controller.check(false);
  assert.equal(state.available, false);
  assert.equal(state.notes, "");
  assert.equal(state.busy, false);
  assert.match(state.status, /GitHub unavailable/);
});
