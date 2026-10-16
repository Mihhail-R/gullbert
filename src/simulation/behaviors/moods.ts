import { dialogue } from "../dialogue.js";
import type { MoodName, QuietName } from "../model.js";
import type { Pose } from "../poses.js";
// A little recent-event colour, measured only in visible simulation seconds.
// Moods never schedule mischief, require care, or restrict a command.
const moods: Record<
  MoodName,
  { duration: number; routine: QuietName; pose: Pose; lines: string[] }
> = {
  offended: {
    duration: 35,
    routine: "tilt",
    pose: "bag-offended",
    lines: dialogue.gullbert.moods.offended,
  },
  sleepy: {
    duration: 38,
    routine: "nap",
    pose: "nap-wake",
    lines: dialogue.gullbert.moods.sleepy,
  },
  curious: {
    duration: 32,
    routine: "tilt",
    pose: "tilt",
    lines: dialogue.gullbert.moods.curious,
  },
  smug: {
    duration: 40,
    routine: "preen",
    pose: "preen",
    lines: dialogue.gullbert.moods.smug,
  },
  "snack-minded": {
    duration: 35,
    routine: "tilt",
    pose: "bag-inspect",
    lines: dialogue.gullbert.moods["snack-minded"],
  },
};

/** Recent-event colour owns its expiry and nonrepeating remarks. */
export class Mood {
  #mood: { name: MoodName; until: number } | null = null;
  #lastMoodLine: string | undefined;
  readonly #random: () => number;
  readonly #say: (text: string) => void;

  constructor(random: () => number, say: (text: string) => void) {
    this.#random = random;
    this.#say = say;
  }

  snapshot() {
    return structuredClone({
      mood: this.#mood,
      lastMoodLine: this.#lastMoodLine,
    });
  }

  update(now: number): void {
    if (this.#mood && now >= this.#mood.until) {
      this.#mood = null;
    }
  }

  remark(now: number): string | null {
    this.update(now);

    if (!this.#mood) {
      return null;
    }

    let choices = moods[this.#mood.name].lines.filter((line) => {
      return line !== this.#lastMoodLine;
    });

    if (choices.length === 0) {
      choices = moods[this.#mood.name].lines;
    }

    const line =
      choices[
        Math.min(
          choices.length - 1,
          Math.floor(this.#random() * choices.length),
        )
      ];
    this.#lastMoodLine = line;
    return line;
  }

  set(name: MoodName, now: number, { speak = true } = {}): boolean {
    if (!moods[name]) {
      return false;
    }

    this.#mood = { name, until: now + moods[name].duration };

    if (speak) {
      const remark = this.remark(now);

      if (remark) {
        this.#say(remark);
      }
    }

    return true;
  }

  settleOffence(): void {
    if (this.#mood?.name === "offended") {
      this.#mood = null;
    }
  }

  preferredRoutine(now: number): QuietName | null {
    this.update(now);

    if (this.#mood) {
      return moods[this.#mood.name].routine;
    }

    return null;
  }

  pose(mode: string, now: number): Pose | null {
    this.update(now);

    if (mode !== "idle" || now % 5 >= 1.2) {
      return null;
    }

    if (this.#mood) {
      return moods[this.#mood.name].pose;
    }

    return null;
  }
}
