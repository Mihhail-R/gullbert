import type { CaretSample } from "../simulation/model.js";

interface Options {
  read(): Promise<CaretSample | null>;
  sample(value: CaretSample | null): void;
  schedule: typeof setTimeout;
  cancel: typeof clearTimeout;
}
/** Slow, serial reads; stop invalidates replies even across a subsequent restart. */
export class CaretTracker {
  #options: Options;
  #running = false;
  #generation = 0;
  #pending = false;
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
    this.#options.sample(null);
  }
  #schedule(): void {
    if (!this.#running || this.#pending) {
      return;
    }
    this.#timer = this.#options.schedule(() => {
      void this.#poll();
    }, 300);
  }
  async #poll(): Promise<void> {
    this.#timer = undefined;
    if (!this.#running || this.#pending) {
      return;
    }
    const generation = this.#generation;
    this.#pending = true;
    try {
      const value = await this.#options.read();
      if (this.#running && generation === this.#generation) {
        this.#options.sample(value);
      }
    } catch {
      if (this.#running && generation === this.#generation) {
        this.#options.sample(null);
      }
    } finally {
      this.#pending = false;
      this.#schedule();
    }
  }
}
