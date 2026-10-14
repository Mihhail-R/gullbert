import type { Memory } from "./model.js";
import { ITEMS, isCollectible, type Collectible } from "./items.js";
import { clamp, SIZE } from "./geometry.js";

// Durable belongings only. Scenes and animation clocks never enter the snapshot.
const collectibleIds = Object.keys(ITEMS).filter(isCollectible);
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
  return {
    version: 1,
    perch: point(source.perch),
    collection,
    greetings: {
      seen: greetings.seen === true,
      lastAt,
      lastLine,
      lastDiscovery,
    },
  };
}
