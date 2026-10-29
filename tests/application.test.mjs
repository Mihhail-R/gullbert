import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import {
  harness,
  deferred,
  settle,
  pointerEvent,
} from "./application-harness.mjs";

test("startup restores remembered places using the latest display size", async () => {
  const pending = deferred();
  let size = { width: 800, height: 600 };
  const simulation = new Gullbert(800, 600, () => 0);
  const memory = simulation.exportMemory();
  memory.perch = { x: 1700, y: 900 };
  memory.nest = { x: 1600, y: 800, items: [] };
  memory.learned.snackSpot = { x: 1500, y: 700, meals: 3 };
  const h = harness({
    native: true,
    simulation,
    size: () => size,
    load: () => pending.promise,
  });
  const startup = h.app.start();
  await settle();
  size = { width: 1920, height: 1080 };
  h.emit("resize");
  pending.resolve(memory);
  await startup;
  await h.app.dispose();

  for (const restored of [simulation.exportMemory(), h.saved.at(-1)]) {
    assert.deepEqual(restored.perch, memory.perch);
    assert.deepEqual(restored.nest, memory.nest);
    assert.deepEqual(restored.learned.snackSpot, memory.learned.snackSpot);
  }
});

test("application starts once and disposes all browser resources and scheduled work", async () => {
  const h = harness();
  await Promise.all([h.app.start(), h.app.start()]);
  assert.equal(h.greeted, 1);
  assert.equal(h.restored.length, 1);
  const callbacks = [...h.timers.values()].map((timer) => timer.callback);
  const before = h.calls.length;
  await Promise.all([h.app.dispose(), h.app.dispose()]);
  assert.equal(h.activeListeners, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.viewDisposed, 1);
  assert.equal(h.audioDisposed, 1);

  for (const callback of callbacks) {
    callback();
  }

  h.emit("message", { type: "action", action: "feed" });
  await h.app.start();
  assert.equal(h.greeted, 1);
  assert.deepEqual(h.calls.slice(before), [["visible", false]]);
});

test(
  "disposing during storage initialization cannot restore, greet, save, or restart " +
  "timers",
  async () => {
    const pending = deferred();
    const h = harness({ load: () => pending.promise });
    const startup = h.app.start();
    h.emit("pagehide");
    pending.resolve({ collection: { sock: 9 } });
    await startup;
    assert.equal(h.greeted, 0);
    assert.deepEqual(h.restored, []);
    assert.deepEqual(h.saved, []);
    assert.equal(h.activeListeners, 0);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.published, []);
  }
);

test("native commands received during memory restore survive startup in order", async () => {
  const pending = deferred();
  const h = harness({ native: true, load: () => pending.promise });
  const configured = [];
  h.simulation.configure = (settings) => {
    configured.push(settings);
  };
  const startup = h.app.start();
  await settle();
  const settings = { sound: false, paused: true, mischief: 1, hat: "none" };
  h.nativeListeners.get("gullbert-settings")({ payload: settings });
  h.nativeListeners.get("gullbert-visible")({ payload: false });
  h.nativeListeners.get("gullbert-action")({ payload: { action: "feed" } });
  h.nativeListeners.get("gullbert-target")({
    payload: { outcome: "started", id: 1, purpose: "poop", preparation: "cancel" },
  });
  h.nativeListeners.get("gullbert-target")({
    payload: { outcome: "selected", id: 1, point: { x: 200, y: 300 } },
  });
  assert.deepEqual(h.calls.filter(([name]) => name === "action"), []);
  assert.deepEqual(h.saved, []);

  pending.resolve({ collection: { sock: 9 } });
  await startup;
  assert.deepEqual(h.restored, [{ collection: { sock: 9 } }]);
  assert.deepEqual(configured.at(-1), settings);
  assert.equal(h.updates.at(-1).visible, false);
  assert.equal(h.updates.at(-1).targeting, false);
  assert.deepEqual(h.calls.filter(([name]) => name === "action"), [
    ["action", "feed", undefined],
    ["action", "cancel", undefined],
    ["action", "poop", { x: 200, y: 300 }],
  ]);
  await h.app.dispose();
});

