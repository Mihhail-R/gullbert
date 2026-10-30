import type { Memory, MemoryEpisode, Point } from "./model.js";
import { ITEMS, isCollectible, type Collectible } from "./items.js";
import { clamp, SIZE } from "./geometry.js";
import { normalizePreferences } from "./preferences.js";
import { createCapMemory, normalizeCapMemory } from "./cap-memory.js";
import { migrateSummaries, normalizeSummaries, validRecallDetail } from "./memory-summaries.js";
import { reconcileMemoryClock } from "./long-term-memory.js";

// Completed experiences only. Scenes and animation clocks never enter the snapshot.
export const MEMORY_LIMIT = 200;
export const TRICK_COOLDOWN_MS = 2 * 60 * 1000;
const episodeKinds = new Set<MemoryEpisode["kind"]>([
  "trick",
  "reward",
  "meal",
  "play",
  "scratch",
  "gift",
  "perch",
  "visit",
  "activity",
  "recall",
]);
export function memoryCount(value: unknown): number {
  if (finite(value)) {
    return Math.floor(clamp(value, 0, 1_000_000));
  }

  return 0;
}
const collectibleIds = Object.keys(ITEMS)
  .filter(isCollectible);
function object(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  } else {
    return {};
  }
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Remembered locations stay in the available travel area without scaling. */
export function clampMemoryPoint(value: unknown, width: number, height: number): Point | null {
  const point = object(value);

  if (!finite(point.x) || !finite(point.y)) {
    return null;
  }

  const safeWidth = finite(width) ? width : 1200;
  const safeHeight = finite(height) ? height : 800;
  return {
    x: clamp(point.x, 0, Math.max(0, safeWidth - SIZE)),
    y: clamp(point.y, 0, Math.max(0, safeHeight - SIZE)),
  };
}

export function createLearnedMemory(): Memory["learned"] {
  return {
    tricks: { come: 0, spin: 0, dead: 0 },
    capPlay: createCapMemory(),
    lastMealId: 0,
    snackSpot: null,
    snackCandidate: null,
    scratchesAfterPlay: 0,
  };
}

