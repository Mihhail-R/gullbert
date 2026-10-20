import { enterPhase } from "../phase-timing.js";
import {
  scopeCapabilities,
  type BehaviorCapabilities,
} from "../capabilities.js";
import { dialogue } from "../dialogue.js";
import { beakOffsetX, clamp } from "../geometry.js";
import { Habits } from "../habits.js";
import type { MotivationState } from "../motivation.js";
import type { BoredomState } from "../boredom.js";
import type { Point, SceneProp, Trick } from "../model.js";
import { observe } from "../observation.js";
import type { Pose } from "../poses.js";
import type { ReadonlyValue } from "../presentation.js";
import type { RoutinePresentation, RecallOwner } from "../routine.js";
import type {
  LearningScene,
  LessonScene,
  EncoreScene,
  SnackRecallScene,
  Scene,
} from "../scenes.js";
import type { RecallReservation } from "../long-term-memory.js";

type Environment = Pick<
  BehaviorCapabilities,
  | "moods"
  | "motivation"
  | "pettiness"
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

/** Owns meal, play, and scratch consequences alongside their transient learned associations. */
export class LearningRoutine implements RecallOwner {
  #environment: Environment;
  #scene: LearningScene | null = null;
  #identity: object = Object.freeze({});
  #mealReward: Trick | null = null;
  #playUntil = 0;
  #habits = new Habits();

  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "moods",
      "motivation",
      "pettiness",
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

  /** Transfers an eligible performance to a new meal before its scene is interrupted. */
  replaceActivity(command: string): void {
    let reward: Trick | null = null;

    switch (command) {
      case "feed":
      case "feed_here":
        reward = this.rewardCandidate();
        break;
    }

    this.cancelAssociations();
    this.#mealReward = reward;
  }

  cancelAssociations(): void {
    this.#mealReward = null;
    this.#playUntil = 0;
  }

  resetHabits(): void {
    this.#habits.reset(this.#environment.clock.now);
  }

  ateMeal(point: Point): void {
    const sim = this.#environment;
    sim.pettiness.settle();
    sim.motivation.enjoyed("meal");

    const wasUnpaid = sim.belongings.snapshot().memory.unpaidTricks >= 2;

    sim.belongings.rememberMeal(point);
    sim.moods.settleOffence();

    const trick = this.#mealReward;
    this.#mealReward = null;

    if (trick) {
      const lessons = sim.belongings.rewardTrick(trick, point);
      let bank = lines.reinforced;

      if (lessons === 3) {
        bank = lines.learned;
      } else if (lessons >= 6) {
        bank = lines.mastered;
      }

      const performed = sim.belongings.snapshot().memory.performances[trick];
      const line = bank[(performed - 1) % bank.length];
      sim.speech.say(line, 4);
    }

    if (wasUnpaid && !trick) {
      sim.speech.say(lines.settled, 4);
    }

    this.#habits.ate(sim.clock.now);
  }

  /** Records history before scene completion; returns whether play benefits are due afterward. */
  rememberCompletion(scene: ReadonlyValue<Scene> | null): boolean {
    if (!scene) {
      return false;
    }

    let played = false;

    switch (scene.kind) {
      case "cap":
        played = scene.phase === "victory" && scene.rounds >= 3;
        break;

      case "toss":
        played = scene.phase === "eat";
        break;

      case "trick":
      case "habit":
      case "guest":
      case "gift":
        return false;
    }

    const sim = this.#environment;
    sim.belongings.remember(played ? "play" : "activity", scene.kind, sim.body);
    return played;
  }

  playCompleted(): void {
    const sim = this.#environment;
    sim.pettiness.settle();
    sim.motivation.enjoyed("play");

    this.#habits.played(sim.clock.now);
    this.#playUntil = sim.clock.now + 18;
    // Leave a quiet, touchable moment after a game, including the first lesson.
    sim.activity.settleUntil(sim.clock.now + 12);

    if (sim.belongings.snapshot().memory.learned.scratchesAfterPlay >= 3) {
      sim.speech.say(lines.scratchExpected, 4);
    }
  }