test("native events delivered before pet_ready resolves survive its snapshot", async () => {
  const ready = deferred();
  const h = harness({
    native: true,
    invoke(name) {
      if (name === "pet_ready") {
        return ready.promise;
      }
    },
  });
  const configured = [];
  h.simulation.configure = (settings) => {
    configured.push(settings);
  };
  const startup = h.app.start();
  await settle();
  const settings = { sound: false, paused: true, mischief: 1, hat: "none" };
  h.nativeListeners.get("gullbert-settings")({ payload: settings });
  h.nativeListeners.get("gullbert-visible")({ payload: false });
  h.nativeListeners.get("gullbert-action")({ payload: { action: "feed" } });
  ready.resolve({
    settings: { ...settings, paused: false },
    visible: true,
    shortcut_errors: [],
  });
  await startup;
  assert.deepEqual(configured.at(-1), settings);
  assert.equal(h.updates.at(-1).visible, false);
  assert.ok(h.calls.some(([name, action]) => name === "action" && action === "feed"));
  await h.app.dispose();
});

test("preview commands received during memory restore survive startup", async () => {
  const pending = deferred();
  const h = harness({ load: () => pending.promise });
  const configured = [];
  h.simulation.configure = (settings) => {
    configured.push(settings);
  };
  const startup = h.app.start();
  const settings = { sound: false, paused: true, mischief: 1, hat: "none" };
  h.emit("message", { type: "settings", settings });
  h.emit("message", { type: "action", action: "feed" });
  h.emit("message", { type: "visible", visible: false });
  pending.resolve({ collection: { sock: 9 } });
  await startup;
  assert.deepEqual(configured.at(-1), settings);
  assert.equal(h.updates.at(-1).visible, false);
  assert.ok(h.calls.some(([name, action]) => name === "action" && action === "feed"));
  await h.app.dispose();
});

test("disposing during native restore discards commands waiting for startup", async () => {
  const pending = deferred();
  const h = harness({ native: true, load: () => pending.promise });
  const startup = h.app.start();
  await settle();
  h.nativeListeners.get("gullbert-action")({ payload: { action: "feed" } });
  await h.app.dispose();
  pending.resolve({ collection: { sock: 9 } });
  await startup;
  assert.deepEqual(h.calls.filter(([name]) => name === "action"), []);
  assert.deepEqual(h.restored, []);
  assert.deepEqual(h.saved, []);
  assert.equal(h.greeted, 0);
  assert.equal(h.timers.size, 0);
});

test("commands queued before a failed restore cannot overwrite unread memory", async () => {
  const pending = deferred();
  const h = harness({ native: true, load: () => pending.promise });
  const startup = h.app.start();
  await settle();
  h.nativeListeners.get("gullbert-visible")({ payload: true });
  h.nativeListeners.get("gullbert-action")({ payload: { action: "feed" } });
  pending.reject(new Error("disk unavailable"));
  await startup;
  await h.app.dispose();
  assert.deepEqual(h.restored, []);
  assert.deepEqual(h.saved, []);
  assert.equal(h.errors.length, 1);
  assert.equal(h.updates.at(-1).visible, false);
  assert.deepEqual(h.calls.filter(([name]) => name === "action"), []);
});

test("a native listener that arrives after disposal is immediately removed", async () => {
  const pending = deferred();
  let subscriptions = 0;
  let removed = 0;
  const h = harness({
    native: true,
    listen() {
      subscriptions++;
      return pending.promise;
    },
  });
  const startup = h.app.start();
  await h.app.dispose();
  pending.resolve(() => {
    removed++;
  });
  await startup;
  assert.equal(subscriptions, 1);
  assert.equal(removed, 1);
  assert.deepEqual(h.saved, []);
  assert.equal(
    h.calls.some(([name]) => name === "pet_ready"),
    false,
  );
});

