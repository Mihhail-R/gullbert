import { dialogue } from "../dialogue.js";
import type { BehaviorCapabilities } from "../capabilities.js";
import { scopeCapabilities } from "../capabilities.js";
import { beakOffsetX, clamp } from "../geometry.js";
import type { Memory, Point, PointerSample } from "../model.js";
import type { ReadonlyValue } from "../presentation.js";
import type { RoutinePresentation, SceneOwner } from "../routine.js";
import type { NestPlayScene } from "../scenes.js";
import { SceneState } from "../scene-state.js";
import { contains, type HitRect } from "./touch.js";

/** Match the three painted nest slots; the nest bed remains click-through. */
export function nestTreasureRects(nest: ReadonlyValue<Memory["nest"]>): HitRect[] {
  if (!nest) {
    return [];
  }

  return nest.items.map((_, index) => ({
    x: nest.x + 3 + index * 33,
    y: nest.y + (index === 1 ? 71 : 64),
    width: 24,
    height: 24,
  }));
}

export function playableTreasureRects(
  nest: ReadonlyValue<Memory["nest"]>,
  scene: ReadonlyValue<NestPlayScene> | null,
): HitRect[] {
  if (!scene) {
    return nestTreasureRects(nest);
  }

  if (scene.phase !== "ready") {
    return [];
  }

  return [{ x: scene.point.x - 16, y: scene.point.y - 16, width: 32, height: 32 }];
}

type Environment = Pick<BehaviorCapabilities,
  "body" | "clock" | "activity" | "speech" | "policy" | "lifecycle" | "belongings"
  | "moods" | "random" | "objects" | "events" | "motivation" | "pettiness"
>;

type CursorRevenge = (
  pointer: Point,
  cursorId: number | undefined,
  remainingSeconds: number,
) => void;

/** A borrowed treasure stays owned and returns home on every cancellation path. */
export class NestPlayRoutine implements SceneOwner {
  readonly #environment: Environment;
  readonly #state = new SceneState<NestPlayScene>();
  readonly #cursorRevenge: CursorRevenge;
  #nextTantrum = 0;
  #lastDisturbed = -Infinity;

