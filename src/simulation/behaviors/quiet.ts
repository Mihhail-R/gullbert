import { dialogue } from "../dialogue.js";
import type { Quiet, QuietName } from "../model.js";
import type { Pose } from "../poses.js";
import type { Routine, RoutineCapabilities } from "../routine.js";
import type { Mood } from "./moods.js";
import { NEUTRAL_MOTIVATION, type MotivationState } from "../motivation.js";

const routines: QuietName[] = ["nap", "preen", "tilt", "stretch"];
const durations = { preen: 3.8, tilt: 2.4, stretch: 3.2 };

function quietWeight(name: QuietName, motivation: Readonly<MotivationState>): number {
  switch (name) {
    case "nap":
      return 2 ** (5 * (0.5 - motivation.energy));

    case "tilt":
      return 2 ** (4 * (motivation.curiosity - 0.5));

    case "preen":
    case "stretch":
      return 2 ** (2 * (0.5 - motivation.energy));
  }
}

export interface QuietHost extends Pick<
  RoutineCapabilities,
  "clock" | "random" | "speech" | "events"
> {
  readonly activity: {
    beginQuiet(name: QuietName, until: number): void;
    rest(delay: number): void;
    snapshot(): { readonly mode: string; readonly until: number };
  };
  readonly moods: Pick<Mood, "set" | "preferredRoutine">;
  isPaused(): boolean;
}

/** Owns quiet phases, one-shot wake events and the quiet-slot selection history. */
export class QuietRoutine implements Routine {
  readonly #host: QuietHost;
  #quiet: Quiet | null = null;
  #nextQuiet: number | undefined;
  #lastQuiet: QuietName | undefined;

  constructor(host: QuietHost) {
    this.#host = host;
  }

  snapshot() {
    return structuredClone({
      quiet: this.#quiet,
      nextQuiet: this.#nextQuiet,
      lastQuiet: this.#lastQuiet,
    });
  }

  start(name: string): boolean {
    switch (name) {
      case "nap":
      case "preen":
      case "tilt":
      case "stretch":
        break;

      default:
        return false;
    }

    const now = this.#host.clock.now;
    let sleep = 0;

    if (name === "nap") {
      sleep = 7 + this.#host.random() * 4;
    }

    this.#quiet = {
      name,
      started: now,
      sleep,
      startled: name === "nap" && this.#host.random() < 0.12,
      woke: false,
    };
    this.#host.speech.clear();

    if (name === "nap") {
      this.#host.moods.set("sleepy", now);
    }

    if (name === "tilt") {
      this.#host.moods.set("curious", now);
    }

    this.#lastQuiet = name;
    let duration;

    if (name === "nap") {
      let wakeDuration = 1.2;

      if (this.#quiet.startled) {
        wakeDuration = 2.4;
      }

      duration = 0.8 + sleep + wakeDuration;
    } else {
      duration = durations[name];
    }

    const until = now + duration;
    this.#host.activity.beginQuiet(name, until);
    this.#nextQuiet = until + 14 + this.#host.random() * 12;
    return true;
  }

  update(_delta: number): "running" | "complete" {
    const quiet = this.#quiet;
    const activity = this.#host.activity.snapshot();

    if (!quiet || activity.mode !== quiet.name) {
      return "complete";
    }

    const now = this.#host.clock.now;

    if (
      quiet.name === "nap" &&
      now >= quiet.started + 0.8 + quiet.sleep &&
      !quiet.woke
    ) {
      quiet.woke = true;

      if (quiet.startled) {
        this.#host.events.emit("squawk");
        this.#host.speech.say(dialogue.gullbert.quiet.whoDidThat, 2.4);
      }
    }

    if (now >= activity.until) {
      this.#quiet = null;
      this.#host.activity.rest(2 + this.#host.random() * 2);
      return "complete";
    }

    return "running";
  }

  complete(): void {
    this.#quiet = null;
  }

  interrupt(): void {
    this.#quiet = null;
  }

  visibility(_visible: boolean): void {
    // Quiet clocks use visible simulation time: hiding suspends every phase.
  }

  presentation(): { pose?: Pose } {
    const pose = this.#pose();

    if (pose) {
      return { pose };
    }

    return {};
  }

  choose(motivation: Readonly<MotivationState> = NEUTRAL_MOTIVATION): QuietName | null {
    const now = this.#host.clock.now;

    if (
      this.#host.isPaused() ||
      this.#host.activity.snapshot().mode !== "idle"
    ) {
      return null;
    }

    if (this.#nextQuiet === undefined) {
      this.#nextQuiet = now + 10 + this.#host.random() * 8;
    }

    if (now < this.#nextQuiet) {
      return null;
    }

    const choices = routines.filter((name) => {
      return name !== this.#lastQuiet;
    });
    const preferred = this.#host.moods.preferredRoutine(now);

    if (preferred && choices.includes(preferred)) {
      choices.push(preferred, preferred);
    }

    const weighted = choices.map((name) => {
      return { name, weight: quietWeight(name, motivation) };
    });
    const wanderWeight = Math.max(0, motivation.curiosity - 0.5) * 8 * motivation.energy;
    const total = weighted.reduce((sum, choice) => sum + choice.weight, wanderWeight);
    let draw = this.#host.random() * total;

    for (const choice of weighted) {
      draw -= choice.weight;

      if (draw < 0) {
        return choice.name;
      }
    }

    // A curious walk uses this quiet slot, rather than retrying a nap every frame.
    this.#nextQuiet = now + 14;
    return null;
  }

  #pose(): Pose | null {
    const quiet = this.#quiet;
    const activity = this.#host.activity.snapshot();

    if (!quiet || activity.mode !== quiet.name) {
      return null;
    }

    const now = this.#host.clock.now;
    const elapsed = now - quiet.started;

    if (quiet.name === "nap") {
      if (elapsed < 0.8) {
        return "nap-settle";
      }

      const waking = elapsed - 0.8 - quiet.sleep;

      if (waking >= 0) {
        if (quiet.startled) {
          if (waking < 0.55) {
            return "nap-startle";
          }

          return "nap-accuse";
        }

        return "nap-wake";
      }

      if ((elapsed - 0.8) % 3.2 > 2.6) {
        return "nap-wobble";
      }

      return "nap-sleep";
    }

    if (elapsed < 0.45) {
      return `${quiet.name}-start`;
    }

    if (activity.until - now < 0.5) {
      return `${quiet.name}-finish`;
    }

    if (quiet.name === "preen") {
      if (Math.floor((elapsed - 0.45) * 2) % 2) {
        return "preen-start";
      }

      return "preen";
    }

    return quiet.name;
  }
}
