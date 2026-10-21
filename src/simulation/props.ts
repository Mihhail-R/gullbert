import { clamp } from "./geometry.js";
import type { Bag, Cone, Point, SceneProp } from "./model.js";
import type { ReadonlyValue } from "./presentation.js";

export interface Splat extends Point {
  id: number;
  born: number;
  scale?: number;
  trailLength?: number;
  clip?: Point & { width: number; height: number };
}
interface StoredSplat extends Splat {
  runoffLength: number;
}

/** Painted bounds, shared by rendering and cleanup selection. */
export function splatBounds(splat: Readonly<Splat>) {
  const scale = splat.scale ?? 1;
  const left = splat.x - 24 * scale;
  const top = splat.y - 15 * scale;
  const right = left + 48 * scale;
  const bottom = top + (30 + (splat.trailLength ?? 0)) * scale;
  const clip = splat.clip;
  const x = clip ? Math.max(left, clip.x) : left;
  const y = clip ? Math.max(top, clip.y) : top;
  const clippedRight = clip ? Math.min(right, clip.x + clip.width) : right;
  const clippedBottom = clip ? Math.min(bottom, clip.y + clip.height) : bottom;

  return {
    x,
    y,
    width: Math.max(0, clippedRight - x),
    height: Math.max(0, clippedBottom - y),
  };
}
interface Rubbish extends Point {
  id: number;
  born: number;
}
export interface PropSnapshot {
  serial: number;
  bag: Bag | null;
  crumb: Point | null;
  splats: Splat[];
  cones: Cone[];
  rubbish: Rubbish[];
  looseChips: (SceneProp & { id: number })[];
}
type LooseKind = "bag" | "chip" | "splat" | "rubbish" | "cone";

/** Owns loose objects and session stains, including runoff, cleanup and expiry. */
export class Props {
  #serial = 0;
  #bag: Bag | null = null;
  #crumb: Point | null = null;
  #splats: StoredSplat[] = [];
  #now = 0;
  #cones: Cone[] = [];
  #rubbish: Rubbish[] = [];
  #looseChips: (SceneProp & { id: number })[] = [];
  #width: number;
  #height: number;

  constructor(width: number, height: number) {
    this.#width = width;
    this.#height = height;
  }

  snapshot(): ReadonlyValue<PropSnapshot> {
    return structuredClone({
      serial: this.#serial,
      bag: this.#bag,
      crumb: this.#crumb,
      splats: this.#visibleSplats(),
      cones: this.#cones,
      rubbish: this.#rubbish,
      looseChips: this.#looseChips,
    });
  }

  nextId(): number {
    this.#serial += 1;
    return this.#serial;
  }

  placeBag(point: Point): void {
    this.#bag = { ...point, id: this.nextId(), servings: 3, attached: false };
    this.#clampBag();
  }

  restoreBag(bag: Readonly<Bag>): boolean {
    if (this.#bag) {
      return false;
    }

    this.#bag = { ...bag, id: this.nextId(), attached: false };
    this.#clampBag();
    return true;
  }

  carryBag(point: Point): void {
    if (!this.#bag) {
      return;
    }

    this.#bag.attached = true;
    this.#bag.x = point.x;
    this.#bag.y = point.y;
    this.#clampBag();
  }

  releaseBag(displacement: Point = { x: 0, y: 0 }): void {
    if (!this.#bag) {
      return;
    }

    this.#bag.attached = false;

    if (displacement.x !== 0 || displacement.y !== 0) {
      this.#bag.x += displacement.x;
      this.#bag.y += displacement.y;
      this.#clampBag();
    }
  }

  consumeBag(id: number): boolean {
    if (!this.#bag || this.#bag.id !== id || this.#bag.servings <= 0) {
      return false;
    }

    this.#bag.servings -= 1;
    return true;
  }

  offerCrumb(point: Point): void {
    this.#crumb = { ...point };
  }

  discardFood(): void {
    this.#crumb = null;
    this.#looseChips = [];
  }

