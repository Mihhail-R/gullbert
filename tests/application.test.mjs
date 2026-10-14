import test from "node:test";
import assert from "node:assert/strict";
import { PetApplication } from "../web-dist/ui/pet/application.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let count = 0; count < 20; count++) {
    await Promise.resolve();
  }
}

function harness(options = {}) {
  const listeners = new Map();
  const nativeListeners = new Map();
  const timers = new Map();
  const saved = [];
  const restored = [];
  const published = [];
  const calls = [];
  const errors = [];
  const updates = [];
  let serial = 0;
  let viewDisposed = 0;
  let audioDisposed = 0;
  let greeted = 0;
  let revision = 0;
  let held = false;
  let tidying = false;
  let currentTime = 0;
  const simulation = {
    present() {
      return {};
    },
    status() {
      return {
        memoryRevision: revision,
        mood: null,
        sound: false,
        tidying,
        idle: true,
        animate: false,
        held,
        dragged: held,
      };
    },
    exportMemory() {
      return { collection: { sock: revision } };
    },
    restoreMemory(memory) {
      restored.push(memory);
    },
    drainSounds() {
      return [];
    },
    interactionRects() {
      return [{ x: 0, y: 0, width: 96, height: 96 }];
    },
    pickupRect() {
      return { x: 0, y: 0, width: 96, height: 96 };
    },
    canPickup() {
      return true;
    },
    directCleanupAt() {
      return false;
    },
    beginPickup() {
      held = true;
      return true;
    },
    movePickup() {},
    finishPickup() {
      held = false;
      return null;
    },
    currentReaction() {
      return false;
    },
    armReaction() {
      assert.fail("A disposed application cannot arm cursor authorization");
    },
    reactionMovesCursor() {
      return false;
    },
    updatePickupClock() {},
    caret() {},
    cursorEncounter() {
      return null;
    },
    releaseCursor() {},
    authorizeCursor() {},
    action(name) {
      calls.push(["action", name]);
      tidying = name === "tidy";
    },
    configure() {},
    resize() {},
    pointer() {},
    tidyPointer() {},
    greet() {
      greeted++;
    },
    setVisible(visible) {
      calls.push(["visible", visible]);
    },
    step() {},
  };
  const browser = {
    size() {
      return { width: 800, height: 600 };
    },
    listen(name, callback) {
      const group = listeners.get(name) ?? new Set();
      group.add(callback);
      listeners.set(name, group);
      return () => {
        group.delete(callback);
      };
    },
    capture() {},
    releaseCapture() {},
    publish(value) {
      published.push(value);
    },
  };
  let native = null;
  if (options.native) {
    native = {
      async listen(name, callback) {
        if (options.listen) {
          return options.listen(name, callback);
        }
        nativeListeners.set(name, callback);
        return () => {
          nativeListeners.delete(name);
        };
      },
      async invoke(name, args) {
        calls.push([name, args]);
        if (options.invoke) {
          const value = options.invoke(name, args);
          if (value !== undefined) {
            return value;
          }
        }
        if (name === "pet_ready") {
          return {
            visible: true,
            settings: { sound: false, paused: false, mischief: 1, hat: "none" },
          };
        }
        return null;
      },
    };
  }
  const app = new PetApplication({
    simulation,
    browser,
    native,
    storage: {
      load() {
        if (options.load) {
          return options.load();
        }
        return { collection: { sock: 3 } };
      },
      save(value) {
        saved.push(value);
        if (options.save) {
          return options.save(value);
        }
      },
    },
    clock: {
      now() {
        return currentTime;
      },
      wallNow() {
        return currentTime;
      },
      schedule(callback, delay) {
        const id = ++serial;
        timers.set(id, { callback, delay });
        return id;
      },
      cancel(id) {
        timers.delete(id);
      },
    },
    view: {
      render() {},
      update(value) {
        updates.push(value);
      },
      dispose() {
        viewDisposed++;
      },
    },
    audio: {
      play() {},
      suspend() {},
      dispose() {
        audioDisposed++;
      },
    },
    reportError(error) {
      errors.push(error);
    },
  });
  return {
    app,
    saved,
    restored,
    published,
    calls,
    errors,
    timers,
    updates,
    nativeListeners,
    emit(name, value) {
      for (const callback of [...(listeners.get(name) ?? [])]) {
        callback(value);
      }
    },
    changeMemory() {
      revision++;
    },
    frame() {
      currentTime += 100;
      const entry = [...timers].find(([, timer]) => timer.delay === 100);
      if (entry) {
        timers.delete(entry[0]);
        entry[1].callback();
      }
    },
    get activeListeners() {
      return [...listeners.values()].reduce(
        (total, group) => total + group.size,
        0,
      );
    },
    get viewDisposed() {
      return viewDisposed;
    },
    get audioDisposed() {
      return audioDisposed;
    },
    get greeted() {
      return greeted;
    },
  };
}

function pointerEvent(overrides = {}) {
  return {
    x: 20,
    y: 20,
    button: 0,
    buttons: 1,
    pointerId: 7,
    onBanner: false,
    preventDefault() {},
    ...overrides,
  };
}

test("application starts once and disposes all browser resources and scheduled work", async () => {
  const h = harness();
  assert.equal(h.app.start(), h.app.start());
  await h.app.start();
  assert.equal(h.greeted, 1);
  assert.equal(h.restored.length, 1);
  assert.ok(h.activeListeners > 0);
  assert.ok(h.timers.size > 0);
  const callbacks = [...h.timers.values()].map((timer) => timer.callback);
  const before = h.calls.length;
  assert.equal(h.app.dispose(), h.app.dispose());
  await h.app.dispose();
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

test("disposing during storage initialization cannot restore, greet, save, or restart timers", async () => {
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

test("late pickup acquisition after application disposal releases its lease without retaliation", async () => {
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
});

test("late targeting failure after disposal cannot cancel a scene or wake the overlay", async () => {
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
  h.nativeListeners.get("gullbert-action")({
    payload: { action: "target", purpose: "poop" },
  });
  h.emit("pointerdown", pointerEvent({ x: 300 }));
  await h.app.dispose();
  const before = h.calls.length;
  picked.reject(new Error("late native error"));
  await settle();
  assert.equal(h.calls.length, before);
  assert.equal(h.errors.length, 0);
  assert.equal(h.timers.size, 0);
});

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
  const shutdown = h.app.dispose().then(() => {
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

test("a stale targeting deadline cannot finish a newer targeting session", async () => {
  const h = harness();
  await h.app.start();
  h.emit("message", { type: "action", action: "target", purpose: "poop" });
  const oldDeadline = [...h.timers.values()].find(
    (timer) => timer.delay === 12000,
  );
  assert.ok(oldDeadline);
  h.emit("message", { type: "action", action: "target", purpose: "tidy" });
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
