import assert from "node:assert/strict";
import { PetApplication } from "../web-dist/ui/pet/application.js";

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export async function settle() {
  for (let count = 0; count < 20; count++) {
    await Promise.resolve();
  }
}

export function harness(options = {}) {
  const listeners = new Map();
  const nativeListeners = new Map();
  const timers = new Map();
  const frames = new Map();
  const steps = [];
  const saved = [];
  const restored = [];
  const published = [];
  const calls = [];
  const errors = [];
  const updates = [];
  let renders = 0;
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
        animate: options.animate ?? false,
        held,
        dragged: held,
      };
    },
    exportMemory() {
      return { collection: { sock: revision } };
    },
    checkpointMemory() {},
    restoreMemory(memory) {
      restored.push(memory);
    },
    drainSounds() {
      return [];
    },
    interactionRects() {
      return [{ x: 0, y: 0, width: 96, height: 96 }];
    },
    treasureRect() {
      return null;
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
    flickCap(point) {
      if (options.flickCap) {
        return options.flickCap(point);
      }

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
    cursorEncounter() {
      return null;
    },
    releaseCursor() {},
    authorizeCursor() {},
    action(name, point) {
      calls.push(["action", name, point]);
      tidying = name === "tidy";
    },
    configure() {},
    resize() {},
    pointer() {},
    observeWork() {},
    tidyPointer() {},
    greet() {
      greeted++;
    },
    setVisible(visible) {
      calls.push(["visible", visible]);
    },
    step(delta) {
      steps.push(delta);
    },
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
    simulation: options.simulation ?? simulation,
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
        timers.set(id, { callback, delay, at: currentTime + delay });
        return id;
      },
      cancel(id) {
        timers.delete(id);
      },
      requestFrame(callback) {
        const id = ++serial;
        frames.set(id, callback);
        return id;
      },
      cancelFrame(id) {
        frames.delete(id);
      },
    },
    view: {
      render() {
        renders++;
      },
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
    native,
    simulation: options.simulation ?? simulation,
    saved,
    restored,
    published,
    calls,
    errors,
    timers,
    frames,
    steps,
    updates,
    displayFrame(delta = 1000 / 60) {
      currentTime += delta;
      const pending = [...frames];

      for (const [id, timer] of [...timers]) {
        if (timer.at <= currentTime) {
          timers.delete(id);
          timer.callback();
        }
      }

      for (const [id, callback] of pending) {
        if (frames.delete(id)) {
          callback(currentTime);
        }
      }
    },
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
    get renders() {
      return renders;
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

export function pointerEvent(overrides = {}) {
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
