/** Read time includes a short settling moment, then scales with the line. */
export function readingDuration(text: string): number {
  return Math.min(
    8,
    Math.max(
      2.6,
      1.2 + text.trim()
        .split(/\s+/).length * 0.32 + text.length * 0.018,
    ),
  );
}

/** Speech expiry follows visible simulation time and survives a silent clear. */
export class Speech {
  #text = "";
  #until = 0;
  snapshot() {
    return Object.freeze({ bubble: this.#text, bubbleUntil: this.#until });
  }
  say(text: string, now: number, duration = 2.5): void {
    this.#text = text;
    this.#until = now + duration;
  }
  clear(): void {
    this.#text = "";
  }
  forget(): void {
    this.#text = "";
    this.#until = 0;
  }
  expire(now: number): void {
    if (now > this.#until) {
      this.#text = "";
    }
  }
}
