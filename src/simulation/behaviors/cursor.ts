import { dialogue } from "../dialogue.js";
import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import { scopeCapabilities } from "../capabilities.js";
import { isPointOnScreen, beakOffsetX } from "../geometry.js";
import type { Point, PointerSample } from "../model.js";
import type { Pose } from "../poses.js";
import type { SimulationView, BehaviorCapabilities } from "../capabilities.js";
import type { SceneOwner } from "../routine.js";
import type { Scene, CursorScene as OwnedScene } from "../scenes.js";
export function cursorBeak(sim: Readonly<Point> & { readonly facing: number }) {
  return { x: sim.x + beakOffsetX(sim.facing), y: sim.y + 48 };
}
export function cursorPose(
  sim: Pick<SimulationView, "scene" | "motionTime">,
): Pose | null {
  const scene = sim.scene;

  if (scene?.kind !== "cursor") {
    return null;
  }

  if (scene.phase === "stare") {
    return "tilt";
  }

  if (scene.phase === "peck" || scene.phase === "chew") {
    return "nibble";
  }

  if (scene.phase === "recoil") {
    return "nap-startle";
  }

  return (["idle", "walkLeft", "idle", "walkRight"] as const)[
    Math.floor(sim.motionTime * 14) % 4
  ];
}

/** Pickup chooses the reaction and budget; Cursor owns its execution. */
export interface CursorRetaliation {
  readonly reaction: "chase" | "trail";
  readonly deadlineSeconds: number;
  readonly expiresAtMs: number;
  readonly pointer: Point | null;
  readonly cursorId?: number;
}

type Environment = Pick<
  BehaviorCapabilities,
  | "food"
  | "policy"
  | "lifecycle"
  | "speech"
  | "clock"
  | "activity"
  | "body"
  | "objects"
  | "commands"
  | "events"