  clearCrumb(): void {
    this.#crumb = null;
  }

  #visibleSplats(): Splat[] {
    return this.#splats.map((splat) => {
      const scale = splat.scale ?? 1;
      const elapsedSeconds = Math.max(0, this.#now - splat.born - 0.25);
      const runoffLength = Math.min(splat.runoffLength, elapsedSeconds * 48 / scale);

      return {
        id: splat.id,
        born: splat.born,
        scale: splat.scale,
        x: splat.x,
        y: splat.y,
        trailLength: Math.floor(runoffLength / 3) * 3,
        clip: { x: 0, y: 0, width: this.#width, height: this.#height },
      };
    });
  }

  scatter(point: Point, now: number, scale?: number): void {
    this.#now = now;
    this.#splats.push({
      ...point,
      id: this.nextId(),
      born: now,
      scale,
      runoffLength: Math.max(0, (this.#height - point.y) / (scale ?? 1) - 15),
    });
    this.#splats = this.#splats.slice(-6);
  }

  dropRubbish(point: Point, now: number): void {
    this.#rubbish.push({ ...point, id: this.nextId(), born: now });
    this.#rubbish = this.#rubbish.slice(-3);
  }

  clearCones(): void {
    this.#cones = [];
  }

  placeCone(point: Point, now: number): void {
    this.#cones.push({ ...point, id: this.nextId(), born: now });
  }

  moveCone(id: number, point: Point): void {
    const cone = this.#cones.find((candidate) => {
      return candidate.id === id;
    });

    if (cone) {
      cone.x = point.x;
      cone.y = point.y;
    }
  }

  preserveChips(chips: readonly SceneProp[]): void {
    for (const chip of chips) {
      this.#looseChips.push({ ...chip, id: this.nextId() });
    }

    this.#looseChips = this.#looseChips.slice(-6);
  }

  remove(kind: LooseKind, id?: number): void {
    if (kind === "bag") {
      this.#bag = null;
    } else if (kind === "chip") {
      if (id === undefined) {
        this.#crumb = null;
      } else {
        this.#looseChips = this.#looseChips.filter((chip) => {
          return chip.id !== id;
        });
      }
    } else if (kind === "splat") {
      this.#splats = this.#splats.filter((splat) => {
        return splat.id !== id;
      });
    } else if (kind === "rubbish") {
      this.#rubbish = this.#rubbish.filter((rubbish) => {
        return rubbish.id !== id;
      });
    } else {
      this.#cones = this.#cones.filter((cone) => {
        return cone.id !== id;
      });
    }
  }

  expire(now: number): void {
    this.#now = now;
    this.#splats = this.#splats.filter((splat) => now - splat.born < 40);
    this.#cones = this.#cones.filter((cone) => {
      return now - cone.born < 90;
    });
    this.#rubbish = this.#rubbish.filter((rubbish) => {
      return now - rubbish.born < 90;
    });
  }

  resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    this.#clampBag();

    for (const cone of this.#cones) {
      cone.x = clamp(cone.x, 14, width - 14);
      cone.y = clamp(cone.y, 36, height);
    }

    for (const item of this.#rubbish) {
      item.x = clamp(item.x, 0, width - 48);
      item.y = clamp(item.y, 0, height - 48);
    }

    for (const chip of this.#looseChips) {
      chip.x = clamp(chip.x, 0, width - chip.width);
      chip.y = clamp(chip.y, 0, height - chip.height);
    }

    this.#splats = this.#splats.filter((splat) => {
      return splat.x < width && splat.y < height;
    });
  }

  clear(): void {
    this.#bag = null;
    this.#crumb = null;
    this.#splats = [];
    this.#cones = [];
    this.#rubbish = [];
    this.#looseChips = [];
  }

  #clampBag(): void {
    if (this.#bag) {
      this.#bag.x = Math.max(0, Math.min(this.#width - 51, this.#bag.x));
      this.#bag.y = Math.max(0, Math.min(this.#height - 67, this.#bag.y));
    }
  }
}
