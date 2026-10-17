import { ITEMS, isCollectible, type Collectible, type Item } from "./items.js";
import type { Point } from "./model.js";
import type { ReadonlyValue } from "./presentation.js";

const collectibleItems = Object.keys(ITEMS)
  .filter(isCollectible);

export interface Preferences {
  seed: number;
  treasureAffection: Partial<Record<Collectible, number>>;
  // Fractions of the available travel area, independent of display resolution.
  hangout: (Point & { visits: number }) | null;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function bounded(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(maximum, value));
}

export function normalizePreferences(value: unknown): Preferences {
  const source = record(value);
  let seed = 0;

  if (typeof source.seed === "number" && Number.isInteger(source.seed)) {
    if (source.seed > 0 && source.seed <= 0xffff_ffff) {
      seed = source.seed;
    }
  }

  const affection = record(source.treasureAffection);
  const treasureAffection: Preferences["treasureAffection"] = {};

  for (const item of collectibleItems) {
    const score = bounded(affection[item], 12);

    if (score > 0) {
      treasureAffection[item] = score;
    }
  }

  const spot = record(source.hangout);
  let hangout: Preferences["hangout"] = null;
  const visits = Math.floor(bounded(spot.visits, 1000));
  const validX = typeof spot.x === "number" && Number.isFinite(spot.x);
  const validY = typeof spot.y === "number" && Number.isFinite(spot.y);

  if (visits > 0 && validX && validY) {
    hangout = { x: bounded(spot.x, 1), y: bounded(spot.y, 1), visits };
  }

  return { seed, treasureAffection, hangout };
}

/** Stable, separate draws keep tastes independent of animation and command order. */
export function preferenceDraw(seed: number, subject: string): number {
  let hash = seed >>> 0;

  for (const character of subject) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}

export function hangoutPosition(preferences: ReadonlyValue<Preferences>): Point {
  if (preferences.hangout) {
    return { x: preferences.hangout.x, y: preferences.hangout.y };
  }

  return {
    x: 0.15 + preferenceDraw(preferences.seed, "hangout-x") * 0.7,
    y: 0.2 + preferenceDraw(preferences.seed, "hangout-y") * 0.6,
  };
}

export function favouriteTreasure(
  preferences: ReadonlyValue<Preferences>,
  collection: Readonly<Partial<Record<Collectible, number>>>,
): Collectible | null {
  let favourite: Collectible | null = null;
  let best = 0;

  for (const item of collectibleItems) {
    const affection = preferences.treasureAffection[item] ?? 0;

    if (affection < 3) {
      continue;
    }

    if ((collection[item] ?? 0) > 0 && affection > best) {
      favourite = item;
      best = affection;
    }
  }

  return favourite;
}

/** Familiar finds are more tempting, but every kind of gift stays possible. */
export function chooseGift(
  preferences: ReadonlyValue<Preferences>,
  random: () => number,
): Item {
  const items: Item[] = [
    "bottle_cap", "bent_spoon", "sock", "glass_diamond", "parking_ticket", "chip",
  ];
  const choices = items.map((item) => {
    let weight = 1;

    if (isCollectible(item)) {
      const affinity = 0.6 + preferenceDraw(preferences.seed, item) * 0.8;
      const affection = preferences.treasureAffection[item] ?? 0;
      weight += affinity * Math.min(3, affection / 3);
    }

    return { item, weight };
  });
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  let draw = random() * total;

  for (const choice of choices) {
    draw -= choice.weight;

    if (draw < 0) {
      return choice.item;
    }
  }

  return "chip";
}