test("failed native restore never saves unread belongings even after later commands", async () => {
  const h = harness({
    native: true,
    load() {
      throw new Error("disk unavailable");
    },
  });
  await h.app.start();
  assert.equal(h.errors.length, 1);
  assert.deepEqual(h.saved, []);
  assert.deepEqual(h.restored, []);
  assert.equal(h.updates.at(-1).visible, false);
  h.nativeListeners.get("gullbert-visible")({ payload: true });
  h.changeMemory();
  h.nativeListeners.get("gullbert-action")({ payload: { action: "feed" } });
  assert.deepEqual(h.saved, []);
  assert.ok(
    h.calls.some(
      ([name, args]) => name === "publish_roommate" && args.status.error,
    ),
  );
  await h.app.dispose();
  assert.equal(h.nativeListeners.size, 0);
});

test("native roommate requests keep reporting a failed restore without memory", async () => {
  let loadCount = 0;
  const h = harness({
    native: true,
    load() {
      loadCount++;
      throw new Error("disk unavailable");
    },
  });
  await h.app.start();

  const previousCount = h.calls.filter(([name]) => name === "publish_roommate").length;
  h.nativeListeners.get("gullbert-roommate-request")();
  h.nativeListeners.get("gullbert-roommate-request")();
  const statuses = h.calls
    .filter(([name]) => name === "publish_roommate")
    .map(([, args]) => args.status);

  assert.equal(statuses.length, previousCount + 2);
  assert.deepEqual(statuses.slice(-2), [
    {
      error: "Could not restore Gullbert’s belongings. Restart to try again; saved " +
        "belongings have not been replaced.",
      unreadable: true,
    },
    {
      error: "Could not restore Gullbert’s belongings. Restart to try again; saved " +
        "belongings have not been replaced.",
      unreadable: true,
    },
  ]);
  assert.deepEqual(statuses[0], {
    error: "Could not restore Gullbert’s belongings. Restart to try again; saved " +
      "belongings have not been replaced.",
    unreadable: true,
  });
  assert.deepEqual(h.saved, []);
  assert.deepEqual(h.restored, []);
  assert.equal(loadCount, 1);
  await h.app.dispose();
});

test("preview publishes only the restore error after failed initialization", async () => {
  let loadCount = 0;
  const h = harness({
    load() {
      loadCount++;
      throw new Error("disk unavailable");
    },
  });
  await h.app.start();

  const roommateUpdates = h.published.filter(({ type }) => type === "roommate");
  assert.ok(roommateUpdates.length > 0);
  assert.ok(h.published.some(({ type }) => type === "ready"));
  assert.deepEqual(roommateUpdates, roommateUpdates.map((update) => ({
    type: "roommate",
    error: "Could not restore Gullbert’s belongings. Restart to try again; saved " +
      "belongings have not been replaced.",
    unreadable: true,
  })));
  assert.deepEqual(h.saved, []);
  assert.deepEqual(h.restored, []);
  assert.equal(loadCount, 1);
  await h.app.dispose();
});

test(
  "late pickup acquisition after application disposal releases its lease without " +
  "retaliation",
  async () => {
    const acquisition = deferred();
    const h = harness({
      native: true,
      invoke(name) {
        if (name === "begin_pickup") {
          return acquisition.promise;
        }

        if (name === "end_pickup") {
          return 88;
        }
      },
    });
    await h.app.start();
    h.emit("pointerdown", pointerEvent());
    await h.app.dispose();
    acquisition.resolve(37);
    await settle();
    const release = h.calls.find(([name]) => name === "end_pickup");
    assert.deepEqual(release, [
      "end_pickup",
      { id: 37, retaliate: false, tug: false },
    ]);
    assert.ok(
      h.calls.some(([name, args]) => name === "release_cursor" && args.id === 88),
    );
    assert.equal(h.timers.size, 0);
  }
);

