import type { Memory, MemoryEpisode } from "./model.js";
import { ITEMS, isCollectible, type Collectible } from "./items.js";
import { clamp, SIZE } from "./geometry.js";
import { normalizePreferences } from "./preferences.js";
import { migrateSummaries, normalizeSummaries, validRecallDetail } from "./memory-summaries.js";

// Completed experiences only. Scenes and animation clocks never enter the snapshot.
export const MEMORY_LIMIT = 200;
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

export function normalizeMemory(
  data: unknown,
  width = 1200,
  height = 800,
  nowMs = Date.now(),
): Memory {
  const source = object(data);
  let safeWidth;

  if (finite(width)) {
    safeWidth = width;
  } else {
    safeWidth = 1200;
  }

  const maxX = Math.max(0, safeWidth - SIZE);
  let safeHeight;

  if (finite(height)) {
    safeHeight = height;
  } else {
    safeHeight = 800;
  }

  const maxY = Math.max(0, safeHeight - SIZE);
  function point(value: unknown) {
    const p = object(value);

    if (!finite(p.x) || !finite(p.y)) {
      return null;
    }

    return {
      x: clamp(p.x, 0, maxX),
      y: clamp(p.y, 0, maxY),
    };
  }
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
  const spot = point(learned.snackSpot);
  const meals = lessons(object(learned.snackSpot).meals);
  let snackSpot = null;

  if (spot && meals > 0) {
    snackSpot = { ...spot, meals };
  }

  const candidate = point(learned.snackCandidate);
  const candidateMeals = lessons(object(learned.snackCandidate).meals);
  let snackCandidate = null;

  if (candidate && candidateMeals > 0) {
    if (snackSpot && snackSpot.meals >= 3) {
      snackCandidate = { ...candidate, meals: Math.min(2, candidateMeals) };
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
      trickCooldownUntilMs = Math.floor(source.trickCooldownUntilMs);
    }
  }

  return {
    version: 3,
    longTerm: source.version === 3
      ? normalizeSummaries(source.longTerm)
      : migrateSummaries(episodes, nowMs),
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
    learned: {
      tricks: {
        come: lessons(tricks.come),
        spin: lessons(tricks.spin),
        dead: lessons(tricks.dead),
      },
      snackSpot,
      snackCandidate,
      scratchesAfterPlay: lessons(learned.scratchesAfterPlay),
    },
    perch: point(source.perch),
    collection,
    preferences: normalizePreferences(source.preferences),
    greetings: {
      seen: greetings.seen === true,
      lastAt,
      lastLine,
      lastDiscovery,
    },
  };
}