  constructor(environment: Environment, cursorRevenge: CursorRevenge) {
    this.#environment = scopeCapabilities(environment, [
      "body", "clock", "activity", "speech", "policy", "lifecycle", "belongings",
      "moods", "random", "objects", "events", "motivation", "pettiness",
    ]);
    this.#cursorRevenge = cursorRevenge;
  }

  get scene() {
    return this.#state.snapshot();
  }

  get identity() {
    return this.#state.identity;
  }

  start(): boolean {
    return false;
  }

  clear(): void {
    this.#state.clear();
  }

  interrupt(): void {
    this.clear();
  }

  complete(): void {
    this.clear();
    this.#environment.lifecycle.rest(5);
  }

  visibility(visible: boolean): void {
    if (!visible) {
      this.#environment.lifecycle.interrupt();
      this.#environment.lifecycle.rest();
    }
  }

  hitRect(point: Point): HitRect | null {
    const sim = this.#environment;

    if (!sim.policy.visible() || sim.policy.tidying() || sim.policy.settings().paused) {
      return null;
    }

    return playableTreasureRects(sim.belongings.snapshot().memory.nest, this.scene)
      .find((rect) => contains(rect, point)) ?? null;
  }

  begin(point: Point): boolean {
    if (!this.hitRect(point)) {
      return false;
    }

    const sim = this.#environment;
    const previous = this.#state.current;

    if (previous?.phase === "ready") {
      previous.phase = "held";
      previous.origin = { ...point };
      previous.pointer = { ...point };
      previous.until = sim.clock.now + 30;
      return true;
    }

    const nest = sim.belongings.snapshot().memory.nest!;
    const slot = nestTreasureRects(nest)
      .findIndex((rect) => contains(rect, point));
    const mood = sim.moods.snapshot().mood?.name;
    let response: NestPlayScene["response"] = "play";

    switch (mood) {
      case "sleepy":
        response = "sleepy";
        break;

      case "offended":
        response = "offended";
        break;
    }

    this.#state.current = {
      kind: "nest_play", phase: "held", item: nest.items[slot], slot,
      point: { ...point }, origin: { ...point }, target: { ...point }, pointer: { ...point },
      started: sim.clock.now, until: sim.clock.now + 30, deadline: sim.clock.now + 60,
      response, revenge: "none", rounds: 0, drops: 0, retrievalSpeedPxPerSecond: 390,
    };
    this.#state.activate();
    sim.activity.beginRoutine("nest_play");
    const lines = dialogue.gullbert.nestPlay;
    sim.speech.say(response === "play" ? lines.invitation : lines.protect);
    return true;
  }

  move(point: Point): void {
    const scene = this.#state.current;

    if (scene?.phase !== "held" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }

    scene.point = this.#onScreen(point);
    scene.pointer = { ...scene.point };
  }

  release(): boolean {
    const scene = this.#state.current;

    if (scene?.phase !== "held") {
      return false;
    }

    const sim = this.#environment;
    const distance = Math.hypot(scene.point.x - scene.origin.x, scene.point.y - scene.origin.y);

    if (distance < 8) {
      sim.lifecycle.interrupt();
      sim.lifecycle.rest();
      return false;
    }

    const repeated = sim.clock.now - this.#lastDisturbed < 45;
    this.#lastDisturbed = sim.clock.now;
    const mischief = sim.policy.settings().mischief;

    if (scene.response === "offended" && repeated && sim.clock.now >= this.#nextTantrum) {
      if (mischief === 2) {
        scene.revenge = sim.random() < 0.5 ? "flyby" : "cursor";
        this.#nextTantrum = sim.clock.now + 90;
        scene.deadline = sim.clock.now + 9;
      }
    }

    scene.target = this.#onScreen({
      x: scene.point.x + (scene.point.x - scene.origin.x) * 0.5,
      y: scene.point.y + (scene.point.y - scene.origin.y) * 0.5,
    });

    if (scene.revenge !== "none") {
      const nest = sim.belongings.snapshot().memory.nest!;
      const outbound = Math.hypot(scene.target.x - sim.body.x, scene.target.y - sim.body.y);
      const homeward = Math.hypot(scene.target.x - nest.x, scene.target.y - nest.y);
      // Rush retrieval to reserve time for the whole reaction, even on large displays.
      scene.retrievalSpeedPxPerSecond = Math.max(390, (outbound + homeward) / 3.5);
    }

    scene.origin = { ...scene.point };
    scene.started = sim.clock.now;
    scene.until = sim.clock.now + 0.6;
    scene.phase = "toss";
    sim.pettiness.settle();

    if (scene.response !== "play") {
      sim.moods.set("offended", sim.clock.now, { speak: false });
      const lines = dialogue.gullbert.nestPlay;
      sim.speech.say(mischief > 0 ? lines.warning : lines.retrieve);
    }

    return scene.revenge !== "none";
  }

  pointerSample(point: PointerSample | null): void {
    const scene = this.#state.current;

    if (!scene || scene.phase === "held" || !point) {
      return;
    }

    if (point.inside === false || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }

    scene.pointer = this.#onScreen(point);
  }

  authorize(id: number): void {
    if (this.#state.current) {
      this.#state.current.cursorId = id;
    }
  }

  resize(): void {
    const scene = this.#state.current;

    if (scene) {
      scene.point = this.#onScreen(scene.point);
      scene.target = this.#onScreen(scene.target);
      scene.pointer = this.#onScreen(scene.pointer);
      scene.origin = this.#onScreen(scene.origin);
    }
  }

  update(delta: number): "running" | "complete" {
    const sim = this.#environment;
    const scene = this.#state.current;
    const nest = sim.belongings.snapshot().memory.nest;

    if (!scene || !nest || sim.clock.now >= scene.deadline) {
      return "complete";
    }

    switch (scene.phase) {
      case "held":
        if (sim.clock.now >= scene.until) {
          return "complete";
        }

        break;

      case "toss": {
        const progress = clamp((sim.clock.now - scene.started) / 0.6, 0, 1);
        scene.point = this.#onScreen({
          x: scene.origin.x + (scene.target.x - scene.origin.x) * progress,
          y: scene.origin.y + (scene.target.y - scene.origin.y) * progress
            - Math.sin(progress * Math.PI) * 45,
        });

        if (progress === 1) {
          scene.phase = "chase";
          scene.until = sim.clock.now + (scene.response === "sleepy" ? 1.5 : 0);
        }

        break;
      }

      case "chase": {
        if (sim.clock.now < scene.until) {
          break;
        }

        const speed = scene.response === "sleepy" ? 110 : scene.retrievalSpeedPxPerSecond;
        const target = sim.body.safePoint({ x: scene.point.x - 48, y: scene.point.y - 60 });

        if (sim.body.moveToward(target, speed, delta)) {
          scene.rounds += 1;
          scene.phase = scene.response === "play" ? "return" : "home";
        }

        break;
      }

      case "return": {
        const returnX = scene.pointer.x < sim.body.width / 2
          ? scene.pointer.x + 30 : scene.pointer.x - 110;
        const target = sim.body.safePoint({ x: returnX, y: scene.pointer.y - 86 });
        scene.point = this.#mouth();

        if (sim.body.moveToward(target, 280, delta)) {
          scene.point = this.#onScreen(scene.pointer);
          sim.body.face(scene.pointer.x >= sim.body.x + 48 ? 1 : -1);
          scene.phase = "ready";
          scene.until = sim.clock.now + 8;
          sim.motivation.enjoyed("play");
          sim.belongings.remember("play", "nest", scene.point);
          sim.speech.say(dialogue.gullbert.nestPlay.again);
        }

        break;
      }

      case "ready":
        if (sim.clock.now >= scene.until || scene.rounds >= 3) {
          scene.phase = "chase";
          scene.response = "offended";
          scene.until = sim.clock.now;
        }

        break;

      case "home":
        scene.point = this.#mouth();

        if (sim.body.moveToward(nest, scene.retrievalSpeedPxPerSecond, delta)) {
          sim.belongings.arrangeNest();

          switch (scene.revenge) {
            case "cursor": {
              const { pointer, cursorId } = scene;
              const remainingSeconds = scene.deadline - sim.clock.now;
              sim.lifecycle.complete();

              if (remainingSeconds > 2.4) {
                this.#cursorRevenge(pointer, cursorId, remainingSeconds);
              }

              return "running";
            }

            case "flyby":
              scene.phase = "flyby";
              scene.started = sim.clock.now;
              scene.origin = { x: sim.body.x, y: sim.body.y };
              scene.target = sim.body.safePoint({
                x: sim.body.x < sim.body.width / 2 ? sim.body.width - 96 : 0,
                y: Math.max(24, sim.body.y - 160),
              });
              sim.body.face(scene.target.x >= sim.body.x ? 1 : -1);
              sim.speech.say(dialogue.gullbert.nestPlay.flyby);
              break;

            case "none":
              sim.speech.say(dialogue.gullbert.nestPlay.home);
              return "complete";
          }
        }

        break;

      case "flyby": {
        const elapsed = sim.clock.now - scene.started;
        const progress = clamp(elapsed / 2.4, 0, 1);
        sim.body.place({
          x: scene.origin.x + (scene.target.x - scene.origin.x) * progress,
          y: scene.origin.y + (scene.target.y - scene.origin.y) * Math.sin(progress * Math.PI),
        });

        if (scene.drops < 4 && elapsed >= 0.3 + scene.drops * 0.5) {
          sim.objects.scatter({ x: sim.body.x + 48, y: sim.body.y + 86 }, sim.clock.now, 0.8);
          sim.events.emit("plop");
          scene.drops += 1;
        }

        if (progress === 1) {
          sim.moods.set("smug", sim.clock.now, { speak: false });
          return "complete";
        }

        break;
      }
    }

    return "running";
  }

  presentation(): RoutinePresentation {
    const scene = this.#state.current;

    if (!scene) {
      return {};
    }

    const now = this.#environment.clock.now;

    if (scene.phase === "flyby") {
      return { pose: Math.floor(now * 10) % 2 ? "wingUp" : "wingDown" };
    }

    const walking = ["chase", "return", "home"].includes(scene.phase);
    let pose: RoutinePresentation["pose"] = "tilt";

    if (walking) {
      pose = Math.floor(now * 9) % 2 ? "walkLeft" : "walkRight";
    }

    return {
      pose,
      props: [{
        id: "nest-play-treasure", asset: scene.item,
        x: scene.point.x - 12, y: scene.point.y - 12, width: 24, height: 24,
        rotation: scene.phase === "toss" ? (now - scene.started) * 540 : 0,
      }],
    };
  }

  #mouth(): Point {
    const body = this.#environment.body;
    return { x: body.x + beakOffsetX(body.facing), y: body.y + 48 };
  }

  #onScreen(point: Point): Point {
    const body = this.#environment.body;

    return {
      x: clamp(point.x, 12, body.width - 12),
      y: clamp(point.y, 12, body.height - 12),
    };
  }
}
