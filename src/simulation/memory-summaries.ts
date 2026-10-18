import { ITEMS, isCollectible } from "./items.js";
import type { MemoryEpisode } from "./model.js";
import {
  ACTIVE_DAY_MS,
  createLongTermMemory,
  creditHistoricalDay,
  localMemoryDay,
  recordAcquisition,
  recordMealEvidence,
  recordTrickEvidence,
  validMemoryTime,
  type Evidence,
  type EvidenceDay,
  type LongTermMemory,
  type RelativePosition,
  type SnackPlace,
} from "./long-term-memory.js";

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function boundedCount(value: unknown, limit: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(limit, Math.max(0, Math.floor(value)));
}

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T12:00:00Z`);

  if (!Number.isFinite(parsed.getTime())) {
    return false;
  }

  return parsed.toISOString()
    .slice(0, 10) === value;
}

export function validRecallDetail(detail: unknown): detail is string {
  if (detail === "snack_spot" || detail === "encore:spin" || detail === "encore:dead") {
    return true;
  }

  if (typeof detail !== "string" || !detail.startsWith("keepsake:")) {
    return false;
  }

  return isCollectible(detail.slice(9));
}

function evidenceDay(value: unknown): EvidenceDay | null {
  const source = object(value);

  if (!validDay(source.day) || !validMemoryTime(source.atMs)) {
    return null;
  }

  return { day: source.day, atMs: source.atMs };
}

function evidence(value: unknown): Evidence {
  const source = object(value);
  const lastDay = evidenceDay(source.lastDay);
  const days = boundedCount(source.days, 3);

  if (days === 0 || lastDay === null) {
    return { days: 0, lastDay: null };
  }

  return { days, lastDay };
}

function position(value: unknown): RelativePosition | null {
  const source = object(value);

  if (typeof source.x !== "number" || typeof source.y !== "number") {
    return null;
  }

  if (!Number.isFinite(source.x) || source.x < 0 || source.x > 1) {
    return null;
  }

  if (!Number.isFinite(source.y) || source.y < 0 || source.y > 1) {
    return null;
  }

  return { x: source.x, y: source.y };
}

function snackPlace(value: unknown): SnackPlace | null {
  const source = object(value);
  const point = position(source.position);
  const days = evidence(source);

  if (!point || days.days === 0) {
    return null;
  }

  return { ...days, position: point };
}

function laterTimestamp(value: unknown, earliestMs: number): number | null {
  if (!validMemoryTime(value) || value < earliestMs) {
    return null;
  }

  return value;
}

function validRecallKey(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const parts = value.split(":");

  if (parts.length !== 2) {
    return false;
  }

  const [kind, detail] = parts;

  switch (kind) {
    case "snack": {
      const atMs = Number(detail);
      return validMemoryTime(atMs) && String(atMs) === detail;
    }

    case "trick":
      return detail === "spin" || detail === "dead";

    case "treasure":
      return isCollectible(detail);

    default:
      return false;
  }
}

/** Normalize the bounded summary independently of the evictable episode history. */
export function normalizeSummaries(data: unknown): LongTermMemory {
  const source = object(data);
  const memory = createLongTermMemory();
  const timestamps: number[] = [];

  if (validMemoryTime(source.highWaterAtMs)) {
    timestamps.push(source.highWaterAtMs);
  }

  if (validDay(source.migratedOnDay)) {
    memory.migratedOnDay = source.migratedOnDay;
  }

  const active = object(source.active);
  const activeDay = evidenceDay(active.lastDay);
  const activeDays = boundedCount(active.days, 1_000_000);

  if (activeDay && activeDays > 0) {
    memory.active.days = activeDays;
    memory.active.lastDay = activeDay;
    timestamps.push(activeDay.atMs);
  }

  if (validDay(active.progressDay)) {
    memory.active.progressDay = active.progressDay;
    memory.active.progressMs = boundedCount(active.progressMs, ACTIVE_DAY_MS);
  }

  const daily = object(source.daily);
  const dailyDay = evidenceDay(daily);

  if (dailyDay && memory.active.lastDay) {
    const matchesDay = dailyDay.day === activeDay!.day;
    const matchesTime = dailyDay.atMs === activeDay!.atMs;

    if (matchesDay && matchesTime) {
      memory.daily = { ...dailyDay, allowed: daily.allowed === true, used: daily.used !== false };
    }
  }

  const lastStart = object(source.lastStart);

  if (validRecallKey(lastStart.key) && validMemoryTime(lastStart.atMs)) {
    memory.lastStart = { key: lastStart.key, atMs: lastStart.atMs };
    timestamps.push(lastStart.atMs);

    if (memory.daily && localMemoryDay(lastStart.atMs) === memory.daily.day) {
      memory.daily.used = true;
    }
  }

  const snack = object(source.snack);
  const established = snackPlace(snack.established);
  const candidate = snackPlace(snack.candidate);

  if (established?.days === 3) {
    memory.snack.established = established;
    timestamps.push(established.lastDay!.atMs);
  }

  if (candidate && candidate.days < 3) {
    memory.snack.candidate = candidate;
    timestamps.push(candidate.lastDay!.atMs);
  }

  const old = object(snack.old);
  const oldPosition = position(old.position);

  if (oldPosition && memory.snack.established && validMemoryTime(old.replacedAtMs)) {
    const recalledAtMs = laterTimestamp(old.recalledAtMs, old.replacedAtMs);
    memory.snack.old = { position: oldPosition, replacedAtMs: old.replacedAtMs, recalledAtMs };
    timestamps.push(old.replacedAtMs, recalledAtMs ?? 0);
  }

  const tricks = object(source.tricks);

  for (const trick of ["spin", "dead"] as const) {
    const saved = object(tricks[trick]);
    const days = evidence(saved);
    let qualifiedAtMs = null;

    if (days.days === 3 && validMemoryTime(saved.qualifiedAtMs)) {
      if (saved.qualifiedAtMs <= days.lastDay!.atMs) {
        qualifiedAtMs = saved.qualifiedAtMs;
      }
    }

    let recalledAtMs = null;

    if (qualifiedAtMs !== null) {
      recalledAtMs = laterTimestamp(saved.recalledAtMs, qualifiedAtMs);
    }

    memory.tricks[trick] = { ...days, qualifiedAtMs, recalledAtMs };
    timestamps.push(days.lastDay?.atMs ?? 0, recalledAtMs ?? 0);
  }

  const keepsakes = object(source.keepsakes);

  for (const item of Object.keys(ITEMS)) {
    if (!isCollectible(item)) {
      continue;
    }

    const saved = object(keepsakes[item]);

    if (!validMemoryTime(saved.acquiredAtMs)) {
      continue;
    }

    const acquiredDays = boundedCount(saved.activeDaysAtAcquisition, 1_000_000);

    if (acquiredDays > memory.active.days) {
      continue;
    }

    const recalledAtMs = laterTimestamp(saved.recalledAtMs, saved.acquiredAtMs);
    memory.keepsakes[item] = {
      acquiredAtMs: saved.acquiredAtMs,
      activeDaysAtAcquisition: acquiredDays,
      recalledAtMs,
    };
    timestamps.push(saved.acquiredAtMs, recalledAtMs ?? 0);
  }

  memory.highWaterAtMs = Math.max(0, ...timestamps);
  return memory;
}

export function migrateSummaries(
  episodes: readonly MemoryEpisode[],
  nowMs: number,
): LongTermMemory {
  const memory = createLongTermMemory();
  const chronological = [...episodes]
    .sort((first, second) => first.at - second.at || first.id - second.id);

  for (const event of chronological) {
    creditHistoricalDay(memory, event.at);

    switch (event.kind) {
      case "meal":
        recordMealEvidence(
          memory,
          event.location,
          event.location.width,
          event.location.height,
          event.at,
        );
        break;

      case "reward":
        if (event.detail === "spin" || event.detail === "dead") {
          recordTrickEvidence(memory, event.detail, event.at);
        }

        break;

      case "gift":
        if (isCollectible(event.detail)) {
          recordAcquisition(memory, event.detail, event.at);
        }

        break;
    }
  }

  if (episodes.length > 0 && validMemoryTime(nowMs)) {
    memory.migratedOnDay = localMemoryDay(nowMs);
  }

  return memory;
}