export function normalizeMemory(
  data: unknown,
  width = 1200,
  height = 800,
  nowMs = Date.now(),
): Memory {
  const source = object(data);
  const collection: Memory["collection"] = {};
  const savedCollection = object(source.collection);

  for (const id of collectibleIds) {
    const count = savedCollection[id];

    if (finite(count) && count >= 1) {
      collection[id] = Math.min(999, Math.floor(count));
    }
  }

  const greetings = object(source.greetings);
  const learned = object(source.learned);
  const tricks = object(learned.tricks);
  const performances = object(source.performances);
  const visits = object(source.visits);
  const episodes: MemoryEpisode[] = [];
  const ids = new Set<number>();

  if (Array.isArray(source.episodes)) {
    for (const raw of source.episodes.slice(-MEMORY_LIMIT)) {
      const event = object(raw);
      const location = object(event.location);

      if (
        !finite(event.id) ||
        !Number.isSafeInteger(event.id) ||
        event.id < 1
      ) {
        continue;
      }

      if (ids.has(event.id)) {
        continue;
      }

      if (!finite(event.at) || event.at < 0 || event.at > 8.64e15) {
        continue;
      }

      if (!episodeKinds.has(event.kind as MemoryEpisode["kind"])) {
        continue;
      }

      if (typeof event.detail !== "string" || !event.detail.trim()) {
        continue;
      }

      if (event.kind === "recall" && !validRecallDetail(event.detail)) {
        continue;
      }

      if (!finite(location.x) || !finite(location.y)) {
        continue;
      }

      if (!finite(location.width) || location.width <= 0) {
        continue;
      }

      if (!finite(location.height) || location.height <= 0) {
        continue;
      }

      ids.add(event.id);
      episodes.push({
        id: event.id,
        at: Math.floor(event.at),
        kind: event.kind as MemoryEpisode["kind"],
        detail: event.detail.slice(0, 80),
        // Preserve the original display geometry when today's display changes.
        location: {
          x: clamp(location.x, 0, location.width),
          y: clamp(location.y, 0, location.height),
          width: location.width,
          height: location.height,
        },
      });
    }

    episodes.sort((a, b) => {
      return a.id - b.id;
    });
  }

  function lessons(value: unknown): number {
    if (finite(value)) {
      return Math.floor(clamp(value, 0, 6));
    }

    return 0;
  }

  const learnedMemory = createLearnedMemory();
  learnedMemory.tricks = {
    come: lessons(tricks.come),
    spin: lessons(tricks.spin),
    dead: lessons(tricks.dead),
  };
  learnedMemory.scratchesAfterPlay = lessons(learned.scratchesAfterPlay);
  learnedMemory.capPlay = normalizeCapMemory(learned.capPlay, episodes);

  if (
    typeof learned.lastMealId === "number" &&
    Number.isSafeInteger(learned.lastMealId) &&
    learned.lastMealId >= 0
  ) {
    learnedMemory.lastMealId = learned.lastMealId;
  } else {
    const meals = episodes.filter((event) => event.kind === "meal");
    learnedMemory.lastMealId = meals.at(-1)?.id ?? 0;
  }

  const spot = clampMemoryPoint(learned.snackSpot, width, height);
  const meals = lessons(object(learned.snackSpot).meals);

  if (spot && meals > 0) {
    learnedMemory.snackSpot = { ...spot, meals };
  }

  const candidate = clampMemoryPoint(learned.snackCandidate, width, height);
  const candidateMeals = lessons(object(learned.snackCandidate).meals);

  if (candidate && candidateMeals > 0) {
    if (learnedMemory.snackSpot && learnedMemory.snackSpot.meals >= 3) {
      learnedMemory.snackCandidate = { ...candidate, meals: Math.min(2, candidateMeals) };
    }
  }

  let lastAt;

  if (finite(greetings.lastAt)) {
    lastAt = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, greetings.lastAt));
  } else {
    lastAt = 0;
  }

  let lastLine;

  if (typeof greetings.lastLine === "string") {
    lastLine = greetings.lastLine.slice(0, 240);
  } else {
    lastLine = "";
  }

  let lastDiscovery: Collectible | null;

  if (isCollectible(greetings.lastDiscovery)) {
    lastDiscovery = greetings.lastDiscovery;
  } else {
    lastDiscovery = null;
  }

  let trickCooldownUntilMs = null;

  if (finite(source.trickCooldownUntilMs)) {
    if (source.trickCooldownUntilMs >= 0 && source.trickCooldownUntilMs <= 8.64e15) {
      // A cooldown saved under a clock set far ahead must not outlast its normal length.
      trickCooldownUntilMs = Math.min(
        Math.floor(source.trickCooldownUntilMs),
        nowMs + TRICK_COOLDOWN_MS,
      );
    }
  }

  const savedNest = object(source.nest);
  // Retired legacy nests had only coordinates; do not silently revive them.
  const nestPoint = Array.isArray(savedNest.items)
    ? clampMemoryPoint(source.nest, width, height)
    : null;
  const nestItems: Collectible[] = [];

  if (Array.isArray(savedNest.items)) {
    for (const item of savedNest.items) {
      if (!isCollectible(item) || nestItems.includes(item)) {
        continue;
      }

      if ((collection[item] ?? 0) > 0 && nestItems.length < 3) {
        nestItems.push(item);
      }
    }
  }

  const longTerm = source.version === 3
    ? normalizeSummaries(source.longTerm)
    : migrateSummaries(episodes, nowMs);
  reconcileMemoryClock(longTerm, nowMs);

  return {
    version: 3,
    longTerm,
    episodes,
    unpaidTricks: Math.min(2, memoryCount(source.unpaidTricks)),
    trickCooldownUntilMs,
    trickRefusals: memoryCount(source.trickRefusals),
    performances: {
      come: Math.max(memoryCount(performances.come), lessons(tricks.come)),
      spin: Math.max(memoryCount(performances.spin), lessons(tricks.spin)),
      dead: Math.max(memoryCount(performances.dead), lessons(tricks.dead)),
    },
    visits: {
      pigeon: memoryCount(visits.pigeon),
      gull: memoryCount(visits.gull),
    },
    learned: learnedMemory,
    perch: clampMemoryPoint(source.perch, width, height),
    collection,
    nest: nestPoint ? { ...nestPoint, items: nestItems } : null,
    preferences: normalizePreferences(source.preferences),
    greetings: {
      seen: greetings.seen === true,
      lastAt,
      lastLine,
      lastDiscovery,
    },
  };
}
