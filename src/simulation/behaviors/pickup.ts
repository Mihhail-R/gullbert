import { dialogue } from "../dialogue.js";
import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import type { Body } from "../body.js";
import type { Props } from "../props.js";
import type { Point, Settings } from "../model.js";
import type { Pose } from "../poses.js";
import type { RoutineCapabilities, SceneOwner } from "../routine.js";
import type { Scene, RelocationScene, CursorScene } from "../scenes.js";
import type { SimulationView } from "../capabilities.js";
import { contains, gullRect, type HitRect, type Touch } from "./touch.js";
import { theatreOffset } from "./theatre.js";
import { gagOffset } from "./gags.js";

interface HeldPickup {
  start: Point;
  offset: Point;
  origin: Point;
  dragged: boolean;
}
interface PickupState {
  now: number;
  recent: number[];
  held: HeldPickup | null;
  revengeUntil: number;
  nextRevenge: number;
}
export interface PickupSnapshot {
  readonly now: number;
  readonly recent: readonly number[];
  readonly held: null | {
    readonly start: Readonly<Point>;
    readonly offset: Readonly<Point>;
    readonly origin: Readonly<Point>;
    readonly dragged: boolean;
  };
  readonly revengeUntil: number;
  readonly nextRevenge: number;
}

export interface PickupContext {
  readonly body: Body;
  readonly objects: Pick<Props, "scatter" | "dropRubbish">;
  readonly clock: RoutineCapabilities["clock"];
  readonly speech: RoutineCapabilities["speech"];
  readonly events: RoutineCapabilities["events"];
  readonly random: RoutineCapabilities["random"];
  readonly touch: Pick<Touch, "snapshot" | "reset" | "poke">;
  settings(): Readonly<Settings>;
  visible(): boolean;
  tidying(): boolean;
  visual(): {
    readonly x: number;
    readonly opacity: number;
    readonly gone: boolean;
  };
  pickLoose(point: Readonly<Point>): boolean;
  offend(): void;
  beginDragging(): void;
  carry(): void;
  rest(delay?: number): void;
  install(scene: Scene): void;
  cancel(): void;
  cursorRetaliation(): Readonly<
    Pick<CursorScene, "phase" | "retaliation" | "trail" | "nextSplat">
  > | null;
  consumeTrail(nextAt: number): void;
}

export function pickupRect(
  sim: Readonly<Pick<SimulationView, "scene" | "time" | "x" | "y">>,
): HitRect {
  const rect = gullRect(sim);
  rect.x += theatreOffset(sim).x + gagOffset(sim).x;
  return rect;
}
export function canPickup(
  sim: Readonly<Pick<SimulationView, "visible" | "tidying" | "scene" | "time">>,
): boolean {
  if (!sim.visible || sim.tidying) {
    return false;
  }

  if (sim.scene?.kind === "gift" && sim.scene.phase === "away") {
    return false;
  }

  return theatreOffset(sim).opacity * gagOffset(sim).opacity > 0;
}

