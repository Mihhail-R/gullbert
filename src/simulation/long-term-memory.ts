import { SIZE } from "./geometry.js";
import { isCollectible, type Collectible } from "./items.js";
import type { Point, Trick } from "./model.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CREDIT_GAP_MS = 20 * 60 * 60 * 1000;
export const ACTIVE_DAY_MS = 5 * 60 * 1000;
const SNACK_RADIUS = 90;

export interface RelativePosition {
  x: number;
  y: number;
}
export interface EvidenceDay {
  day: string;
  atMs: number;
}
export interface Evidence {
  days: number;
  lastDay: EvidenceDay | null;
}
export interface SnackPlace extends Evidence {
  position: RelativePosition;
}
export interface EncoreMemory extends Evidence {
  qualifiedAtMs: number | null;
  recalledAtMs: number | null;
}
export interface KeepsakeMemory {
  acquiredAtMs: number;
  activeDaysAtAcquisition: number;
  recalledAtMs: number | null;
}
export interface LongTermMemory {
  highWaterAtMs: number;
  migratedOnDay: string | null;
  active: {
    days: number;
    lastDay: EvidenceDay | null;
    progressDay: string | null;
    progressMs: number;
  };
  daily: (EvidenceDay & { allowed: boolean; used: boolean }) | null;
  lastStart: { key: string; atMs: number } | null;
  snack: {
    established: SnackPlace | null;
    candidate: SnackPlace | null;
    old: {
      position: RelativePosition;
      replacedAtMs: number;
      recalledAtMs: number | null;
    } | null;
  };
  tricks: Record<"spin" | "dead", EncoreMemory>;
  keepsakes: Partial<Record<Collectible, KeepsakeMemory>>;
}
export type RecallMemory =
  | {
    kind: "snack";
    key: string;
    oldPosition: RelativePosition;
    currentPosition: RelativePosition;
  }
  | { kind: "trick"; key: string; trick: "spin" | "dead" }
  | { kind: "treasure"; key: string; item: Collectible };
export interface RecallReservation {
  memory: RecallMemory;
  startedAtMs: number;
}

export function createLongTermMemory(): LongTermMemory {
  const encore = (): EncoreMemory => ({
    days: 0,
    lastDay: null,
    qualifiedAtMs: null,
    recalledAtMs: null,
  });
  return {
    highWaterAtMs: 0,
    migratedOnDay: null,
    active: { days: 0, lastDay: null, progressDay: null, progressMs: 0 },
    daily: null,
    lastStart: null,
    snack: { established: null, candidate: null, old: null },
    tricks: { spin: encore(), dead: encore() },
    keepsakes: {},
  };
}

export function validMemoryTime(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }

  return value >= 0 && value <= 8.64e15;
}

