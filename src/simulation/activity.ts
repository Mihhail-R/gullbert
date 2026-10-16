import type { Body } from "./body.js";
import type { Props } from "./props.js";
import type { Flight, Point, MoodName, Sound, QuietName } from "./model.js";
import type { Scene } from "./scenes.js";
import { clamp, SIZE } from "./geometry.js";

interface Effects {
  random(): number;
  mood(name: MoodName): void;
  emit(sound: Sound): void;
  ateChip?(point: Point): void;
}

/** Owns ordinary travel and flight, including grounding on interruption. */
export class Activity {
  #body: Body;
  #objects: Props;
  #effects: Effects;
  #mode = "idle";
  #until = 3;
  #goal: Point | null = null;
  #flight: Flight | null = null;
  #pendingPoop: Point | null = null;
  #calmUntil = 0;

  constructor(body: Body, objects: Props, effects: Effects) {
    this.#body = body;
    this.#objects = objects;
    this.#effects = effects;
  }
  get mode() {
    return this.#mode;
  }
  get until() {
    return this.#until;
  }
  get goal(): Readonly<Point> | null {
    return structuredClone(this.#goal);
  }
  get flight(): Readonly<Flight> | null {
    return structuredClone(this.#flight);
  }
  get pendingPoop(): Readonly<Point> | null {
    return structuredClone(this.#pendingPoop);
  }
  get calmUntil() {
    return this.#calmUntil;
  }
  snapshot() {
    return structuredClone({
      mode: this.#mode,
      until: this.#until,
      goal: this.#goal,
      flight: this.#flight,
      pendingPoop: this.#pendingPoop,
      calmUntil: this.#calmUntil,
    });
  }
  beginRoutine(mode: Scene["kind"] | "routine"): void {
    this.#mode = mode;
    this.#goal = null;
  }
  beginQuiet(name: QuietName, until: number): void {
    this.#mode = name;
    this.#goal = null;
    this.#until = until;
  }
  fetch(point: Point): void {
    this.#goal = this.#body.safePoint(point);
    this.#objects.offerCrumb({ x: this.#goal.x + 60, y: this.#goal.y + 78 });
    this.#mode = "fetch";
  }
  walk(point: Point): void {
    this.#body.resetMotion();
    this.#mode = "walk";
    this.#goal = this.#body.safePoint(point);
  }
  carry(): void {
    this.#mode = "carried";
    this.#goal = null;
  }
  squawk(now: number): void {
    this.#mode = "squawk";
    this.#until = now + 1.2;
  }
  linger(until: number): void {
    this.#until = until;
  }
  stopTravel(): void {
    this.#goal = null;
  }
  settleUntil(until: number): void {
    this.#calmUntil = until;
  }
  rest(now: number, delay = 2): void {
    this.#mode = "idle";
    this.#body.resetMotion();
    this.#goal = null;
    this.#until = now + delay;
  }
  clearPendingDrop(): void {
    this.#pendingPoop = null;
  }
  interruptFlight(): void {
    if (this.#flight) {
      this.#body.place({
        x: this.#body.x,
        y: clamp(this.#flight.groundY, 0, this.#body.height - SIZE),
      });
    }

    this.#flight = null;
  }
  beginDrop(landing: Point, now: number): void {
    this.#pendingPoop = {
      x: clamp(landing.x, 8, this.#body.width - 8),
      y: clamp(landing.y, 8, this.#body.height - 8),
    };
    this.#goal = this.#body.safePoint({
      x: landing.x - 48,
      y: landing.y - 130,
    });
    this.#flight = {
      groundY: this.#body.y,
      takeoffY: this.#body.y,
      startedY: this.#body.y,
      landingY: this.#body.safePoint({ x: 0, y: landing.y - 86 }).y,
    };
    this.#mode = "takeoff";
    this.#until = now + 0.45;
  }
  splat(point: Point, now: number): void {
    this.#objects.scatter(point, now);
    this.#effects.emit("plop");
    this.#pendingPoop = null;

    if (this.#flight) {
      this.#mode = "land";
      this.#flight.startedY = this.#body.y;
      this.#until = now + 0.65;
    } else {
      this.#mode = "proud";
      this.#until = now + 2;
    }

    this.#effects.mood("smug");
  }
  resize(): void {
    if (this.#goal) {
      this.#goal = this.#body.safePoint(this.#goal);
    }

    if (this.#flight) {
      this.#flight.startedY = clamp(
        this.#flight.startedY,
        0,
        this.#body.height - SIZE,
      );
      this.#flight.takeoffY = clamp(
        this.#flight.takeoffY,
        0,
        this.#body.height - SIZE,
      );
      this.#flight.groundY = clamp(
        this.#flight.groundY,
        0,
        this.#body.height - SIZE,
      );
      this.#flight.landingY = clamp(
        this.#flight.landingY,
        0,
        this.#body.height - SIZE,
      );
    }

    if (this.#pendingPoop) {
      this.#pendingPoop.x = clamp(this.#pendingPoop.x, 8, this.#body.width - 8);
      this.#pendingPoop.y = clamp(
        this.#pendingPoop.y,
        8,
        this.#body.height - 8,
      );
    }

    if (this.#objects.snapshot().crumb && this.#goal) {
      this.#objects.offerCrumb({ x: this.#goal.x + 60, y: this.#goal.y + 78 });
    }
  }
  /** True means flight consumed this tick before ordinary autonomy can run. */
  update(now: number, delta: number): boolean {
    if (this.#stepFlight(now)) {
      return true;
    }

    this.#stepTravel(now, delta);
    return false;
  }
  #stepFlight(now: number): boolean {
    if (this.#mode === "takeoff" && this.#flight) {
      const progress = clamp(1 - (this.#until - now) / 0.45, 0, 1);
      this.#body.place({
        x: this.#body.x,
        y: clamp(
          this.#flight.takeoffY - progress * 24,
          0,
          this.#body.height - SIZE,
        ),
      });

      if (now >= this.#until) {
        this.#mode = "fly";
        this.#body.resetMotion();
      }

      return true;
    }

    if (this.#mode === "land" && this.#flight) {
      const progress = clamp(1 - (this.#until - now) / 0.65, 0, 1);
      this.#body.place({
        x: this.#body.x,
        y:
          this.#flight.startedY +
          (this.#flight.landingY - this.#flight.startedY) * progress,
      });
      this.#flight.groundY = this.#body.y;

      if (now >= this.#until) {
        this.#body.place({ x: this.#body.x, y: this.#flight.landingY });
        this.#flight = null;
        this.#mode = "proud";
        this.#until = now + 1.4;
      }

      return true;
    }

    return false;
  }
  #stepTravel(now: number, delta: number): void {
    if (this.#goal) {
      const deltaX = this.#goal.x - this.#body.x;
      const deltaY = this.#goal.y - this.#body.y;
      const remaining = Math.hypot(deltaX, deltaY);
      let speed = 64;

      if (this.#mode === "fly") {
        speed = 300;
      } else if (this.#mode === "fetch") {
        speed = 180;
      }

      const travel = speed * delta;

      if (Math.abs(deltaX) > 1) {
        let facing = 1;

        if (deltaX < 0) {
          facing = -1;
        }

        if (facing !== this.#body.facing) {
          this.#body.resetMotion();
        }

        this.#body.face(facing);
      }

      this.#body.advanceMotion(delta);

      if (this.#flight) {
        this.#flight.groundY = clamp(
          this.#body.y + 44,
          0,
          this.#body.height - SIZE,
        );
      }

      if (remaining <= Math.max(travel, 0.2)) {
        this.#body.place(this.#goal);
        this.#goal = null;

        if (this.#mode === "fetch") {
          if (!this.#objects.snapshot().crumb) {
            this.rest(now);
            return;
          }

          this.#mode = "eat";
          this.#until = now + 2.25;
          this.#effects.mood("snack-minded");
          this.#effects.emit("munch");
          this.#effects.ateChip?.({ x: this.#body.x, y: this.#body.y });
        } else if (this.#mode === "fly") {
          this.#mode = "drop";
          this.#until = now + 0.55;
        } else {
          this.rest(now, 2 + this.#effects.random() * 4);
        }
      } else {
        this.#body.place({
          x: this.#body.x + (deltaX / remaining) * travel,
          y: this.#body.y + (deltaY / remaining) * travel,
        });
      }
    } else if (this.#mode === "drop" && now >= this.#until) {
      if (this.#pendingPoop) {
        this.splat(this.#pendingPoop, now);
      } else {
        this.rest(now);
      }
    } else if (this.#mode !== "idle" && now >= this.#until) {
      this.#objects.clearCrumb();
      this.rest(now, 2);
    }
  }
}