  scratched(): void {
    const sim = this.#environment;
    sim.pettiness.settle();
    sim.motivation.enjoyed("scratch");

    if (this.#playUntil <= sim.clock.now) {
      return;
    }

    this.#playUntil = 0;
    sim.belongings.rememberScratchAfterPlay();
    sim.belongings.remember("scratch", "after play", sim.body);

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

  maybeStart(motivation: Readonly<MotivationState>, boredom: BoredomState): boolean {
    const sim = this.#environment;

    if (
      !sim.policy.visible() ||
      sim.policy.settings().paused ||
      sim.policy.tidying()
    ) {
      return false;
    }

    const command = this.#habits.choose(
      sim.belongings.snapshot().memory,
      sim.clock.now,
      sim.policy.settings().mischief,
      sim.random,
      motivation,
      boredom,
    );

    if (!command) {
      return false;
    }

    sim.commands.action(command);
    return true;
  }

  start(name: string, point?: Point): boolean {
    const sim = this.#environment;

    if (name === "forget_learning") {
      this.cancelAssociations();
      this.resetHabits();
      sim.belongings.forgetLearning();
      sim.lifecycle.rest(3);
      sim.speech.say(lines.forgotten, 3);
      return true;
    }

    const memory = sim.belongings.snapshot().memory;
    const snackSpot = memory.learned.snackSpot;
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

    const requested = name.startsWith("trick_");
    const chosen = trick ?? "come";
    const practiced = memory.learned.tricks[chosen] >= 3;
    this.#scene = {
      kind,
      purpose: "lesson",
      trick: chosen,
      phase: "consider",
      phaseStarted: sim.clock.now,
      until: sim.clock.now + 1.1,
      origin,
      target,
      facing: sim.body.facing,
      practiced,
      unsolicited: name.startsWith("show_"),
      reluctant: requested && memory.unpaidTricks === 1,
    };

    if (practiced || habit) {
      this.#scene.until = sim.clock.now + 0.35;
    }

    this.#identity = Object.freeze({});
    sim.activity.beginRoutine(kind);

