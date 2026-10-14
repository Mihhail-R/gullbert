import type { PointerSample } from "../simulation/model.js";
type PendingSample = PointerSample | (() => PointerSample);
interface PointerOptions {
  read?: (() => Promise<PointerSample | null | undefined>) | null;
  listen?: (sample: (point: PendingSample) => void) => () => void;
  sample: (point: PointerSample | null) => void;
  now?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}
// No global pointer history: providers exist only while the overlay is visible.
// The timer is independent of rendering and permits at most ten reads/second.
export function createPointerTracker({
  read,
  listen,
  sample,
  now = () => {
    return performance.now();
  },
  schedule = setTimeout,
  cancel = clearTimeout,
}: PointerOptions) {
  let running = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  let unlisten: (() => void) | null = null;
  let pending: PendingSample | null = null;
  let last = -Infinity;
  function stop() {
    running = false;
    generation++;
    cancel(timer);
    timer = undefined;
    pending = null;
    unlisten?.();
    unlisten = null;
  }
  function start() {
    if (running) {
      return;
    }
    running = true;
    const token = ++generation;
    if (read) {
      const readPointer = read;
      async function poll() {
        timer = undefined;
        if (!running || token !== generation) {
          return;
        }
        try {
          last = now();
          const point = await readPointer();
          if (running && token === generation && point !== undefined) {
            sample(point);
          }
        } catch {
          if (running && token === generation) {
            sample(null);
          }
        }
        if (running && token === generation) {
          timer = schedule(poll, 100);
        }
      }
      // Retain the throttle across encounters, including rapid cancellation.
      timer = schedule(poll, Math.max(0, 100 - (now() - last)));
    } else if (listen) {
      function flush() {
        timer = undefined;
        if (!running || token !== generation || !pending) {
          return;
        }
        const latest = pending;
        pending = null;
        last = now();
        if (typeof latest === "function") {
          sample(latest());
        } else {
          sample(latest);
        }
      }
      unlisten = listen((point) => {
        if (!running || token !== generation) {
          return;
        }
        pending = point;
        if (now() - last >= 100) {
          cancel(timer);
          flush();
        } else if (timer == null) {
          timer = schedule(flush, 100 - (now() - last));
        }
      });
    }
  }
  return {
    start,
    stop,
    get running() {
      return running;
    },
  };
}
