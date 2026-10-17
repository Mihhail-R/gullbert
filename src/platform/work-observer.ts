import type { WorkSample } from "../simulation/model.js";

interface Options {
  read(): Promise<WorkSample | null>;
  stop(): void;
  sample(sample: WorkSample | null, nowMs: number): void;
  now(): number;
  schedule: typeof setTimeout;
  cancel: typeof clearTimeout;
}

/** Owns polling, cancellation, and stale replies for ephemeral work observations. */
export class WorkObserver {
  readonly #options: Options;
  #running = false;
  #generation = 0;
  #busy = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: Options) {
    this.#options = options;
  }

  start(): void {
    if (this.#running) {
      return;
    }

    this.#running = true;
    this.#generation++;
    this.#schedule();
  }

  stop(): void {
    if (!this.#running) {
      return;
    }

    this.#running = false;
    this.#generation++;
    this.#options.cancel(this.#timer);
    this.#timer = undefined;
    this.#options.stop();
    this.#options.sample(null, this.#options.now());
  }

  #schedule(): void {
    this.#timer = this.#options.schedule(() => {
      void this.#poll();
    }, 500);
  }

  async #poll(): Promise<void> {
    this.#timer = undefined;

    if (!this.#running) {
      return;
    }

    if (this.#busy) {
      this.#schedule();
      return;
    }

    const generation = this.#generation;
    const requestedAtMs = this.#options.now();
    this.#busy = true;
    let sample: WorkSample | null = null;

    try {
      sample = await this.#options.read();
    } catch {
      // An unavailable sensor is an ordinary no-observation result.
    } finally {
      this.#busy = false;
    }

    if (!this.#running || generation !== this.#generation) {
      return;
    }

    const nowMs = this.#options.now();

    if (nowMs - requestedAtMs > 1500) {
      sample = null;
    }

    this.#options.sample(sample, nowMs);

    if (this.#running && generation === this.#generation) {
      this.#schedule();
    }
  }
}
