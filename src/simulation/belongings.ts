import { dialogue } from "./dialogue.js";
import { MEMORY_LIMIT, memoryCount, normalizeMemory } from "./memory.js";
import { ITEMS, isCollectible, type Collectible, type Item } from "./items.js";
import type { Memory, MemoryEpisode, Point, Trick } from "./model.js";
import { observe } from "./observation.js";
import type { ReadonlyValue } from "./presentation.js";
import { chooseGift, favouriteTreasure, hangoutPosition } from "./preferences.js";
import { SIZE } from "./geometry.js";

export const TRICK_COOLDOWN_MS = 2 * 60 * 1000;
export const GREETING_COOLDOWN_MS = 5 * 60 * 1000;
const firstLines = dialogue.gullbert.greetings.first;
const returnLines = dialogue.gullbert.greetings.return;

/** The sole writer of durable memory, with a cached immutable view for animation. */
export class Belongings {
  #memory: Memory;
  #revision = 0;
  #width: number;
  #height: number;
  #now: () => number;
  #snapshot: ReadonlyValue<{ memory: Memory; revision: number }> | null = null;
  readonly #initialSeed = 1 + Math.floor(Math.random() * 0xffff_ffff);

  constructor(width: number, height: number, now = Date.now) {
    this.#width = width;
    this.#height = height;
    this.#now = now;
    this.#memory = normalizeMemory(null, width, height);
    this.#memory.preferences.seed = this.#initialSeed;
  }

  remember(kind: MemoryEpisode["kind"], detail: string, point: Point): void {
    const at = this.#now();

    if (!Number.isFinite(at) || at < 0 || at > 8.64e15) {
      return;
    }

    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }

    const episodes = this.#memory.episodes;
    episodes.push({
      id: (episodes.at(-1)?.id ?? 0) + 1,
      at: Math.floor(at),
      kind,
      detail,
      location: {
        x: Math.min(this.#width, Math.max(0, point.x)),
        y: Math.min(this.#height, Math.max(0, point.y)),
        width: this.#width,
        height: this.#height,
      },
    });

    if (episodes.length > MEMORY_LIMIT) {
      episodes.shift();
    }

    this.#revision += 1;
  }

  performed(trick: Trick, point: Point, requested = true): void {
    this.#coolOff();

    if (requested) {
      this.#memory.unpaidTricks = Math.min(2, this.#memory.unpaidTricks + 1);
      this.#memory.trickCooldownUntilMs = this.#now() + TRICK_COOLDOWN_MS;
    }

    this.#memory.performances[trick] = memoryCount(
      this.#memory.performances[trick] + 1,
    );
    this.#revision += 1;
    this.remember("trick", trick, point);
  }

  refuseTrick(point: Point): number {
    this.#memory.trickRefusals = memoryCount(this.#memory.trickRefusals + 1);
    this.#revision += 1;
    this.remember("activity", "trick_refusal", point);
    return this.#memory.trickRefusals;
  }

  #coolOff(): void {
    if (this.#memory.unpaidTricks === 0) {
      return;
    }

    const nowMs = this.#now();

    if (!Number.isFinite(nowMs) || nowMs < 0 || nowMs > 8.64e15) {
      return;
    }

    // Older memories receive one bounded cooldown instead of a permanent strike.
    if (this.#memory.trickCooldownUntilMs === null) {
      this.#memory.trickCooldownUntilMs = nowMs + TRICK_COOLDOWN_MS;
      this.#revision += 1;
      return;
    }

    if (nowMs < this.#memory.trickCooldownUntilMs) {
      return;
    }

