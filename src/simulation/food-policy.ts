/** Snack requests and encounters share a finite, visible-time budget. */
export class FoodPolicy {
  #nextNibble = 0;
  #nextSnackRequest: number;
  #snackRequestAt: number | null = null;
  #nibbleEligibleAt: number | null = null;
  #nextBagVisit = 0;
  #nextCrime: number;
  constructor(random: () => number) {
    this.#nextSnackRequest = 45 + random() * 45;
    this.#nextCrime = 70 + random() * 60;
  }
  snapshot() {
    return Object.freeze({
      nextNibble: this.#nextNibble,
      nextSnackRequest: this.#nextSnackRequest,
      snackRequestAt: this.#snackRequestAt,
      nibbleEligibleAt: this.#nibbleEligibleAt,
      nextBagVisit: this.#nextBagVisit,
      nextCrime: this.#nextCrime,
    });
  }
  clearRequest(): void {
    this.#snackRequestAt = null;
    this.#nibbleEligibleAt = null;
  }
  failed(now: number): void {
    this.#nibbleEligibleAt = now + 3;
  }
  deferEncounter(now: number): void {
    this.#nextNibble = now + 90;
  }
  afterBagActivity(now: number): void {
    this.#nextBagVisit = now + 24;
  }
  afterGuest(now: number): void {
    this.#nextBagVisit = Math.max(this.#nextBagVisit, now + 20);
  }
  afterCrime(now: number, random: () => number): void {
    this.#nextCrime = now + 120 + random() * 60;
  }
  eligible(now: number): boolean {
    if (
      this.#snackRequestAt !== null &&
      now - this.#snackRequestAt >= 15 &&
      this.#nibbleEligibleAt === null
    ) {
      this.#nibbleEligibleAt = now;
    }

    return (
      this.#nibbleEligibleAt !== null &&
      now >= this.#nibbleEligibleAt &&
      now >= this.#nextNibble
    );
  }
  requestDue(now: number): boolean {
    return this.#snackRequestAt === null && now >= this.#nextSnackRequest;
  }
  request(now: number, random: () => number): void {
    this.#snackRequestAt = now;
    this.#nextSnackRequest = now + 100 + random() * 50;
  }
}
