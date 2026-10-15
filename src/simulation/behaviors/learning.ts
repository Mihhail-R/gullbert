import {
  scopeCapabilities,
  type BehaviorCapabilities,
} from "../capabilities.js";
import { dialogue } from "../dialogue.js";
import { clamp } from "../geometry.js";
import type { Point, Trick } from "../model.js";
import { observe } from "../observation.js";
import type { Pose } from "../poses.js";
import type { ReadonlyValue } from "../presentation.js";
import type { RoutinePresentation, SceneOwner } from "../routine.js";
import type { LearningScene, Scene } from "../scenes.js";

type Environment = Pick<
  BehaviorCapabilities,
  | "body"
  | "clock"
  | "belongings"
  | "activity"
  | "speech"
  | "lifecycle"
  | "policy"
  | "commands"
  | "random"
>;
const lines = dialogue.gullbert.learning;
const commands: Partial<Record<string, Trick>> = {
  trick_come: "come",
  trick_spin: "spin",
  trick_dead: "dead",
  show_spin: "spin",
  show_dead: "dead",
};

/** Reward associations last for one interaction; only earned lessons are durable. */
export class LearningRoutine implements SceneOwner {
  #environment: Environment;
  #scene: LearningScene | null = null;
  #identity: object = Object.freeze({});
  #mealReward: Trick | null = null;
  #playUntil = 0;
  #nextHabit = 90;

  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "body",
      "clock",
      "belongings",
      "activity",
      "speech",
      "lifecycle",
      "policy",
      "commands",
      "random",
    ]);
  }

  get scene(): ReadonlyValue<LearningScene> | null {
    return observe(this.#scene);
  }
  get identity(): object {
    return this.#identity;
  }
  install(scene: ReadonlyValue<Scene>): void {
    this.#scene = structuredClone(scene) as LearningScene;
    this.#identity = Object.freeze({});
    this.resize();
  }
  clear(): void {
    this.#scene = null;
  }

  rewardCandidate(): Trick | null {
    if (
      this.#scene?.kind === "trick" &&
      this.#scene.phase === "reward" &&
      this.#environment.clock.now < this.#scene.until
    ) {
      return this.#scene.trick;
    }
    return null;
  }

  offerReward(trick: Trick | null): void {
    this.#mealReward = trick;
  }

  cancelAssociations(): void {
    this.#mealReward = null;
    this.#playUntil = 0;
  }

  ateChip(point: Point): void {
    const sim = this.#environment;
    sim.belongings.rememberMeal(point);
    const trick = this.#mealReward;
    this.#mealReward = null;
    if (trick) {
      const lessons = sim.belongings.rewardTrick(trick);
      let line = lines.reinforced;
      if (lessons === 3) {
        line = lines.learned;
      } else if (lessons >= 6) {
        line = lines.mastered;
      }
      sim.speech.say(line, 4);
    }
    this.#nextHabit = Math.max(this.#nextHabit, sim.clock.now + 90);
  }

  playCompleted(): void {
    const sim = this.#environment;
    this.#playUntil = sim.clock.now + 18;
    // Leave a quiet, touchable moment after a game, including the first lesson.
    sim.activity.settleUntil(sim.clock.now + 12);
    if (sim.belongings.snapshot().memory.learned.scratchesAfterPlay >= 3) {
      sim.speech.say(lines.scratchExpected, 4);
    }
  }

  scratched(): void {
    const sim = this.#environment;
    if (this.#playUntil <= sim.clock.now) {
      return;
    }
    this.#playUntil = 0;
    sim.belongings.rememberScratchAfterPlay();
    if (sim.belongings.snapshot().memory.learned.scratchesAfterPlay === 3) {
      sim.speech.say(lines.scratchLearned, 4);
    }
  }

  expectationPose(): Pose | null {
    const sim = this.#environment;
    if (
      sim.activity.mode === "idle" &&
      sim.clock.now < this.#playUntil &&
      sim.belongings.snapshot().memory.learned.scratchesAfterPlay >= 3
    ) {
      return "tilt";
    }
    return null;
  }

  maybeStart(): boolean {
    const sim = this.#environment;
    if (
      !sim.policy.visible() ||
      sim.policy.settings().paused ||
      sim.policy.tidying() ||
      sim.clock.now < this.#nextHabit
    ) {
      return false;
    }
    const learned = sim.belongings.snapshot().memory.learned;
    const choices: string[] = [];
    if (learned.snackSpot && learned.snackSpot.meals >= 3) {
      choices.push("habit_snack");
    }
    if (sim.policy.settings().mischief > 0) {
      for (const trick of ["spin", "dead"] as const) {
        if (learned.tricks[trick] >= 3) {
          choices.push(`show_${trick}`);
        }
      }
    }
    if (!choices.length) {
      return false;
    }
    const command =
      choices[
        Math.min(choices.length - 1, Math.floor(sim.random() * choices.length))
      ];
    this.#nextHabit = sim.clock.now + 120 + sim.random() * 90;
    sim.commands.action(command);
    return true;
  }

  start(name: string, point?: Point): boolean {
    const sim = this.#environment;
    if (name === "forget_learning") {
      this.cancelAssociations();
      sim.belongings.forgetLearning();
      sim.lifecycle.rest(3);
      sim.speech.say(lines.forgotten, 3);
      return true;
    }
    const snackSpot = sim.belongings.snapshot().memory.learned.snackSpot;
    const habit = name === "habit_snack" && snackSpot !== null;
    const trick = commands[name];
    if (!habit && !trick) {
      return false;
    }
    if (point && (!Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      sim.lifecycle.rest();
      return true;
    }
    const origin = { x: sim.body.x, y: sim.body.y };
    let target = origin;
    if (habit && snackSpot) {
      target = sim.body.safePoint(snackSpot);
    } else if (point) {
      target = sim.body.safePoint({ x: point.x - 48, y: point.y - 78 });
    }
    let kind: LearningScene["kind"] = "trick";
    if (habit) {
      kind = "habit";
    }
    const chosen = trick ?? "come";
    const practiced =
      sim.belongings.snapshot().memory.learned.tricks[chosen] >= 3;
    this.#scene = {
      kind,
      trick: chosen,
      phase: "consider",
      phaseStarted: sim.clock.now,
      until: sim.clock.now + 1.1,
      origin,
      target,
      facing: sim.body.facing,
      practiced,
      unsolicited: name.startsWith("show_"),
    };
    if (practiced || habit) {
      this.#scene.until = sim.clock.now + 0.35;
    }
    this.#identity = Object.freeze({});
    sim.activity.beginRoutine(kind);
    let line = lines.consider[chosen];
    if (habit) {
      line = lines.checkSpot;
    } else if (this.#scene.unsolicited) {
      line = lines.showoff;
    } else if (practiced) {
      line = lines.perform[chosen];
    }
    sim.speech.say(line, 3);
    return true;
  }

  resize(): void {
    if (this.#scene) {
      this.#scene.target = this.#environment.body.safePoint(this.#scene.target);
      this.#scene.origin = this.#environment.body.safePoint(this.#scene.origin);
    }
  }

  update(dt: number): "running" | "complete" {
    const sim = this.#environment;
    const scene = this.#scene;
    if (!scene) {
      return "complete";
    }
    if (scene.phase === "consider" && sim.clock.now >= scene.until) {
      let duration = 2.5;
      if (scene.trick === "come") {
        duration = 18;
      } else if (scene.trick === "dead") {
        duration = 3.5;
      }
      this.#phase("perform", duration);
    } else if (scene.phase === "perform") {
      const elapsed = sim.clock.now - scene.phaseStarted;
      if (scene.trick === "come") {
        let speed = 150;
        if (scene.practiced) {
          speed = 270;
        }
        if (sim.body.moveToward(scene.target, speed, dt)) {
          this.#performed();
        } else if (sim.clock.now >= scene.until) {
          // Never offer reinforcement for a destination he did not reach.
          this.#finish();
        }
      } else if (scene.trick === "spin") {
        const angle = clamp(elapsed / 2.5, 0, 1) * Math.PI * 2;
        sim.body.place(
          sim.body.safePoint({
            x: scene.origin.x + Math.sin(angle) * 14,
            y: scene.origin.y + (1 - Math.cos(angle)) * 6,
          }),
        );
        if (Math.cos(angle) >= 0) {
          sim.body.face(scene.facing);
        } else {
          sim.body.face(-scene.facing);
        }
        sim.body.advanceMotion(dt);
        if (sim.clock.now >= scene.until) {
          sim.body.place(sim.body.safePoint(scene.origin));
          this.#performed();
        }
      } else if (sim.clock.now >= scene.until) {
        this.#performed();
      }
    } else if (sim.clock.now >= scene.until) {
      if (scene.phase === "reward") {
        sim.speech.say(lines.unpaid, 3);
      }
      this.#finish();
    }
    if (!this.#scene) {
      return "complete";
    }
    return "running";
  }

  complete(): void {
    this.clear();
  }
  interrupt(): void {
    this.clear();
    this.cancelAssociations();
  }
  visibility(visible: boolean): void {
    if (!visible) {
      this.#environment.lifecycle.interrupt();
      this.#environment.lifecycle.rest(3);
    }
  }

  presentation(): RoutinePresentation {
    const scene = this.#scene;
    if (!scene) {
      return {};
    }
    const sim = this.#environment;
    let pose: Pose = "tilt";
    let rotation = 0;
    if (scene.phase === "perform") {
      if (scene.trick === "dead") {
        const elapsed = sim.clock.now - scene.phaseStarted;
        rotation = 85 * clamp(elapsed / 0.6, 0, 1) * scene.facing;
        pose = "nap-sleep";
        if (!scene.practiced && elapsed > 1.6 && elapsed < 2.2) {
          pose = "blink";
        }
      } else {
        pose = (["idle", "walkLeft", "idle", "walkRight"] as const)[
          Math.floor(sim.body.motionTime * 12) % 4
        ];
      }
    }
    return { pose, rotation };
  }

  #phase(phase: LearningScene["phase"], duration: number): void {
    const scene = this.#scene!;
    scene.phase = phase;
    scene.phaseStarted = this.#environment.clock.now;
    scene.until = scene.phaseStarted + duration;
  }
  #performed(): void {
    const sim = this.#environment;
    if (this.#scene?.kind === "habit") {
      this.#phase("check", 3);
      sim.speech.say(lines.emptySpot, 3);
    } else {
      this.#phase("reward", 20);
      sim.speech.say(lines.reward, 20);
    }
  }
  #finish(): void {
    this.#environment.lifecycle.complete();
    this.#environment.lifecycle.rest(4);
  }
}