    if (requested && memory.unpaidTricks >= 2) {
      const refusals = sim.belongings.refuseTrick(sim.body);
      this.#scene.target = sim.body.safePoint({
        x: origin.x + sim.body.facing * 32,
        y: origin.y,
      });
      this.#phase("refuse", 2.5);
      sim.moods.set("offended", sim.clock.now, { speak: false });
      sim.speech.say(lines.refuse[(refusals - 1) % lines.refuse.length], 4);
      return true;
    }

    const performed = memory.performances[chosen];
    let bank = lines.consider[chosen];

    if (practiced) {
      bank = lines.perform[chosen];
    }

    let line = bank[performed % bank.length];

    if (habit) {
      line = lines.checkSpot;
    } else if (this.#scene.unsolicited) {
      line = lines.showoff;
    } else if (this.#scene.reluctant) {
      line = lines.reluctant[chosen];
    }

    sim.speech.say(line, 3);
    return true;
  }

  startRecall(recall: RecallReservation): boolean {
    const sim = this.#environment;
    const origin = { x: sim.body.x, y: sim.body.y };

    switch (recall.memory.kind) {
      case "snack":
        this.#scene = {
          kind: "habit",
          purpose: "old-snack-spot",
          recall: structuredClone(recall),
          phase: "recall-old",
          phaseStarted: sim.clock.now,
          until: sim.clock.now + 18,
          origin,
          target: sim.belongings.recallPoint(recall.memory.oldPosition),
        };
        break;

      case "trick":
        this.#scene = {
          kind: "trick",
          purpose: "encore",
          recall: structuredClone(recall),
          trick: recall.memory.trick,
          phase: "perform",
          phaseStarted: sim.clock.now,
          until: sim.clock.now + (recall.memory.trick === "spin" ? 2.5 : 3.5),
          origin,
          target: origin,
          facing: sim.body.facing,
          practiced: true,
          unsolicited: true,
          reluctant: false,
        };
        break;

      default:
        return false;
    }

    this.resize();
    this.cancelAssociations();
    this.#identity = Object.freeze({});
    sim.activity.beginRoutine(this.#scene.kind);
    return true;
  }

  resize(): void {
    const scene = this.#scene;

    if (!scene) {
      return;
    }

    const sim = this.#environment;
    scene.origin = sim.body.safePoint(scene.origin);
    scene.target = sim.body.safePoint(scene.target);

    if (scene.purpose === "old-snack-spot" && scene.recall.memory.kind === "snack") {
      const memory = scene.recall.memory;
      const position = scene.phase === "recall-current"
        ? memory.currentPosition
        : memory.oldPosition;
      scene.target = sim.belongings.recallPoint(position);
    }
  }

  update(dt: number): "running" | "complete" {
    const sim = this.#environment;
    const scene = this.#scene;

    if (!scene) {
      return "complete";
    }

    if (scene.purpose === "old-snack-spot") {
      return this.#updateSnackRecall(scene, dt);
    }

    switch (scene.phase) {
      case "refuse":
        if (sim.belongings.snapshot().memory.unpaidTricks === 0) {
          this.#finish();
          break;
        }

        if (sim.clock.now - scene.phaseStarted < 1) {
          sim.body.moveToward(scene.target, 32, dt);
        }

        if (sim.clock.now >= scene.until) {
          this.#protest();
        }

        break;

      case "consider":
        if (sim.clock.now >= scene.until) {
          const durations = { come: 18, spin: 2.5, dead: 3.5 };
          const pace = scene.reluctant ? 2.4 : 1;
          this.#phase("perform", durations[scene.trick] * pace);
        }

        break;

      case "perform":
        this.#perform(scene, dt);
        break;

      case "pleased":
        if (sim.clock.now >= scene.until) {
          sim.belongings.completeRecall(scene.recall, sim.body);
          this.#finish();
        }

        break;

      case "reward":
      case "check":
        if (sim.clock.now >= scene.until) {
          if (scene.phase === "reward") {
            sim.speech.say(lines.unpaid, 3);
          }

          this.#finish();
        }

        break;
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
    // Meal associations outlive the trick scene; replacement or cancellation owns them.
    this.clear();
  }
  visibility(visible: boolean): void {
    if (!visible) {
      this.cancelAssociations();
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

    if (scene.purpose === "old-snack-spot") {
      if (scene.phase === "recall-tilt") {
        return { pose: "tilt" };
      }

      const cycle = ["idle", "walkLeft", "idle", "walkRight"] as const;
      return { pose: cycle[Math.floor(sim.body.motionTime * 8) % cycle.length] };
    }

    if (scene.phase === "refuse") {
      return this.#invoice(scene);
    }

    if (scene.phase === "pleased") {
      return { pose: "blink" };
    }

    let pose: Pose = "tilt";
    let rotation = 0;

    if (scene.phase === "perform") {
      if (scene.trick === "dead") {
        const pace = scene.reluctant ? 2.4 : 1;
        const elapsed = (sim.clock.now - scene.phaseStarted) / pace;
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

  #updateSnackRecall(scene: SnackRecallScene, dt: number): "running" | "complete" {
    const sim = this.#environment;

    if (scene.phase === "recall-tilt") {
      if (sim.clock.now < scene.until) {
        return "running";
      }

      if (scene.recall.memory.kind !== "snack") {
        this.#finish();
        return "complete";
      }

      scene.target = sim.belongings.recallPoint(scene.recall.memory.currentPosition);
      this.#phase("recall-current", 18);
      return "running";
    }

    if (sim.clock.now >= scene.until) {
      this.#finish();
      return "complete";
    }

    if (!sim.body.moveToward(scene.target, 150, dt)) {
      return "running";
    }

    if (scene.phase === "recall-old") {
      this.#phase("recall-tilt", 2);
      sim.speech.say(lines.snackRecall, 2);
      return "running";
    }

    sim.belongings.completeRecall(scene.recall, sim.body);
    this.#finish();
    return "complete";
  }

  #invoice(scene: LessonScene): RoutinePresentation {
    const sim = this.#environment;
    const elapsed = sim.clock.now - scene.phaseStarted;
    const dragging = elapsed < 1;
    const pecking = !dragging && Math.floor((elapsed - 1) * 4) % 2 === 0;
    const width = Math.min(88, sim.body.width);
    const height = Math.min(42, sim.body.height);
    const beakX = sim.body.x + beakOffsetX(sim.body.facing);
    const paper: SceneProp = {
      id: "snack-invoice",
      asset: "snack-invoice",
      text: lines.invoice,
      x: clamp(beakX - width / 2, 0, sim.body.width - width),
      y: clamp(sim.body.y + 50, 0, sim.body.height - height),
      width,
      height,
      rotation: dragging ? -sim.body.facing * 6 : 0,
    };
    let pose: Pose = "bag-offended";

    if (dragging || pecking) {
      pose = "nibble";
    }

    return { pose, props: [paper], rotation: pecking ? sim.body.facing * 4 : 0 };
  }

  #perform(scene: LessonScene | EncoreScene, dt: number): void {
    const sim = this.#environment;
    const pace = scene.reluctant ? 2.4 : 1;
    const elapsed = (sim.clock.now - scene.phaseStarted) / pace;

    switch (scene.trick) {
      case "come": {
        const speed = scene.practiced ? 270 : 150;

        if (sim.body.moveToward(scene.target, speed / pace, dt)) {
          this.#performed();
        } else if (sim.clock.now >= scene.until) {
          // Never offer reinforcement for a destination he did not reach.
          this.#finish();
        }

        break;
      }

      case "spin": {
        const angle = clamp(elapsed / 2.5, 0, 1) * Math.PI * 2;
        sim.body.place(
          sim.body.safePoint({
            x: scene.origin.x + Math.sin(angle) * 14,
            y: scene.origin.y + (1 - Math.cos(angle)) * 6,
          }),
        );
        sim.body.face(Math.cos(angle) >= 0 ? scene.facing : -scene.facing);
        sim.body.advanceMotion(dt / pace);

        if (sim.clock.now >= scene.until) {
          sim.body.place(sim.body.safePoint(scene.origin));
          this.#performed();
        }

        break;
      }

      case "dead":
        if (sim.clock.now >= scene.until) {
          this.#performed();
        }

        break;
    }
  }

  #phase(phase: LearningScene["phase"], duration: number): void {
    const scene = this.#scene!;
    enterPhase(scene, phase, this.#environment.clock.now, duration);
  }
  #performed(): void {
    const scene = this.#scene;

    if (!scene || scene.purpose === "old-snack-spot") {
      return;
    }

    const sim = this.#environment;

    if (scene.purpose === "encore") {
      this.#phase("pleased", 3);
      sim.speech.say(lines.encore, 3);
      return;
    }

    if (scene.kind === "habit") {
      this.#phase("check", 3);
      sim.speech.say(lines.emptySpot, 3);
      return;
    }

    const trick = scene.trick;
    sim.belongings.performed(trick, sim.body, !scene.unsolicited);
    const performed = sim.belongings.snapshot().memory.performances[trick];
    this.#phase("reward", 20);
    let line = lines.reward[(performed - 1) % lines.reward.length];

    if (scene.reluctant) {
      line = lines.reluctantReward;
    }

    sim.speech.say(line, 20);
  }
  #protest(): void {
    const sim = this.#environment;
    const refusals = sim.belongings.snapshot().memory.trickRefusals;
    const settings = sim.policy.settings();
    this.#finish();

    if (settings.paused || settings.mischief <= 0 || !sim.policy.visible()) {
      return;
    }

    if (refusals < 2) {
      return;
    }

    if (settings.mischief >= 2 && refusals % 2 === 1) {
      sim.commands.action("nibble_cursor");
      sim.speech.say(lines.collectPayment, 3);
    } else {
      sim.commands.action("pretend_leave");
      sim.speech.say(lines.movingOut, 3);
    }
  }

  #finish(): void {
    this.#environment.lifecycle.complete();
    this.#environment.lifecycle.rest(4);
  }
}
