import { dialogue } from "./dialogue.js";
import { normalizeMemory } from "./memory.js";
import { ITEMS, isCollectible, type Collectible } from "./items.js";
import type { Memory, Point, Trick } from "./model.js";

export const GREETING_COOLDOWN_MS = 5 * 60 * 1000;
const firstLines = dialogue.gullbert.greetings.first;
const returnLines = dialogue.gullbert.greetings.return;

/** The sole writer of durable belongings and greeting history. */
export class Belongings {
  #memory: Memory;
  #revision = 0;
  #width: number;
  #height: number;

  constructor(width: number, height: number) {
    this.#width = width;
    this.#height = height;
    this.#memory = normalizeMemory(null, width, height);
  }

  snapshot() {
    return { memory: structuredClone(this.#memory), revision: this.#revision };
  }

  restore(data: unknown): void {
    this.#memory = normalizeMemory(data, this.#width, this.#height);
    this.#revision += 1;
  }

  resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    const memory = normalizeMemory(this.#memory, width, height);
    if (JSON.stringify(memory) !== JSON.stringify(this.#memory)) {
      this.#memory = memory;
      this.#revision += 1;
    }
  }

  placePerch(point: Point): void {
    this.#memory.perch = normalizeMemory(
      { perch: point },
      this.#width,
      this.#height,
    ).perch;
    this.#revision += 1;
  }

  clearPerch(): void {
    if (this.#memory.perch) {
      this.#memory.perch = null;
      this.#revision += 1;
    }
  }

  collect(item: Collectible): void {
    this.#memory.collection[item] = Math.min(
      999,
      (this.#memory.collection[item] ?? 0) + 1,
    );
    this.#memory.greetings.lastDiscovery = item;
    this.#revision += 1;
  }

  rewardTrick(trick: Trick): number {
    const learned = this.#memory.learned;
    if (learned.tricks[trick] < 6) {
      learned.tricks[trick] += 1;
      this.#revision += 1;
    }
    return learned.tricks[trick];
  }

  rememberMeal(point: Point): void {
    const location = normalizeMemory(
      { perch: point },
      this.#width,
      this.#height,
    ).perch;
    if (!location) {
      return;
    }
    const learned = this.#memory.learned;
    const spot = learned.snackSpot;
    const previous = JSON.stringify(learned);
    if (spot && Math.hypot(spot.x - location.x, spot.y - location.y) <= 90) {
      learned.snackSpot = {
        x: Math.round((spot.x * spot.meals + location.x) / (spot.meals + 1)),
        y: Math.round((spot.y * spot.meals + location.y) / (spot.meals + 1)),
        meals: Math.min(6, spot.meals + 1),
      };
      learned.snackCandidate = null;
    } else if (spot && spot.meals >= 3) {
      const candidate = learned.snackCandidate;
      let meals = 1;
      if (
        candidate &&
        Math.hypot(candidate.x - location.x, candidate.y - location.y) <= 90
      ) {
        meals = candidate.meals + 1;
      }
      learned.snackCandidate = { ...location, meals };
      if (meals >= 3) {
        learned.snackSpot = learned.snackCandidate;
        learned.snackCandidate = null;
      }
    } else {
      learned.snackSpot = { ...location, meals: 1 };
    }
    if (previous !== JSON.stringify(learned)) {
      this.#revision += 1;
    }
  }

  rememberScratchAfterPlay(): void {
    if (this.#memory.learned.scratchesAfterPlay < 6) {
      this.#memory.learned.scratchesAfterPlay += 1;
      this.#revision += 1;
    }
  }

  forgetLearning(): void {
    this.#memory.learned = normalizeMemory(null).learned;
    this.#revision += 1;
  }

  /** Choosing a line records its cooldown atomically; no unearned discoveries. */
  greet(now: number, random: () => number): string | null {
    if (!Number.isFinite(now) || now < 0) {
      return null;
    }
    const history = this.#memory.greetings;
    const elapsed = now - history.lastAt;
    if (history.seen && elapsed >= 0 && elapsed < GREETING_COOLDOWN_MS) {
      return null;
    }
    const collection = this.#memory.collection;
    function owned(id: unknown): id is Collectible {
      return isCollectible(id) && (collection[id] ?? 0) > 0;
    }
    let item;
    if (owned(history.lastDiscovery)) {
      item = history.lastDiscovery;
    } else {
      item = Object.keys(collection).find(owned);
    }
    let lines = firstLines;
    if (history.seen) {
      const name = item && ITEMS[item].name.toLowerCase();
      if (name) {
        lines = dialogue.gullbert.greetings.treasure.map((line) => {
          return line.replaceAll("{item}", name);
        });
      } else {
        lines = returnLines;
      }
    }
    let choices = lines.filter((line) => {
      return line !== history.lastLine;
    });
    if (choices.length === 0) {
      choices = lines;
    }
    const line =
      choices[
        Math.min(choices.length - 1, Math.floor(random() * choices.length))
      ];
    this.#memory.greetings = {
      ...history,
      seen: true,
      lastAt: now,
      lastLine: line,
    };
    this.#revision += 1;
    return line;
  }
}
