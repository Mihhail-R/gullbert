import { clamp } from "./geometry.js";
import type { Bag, Cone, Point, SceneProp } from "./model.js";
import type { ReadonlyValue } from "./presentation.js";

export interface Splat extends Point {
  id: number;
  born: number;
  scale?: number;
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

/** Owns transient objects, their identities, bounds, serving counts and expiry. */
export class Props {
  #serial = 0;
  #bag: Bag | null = null;
  #crumb: Point | null = null;
  #splats: Splat[] = [];
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
      splats: this.#splats,
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

  scatter(point: Point, now: number, scale?: number): void {
    const splat: Splat = { ...point, id: this.nextId(), born: now };
    if (scale !== undefined) {
      splat.scale = scale;
    }
    this.#splats.push(splat);
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
    this.#splats = this.#splats.filter((splat) => {
      return now - splat.born < 40;
    });
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
