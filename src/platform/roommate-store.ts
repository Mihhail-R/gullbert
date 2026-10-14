import type { Memory } from "../simulation/model.js";
// Serialize durable snapshots: a slower old write must never replace a new one.
export function createMemoryWriter(
  write: (memory: Memory) => void | Promise<void>,
  onError: (error: unknown) => void = () => {},
) {
  let pending: Memory | null = null;
  let running: Promise<void> | null = null;
  async function drain() {
    while (pending) {
      const snapshot = pending;
      pending = null;
      try {
        await write(snapshot);
        onError(null);
      } catch (error) {
        onError(error);
      }
    }
  }
  return {
    save(memory: Memory) {
      pending = structuredClone(memory);
      if (!running) {
        running = drain().finally(() => {
          running = null;
        });
      }
      return running;
    },
    flush() {
      return running ?? Promise.resolve();
    },
  };
}