export function localMemoryDay(atMs: number): string {
  const date = new Date(atMs);
  const year = String(date.getFullYear())
    .padStart(4, "0");
  const month = String(date.getMonth() + 1)
    .padStart(2, "0");
  const day = String(date.getDate())
    .padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Repair a corrected wall clock without erasing evidence or granting another credited day. */
export function reconcileMemoryClock(memory: LongTermMemory, nowMs: number): boolean {
  if (!validMemoryTime(nowMs) || nowMs >= memory.highWaterAtMs) {
    return false;
  }

  const day = localMemoryDay(nowMs);
  memory.highWaterAtMs = nowMs;
  const creditedDays = [
    memory.active.lastDay,
    memory.snack.established?.lastDay,
    memory.snack.candidate?.lastDay,
    memory.tricks.spin.lastDay,
    memory.tricks.dead.lastDay,
  ];

  // Only future dates move: legitimate earlier memories keep their age.
  for (const credited of creditedDays) {
    if (!credited || credited.atMs <= nowMs) {
      continue;
    }

    credited.atMs = nowMs;
    credited.day = day;
  }

  if (memory.active.progressDay !== null && memory.active.progressDay > day) {
    memory.active.progressDay = day;
  }

  if (memory.migratedOnDay !== null && memory.migratedOnDay > day) {
    memory.migratedOnDay = day;
  }

  // An uncertain day's allowance is spent, including any interrupted callback.
  if (memory.daily && memory.daily.atMs > nowMs) {
    memory.daily.atMs = nowMs;
    memory.daily.day = day;
    memory.daily.used = true;
  }

  if (memory.lastStart && memory.lastStart.atMs > nowMs) {
    memory.lastStart.atMs = nowMs;
  }

  const oldSnack = memory.snack.old;

  if (oldSnack) {
    oldSnack.replacedAtMs = Math.min(oldSnack.replacedAtMs, nowMs);

    if (oldSnack.recalledAtMs !== null) {
      oldSnack.recalledAtMs = Math.min(oldSnack.recalledAtMs, nowMs);
    }
  }

  for (const evidence of Object.values(memory.tricks)) {
    if (evidence.qualifiedAtMs !== null) {
      evidence.qualifiedAtMs = Math.min(evidence.qualifiedAtMs, nowMs);
    }

    if (evidence.recalledAtMs !== null) {
      evidence.recalledAtMs = Math.min(evidence.recalledAtMs, nowMs);
    }
  }

  for (const keepsake of Object.values(memory.keepsakes)) {
    keepsake.acquiredAtMs = Math.min(keepsake.acquiredAtMs, nowMs);

    if (keepsake.recalledAtMs !== null) {
      keepsake.recalledAtMs = Math.min(keepsake.recalledAtMs, nowMs);
    }
  }

  return true;
}

function observeTime(memory: LongTermMemory, nowMs: number): boolean {
  if (!validMemoryTime(nowMs) || nowMs < memory.highWaterAtMs) {
    return false;
  }

  memory.highWaterAtMs = nowMs;
  return true;
}

function canCredit(lastDay: EvidenceDay | null, nowMs: number): boolean {
  if (lastDay === null) {
    return true;
  }

  if (localMemoryDay(nowMs) <= lastDay.day) {
    return false;
  }

  return nowMs - lastDay.atMs >= CREDIT_GAP_MS;
}

function creditEvidence(evidence: Evidence, nowMs: number): boolean {
  if (!canCredit(evidence.lastDay, nowMs)) {
    return false;
  }

  evidence.days = Math.min(3, evidence.days + 1);
  evidence.lastDay = { day: localMemoryDay(nowMs), atMs: nowMs };
  return true;
}

/** The caller supplies visible, unpaused elapsed time; absence never reaches this operation. */
export function creditActiveTime(
  memory: LongTermMemory,
  elapsedMs: number,
  nowMs: number,
  random: () => number,
): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return false;
  }

  if (!observeTime(memory, nowMs)) {
    return false;
  }

  const active = memory.active;

  if (!canCredit(active.lastDay, nowMs)) {
    return false;
  }

  const day = localMemoryDay(nowMs);

  if (active.progressDay !== day) {
    active.progressDay = day;
    active.progressMs = 0;
  }

  active.progressMs = Math.min(ACTIVE_DAY_MS, active.progressMs + elapsedMs);

  if (active.progressMs < ACTIVE_DAY_MS) {
    return true;
  }

  active.days = Math.min(1_000_000, active.days + 1);
  active.lastDay = { day, atMs: nowMs };
  memory.daily = { ...active.lastDay, allowed: random() < 0.4, used: false };
  return true;
}

/** Migration credits only dates that contain a real event, with no daily callback allowance. */
export function creditHistoricalDay(memory: LongTermMemory, nowMs: number): void {
  if (!observeTime(memory, nowMs) || !canCredit(memory.active.lastDay, nowMs)) {
    return;
  }

  memory.active.days = Math.min(1_000_000, memory.active.days + 1);
  memory.active.lastDay = { day: localMemoryDay(nowMs), atMs: nowMs };
}

export function relativeMemoryPoint(point: Point, width: number, height: number): RelativePosition {
  return {
    x: Math.min(1, Math.max(0, point.x / Math.max(1, width - SIZE))),
    y: Math.min(1, Math.max(0, point.y / Math.max(1, height - SIZE))),
  };
}

export function recallPoint(position: RelativePosition, width: number, height: number): Point {
  return {
    x: position.x * Math.max(0, width - SIZE),
    y: position.y * Math.max(0, height - SIZE),
  };
}

function nearPlace(
  first: RelativePosition,
  second: RelativePosition,
  width: number,
  height: number,
): boolean {
  const a = recallPoint(first, width, height);
  const b = recallPoint(second, width, height);
  return Math.hypot(a.x - b.x, a.y - b.y) <= SNACK_RADIUS;
}

export function recordMealEvidence(
  memory: LongTermMemory,
  point: Point,
  width: number,
  height: number,
  nowMs: number,
): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return;
  }

  if (!observeTime(memory, nowMs)) {
    return;
  }

  const snack = memory.snack;
  const position = relativeMemoryPoint(point, width, height);

  if (snack.established) {
    if (nearPlace(snack.established.position, position, width, height)) {
      snack.candidate = null;
      creditEvidence(snack.established, nowMs);
      return;
    }
  }

  const candidate = snack.candidate;

  if (!candidate || !nearPlace(candidate.position, position, width, height)) {
    snack.candidate = { position, days: 0, lastDay: null };
  }

  const next = snack.candidate!;
  creditEvidence(next, nowMs);

  if (next.days < 3) {
    return;
  }

  if (snack.established) {
    snack.old = {
      position: { ...snack.established.position },
      replacedAtMs: nowMs,
      recalledAtMs: null,
    };
  }

  snack.established = next;
  snack.candidate = null;
}

export function recordTrickEvidence(memory: LongTermMemory, trick: Trick, nowMs: number): void {
  if (trick === "come" || !observeTime(memory, nowMs)) {
    return;
  }

  const evidence = memory.tricks[trick];
  creditEvidence(evidence, nowMs);

  if (evidence.days === 3 && evidence.qualifiedAtMs === null) {
    evidence.qualifiedAtMs = nowMs;
  }
}

