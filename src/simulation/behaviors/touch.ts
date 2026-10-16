import { dialogue } from "../dialogue.js";
import type { Body } from "../body.js";
import type { Point, PointerSample } from "../model.js";
import type { Pose } from "../poses.js";

export interface HitRect extends Point {
  width: number;
  height: number;
}
export function contains(
  rect: Readonly<HitRect>,
  point: Readonly<Point>,
): boolean {
  const withinWidth = point.x >= rect.x && point.x <= rect.x + rect.width;
  const withinHeight = point.y >= rect.y && point.y <= rect.y + rect.height;
  return withinWidth && withinHeight;
}

interface TouchState {
  point: Point | null;
  sampledAt: number;
  since: number;
  zone: "" | "near" | "head" | "body";
  until: number;
  reaction: "" | "pet" | "poke" | "ruffled" | "miss-scratch";
  pokes: number[];
  nextRemark: number;
  nextPoke: number;
}
export type TouchSnapshot = Readonly<Omit<TouchState, "point" | "pokes">> & {
  readonly point: Readonly<Point> | null;
  readonly pokes: readonly number[];
};

export interface TouchContext {
  readonly body: Body;
  readonly clock: { readonly now: number };
  readonly speech: { say(text: string, duration?: number): void };
  available(): boolean;
  sleeping(): boolean;
  rest(delay: number): void;
  scratched?(): void;
}

export function canTouch(sim: {
  readonly visible: boolean;
  readonly pickup: { readonly held: unknown };
  readonly scene: unknown;
  readonly flight: unknown;
  readonly tidying: boolean;
  readonly cleanup: {
    readonly reactionUntil: number;
    readonly sulkUntil: number;
  };
  readonly time: number;
  readonly mode: string;
}): boolean {
  if (!sim.visible || sim.pickup.held) {
    return false;
  }
  if (sim.scene || sim.flight || sim.tidying) {
    return false;
  }
  const settled =
    sim.cleanup.reactionUntil <= sim.time && sim.cleanup.sulkUntil <= sim.time;
  return settled && ["idle", "walk", "nap"].includes(sim.mode);
}

export function gullRect(sim: Readonly<Point>): HitRect {
  return { x: sim.x + 15, y: sim.y + 21, width: 66, height: 66 };
}

function zoneAt(body: Body, point: Readonly<Point>): TouchState["zone"] {
  const rect = gullRect(body);
  if (contains(rect, point)) {
    let headOffsetX = 37;
    if (body.facing === 1) {
      headOffsetX = 59;
    }
    const headX = body.x + headOffsetX;
    if (point.y <= body.y + 51 && Math.abs(point.x - headX) <= 22) {
      return "head";
    }
    return "body";
  }
  if (Math.hypot(point.x - body.x - 48, point.y - body.y - 50) <= 130) {
    return "near";
  }
  return "";
}

function freshState(): TouchState {
  return {
    point: null,
    sampledAt: -Infinity,
    since: 0,
    zone: "",
    until: 0,
    reaction: "",
    pokes: [],
    nextRemark: 0,
    nextPoke: 0,
  };
}

/** Owns bounded pointer dwell, pokes, reaction timing and their reset lifecycle. */
export class Touch {
  readonly #context: TouchContext;
  #state = freshState();

  constructor(context: TouchContext) {
    this.#context = context;
  }

  snapshot(): TouchSnapshot {
    let point = null;
    if (this.#state.point) {
      point = Object.freeze({ ...this.#state.point });
    }
    return Object.freeze({
      ...this.#state,
      point,
      pokes: Object.freeze([...this.#state.pokes]),
    });
  }

  reset(): void {
    this.#state = freshState();
  }

  pointer(point: PointerSample | null): void {
    this.#state.point = null;
    if (point && point.inside !== false) {
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
        this.#state.point = { ...point };
      }
    }
    this.#state.sampledAt = this.#context.clock.now;
  }

  poke(point: Readonly<Point>): void {
    const context = this.#context;
    const now = context.clock.now;
    if (
      !context.available() ||
      !contains(gullRect(context.body), point) ||
      now < this.#state.nextPoke
    ) {
      return;
    }
    const state = this.#state;
    state.nextPoke = now + 0.3;
    state.pokes = state.pokes.filter((time) => {
      return now - time < 4;
    });
    state.pokes.push(now);
    state.reaction = "poke";
    if (state.pokes.length >= 3) {
      state.reaction = "ruffled";
    }
    let duration = 0.6;
    if (state.reaction === "ruffled") {
      duration = 1.4;
    }
    state.until = now + duration;
    if (context.sleeping()) {
      context.rest(3);
    }
    if (state.reaction === "ruffled") {
      if (point.x < context.body.x + 48) {
        context.body.face(1);
      } else {
        context.body.face(-1);
      }
      if (state.pokes.length === 3) {
        state.nextRemark = now;
      }
      this.#remark(dialogue.gullbert.touch.thisGullIsNotAButton);
    } else {
      this.#remark(dialogue.gullbert.touch.personalSpaceEverHeardOfIt);
    }
  }

  update(): boolean {
    const context = this.#context;
    const state = this.#state;
    const now = context.clock.now;
    if (!context.available()) {
      state.zone = "";
      state.reaction = "";
      return false;
    }
    let point = null;
    if (now - state.sampledAt < 0.4) {
      point = state.point;
    }
    let zone: TouchState["zone"] = "";
    if (point) {
      zone = zoneAt(context.body, point);
    }
    if (state.reaction === "pet" && zone !== "head") {
      state.reaction = "miss-scratch";
      state.until = now + 0.65;
    }
    if (zone !== state.zone) {
      state.zone = zone;
      state.since = now;
    }
    if (state.until > now) {
      return true;
    }
    state.reaction = "";
    if (!point || !zone) {
      return false;
    }
    const dwell = now - state.since;
    if (dwell > 3.5) {
      return false;
    }
    if (zone === "near") {
      if (context.sleeping() || dwell < 0.25) {
        return false;
      }
      if (Math.abs(point.x - context.body.x - 48) > 24) {
        if (point.x < context.body.x + 48) {
          context.body.face(-1);
        } else {
          context.body.face(1);
        }
      }
      return true;
    }
    if (zone === "head" && dwell >= 0.45) {
      state.reaction = "pet";
      this.#remark(dialogue.gullbert.touch.fineOneHeadScratch);
      context.scratched?.();
      return true;
    }
    if (zone === "body" && dwell >= 0.2 && !context.sleeping()) {
      return true;
    }
    return false;
  }

  pose(): Pose | null {
    const context = this.#context;
    const state = this.#state;
    const now = context.clock.now;
    if (!context.available()) {
      return null;
    }
    if (state.until > now) {
      if (state.reaction === "ruffled" || state.reaction === "miss-scratch") {
        return "bag-offended";
      }
      return "nap-startle";
    }
    if (now - state.sampledAt >= 0.4 || now - state.since > 3.5) {
      return null;
    }
    if (state.reaction === "pet") {
      return "nap-sleep";
    }
    if (state.zone && !context.sleeping() && now - state.since >= 0.25) {
      return "tilt";
    }
    return null;
  }

  #remark(text: string): void {
    const now = this.#context.clock.now;
    if (now < this.#state.nextRemark) {
      return;
    }
    this.#context.speech.say(text, 2);
    this.#state.nextRemark = now + 5;
  }
}
