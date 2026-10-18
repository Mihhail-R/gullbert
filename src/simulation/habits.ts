import type { Memory, MemoryEpisode } from "./model.js";
import type { ReadonlyValue } from "./presentation.js";
import { NEUTRAL_MOTIVATION, type MotivationState } from "./motivation.js";
import { FRESH_INTEREST, type BoredomState } from "./boredom.js";

type Habit = "habit_snack" | "play_cap";
interface Evidence {
  command: Habit;
  weight: number;
  responseId: number;
}
interface Attempt {
  at: number;
  responseId: number;
  unanswered: number;
}

function motivationWeight(command: Habit, motivation: Readonly<MotivationState>): number {
  const energy = motivation.energy - 0.5;
  const company = motivation.socialInterest - 0.5;

  switch (command) {
    case "habit_snack":
      return 2 ** (2 * (motivation.curiosity - 0.5));

    case "play_cap":
      return 2 ** (4 * energy + 3 * company);
  }
}

// Recent outcomes matter more than old ones. The prior leaves room to try again.
function responseRate(outcomes: readonly boolean[]): number {
  let successes = 1;
  let total = 2;
  const recent = outcomes.slice(-12)
    .reverse();

  for (const [index, rewarded] of recent.entries()) {
    const weight = 0.8 ** index;
    successes += rewarded ? weight : 0;
    total += weight;
  }

  return successes / total;
}

function playEvidence(episodes: readonly ReadonlyValue<MemoryEpisode>[]): Evidence {
  const outcomes: boolean[] = [];
  let responseId = 0;
  let completed = 0;

  for (const event of episodes) {
    if (event.detail !== "cap") {
      continue;
    }

    switch (event.kind) {
      case "play":
        completed += 1;
        responseId = event.id;
        outcomes.push(true);
        break;

      case "activity":
        outcomes.push(false);
        break;
    }
  }

  return {
    command: "play_cap",
    weight: 3 * responseRate(outcomes) * (completed / (completed + 1)),
    responseId,
  };
}

/** Local experience-based choices, with visible-time cooldowns and no care debt. */
export class Habits {
  #nextChoice = 90;
  #lastMeal = -Infinity;
  #attempts = new Map<Habit, Attempt>();

  reset(now: number): void {
    this.#nextChoice = now + 90;
    this.#lastMeal = -Infinity;
    this.#attempts.clear();
  }

  ate(now: number): void {
    this.#lastMeal = now;
    this.#nextChoice = Math.max(this.#nextChoice, now + 90);
  }

  played(now: number): void {
    this.#nextChoice = Math.max(this.#nextChoice, now + 90);
  }

  choose(
    memory: ReadonlyValue<Memory>,
    now: number,
    mischief: number,
    random: () => number,
    motivation: Readonly<MotivationState> = NEUTRAL_MOTIVATION,
    boredom: BoredomState = FRESH_INTEREST,
  ): Habit | null {
    if (now < this.#nextChoice) {
      return null;
    }

    const choices: Evidence[] = [];
    const spot = memory.learned.snackSpot;

    if (spot) {
      const meals = memory.episodes.filter((event) => {
        return event.kind === "meal";
      });
      const appetite = Math.min(1, (now - this.#lastMeal) / 180);
      choices.push({
        command: "habit_snack",
        weight: 1.5 * (spot.meals / (spot.meals + 1)) * appetite,
        responseId: meals.at(-1)?.id ?? 0,
      });
    }

    if (mischief > 0) {
      choices.push(playEvidence(memory.episodes));
    }

    const available: Evidence[] = [];

    for (const choice of choices) {
      choice.weight *= motivationWeight(choice.command, motivation);

      if (choice.command !== "habit_snack") {
        choice.weight *= boredom.interest[choice.command] ?? 1;
      }

      const attempt = this.#attempts.get(choice.command);

      if (attempt) {
        const answered = choice.responseId > attempt.responseId;
        const unanswered = answered ? 0 : attempt.unanswered;
        const cooldownSeconds = 180 * 2 ** Math.min(3, Math.max(0, unanswered - 1));

        if (now - attempt.at < cooldownSeconds) {
          continue;
        }

        choice.weight /= 1 + unanswered;
      }

      if (choice.weight > 0) {
        available.push(choice);
      }
    }

    if (available.length === 0) {
      this.#nextChoice = now + 10;
      return null;
    }

    // Doing nothing is a real option; familiarity never guarantees an interruption.
    const total = available.reduce((sum, choice) => sum + choice.weight, 0) + 0.35;
    let draw = random() * total;
    this.#nextChoice = now + 120 + random() * 90;

    for (const choice of available) {
      draw -= choice.weight;

      if (draw < 0) {
        const previous = this.#attempts.get(choice.command);
        let unanswered = 1;

        if (previous && choice.responseId <= previous.responseId) {
          unanswered = Math.min(4, previous.unanswered + 1);
        }

        this.#attempts.set(choice.command, {
          at: now,
          responseId: choice.responseId,
          unanswered,
        });
        return choice.command;
      }
    }

    return null;
  }
}
