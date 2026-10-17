interface ShutdownDependencies {
  ready(): Promise<void>;
  pause(): void;
  flush(): Promise<void>;
  resume(): void;
  acknowledge(id: number, error: string | null): Promise<void>;
  reportError(error: unknown): void;
}

/** Keeps a requested shutdown frozen until native code exits or explicitly cancels it. */
export class ShutdownCoordinator {
  #request: number | null = null;
  #paused = false;
  #disposed = false;
  readonly #dependencies: ShutdownDependencies;

  constructor(dependencies: ShutdownDependencies) {
    this.#dependencies = dependencies;
  }

  async prepare(id: number): Promise<void> {
    if (this.#disposed || this.#request === id) {
      return;
    }

    this.#request = id;
    let error: string | null = null;

    try {
      await this.#dependencies.ready();

      if (this.#request !== id) {
        return;
      }

      this.#dependencies.pause();
      this.#paused = true;
      await this.#dependencies.flush();
    } catch (cause) {
      error = String(cause);
    }

    if (this.#request !== id) {
      return;
    }

    try {
      await this.#dependencies.acknowledge(id, error);
    } catch (cause) {
      // Native code may have accepted the save even if its IPC reply was lost.
      // Only its cancellation event can safely authorize resuming mutations.
      this.#dependencies.reportError(cause);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#request = null;
  }

  cancel(id: number): void {
    if (this.#request !== id) {
      return;
    }

    this.#request = null;

    if (this.#paused) {
      this.#paused = false;
      this.#dependencies.resume();
    }
  }
}
