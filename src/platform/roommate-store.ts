import type { Memory } from "../simulation/model.js";

interface PersistenceDependencies {
  storage: {
    load(): unknown | Promise<unknown>;
    save(memory: Memory): void | Promise<void>;
  };
  clock: {
    schedule: typeof setTimeout;
    cancel: typeof clearTimeout;
  };
  restore(memory: unknown): void;
  revision(): number;
  snapshot(): Memory;
  checkpoint?(): void;
  result(error: unknown): void;
}

/** Owns restoration and durable writes, including retries while the pet is hidden. */
export class MemoryPersistence {
  #dependencies: PersistenceDependencies;
  #restoration: Promise<void> | null = null;
  #restored = false;
  #active = false;
  #disposed = false;
  #submittedRevision = -1;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #pending: { memory: Memory; revision: number } | null = null;
  #committedRevision = -1;
  #writeError: unknown = null;
  #flushing: Promise<void> | null = null;
  #flushingRevision = -1;
  #writing: Promise<void> | null = null;
  #shutdown: Promise<void> | null = null;

  constructor(dependencies: PersistenceDependencies) {
    this.#dependencies = dependencies;
  }

  restore(): Promise<void> {
    if (this.#disposed) {
      return Promise.resolve();
    }

    this.#restoration ??= this.#load();
    return this.#restoration;
  }

  async #load(): Promise<void> {
    const memory = await this.#dependencies.storage.load();

    if (this.#disposed) {
      return;
    }

    this.#dependencies.restore(memory);
    this.#restored = true;
  }

  /** Start saving only after the application has finished configuring the pet. */
  start(): void {
    if (this.#disposed || !this.#restored || this.#active) {
      return;
    }

    this.#active = true;
    this.remember();
  }

  remember(): void {
    if (!this.#active || this.#retry !== undefined) {
      return;
    }

    const revision = this.#dependencies.revision();

    if (revision === this.#submittedRevision) {
      return;
    }

    this.#submittedRevision = revision;
    this.#pending = {
      memory: structuredClone(this.#dependencies.snapshot()),
      revision,
    };

    if (!this.#writing) {
      this.#writing = this.#drain()
        .finally(() => {
          this.#writing = null;
        });
    }
  }

  /** Flush without disposing: a failed desktop shutdown must remain retryable. */
  flush(): Promise<void> {
    this.#dependencies.checkpoint?.();
    const revision = this.#dependencies.revision();

    if (this.#flushing && this.#flushingRevision === revision) {
      return this.#flushing;
    }

    const flushing = this.#flush(revision)
      .finally(() => {
        if (this.#flushing === flushing) {
          this.#flushing = null;
        }
      });
    this.#flushing = flushing;
    this.#flushingRevision = revision;
    return flushing;
  }

  async #flush(revision: number): Promise<void> {
    if (!this.#active) {
      throw new Error("Memory storage is not ready to flush.");
    }

    this.#cancelRetry();
    this.remember();
    await this.#writing;

    if (this.#committedRevision !== revision) {
      throw this.#writeError ?? new Error("The latest memories have not been saved.");
    }
  }

  dispose(): Promise<void> {
    if (this.#shutdown) {
      return this.#shutdown;
    }

    this.#cancelRetry();
    // Capture before application teardown; bypass backoff for the final attempt.
    this.#dependencies.checkpoint?.();
    this.remember();
    this.#active = false;
    this.#disposed = true;
    // A synchronous failure may have scheduled a retry during remember().
    this.#cancelRetry();
    this.#shutdown = this.#writing ?? Promise.resolve();
    return this.#shutdown;
  }

  async #drain(): Promise<void> {
    while (this.#pending) {
      const snapshot = this.#pending;
      this.#pending = null;

      try {
        await this.#dependencies.storage.save(snapshot.memory);
        this.#committedRevision = snapshot.revision;
        this.#writeError = null;
        this.#result(null);
      } catch (error) {
        this.#writeError = error;
        this.#result(error);
      }
    }
  }

  #result(error: unknown): void {
    if (!this.#active) {
      return;
    }

    this.#cancelRetry();

    if (error) {
      this.#submittedRevision = -1;
      this.#retry = this.#dependencies.clock.schedule(() => {
        this.#retry = undefined;
        this.remember();
      }, 5000);
    }

    this.#dependencies.result(error);
  }

  #cancelRetry(): void {
    this.#dependencies.clock.cancel(this.#retry);
    this.#retry = undefined;
  }
}
