import type { MemoryEpisode } from "./model.js";
import type { ReadonlyValue } from "./presentation.js";

type Experience = "spin" | "dead" | "come" | "cap";
export interface BoredomState {
  readonly level: number;
  readonly capInterest: number;
}
export const FRESH_INTEREST: BoredomState = Object.freeze({
  level: 0,
  capInterest: 1,
});

function experience(event: ReadonlyValue<MemoryEpisode>): Experience | null {
  if (event.kind === "trick") {
    switch (event.detail) {
      case "spin":
        return "spin";

      case "dead":
        return "dead";

      case "come":
        return "come";
    }
  }

  if (event.kind === "play" && event.detail === "cap") {
    return "cap";
  }

  return null;
}

/** Temporary habituation to completed experiences; ordinary rest restores interest. */
export class Boredom {
  #seenId = 0;
  #last: Experience | null = null;
  #level = 0;
  #capFamiliarity = 0;

  reset(episodes: readonly ReadonlyValue<MemoryEpisode>[]): void {
    this.#seenId = episodes.at(-1)?.id ?? 0;
    this.#last = null;
    this.#level = 0;
    this.#capFamiliarity = 0;
  }

  observe(episodes: readonly ReadonlyValue<MemoryEpisode>[]): void {
    if ((episodes.at(-1)?.id ?? 0) <= this.#seenId) {
      return;
    }

    for (const event of episodes) {
      if (event.id <= this.#seenId) {
        continue;
      }

      this.#seenId = event.id;
      const completed = experience(event);

      if (!completed) {
        continue;
      }

      if (completed === "cap") {
        this.#capFamiliarity = Math.min(6, this.#capFamiliarity + 1);
      }

      if (this.#last === completed) {
        this.#level = Math.min(0.8, this.#level + 0.12);
      } else {
        this.#level = Math.max(0, this.#level - 0.18);
      }

      this.#last = completed;
    }
  }

  update(elapsedSeconds: number, activity: string): void {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      return;
    }

    const seconds = Math.min(0.1, elapsedSeconds);

    this.#capFamiliarity *= Math.exp(-seconds / 180);

    const changePerSecond = activity === "idle" ? 0.0004 : -0.001;
    this.#level = Math.max(0, Math.min(0.8, this.#level + seconds * changePerSecond));
  }

  snapshot(): BoredomState {
    return Object.freeze({
      level: this.#level,
      capInterest: 1 / (1 + this.#capFamiliarity * 0.65),
    });
  }
}
