export type GrudgeOffence = "handled" | "tidied" | "ignored";
export type GrudgeLevel = 0 | 1 | 2;
export interface GrudgeState {
  readonly points: number;
  readonly level: GrudgeLevel;
}

const OFFENCE_POINTS: Record<GrudgeOffence, number> = {
  handled: 1,
  tidied: 1,
  ignored: 2,
};
// Points fade in visible simulation seconds, so time away always forgives.
const FADE_PER_SECOND = 1 / 90;
const MAX_POINTS = 8;
const ANNOYED_POINTS = 2;
const FURIOUS_POINTS = 5;

/** One running tally of recent offences that scales how hard he escalates. Never persisted. */
export class Grudge {
  #points = 0;
  #updatedAt = 0;

  offend(offence: GrudgeOffence, now: number): void {
    this.#fade(now);
    this.#points = Math.min(MAX_POINTS, this.#points + OFFENCE_POINTS[offence]);
  }

  soothe(points: number, now: number): void {
    this.#fade(now);
    this.#points = Math.max(0, this.#points - points);
  }

  settle(): void {
    this.#points = 0;
  }

  level(now: number): GrudgeLevel {
    this.#fade(now);

    if (this.#points >= FURIOUS_POINTS) {
      return 2;
    }

    if (this.#points >= ANNOYED_POINTS) {
      return 1;
    }

    return 0;
  }

  snapshot(now: number): GrudgeState {
    const level = this.level(now);
    return Object.freeze({ points: this.#points, level });
  }

  #fade(now: number): void {
    if (!Number.isFinite(now)) {
      return;
    }

    const elapsedSeconds = Math.max(0, now - this.#updatedAt);
    this.#updatedAt = Math.max(this.#updatedAt, now);
    this.#points = Math.max(0, this.#points - elapsedSeconds * FADE_PER_SECOND);
  }
}