>;
export class CursorRoutine implements SceneOwner {
  #environment: Environment;
  #scene: OwnedScene | null = null;
  #identity: object = Object.freeze({});

  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "food",
      "policy",
      "lifecycle",
      "speech",
      "clock",
      "activity",
      "body",
      "objects",
      "commands",
      "events",
    ]);
  }
  get scene(): ReadonlyValue<OwnedScene> | null {
    return observe(this.#scene);
  }

  get identity(): object {
    return this.#identity;
  }
  install(scene: ReadonlyValue<Scene>): void {
    this.#scene = structuredClone(scene) as OwnedScene;
    this.#identity = Object.freeze({});
  }
  clear(): void {
    this.#scene = null;
  }
  start(name: string): boolean {
    const handled = this.#startCursor(name);

    if (handled && this.#scene) {
      this.#identity = Object.freeze({});
    }

    return handled;
  }
  update(dt: number): "running" | "complete" {
    this.#stepCursor(dt);

    if (!this.#scene) {
      return "complete";
    }

    return "running";
  }
  complete(): void {
    this.#deferEncounter();
    this.#scene = null;
  }
  presentation() {
    const sim = this.#environment;
    const observation = {
      ...sim.body.snapshot(),
      ...sim.activity.snapshot(),
      time: sim.clock.now,
      scene: this.#scene,
    };
    return {
      pose: cursorPose(observation) ?? undefined,
    };
  }
  interrupt(): void {
    this.#deferEncounter();
    this.#scene = null;
  }
  visibility(visible: boolean): void {
    if (!visible && this.#scene) {
      this.#environment.lifecycle.interrupt();
      this.#environment.lifecycle.rest();
    }
  }

  #deferEncounter(): void {
    if (this.#scene) {
      this.#environment.food.deferEncounter(this.#environment.clock.now);
    }
  }

  #startCursor(name: string) {
    const sim = this.#environment;

    if (!["nibble_cursor", "eat_cursor"].includes(name)) {
      return false;
    }

    sim.food.clearRequest();

    if (sim.policy.settings().paused || !sim.policy.visible()) {
      sim.lifecycle.rest();
      sim.speech.say(dialogue.gullbert.cursor.pointerInspectionOnHold);
      return true;
    }

    this.#scene = {
      kind: "cursor",
      takeover: name === "eat_cursor",
      phase: "stare",
      started: sim.clock.now,
      until: sim.clock.now + 0.8,
      deadline: sim.clock.now + 8,
      pointer: null,
    };
    sim.activity.beginRoutine("cursor");
    sim.speech.say(dialogue.gullbert.cursor.chip, 1.6);
    return true;
  }
  pointerSample(point: PointerSample | null) {
    const sim = this.#environment;
    const scene = this.#scene;

    if (scene?.kind !== "cursor") {
      return;
    }

    if (
      !point ||
      point.inside === false ||
      !isPointOnScreen(point, sim.body.width, sim.body.height)
    ) {
      sim.lifecycle.complete();
      sim.lifecycle.rest();

      if (point) {
        sim.speech.say(dialogue.gullbert.cursor.tooSlippery);
      } else {
        sim.speech.say(dialogue.gullbert.cursor.whereDidItGo);
      }

      return;
    }

    scene.pointer = { x: point.x, y: point.y };
  }
  #finish(text: string) {
    const sim = this.#environment;
    sim.lifecycle.complete();
    sim.lifecycle.rest(3);
    sim.speech.say(text, 2.5);
  }
  releaseCursor(text = dialogue.gullbert.cursor.notAChip) {
    const sim = this.#environment;

    if (this.#scene?.kind !== "cursor") {
      return;
    }

    this.#scene.phase = "recoil";
    this.#scene.until = sim.clock.now + 1.35;

    if (this.#scene.retaliation && text === dialogue.gullbert.cursor.notAChip) {
      sim.speech.say(dialogue.gullbert.cursor.considerUsEven, 2);
    } else {
      sim.speech.say(text, 2);
    }
  }

  authorize(id: number): boolean {
    if (!this.#scene?.takeover || !Number.isFinite(id)) {
      return false;
    }

    this.#scene.cursorId = id;
    return true;
  }

  /** Prepare a handoff for activation through the shared scene registry. */
  createRetaliationScene(reaction: CursorRetaliation): OwnedScene {
    const now = this.#environment.clock.now;
    return {
      kind: "cursor",
      phase: "stare",
      takeover: true,
      started: now,
      until: now + 0.5,
      deadline: reaction.deadlineSeconds,
      pointer: reaction.pointer,
      retaliation: true,
      retaliationUntilMs: reaction.expiresAtMs,
      cursorId: reaction.cursorId,
      trail: reaction.reaction === "trail" ? 3 : 0,
      nextSplat: now + 0.8,
    };
  }

  /** Run before touch handling and movement, even when either consumes the tick. */
  maintainRetaliation(nowMs: number): void {
    const scene = this.#scene;

    if (!scene?.retaliation) {
      return;
    }

    const sim = this.#environment;

    if (nowMs >= (scene.retaliationUntilMs ?? Infinity)) {
      sim.lifecycle.interrupt();
      sim.lifecycle.rest();
      return;
    }

    const remainingSplats = scene.trail ?? 0;

    if (scene.phase !== "stalk" || remainingSplats <= 0) {
      return;
    }

    if (sim.clock.now < (scene.nextSplat ?? 0)) {
      return;
    }

    sim.objects.scatter(
      { x: sim.body.x + 48, y: sim.body.y + 86 },
      sim.clock.now,
      0.8,
    );
    sim.events.emit("plop");
    scene.trail = remainingSplats - 1;
    scene.nextSplat = sim.clock.now + 1.8;
  }

  #stepCursor(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;

    if (scene?.kind !== "cursor") {
      return false;
    }

    if (sim.clock.now >= scene.deadline) {
      this.#finish(dialogue.gullbert.cursor.notWorthTheEffort);
      return true;
    }

    if ((sim.objects.snapshot().bag?.servings ?? 0) > 0) {
      sim.commands.action("search_snack");
      return true;
    }

    if (!scene.pointer) {
      if (sim.clock.now - scene.started >= 1.5) {
        this.#finish(dialogue.gullbert.cursor.whereDidItGo);
      }

      return true;
    }

    switch (scene.phase) {
      case "stare": {
        if (scene.pointer.x >= sim.body.x + 48) {
          sim.body.face(1 as -1 | 1);
        } else {
          sim.body.face(-1 as -1 | 1);
        }

        if (sim.clock.now >= scene.until) {
          scene.phase = "stalk";
        }

        break;
      }

      case "stalk": {
        let facing;

        if (scene.pointer.x >= sim.body.x + 48) {
          facing = 1;
        } else {
          facing = -1;
        }

        const target = {
          x: scene.pointer.x - beakOffsetX(facing),
          y: scene.pointer.y - 48,
        };
        sim.body.moveToward(target, 210, dt);
        sim.body.face(facing as -1 | 1);
        const beak = {
          x: sim.body.x + beakOffsetX(facing),
          y: sim.body.y + 48,
        };

        if (
          Math.hypot(beak.x - scene.pointer.x, beak.y - scene.pointer.y) < 27
        ) {
          scene.phase = "peck";
          scene.until = sim.clock.now + 0.38;

          if (scene.retaliation) {
            sim.speech.say(dialogue.gullbert.cursor.gotYou, 0.65);
          } else {
            sim.speech.say(dialogue.gullbert.cursor.nom, 0.65);
          }
        }

        break;
      }

      case "peck": {
        if (sim.clock.now >= scene.until) {
          const beak = cursorBeak(sim.body);

          if (
            Math.hypot(beak.x - scene.pointer.x, beak.y - scene.pointer.y) >= 27
          ) {
            scene.phase = "stalk";

            if (scene.retaliation) {
              sim.speech.say(dialogue.gullbert.cursor.comeBackHere, 1);
            } else {
              sim.speech.say(dialogue.gullbert.cursor.holdStillLunch, 1);
            }

            return true;
          }

          if (scene.takeover && scene.deadline - sim.clock.now > 1.3) {
            scene.phase = "chew";
            scene.caughtAt = sim.clock.now;
            scene.until = sim.clock.now + 1.2;
            sim.speech.say(dialogue.gullbert.cursor.mineEscToEscape, 1.2);
            sim.events.emit("munch");
            return true;
          }

          this.releaseCursor();
          sim.body.moveToward(
            { x: sim.body.x - sim.body.facing * 14, y: sim.body.y },
            140,
            0.1,
          );
          sim.speech.say(dialogue.gullbert.cursor.notAChip, 2);
          sim.events.emit("munch");
        }

        break;
      }

      case "chew": {
        if (sim.clock.now >= scene.until) {
          this.releaseCursor();
        } else {
          const facing = sim.body.facing;
          sim.body.moveToward(
            { x: sim.body.x - facing * 30, y: sim.body.y },
            30,
            dt,
          );
          sim.body.face(facing as -1 | 1);
        }

        break;
      }

      case "recoil": {
        if (sim.clock.now >= scene.until) {
          if (scene.retaliation) {
            this.#finish(dialogue.gullbert.cursor.considerUsEven);
          } else {
            this.#finish(dialogue.gullbert.cursor.notAChip);
          }
        }

        break;
      }
    }

    return true;
  }
}
