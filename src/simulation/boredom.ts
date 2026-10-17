import type { MemoryEpisode } from "./model.js";
import type { ReadonlyValue } from "./presentation.js";

export type Interest = "show_spin" | "show_dead" | "trick_come" | "play_cap";
export interface BoredomState {
  readonly level: number;
  readonly interest: Readonly<Partial<Record<Interest, number>>>;
}
export const FRESH_INTEREST: BoredomState = Object.freeze({
  level: 0,
  interest: Object.freeze({}),
});

function experience(event: ReadonlyValue<MemoryEpisode>): Interest | null {
  if (event.kind === "trick") {
    switch (event.detail) {
      case "spin":
        return "show_spin";

      case "dead":
        return "show_dead";

      case "come":
        return "trick_come";
    }
  }

  if (event.kind === "play" && event.detail === "cap") {
    return "play_cap";
  }

  return null;
}

/** Temporary habituation to completed experiences; ordinary rest restores interest. */
export class Boredom {
  #seenId = 0;
  #last: Interest | null = null;
  #level = 0;
  #familiarity = new Map<Interest, number>();

  reset(episodes: readonly ReadonlyValue<MemoryEpisode>[]): void {
    this.#seenId = episodes.at(-1)?.id ?? 0;
    this.#last = null;
    this.#level = 0;
    this.#familiarity.clear();
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
      const interest = experience(event);

      if (!interest) {
        continue;
      }

      const familiarity = this.#familiarity.get(interest) ?? 0;
      this.#familiarity.set(interest, Math.min(6, familiarity + 1));

      if (this.#last === interest) {
        this.#level = Math.min(0.8, this.#level + 0.12);
      } else {
        this.#level = Math.max(0, this.#level - 0.18);
      }

      this.#last = interest;
    }
  }

  update(elapsedSeconds: number, activity: string): void {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      return;
    }

    const seconds = Math.min(0.1, elapsedSeconds);

    for (const [interest, familiarity] of this.#familiarity) {
      this.#familiarity.set(interest, familiarity * Math.exp(-seconds / 180));
    }

    const changePerSecond = activity === "idle" ? 0.0004 : -0.001;
    this.#level = Math.max(0, Math.min(0.8, this.#level + seconds * changePerSecond));
  }

  snapshot(): BoredomState {
    const interest: Partial<Record<Interest, number>> = {};

    for (const [name, familiarity] of this.#familiarity) {
      interest[name] = 1 / (1 + familiarity * 0.65);
    }

    return Object.freeze({ level: this.#level, interest: Object.freeze(interest) });
  }
}
