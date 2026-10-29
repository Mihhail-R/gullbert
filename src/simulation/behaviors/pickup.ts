import type { CursorRetaliation } from "./cursor.js";
import { dialogue } from "../dialogue.js";
import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import type { Body } from "../body.js";
import type { Props } from "../props.js";
import type { Point, Settings } from "../model.js";
import type { Pose } from "../poses.js";
import type { RoutineCapabilities, SceneOwner } from "../routine.js";
import type { RelocationScene } from "../scenes.js";
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
  /** Current grudge level, read after this handling has been counted. */
  grudge(): number;
  beginDragging(): void;
  carry(): void;
  rest(delay?: number): void;
  relocated(): void;
  retaliate(reaction: CursorRetaliation): void;
  cancel(): void;
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

const PUBLIC_ENEMY_REPLIES: Record<RelocationScene["revenge"], string> = {
  none: dialogue.gullbert.pickup.iAmNotFurniture,
  chase: dialogue.gullbert.pickup.yourTurn,
  trail: dialogue.gullbert.pickup.thisIsNowPersonal,
  big: dialogue.gullbert.pickup.iWillRedecorate,
  trash: dialogue.gullbert.pickup.iWillRedecorate,
};

function choosePublicEnemyRevenge(
  pickupCount: number,
  grudge: number,
  random: () => number,
): RelocationScene["revenge"] {
  // Repeated handling or an older grudge favors mess, but cursor encounters remain the majority.
  // The grudge already counts recent handling, so take the larger rather than adding.
  const annoyance = Math.min(Math.max(pickupCount - 1, grudge), 3);
  const choices: [RelocationScene["revenge"], number][] = [
    ["chase", 6],
    ["trail", 2 + annoyance],
    ["big", 1 + annoyance],
    ["trash", 1 + annoyance],
  ];
  const totalWeight = choices.reduce((total, [, weight]) => {
    return total + weight;
  }, 0);
  let draw = random() * totalWeight;

  for (const [reaction, weight] of choices) {
    draw -= weight;

    if (draw < 0) {
      return reaction;
    }
  }

  return "trash";
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
    this.#scene = scene;
    this.#identity = Object.freeze({});
    context.relocated();

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

    switch (level) {
      case 1: {
        if (count === 1) {
          context.speech.say(dialogue.gullbert.pickup.youCouldHaveAsked, 3);
        } else {
          context.speech.say(dialogue.gullbert.pickup.iAmNotFurniture, 3);
        }

        if (count === 1 && context.random() < 0.35) {
          this.#mess(0.55);
        }

        if (count >= 3 && !settings.paused) {
          scene.revenge = "trash";
        }

        break;
      }

      case 2: {
        scene.revenge = choosePublicEnemyRevenge(
          count,
          context.grudge(),
          context.random,
        );
        break;
      }
    }

    if (!settings.paused && scene.revenge !== "none") {
      if (this.#state.now >= this.#state.nextRevenge) {
        this.#state.revengeUntil = this.#state.now + 10000;
        this.#state.nextRevenge = this.#state.now + 20000;
      }

      const remaining = this.#state.revengeUntil - this.#state.now;

      if (remaining > 700) {
        scene.deadline = context.clock.now + remaining / 1000;
      } else {
        scene.revenge = "none";
      }
    } else {
      scene.revenge = "none";
    }

    if (level === 2) {
      context.speech.say(PUBLIC_ENEMY_REPLIES[scene.revenge], 3);
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

    switch (scene.phase) {
      case "settle":
        if (now >= scene.until) {
          this.#reactAfterRelease(scene, now);
        }

        break;

      case "sulk":
        if (now >= scene.until) {
          context.cancel();
          context.rest(3);
        }

        break;

      case "collect":
        if (context.body.moveToward(scene.target, 450, delta)) {
          scene.phase = "return";
          context.speech.say(dialogue.gullbert.pickup.sinceWereMovingThings, 3);
        }

        break;

      case "return":
        if (!context.body.moveToward(scene.origin, 450, delta)) {
          break;
        }

        context.objects.dropRubbish(
          { x: context.body.x + 24, y: context.body.y + 48 },
          now,
        );
        context.speech.say(dialogue.gullbert.pickup.iveImprovedIt, 3);
        context.cancel();
        context.rest(3);
        break;
    }

    return this.#scene ? "running" : "complete";
  }

  #reactAfterRelease(scene: RelocationScene, nowSeconds: number): void {
    const context = this.#context;

    switch (scene.revenge) {
      case "chase":
      case "trail":
        context.retaliate({
          reaction: scene.revenge,
          deadlineSeconds: scene.deadline,
          expiresAtMs: this.#state.revengeUntil,
          pointer: context.touch.snapshot().point,
          cursorId: scene.cursorId,
        });
        return;

      case "trash":
        scene.phase = "collect";
        return;

      case "big":
        this.#mess(2.5);
        context.speech.say(dialogue.gullbert.pickup.aProportionateResponse, 3);
        break;

      case "none":
        break;
    }

    scene.phase = "sulk";
    const durationSeconds = context.settings().mischief === 0 ? 1 : 2.5;
    scene.until = nowSeconds + durationSeconds;
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
