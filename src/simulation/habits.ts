import type { Memory, MemoryEpisode, Trick } from "./model.js";
import type { ReadonlyValue } from "./presentation.js";

type Habit = "habit_snack" | "show_spin" | "show_dead" | "play_cap";
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

function trickEvidence(
  memory: ReadonlyValue<Memory>,
  trick: Exclude<Trick, "come">,
): Evidence {
  const outcomes: boolean[] = [];
  let responseId = 0;

  for (const event of memory.episodes) {
    if (event.detail !== trick) {
      continue;
    }

    switch (event.kind) {
      case "trick":
        outcomes.push(false);
        break;

      case "reward":
        responseId = event.id;

        if (outcomes.length > 0) {
          outcomes[outcomes.length - 1] = true;
        }

        break;
    }
  }

  const lessons = memory.learned.tricks[trick];
  let rate = responseRate(outcomes);

  if (outcomes.length === 0) {
    // Old saves have lesson counts but may have no episode history.
    rate = (lessons + 1) / (memory.performances[trick] + 2);
  }

  return {
    command: trick === "spin" ? "show_spin" : "show_dead",
    weight: 3 * rate * (lessons / (lessons + 1)),
    responseId,
  };
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
      if (memory.unpaidTricks < 2) {
        choices.push(trickEvidence(memory, "spin"), trickEvidence(memory, "dead"));
      }

      choices.push(playEvidence(memory.episodes));
    }

    const available: Evidence[] = [];

    for (const choice of choices) {
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
