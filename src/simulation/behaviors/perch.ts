import { dialogue } from "../dialogue.js";
import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import { scopeCapabilities } from "../capabilities.js";
import type { Pose } from "../poses.js";
import type { Point } from "../model.js";
import type { SimulationView, BehaviorCapabilities } from "../capabilities.js";
import type { SceneOwner } from "../routine.js";
import type { Scene, PerchScene as OwnedScene } from "../scenes.js";

export function perchPose(
  sim: Pick<SimulationView, "scene" | "motionTime" | "time">,
): Pose | null {
  const scene = sim.scene;
  if (scene?.kind !== "perch") {
    return null;
  }
  if (scene.phase === "approach") {
    return (["idle", "walkLeft", "idle", "walkRight"] as const)[
      Math.floor(sim.motionTime * 9) % 4
    ];
  }
  if (scene.phase === "settle") {
    if (scene.until - sim.time > 0.5) {
      return "crouch";
    } else {
      return "blink";
    }
  }
  if (sim.time % 4 > 3.4) {
    return "blink";
  } else {
    return "idle";
  }
}

type Environment = Pick<
  BehaviorCapabilities,
  | "belongings"
  | "lifecycle"
  | "speech"
  | "clock"
  | "activity"
  | "random"
  | "body"
  | "policy"
  | "commands"
>;
export class PerchRoutine implements SceneOwner {
  #environment: Environment;
  #scene: OwnedScene | null = null;
  #identity: object = Object.freeze({});
  #nextPerchVisit = 0;
  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "belongings",
      "lifecycle",
      "speech",
      "clock",
      "activity",
      "random",
      "body",
      "policy",
      "commands",
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
  start(name: string, point?: Point): boolean {
    const handled = this.#startPerch(name, point);
    if (handled && this.#scene) {
      this.#identity = Object.freeze({});
    }
    return handled;
  }
  update(dt: number): "running" | "complete" {
    this.#stepPerch(dt);
    if (!this.#scene) {
      return "complete";
    }
    return "running";
  }
  complete(): void {
    this.#scene = null;
  }
  presentation() {
    const sim = this.#environment;
    return {
      pose:
        perchPose({
          ...sim.body.snapshot(),
          ...sim.activity.snapshot(),
          time: sim.clock.now,
          scene: this.#scene,
        }) ?? undefined,
    };
  }
  interrupt(): void {
    this.#scene = null;
  }
  visibility(): void {}
  get nextPerchVisit() {
    return this.#nextPerchVisit;
  }
  scheduleFirstVisit(): void {
    this.#nextPerchVisit =
      this.#environment.clock.now + 60 + this.#environment.random() * 60;
  }
  #beginVisit() {
    const sim = this.#environment;
    if (!sim.belongings.snapshot().memory.perch) {
      sim.lifecycle.rest(3);
      sim.speech.say(dialogue.gullbert.perch.pickMyLoiteringSpotFirst);
      return;
    }
    this.#scene = {
      kind: "perch",
      phase: "approach",
      until: sim.clock.now + 30,
    };
    sim.activity.beginRoutine("perch");
    this.#nextPerchVisit = sim.clock.now + 90 + sim.random() * 60;
    sim.speech.say(dialogue.gullbert.perch.myUsualSpot);
  }
  #startPerch(name: string, point?: Point) {
    const sim = this.#environment;
    if (name === "clear_perch") {
      if (sim.belongings.snapshot().memory.perch) {
        sim.belongings.clearPerch();
      }
      sim.lifecycle.rest(3);
      sim.speech.say(dialogue.gullbert.perch.loiteringRightsRevoked);
      return true;
    }
    if (name === "place_perch") {
      // Placement points mark his feet; persisted points locate the whole sprite.
      let perchX;
      if (point && Number.isFinite(point.x)) {
        perchX = point.x;
      } else {
        perchX = sim.body.x + 48;
      }
      let perchY;
      if (point && Number.isFinite(point.y)) {
        perchY = point.y;
      } else {
        perchY = sim.body.y + 86;
      }
      sim.belongings.placePerch(
        sim.body.safePoint({
          x: perchX - 48,
          y: perchY - 86,
        }),
      );

      this.#beginVisit();
      return true;
    }
    if (name !== "perch") {
      return false;
    }
    this.#beginVisit();
    return true;
  }
  #stepPerch(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;
    if (scene?.kind !== "perch") {
      return false;
    }
    const perch = sim.belongings.snapshot().memory.perch;
    if (!perch) {
      sim.lifecycle.complete();
      sim.lifecycle.rest(3);
      return true;
    }
    if (scene.phase === "approach") {
      if (sim.body.moveToward(perch, 150, dt)) {
        scene.phase = "settle";
        scene.until = sim.clock.now + 1.2;
        sim.body.resetMotion();
        sim.speech.say(dialogue.gullbert.perch.reservedForMe);
      } else if (sim.clock.now >= scene.until) {
        sim.lifecycle.complete();
        sim.lifecycle.rest(3);
      }
    } else if (scene.phase === "settle" && sim.clock.now >= scene.until) {
      scene.phase = "loiter";
      scene.until = sim.clock.now + 6;
    } else if (scene.phase === "loiter" && sim.clock.now >= scene.until) {
      sim.lifecycle.complete();
      sim.lifecycle.rest(5);
      sim.activity.settleUntil(sim.clock.now + 5);
      this.#nextPerchVisit = sim.clock.now + 90 + sim.random() * 60;
    }
    return true;
  }
  maybeVisitPerch() {
    const sim = this.#environment;
    if (!sim.policy.visible() || sim.policy.settings().paused) {
      return false;
    }
    if (sim.activity.mode !== "idle" || this.#scene) {
      return false;
    }
    if (!sim.belongings.snapshot().memory.perch) {
      return false;
    }
    if (
      sim.clock.now < sim.activity.until ||
      sim.clock.now < sim.activity.calmUntil ||
      sim.clock.now < this.#nextPerchVisit
    ) {
      return false;
    }
    this.#nextPerchVisit = sim.clock.now + 90 + sim.random() * 60;
    if (sim.random() >= 0.4) {
      return false;
    }
    sim.commands.action("perch");
    return true;
  }
}
