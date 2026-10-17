import { clamp } from "./geometry.js";

export interface MotivationState {
  energy: number;
  curiosity: number;
  socialInterest: number;
}

export const NEUTRAL_MOTIVATION: Readonly<MotivationState> = Object.freeze({
  energy: 0.5,
  curiosity: 0.5,
  socialInterest: 0.5,
});

/** Comfortable, session-only tendencies. Gullbert can satisfy them by himself. */
export class Motivation {
  #state = { ...NEUTRAL_MOTIVATION };

  snapshot(): Readonly<MotivationState> {
    return Object.freeze({ ...this.#state });
  }

  update(elapsedSeconds: number, activity: string): void {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      return;
    }

    // Match the simulation's suspension cap, even when used independently.
    const seconds = Math.min(0.1, elapsedSeconds);
    let energyPerSecond = 0.0006;
    let curiosityPerSecond = 0.0005;

    switch (activity) {
      case "nap":
        energyPerSecond = 0.018;
        curiosityPerSecond = 0.0002;
        break;

      case "perch":
      case "preen":
      case "stretch":
        energyPerSecond = 0.003;
        break;

      case "walk":
      case "fetch":
      case "tilt":
        energyPerSecond = -0.0008;
        curiosityPerSecond = -0.002;
        break;

      case "cap":
      case "toss":
      case "trick":
      case "fly":
        energyPerSecond = -0.002;
        curiosityPerSecond = -0.001;
        break;
    }

    this.#state.energy = clamp(this.#state.energy + energyPerSecond * seconds, 0.2, 0.8);
    this.#state.curiosity = clamp(this.#state.curiosity + curiosityPerSecond * seconds, 0.2, 0.8);
    // Attention encourages company; solitude returns him to contentment, never loneliness.
    this.#state.socialInterest =
      0.5 + (this.#state.socialInterest - 0.5) * Math.exp(-seconds / 180);
  }

  enjoyed(experience: "meal" | "play" | "scratch"): void {
    switch (experience) {
      case "meal":
        this.#state.energy = Math.min(0.8, this.#state.energy + 0.04);
        this.#state.socialInterest = Math.min(0.8, this.#state.socialInterest + 0.03);
        break;

      case "play":
        this.#state.energy = Math.max(0.2, this.#state.energy - 0.08);
        this.#state.curiosity = Math.max(0.2, this.#state.curiosity - 0.12);
        this.#state.socialInterest = Math.min(0.8, this.#state.socialInterest + 0.12);
        break;

      case "scratch":
        this.#state.socialInterest = Math.min(0.8, this.#state.socialInterest + 0.08);
        break;
    }
  }
}
