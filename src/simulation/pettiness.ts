import type { Settings } from "./model.js";
import type { ReadonlyValue } from "./presentation.js";
import type { Scene } from "./scenes.js";

type Protest = "pretend_leave" | "poop";

/** Brief theatrical protests about actual unanswered invitations, never time away. */
export class Pettiness {
  #invitation: object | null = null;
  #ignoredAt: number[] = [];
  #nextProtestAt = 0;
  #pending: { action: Protest; at: number; expiresAt: number } | null = null;

  invited(identity: object | null): void {
    this.#invitation = identity;
  }

  interrupt(): void {
    this.#invitation = null;
    this.#pending = null;
  }

  settle(): void {
    this.interrupt();
    this.#ignoredAt = [];
  }

  waiting(now: number): boolean {
    return this.#pending !== null && now < this.#pending.at;
  }

  completed(
    identity: object | null,
    scene: ReadonlyValue<Scene> | null,
    now: number,
    settings: Readonly<Settings>,
    random: () => number,
  ): void {
    if (!identity || identity !== this.#invitation || !scene) {
      return;
    }

    this.#invitation = null;

    if (settings.paused || settings.mischief === 0) {
      return;
    }

    switch (scene.kind) {
      case "cap":
        if (scene.rounds > 0) {
          this.settle();
          return;
        }

        break;

      case "trick":
        if (scene.phase !== "reward") {
          return;
        }

        break;

      default:
        return;
    }

    this.#ignoredAt = this.#ignoredAt.filter((at) => now - at <= 600);
    this.#ignoredAt.push(now);
    this.#ignoredAt = this.#ignoredAt.slice(-2);

    if (this.#ignoredAt.length < 2 || now < this.#nextProtestAt) {
      return;
    }

    // Consume this pair even when he decides to let it go.
    this.#ignoredAt = [];
    this.#nextProtestAt = now + 600;
    const chance = settings.mischief >= 2 ? 0.6 : 0.35;

    if (random() >= chance) {
      return;
    }

    this.#pending = {
      action: settings.mischief >= 2 ? "poop" : "pretend_leave",
      at: now + 4,
      expiresAt: now + 20,
    };
  }

  take(now: number, settings: Readonly<Settings>): Protest | null {
    const pending = this.#pending;

    if (!pending || now < pending.at) {
      return null;
    }

    this.#pending = null;

    if (now > pending.expiresAt || settings.paused || settings.mischief === 0) {
      return null;
    }

    if (pending.action === "poop" && settings.mischief < 2) {
      return null;
    }

    return pending.action;
  }
}