/** Owns each hold, rolling history, retaliation budget and relocation lifecycle. */
export class Pickup implements SceneOwner {
  readonly #context: PickupContext;
  #state: PickupState = {
    now: 0,
    recent: [],
    held: null,
    revengeUntil: 0,
    nextRevenge: 0,
  };
  #scene: RelocationScene | null = null;
  #identity: object = Object.freeze({});

  constructor(context: PickupContext) {
    this.#context = context;
  }

  get scene(): ReadonlyValue<RelocationScene> | null {
    return observe(this.#scene);
  }

  get identity(): object {
    return this.#identity;
  }

  authorize(id: number): boolean {
    if (
      !this.#scene ||
      this.#scene.revenge === "none" ||
      !Number.isFinite(id)
    ) {
      return false;
    }

    this.#scene.cursorId = id;
    return true;
  }

  install(scene: ReadonlyValue<Scene>): void {
    if (scene.kind !== "relocation") {
      throw new Error("Pickup owns only relocation scenes");
    }

    this.#scene = structuredClone(scene) as RelocationScene;
    this.#identity = Object.freeze({});
  }

  clear(): void {
    this.#scene = null;
  }

  start(): boolean {
    return false;
  }

  complete(): void {
    this.#scene = null;
  }

  interrupt(): void {
    this.#scene = null;
  }

  visibility(visible: boolean): void {
    if (!visible) {
      this.cancel();

      if (this.#scene) {
        this.#context.cancel();
        this.#context.rest();
      }
    }
  }

  presentation(): { pose?: Pose } {
    const pose = this.pose();

    if (pose) {
      return { pose };
    }

    return {};
  }

  snapshot(): PickupSnapshot {
    let held = null;

    if (this.#state.held) {
      held = Object.freeze({
        start: Object.freeze({ ...this.#state.held.start }),
        offset: Object.freeze({ ...this.#state.held.offset }),
        origin: Object.freeze({ ...this.#state.held.origin }),
        dragged: this.#state.held.dragged,
      });
    }

    return Object.freeze({
      ...this.#state,
      recent: Object.freeze([...this.#state.recent]),
      held,
    });
  }

  updateClock(now: number): void {
    if (!Number.isFinite(now)) {
      return;
    }

    this.#state.now = Math.max(this.#state.now, now);
    const current = this.#state.now;
    this.#state.recent = this.#state.recent.filter((time) => {
      return current - time < 300000;
    });
  }

  begin(point: Readonly<Point>, now: number): boolean {
    const context = this.#context;
    const visual = context.visual();
    const rect = gullRect(context.body);
    rect.x += visual.x;

    if (!context.visible() || context.tidying()) {
      return false;
    }

    if (visual.gone || !(visual.opacity > 0)) {
      return false;
    }

    if (this.#state.held || !contains(rect, point)) {
      return false;
    }

    this.updateClock(now);
    const visualX = context.body.x + visual.x;
    this.#state.held = {
      start: { ...point },
      offset: { x: point.x - visualX, y: point.y - context.body.y },
      origin: { x: visualX, y: context.body.y },
      dragged: false,
    };
    return true;
  }

  move(point: Readonly<Point>): void {
    const held = this.#state.held;

    if (!held || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }

    if (!held.dragged) {
      if (Math.hypot(point.x - held.start.x, point.y - held.start.y) < 6) {
        return;
      }

      held.dragged = true;
      this.#context.beginDragging();
    }

    this.#context.body.place(
      this.#context.body.safePoint({
        x: point.x - held.offset.x,
        y: point.y - held.offset.y,
      }),
    );
    this.#context.carry();
  }

  cancel(): void {
    const held = this.#state.held;
    this.#state.held = null;

    if (held?.dragged) {
      this.#context.rest();
    }
  }

  finish(now: number): void {
    const held = this.#state.held;

    if (!held) {
      return;
    }

    this.#state.held = null;
    this.updateClock(now);
    const context = this.#context;

    if (!held.dragged) {
      if (!context.pickLoose(held.start)) {
        context.touch.poke(held.start);
      }

      return;
    }

    this.#state.recent.push(this.#state.now);
    const count = this.#state.recent.length;
    const settings = context.settings();
    const level = settings.mischief;
    context.rest();
    context.touch.reset();
    let targetX = context.body.width - 96;

    if (context.body.x < context.body.width / 2) {
      targetX = 0;
    }

    const scene: RelocationScene = {
      kind: "relocation",
      phase: "settle",
      until: context.clock.now + 0.7,
      deadline: context.clock.now + 10,
      revenge: "none",
      origin: context.body.safePoint(held.origin),
      target: { x: targetX, y: context.body.y },
    };
    context.install(scene);
    const installed = this.#scene;

    if (!installed) {
      throw new Error("Relocation installation did not reach its owner");
    }

    if (level === 0) {
      if (count === 1) {
        context.speech.say(
          dialogue.gullbert.pickup.wrongPlaceWrongTimeFairEnough,
          3,
        );
      } else {
        context.speech.say(dialogue.gullbert.pickup.yesHereIsAlsoFine, 3);
      }

      return;
    }

    context.offend();
    context.events.emit("squawk");

    if (level === 1) {
      if (count === 1) {
        context.speech.say(dialogue.gullbert.pickup.youCouldHaveAsked, 3);
      } else {
        context.speech.say(dialogue.gullbert.pickup.iAmNotFurniture, 3);
      }

      if (count === 1 && context.random() < 0.35) {
        this.#mess(0.55);
      }

      if (count >= 3 && !settings.paused) {
        installed.revenge = "trash";
      }
    } else {
      if (count === 1) {
        installed.revenge = "chase";
      } else if (count < 4) {
        installed.revenge = "trail";
      } else if (context.random() < 0.5) {
        installed.revenge = "big";
      } else {
        installed.revenge = "trash";
      }

      if (count === 1) {
        context.speech.say(dialogue.gullbert.pickup.yourTurn, 3);
      } else if (count < 4) {
        context.speech.say(dialogue.gullbert.pickup.thisIsNowPersonal, 3);
      } else {
        context.speech.say(dialogue.gullbert.pickup.iWillRedecorate, 3);
      }
    }

    if (!settings.paused && installed.revenge !== "none") {
      if (this.#state.now >= this.#state.nextRevenge) {
        this.#state.revengeUntil = this.#state.now + 10000;
        this.#state.nextRevenge = this.#state.now + 20000;
      }

      const remaining = this.#state.revengeUntil - this.#state.now;

      if (remaining > 700) {
        installed.deadline = context.clock.now + remaining / 1000;
      } else {
        installed.revenge = "none";
      }
    } else {
      installed.revenge = "none";
    }
  }

  update(delta: number): "running" | "complete" {
    if (this.#state.held) {
      return "running";
    }

    const scene = this.#scene;

    if (!scene) {
      return "complete";
    }

    const context = this.#context;
    const now = context.clock.now;

    if (
      now >= scene.deadline ||
      (scene.revenge !== "none" && this.#state.now >= this.#state.revengeUntil)
    ) {
      context.cancel();
      context.rest(3);
      return "complete";
    }

    if (scene.phase === "settle" && now >= scene.until) {
      if (scene.revenge === "chase" || scene.revenge === "trail") {
        let trail = 0;

        if (scene.revenge === "trail") {
          trail = 3;
        }

        context.install({
          kind: "cursor",
          phase: "stare",
          takeover: true,
          started: now,
          until: now + 0.5,
          deadline: scene.deadline,
          pointer: context.touch.snapshot().point,
          retaliation: true,
          retaliationSource: scene,
          cursorId: scene.cursorId,
          trail,
          nextSplat: now + 0.8,
        });
      } else if (scene.revenge === "trash") {
        scene.phase = "collect";
      } else {
        if (scene.revenge === "big") {
          this.#mess(2.5);
          context.speech.say(
            dialogue.gullbert.pickup.aProportionateResponse,
            3,
          );
        }

        scene.phase = "sulk";
        let duration = 2.5;

        if (context.settings().mischief === 0) {
          duration = 1;
        }

        scene.until = now + duration;
      }
    } else if (scene.phase === "sulk" && now >= scene.until) {
      context.cancel();
      context.rest(3);
    } else if (scene.phase === "collect") {
      if (context.body.moveToward(scene.target, 450, delta)) {
        scene.phase = "return";
        context.speech.say(dialogue.gullbert.pickup.sinceWereMovingThings, 3);
      }
    } else if (
      scene.phase === "return" &&
      context.body.moveToward(scene.origin, 450, delta)
    ) {
      context.objects.dropRubbish(
        { x: context.body.x + 24, y: context.body.y + 48 },
        now,
      );
      context.speech.say(dialogue.gullbert.pickup.iveImprovedIt, 3);
      context.cancel();
      context.rest(3);
    }

    if (this.#scene) {
      return "running";
    }

    return "complete";
  }

  pose(): Pose | null {
    const context = this.#context;

    if (this.#state.held?.dragged) {
      if (context.settings().mischief === 0) {
        return "nap-wobble";
      }

      if (Math.floor(context.clock.now * 10) % 2) {
        return "wingUp";
      }

      return "wingDown";
    }

    const scene = this.#scene;

    if (!scene) {
      return null;
    }

    if (["collect", "return"].includes(scene.phase)) {
      if (Math.floor(context.body.motionTime * 12) % 2) {
        return "walkLeft";
      }

      return "walkRight";
    }

    if (scene.phase === "settle") {
      return "crouch";
    }

    if (context.settings().mischief === 0) {
      return "preen";
    }

    return "bag-offended";
  }

  trail(): void {
    const context = this.#context;
    const scene = context.cursorRetaliation();

    if (!scene?.retaliation) {
      return;
    }

    if (this.#state.now >= this.#state.revengeUntil) {
      context.cancel();
      context.rest();
      return;
    }

    if (
      scene.phase === "stalk" &&
      (scene.trail ?? 0) > 0 &&
      context.clock.now >= (scene.nextSplat ?? 0)
    ) {
      this.#mess(0.8);
      context.consumeTrail(context.clock.now + 1.8);
    }
  }

  #mess(scale: number): void {
    const context = this.#context;
    context.objects.scatter(
      { x: context.body.x + 48, y: context.body.y + 86 },
      context.clock.now,
      scale,
    );
    context.events.emit("plop");
  }
}