test("a cap click takes priority over pickup and releases its native hit region", async () => {
  const flicks = [];
  const h = harness({
    native: true,
    flickCap(point) {
      flicks.push(point);
      return true;
    },
  });
  await h.app.start();
  let prevented = false;
  h.emit(
    "pointerdown",
    pointerEvent({
      preventDefault() {
        prevented = true;
      },
    }),
  );
  assert.deepEqual(flicks, [{ x: 20, y: 20 }]);
  assert.equal(prevented, true);
  assert.equal(
    h.calls.some(([name]) => name === "begin_pickup"),
    false,
  );
  assert.ok(
    h.calls.some(([name, args]) => {
      return name === "sync_interaction" && args.rects.length === 0;
    }),
  );
  await h.app.dispose();
});

test("target placement never flicks a cap under the selected point", async () => {
  const h = harness({
    flickCap() {
      assert.fail("Targeting must take priority over the cap game");
    },
  });
  await h.app.start();
  h.emit("message", { type: "action", action: "target" });
  h.emit("pointerdown", pointerEvent());
  assert.deepEqual(h.calls.find(([name, action]) => name === "action" && action === "poop"), [
    "action",
    "poop",
    { x: 20, y: 20 },
  ]);
  await h.app.dispose();
});

test("chip placement keeps the reward window available and Escape cancels it", async () => {
  const h = harness();
  await h.app.start();
  h.emit("message", { type: "action", action: "feed_here" });
  assert.equal(h.updates.at(-1).targeting, true);
  assert.ok(
    h.calls.some(
      ([name, action]) => name === "action" && action === "prepare_chip",
    ),
  );
  h.emit("pointerdown", pointerEvent());
  assert.deepEqual(h.calls.find(([name, action]) => name === "action" && action === "feed_here"), [
    "action",
    "feed_here",
    { x: 20, y: 20 },
  ]);
  assert.equal(h.updates.at(-1).targeting, false);
  h.emit("message", { type: "action", action: "feed_here" });
  h.emit("keydown", "Escape");
  assert.ok(
    h.calls.some(([name, action]) => name === "action" && action === "cancel"),
  );
  assert.equal(h.updates.at(-1).targeting, false);
  await h.app.dispose();
});

test(
  "late targeting failure after disposal cannot cancel a scene or wake the overlay",
  async () => {
    const picked = deferred();
    const h = harness({
      native: true,
      invoke(name) {
        if (name === "target_picked") {
          return picked.promise;
        }
      },
    });
    await h.app.start();
    h.nativeListeners.get("gullbert-target")({
      payload: {
        outcome: "started",
        id: 1,
        purpose: "poop",
        preparation: "cancel",
      },
    });
    h.emit("pointerdown", pointerEvent({ x: 300 }));
    await h.app.dispose();
    const before = h.calls.length;
    picked.reject(new Error("late native error"));
    await settle();
    assert.equal(h.calls.length, before);
    assert.equal(h.errors.length, 0);
    assert.equal(h.timers.size, 0);
  }
);

test("disposal drains queued memory snapshots without publishing late write results", async () => {
  const firstWrite = deferred();
  let writes = 0;
  const h = harness({
    save() {
      writes++;

      if (writes === 1) {
        return firstWrite.promise;
      }
    },
  });
  await h.app.start();
  h.changeMemory();
  h.emit("message", { type: "action", action: "feed" });
  assert.equal(h.saved.length, 1);
  const published = h.published.length;
  let finished = false;
  const shutdown = h.app.dispose()
    .then(() => {
      finished = true;
    });
  await settle();
  assert.equal(finished, false);
  firstWrite.resolve();
  await shutdown;
  assert.deepEqual(h.saved, [
    { collection: { sock: 0 } },
    { collection: { sock: 1 } },
  ]);
  assert.equal(h.published.length, published);
  assert.equal(h.activeListeners, 0);
});

