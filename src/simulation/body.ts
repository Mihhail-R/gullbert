import { clamp, SIZE } from "./geometry.js";
import type { Direction, Point } from "./model.js";

/** Spatial state and movement belong to one body, including intentional exits. */
export class Body {
  #x: number;
  #y: number;
  #facing: Direction = 1;
  #motionTime = 0;
  #width: number;
  #height: number;

  constructor(width: number, height: number) {
    this.#width = Math.max(SIZE, width);
    this.#height = Math.max(SIZE, height);
    this.#x = width * 0.55;
    this.#y = height - 190;
  }

  get x(): number {
    return this.#x;
  }

  get y(): number {
    return this.#y;
  }

  get facing(): Direction {
    return this.#facing;
  }

  get motionTime(): number {
    return this.#motionTime;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  snapshot() {
    return Object.freeze({
      x: this.#x,
      y: this.#y,
      facing: this.#facing,
      motionTime: this.#motionTime,
      width: this.#width,
      height: this.#height,
    });
  }

  /** Scene exits can place the gull offscreen; ordinary travel uses safePoint. */
  place(point: Point): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }
    this.#x = point.x;
    this.#y = point.y;
  }

  face(direction: number): void {
    if (!Number.isFinite(direction) || direction === 0) {
      return;
    }
    if (direction < 0) {
      this.#facing = -1;
    } else {
      this.#facing = 1;
    }
  }

  advanceMotion(delta: number): void {
    this.#motionTime += delta;
  }

  resetMotion(): void {
    this.#motionTime = 0;
  }

  safePoint(point: Point): Point {
    return {
      x: clamp(point.x, 0, this.#width - SIZE),
      y: clamp(point.y, 0, this.#height - SIZE),
    };
  }

  resize(width: number, height: number): void {
    this.#width = Math.max(SIZE, width);
    this.#height = Math.max(SIZE, height);
    this.place(this.safePoint({ x: this.#x, y: this.#y }));
  }

  moveToward(
    point: Point & { facing?: number },
    speed: number,
    delta: number,
  ): boolean {
    const target = this.safePoint(point);
    const dx = target.x - this.#x;
    const dy = target.y - this.#y;
    const distance = Math.hypot(dx, dy);
    if (Math.abs(dx) > 1) {
      if (dx < 0) {
        this.#facing = -1;
      } else {
        this.#facing = 1;
      }
    }
    this.advanceMotion(delta);
    if (distance <= Math.max(speed * delta, 0.2)) {
      this.place(target);
      if (point.facing) {
        this.face(point.facing);
      }
      return true;
    }
    this.place({
      x: this.#x + (dx / distance) * speed * delta,
      y: this.#y + (dy / distance) * speed * delta,
    });
    return false;
  }
}
