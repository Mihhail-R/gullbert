import type { MemoryEpisode } from "./model.js";
import type { ReadonlyValue } from "./presentation.js";

const OUTCOME_LIMIT = 12;
const COMPLETION_LIMIT = 1_000_000;

export interface CapPlayMemory {
  completed: number;
  lastCompletedId: number;
  outcomes: boolean[];
}

export function createCapMemory(): CapPlayMemory {
  return { completed: 0, lastCompletedId: 0, outcomes: [] };
}

/** Keep familiarity and recent game outcomes independent of unrelated history eviction. */
export function rememberCapGame(
  memory: CapPlayMemory,
  event: ReadonlyValue<MemoryEpisode>,
): void {
  if (event.detail !== "cap") {
    return;
  }

  switch (event.kind) {
    case "play":
      memory.completed = Math.min(COMPLETION_LIMIT, memory.completed + 1);
      memory.lastCompletedId = event.id;
      memory.outcomes.push(true);
      break;

    case "activity":
      memory.outcomes.push(false);
      break;

    default:
      return;
  }

  if (memory.outcomes.length > OUTCOME_LIMIT) {
    memory.outcomes.shift();
  }
}

function savedCapMemory(data: unknown): CapPlayMemory | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const { completed, lastCompletedId, outcomes } = data as Record<string, unknown>;

  if (typeof completed !== "number" || !Number.isSafeInteger(completed) || completed < 0) {
    return null;
  }

  if (typeof lastCompletedId !== "number" || !Number.isSafeInteger(lastCompletedId)) {
    return null;
  }

  if (completed === 0 && lastCompletedId !== 0) {
    return null;
  }

  if (completed > 0 && lastCompletedId <= 0) {
    return null;
  }

  if (!Array.isArray(outcomes) || outcomes.some((outcome) => typeof outcome !== "boolean")) {
    return null;
  }

  const recent = outcomes.slice(-OUTCOME_LIMIT);

  if (recent.filter((outcome) => outcome).length > completed) {
    return null;
  }

  return { completed: Math.min(COMPLETION_LIMIT, completed), lastCompletedId, outcomes: recent };
}

/** Older saves can recover only the evidence still present in their validated history. */
export function normalizeCapMemory(
  data: unknown,
  episodes: readonly MemoryEpisode[],
): CapPlayMemory {
  const saved = savedCapMemory(data);

  if (saved) {
    return saved;
  }

  const memory = createCapMemory();

  for (const event of episodes) {
    rememberCapGame(memory, event);
  }

  return memory;
}