test("failed memory writes retry while hidden and save the latest snapshot", async () => {
  const pending = deferred();
  const h = harness({
    save() {
      if (h.saved.length === 1) {
        return pending.promise;
      }
    },
  });
  await h.app.start();
  h.emit("message", { type: "visible", visible: false });
  pending.reject(new Error("disk busy"));
  await settle();
  h.changeMemory();
  h.displayFrame(4999);
  await settle();
  assert.equal(h.saved.length, 1);
  h.displayFrame(1);
  await settle();
  assert.equal(h.saved.length, 2);
  assert.deepEqual(h.saved[1], { collection: { sock: 1 } });
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  await h.app.dispose();
});

test("a stale targeting deadline cannot finish a newer targeting session", async () => {
  const h = harness();
  await h.app.start();
  h.emit("message", { type: "action", action: "target" });
  const oldDeadline = [...h.timers.values()].find(
    (timer) => timer.delay === 12000,
  );
  assert.ok(oldDeadline);
  h.emit("message", { type: "action", action: "tidy" });
  const before = h.calls.length;
  oldDeadline.callback();
  assert.equal(h.calls.length, before);
  assert.equal(h.updates.at(-1).targeting, true);
  assert.equal(h.updates.at(-1).purpose, "tidy");
  const tidyDeadline = [...h.timers.values()].find(
    (timer) => timer.delay === 30000,
  );
  assert.ok(tidyDeadline);
  tidyDeadline.callback();
  assert.equal(h.updates.at(-1).targeting, false);
  assert.ok(
    h.calls.some(
      ([name, action]) => name === "action" && action === "tidy_done",
    ),
  );
  await h.app.dispose();
});

test(
  "moving animation advances on display frames instead of missing alternate frames",
  async () => {
    const h = harness({ animate: true });
    await h.app.start();

    for (let count = 0; count < 60; count++) {
      h.displayFrame();
    }

    assert.equal(
      h.steps.length,
      61,
      "movement should advance on all 60 display frames",
    );
    assert.ok(h.steps.slice(1)
      .every((delta) => Math.abs(delta - 1 / 60) < 1e-9));
    await h.app.dispose();
    assert.equal(h.frames.size, 0);
  }
);

test("idle animation keeps the low-frequency timer and hiding cancels display work", async () => {
  const idle = harness();
  await idle.app.start();
  assert.equal(idle.frames.size, 0);
  assert.ok([...idle.timers.values()].some((timer) => timer.delay === 100));
  await idle.app.dispose();

  const moving = harness({ animate: true });
  await moving.app.start();
  assert.equal(moving.frames.size, 1);
  moving.emit("message", { type: "visible", visible: false });
  assert.equal(moving.frames.size, 0);
  const before = moving.steps.length;
  moving.displayFrame();
  assert.equal(moving.steps.length, before);
  moving.emit("message", { type: "visible", visible: true });
  assert.equal(moving.frames.size, 1);
  await moving.app.dispose();
  assert.equal(moving.frames.size, 0);
});

for (const animate of [false, true]) {
  test(`cleanup pointer bursts render once per display frame (animate=${animate})`, async () => {
    const h = harness({ animate });
    await h.app.start();
    h.emit("message", { type: "action", action: "tidy" });
    const before = h.renders;

    for (let x = 0; x < 100; x++) {
      h.emit("pointermove", pointerEvent({ x }));
    }

    h.displayFrame();
    assert.equal(
      h.renders - before,
      1,
      "100 mouse events need only one scene render",
    );
    h.emit("pointermove", pointerEvent({ x: 150 }));
    const pending = [...h.frames.values()];
    await h.app.dispose();
    assert.equal(h.frames.size, 0);
    const disposed = h.renders;

    for (const callback of pending) {
      callback();
    }

    assert.equal(h.renders, disposed);
  });
}

test("unknown preview actions fail before changing visibility or simulation", async () => {
  const h = harness();
  await h.app.start();
  h.emit("message", { type: "visible", visible: false });
  const before = h.calls.length;
  h.emit("message", { type: "action", action: "not_an_action" });
  assert.equal(h.calls.length, before);
  assert.equal(h.updates.at(-1).visible, false);
  assert.equal(h.errors.length, 1);
  await h.app.dispose();
});