export function recordAcquisition(
  memory: LongTermMemory,
  item: Collectible,
  nowMs: number,
): void {
  if (memory.keepsakes[item] || !observeTime(memory, nowMs)) {
    return;
  }

  memory.keepsakes[item] = {
    acquiredAtMs: nowMs,
    activeDaysAtAcquisition: memory.active.days,
    recalledAtMs: null,
  };
}

export function eligibleRecalls(
  memory: LongTermMemory,
  nowMs: number,
  collection: Partial<Record<Collectible, number>>,
  width: number,
  height: number,
): RecallMemory[] {
  if (!validMemoryTime(nowMs) || nowMs < memory.highWaterAtMs) {
    return [];
  }

  const eligible: RecallMemory[] = [];
  const { old, established } = memory.snack;

  if (old && established && old.recalledAtMs === null) {
    const separated = !nearPlace(old.position, established.position, width, height);

    if (separated && nowMs - old.replacedAtMs >= 2 * DAY_MS) {
      eligible.push({
        kind: "snack",
        key: `snack:${old.replacedAtMs}`,
        oldPosition: { ...old.position },
        currentPosition: { ...established.position },
      });
    }
  }

  for (const trick of ["spin", "dead"] as const) {
    const evidence = memory.tricks[trick];

    if (evidence.qualifiedAtMs === null || nowMs - evidence.qualifiedAtMs < 2 * DAY_MS) {
      continue;
    }

    if (evidence.recalledAtMs !== null && nowMs - evidence.recalledAtMs < 7 * DAY_MS) {
      continue;
    }

    eligible.push({ kind: "trick", key: `trick:${trick}`, trick });
  }

  for (const [item, keepsake] of Object.entries(memory.keepsakes)) {
    if (!isCollectible(item) || (collection[item] ?? 0) < 1) {
      continue;
    }

    if (nowMs - keepsake.acquiredAtMs < 7 * DAY_MS) {
      continue;
    }

    if (memory.active.days - keepsake.activeDaysAtAcquisition < 3) {
      continue;
    }

    if (keepsake.recalledAtMs !== null && nowMs - keepsake.recalledAtMs < 14 * DAY_MS) {
      continue;
    }

    eligible.push({ kind: "treasure", key: `treasure:${item}`, item });
  }

  return eligible;
}

function recalledAt(memory: LongTermMemory, recall: RecallMemory): number {
  switch (recall.kind) {
    case "snack":
      return memory.snack.old?.recalledAtMs ?? -1;

    case "trick":
      return memory.tricks[recall.trick].recalledAtMs ?? -1;

    case "treasure":
      return memory.keepsakes[recall.item]?.recalledAtMs ?? -1;
  }
}

export function reserveRecall(
  memory: LongTermMemory,
  eligible: readonly RecallMemory[],
  nowMs: number,
  random: () => number,
): RecallReservation | null {
  if (eligible.length === 0 || !observeTime(memory, nowMs)) {
    return null;
  }

  const daily = memory.daily;

  if (memory.migratedOnDay === localMemoryDay(nowMs)) {
    return null;
  }

  if (!daily || !daily.allowed || daily.used) {
    return null;
  }

  if (daily.day !== localMemoryDay(nowMs) || nowMs < daily.atMs) {
    return null;
  }

  if (memory.lastStart && nowMs - memory.lastStart.atMs < CREDIT_GAP_MS) {
    return null;
  }

  const oldest = Math.min(...eligible.map((recall) => recalledAt(memory, recall)));
  const choices = eligible.filter((recall) => recalledAt(memory, recall) === oldest);
  const index = Math.max(0, Math.min(choices.length - 1, Math.floor(random() * choices.length)));
  const selected = choices[index];
  daily.used = true;
  memory.lastStart = { key: selected.key, atMs: nowMs };
  return { memory: structuredClone(selected), startedAtMs: nowMs };
}

export function completeRecall(
  memory: LongTermMemory,
  reservation: RecallReservation,
  eligible: readonly RecallMemory[],
  nowMs: number,
): boolean {
  const { lastStart } = memory;
  const recall = reservation.memory;

  if (!lastStart || lastStart.key !== recall.key || lastStart.atMs !== reservation.startedAtMs) {
    return false;
  }

  if (!eligible.some((entry) => entry.key === recall.key) || !observeTime(memory, nowMs)) {
    return false;
  }

  if (recalledAt(memory, recall) >= reservation.startedAtMs) {
    return false;
  }

  switch (recall.kind) {
    case "snack":
      memory.snack.old!.recalledAtMs = nowMs;
      break;

    case "trick":
      memory.tricks[recall.trick].recalledAtMs = nowMs;
      break;

    case "treasure":
      memory.keepsakes[recall.item]!.recalledAtMs = nowMs;
      break;
  }

  return true;
}