    this.#memory.unpaidTricks = 0;
    this.#memory.trickRefusals = 0;
    this.#memory.trickCooldownUntilMs = null;
    this.#revision += 1;
  }

  visited(species: "pigeon" | "gull", point: Point): void {
    this.#memory.visits[species] = memoryCount(
      this.#memory.visits[species] + 1,
    );
    this.#revision += 1;
    this.remember("visit", species, point);
  }

  snapshot() {
    this.#coolOff();

    if (this.#snapshot?.revision !== this.#revision) {
      this.#snapshot = observe({
        memory: this.#memory,
        revision: this.#revision,
      });
    }

    return this.#snapshot;
  }

  exportMemory(): Memory {
    this.#coolOff();
    return structuredClone(this.#memory);
  }

  restore(data: unknown): void {
    this.#memory = normalizeMemory(data, this.#width, this.#height);

    if (this.#memory.preferences.seed === 0) {
      this.#memory.preferences.seed = this.#initialSeed;
    }

    this.#revision += 1;
  }

  hangoutPoint(): Point {
    const position = hangoutPosition(this.#memory.preferences);
    return {
      x: position.x * Math.max(0, this.#width - SIZE),
      y: position.y * Math.max(0, this.#height - SIZE),
    };
  }

  chooseGift(random: () => number): Item {
    return chooseGift(this.#memory.preferences, random);
  }

  visitHangout(point: Point): boolean {
    if (this.#width <= SIZE || this.#height <= SIZE) {
      return false;
    }

    const target = this.hangoutPoint();
    const distance = Math.hypot(point.x - target.x, point.y - target.y);

    if (!Number.isFinite(distance) || distance > 2) {
      return false;
    }

    const preferences = this.#memory.preferences;
    preferences.hangout = {
      ...hangoutPosition(preferences),
      visits: Math.min(1000, (preferences.hangout?.visits ?? 0) + 1),
    };
    this.#revision += 1;
    this.remember("activity", "hangout", point);
    return true;
  }

  favouriteTreasure(): Collectible | null {
    return favouriteTreasure(this.#memory.preferences, this.#memory.collection);
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

    if (this.#memory.perch) {
      this.remember("perch", "favourite spot", this.#memory.perch);
    }

    this.#revision += 1;
  }

  clearPerch(): void {
    if (this.#memory.perch) {
      this.#memory.perch = null;
      this.#revision += 1;
    }
  }

  collect(item: Collectible, point?: Point): void {
    this.#memory.collection[item] = Math.min(
      999,
      (this.#memory.collection[item] ?? 0) + 1,
    );
    this.#memory.greetings.lastDiscovery = item;
    const affection = this.#memory.preferences.treasureAffection;
    const familiarItems = Object.keys(affection)
      .filter(isCollectible);

    for (const known of familiarItems) {
      if (known !== item) {
        affection[known]! *= 0.92;
      }
    }

    affection[item] = Math.min(12, (affection[item] ?? 0) + 1);

    if (point) {
      this.remember("gift", item, point);
    }

    this.#revision += 1;
  }

  rewardTrick(trick: Trick, point?: Point): number {
    const learned = this.#memory.learned;

    if (learned.tricks[trick] < 6) {
      learned.tricks[trick] += 1;
      this.#revision += 1;
    }

    if (point) {
      this.remember("reward", trick, point);
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

    this.#memory.unpaidTricks = 0;
    this.#memory.trickRefusals = 0;
    this.#memory.trickCooldownUntilMs = null;
    this.#revision += 1;
    this.remember("meal", "chip", location);
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
    this.#memory.performances = { come: 0, spin: 0, dead: 0 };
    this.#memory.unpaidTricks = 0;
    this.#memory.trickRefusals = 0;
    this.#memory.trickCooldownUntilMs = null;
    this.#memory.episodes = this.#memory.episodes.filter((event) => {
      if (event.detail === "trick_refusal") {
        return false;
      }

      return !["trick", "reward", "meal", "play", "scratch"].includes(
        event.kind,
      );
    });
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
    let item = this.favouriteTreasure();

    if (!item) {
      if (owned(history.lastDiscovery)) {
        item = history.lastDiscovery;
      } else {
        item = Object.keys(collection)
          .find(owned) ?? null;
      }
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
