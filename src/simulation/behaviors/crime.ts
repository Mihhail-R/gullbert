import { dialogue } from "../dialogue.js";
import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import { scopeCapabilities } from "../capabilities.js";
import type { CrimeScene } from "../scenes.js";
import type { Pose } from "../poses.js";
import type { SimulationView, BehaviorCapabilities } from "../capabilities.js";
import type { SceneOwner } from "../routine.js";
import type { Scene, CrimeScene as OwnedScene } from "../scenes.js";
import { attachBag, bagGoal } from "./snacks.js";

export function crimePose(
  sim: Pick<SimulationView, "scene" | "motionTime" | "time">,
): Pose | null {
  const scene = sim.scene;
  if (!scene || (scene.kind !== "theft" && scene.kind !== "caper")) {
    return null;
  }
  if (scene.phase === "approach") {
    return (["idle", "walkLeft", "idle", "walkRight"] as const)[
      Math.floor(sim.motionTime * 10) % 4
    ];
  }
  if (scene.kind === "theft") {
    if (["innocent", "suspicious"].includes(scene.phase)) {
      return "theft-innocent";
    }
    if (scene.phase === "drag") {
      return (["theft-grip", "walkLeft", "theft-grip", "walkRight"] as const)[
        Math.floor(sim.motionTime * 8) % 4
      ];
    }
    if (scene.phase === "grab") {
      return "theft-grip";
    } else {
      return "bag-offended";
    }
  }
  if (scene.phase === "panic") {
    if (Math.floor(sim.motionTime * 12) % 2) {
      return "bag-panic";
    } else {
      return "bag-trapped";
    }
  }
  if (scene.phase === "shake") {
    if (Math.floor((sim.time - scene.phaseStarted) * 12) % 2) {
      return "bag-shake";
    } else {
      return "bag-panic";
    }
  }
  return (
    (
      {
        inspect: "bag-inspect",
        trapped: "bag-trapped",
        offended: "bag-offended",
      } as Partial<Record<CrimeScene["phase"], Pose>>
    )[scene.phase] ?? "idle"
  );
}

type Environment = Pick<
  BehaviorCapabilities,
  | "objects"
  | "lifecycle"
  | "speech"
  | "clock"
  | "body"
  | "activity"
  | "food"
  | "events"
>;
export class CrimeRoutine implements SceneOwner {
  #environment: Environment;
  #scene: OwnedScene | null = null;
  #identity: object = Object.freeze({});

  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "objects",
      "lifecycle",
      "speech",
      "clock",
      "body",
      "activity",
      "food",
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
    const handled = this.#startCrime(name);
    if (handled && this.#scene) {
      this.#identity = Object.freeze({});
    }
    return handled;
  }
  update(dt: number): "running" | "complete" {
    this.#stepCrime(dt);
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
        crimePose({
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

  #startCrime(name: string) {
    const sim = this.#environment;
    if (!["steal_bag", "bag_caper", "caught"].includes(name)) {
      return false;
    }
    const bag = sim.objects.snapshot().bag;
    if (name === "caught" || !bag) {
      sim.lifecycle.rest(3);
      if (name === "caught") {
        sim.speech.say(dialogue.gullbert.crime.aModelCitizen);
      } else {
        sim.speech.say(dialogue.gullbert.crime.firstProvideTheEvidence);
      }
      return true;
    }
    let kind: "theft" | "caper";
    if (name === "steal_bag") {
      kind = "theft";
    } else {
      kind = "caper";
    }
    this.#scene = {
      kind,
      phase: "approach",
      bagId: bag.id,
      started: sim.clock.now,
      until: sim.clock.now + 12,
      deadline: sim.clock.now + 26,
      pausedOnce: false,
      phaseStarted: sim.clock.now,
      resume: "drag",
      target: { x: sim.body.x, y: sim.body.y },
      dragged: 0,
      direction: 1,
    };
    sim.activity.beginRoutine(kind);
    if (kind === "theft") {
      sim.speech.say(dialogue.gullbert.crime.justPassingThrough, 2);
    } else {
      sim.speech.say(dialogue.gullbert.crime.oneLastChip, 2);
    }
    return true;
  }
  caughtCrime() {
    const sim = this.#environment;
    const scene = this.#scene;
    const bag = sim.objects.snapshot().bag;
    if (scene?.kind !== "theft" || !bag || scene.bagId !== bag.id) {
      return false;
    }
    // A second accusation cannot keep a routine alive indefinitely.
    if (scene.phase !== "innocent") {
      if (scene.phase === "approach") {
        scene.resume = "approach";
      } else {
        scene.resume = "drag";
      }
    }
    scene.phase = "innocent";
    scene.until = Math.min(sim.clock.now + 2.2, scene.deadline - 0.5);
    sim.speech.say(dialogue.gullbert.crime.thisBagFollowedMe, 2.2);
    return true;
  }
  #phase(name: CrimeScene["phase"], duration: number) {
    const sim = this.#environment;
    if (this.#scene?.kind !== "theft" && this.#scene?.kind !== "caper") {
      return;
    }
    this.#scene.phase = name;
    this.#scene.phaseStarted = sim.clock.now;
    this.#scene.until = sim.clock.now + duration;
    sim.body.resetMotion();
  }
  #finish(message?: string) {
    const sim = this.#environment;
    sim.lifecycle.complete();
    sim.lifecycle.rest(4);
    sim.food.afterBagActivity(sim.clock.now);
    if (message) {
      sim.speech.say(message, 2.5);
    }
  }
  #escapePoint() {
    const sim = this.#environment;
    let escapeX;
    if (sim.body.x < (sim.body.width - 96) / 2) {
      escapeX = 12;
    } else {
      escapeX = sim.body.width - 108;
    }
    return sim.body.safePoint({
      x: escapeX,
      y: sim.body.y,
    });
  }
  #panicPoint(direction: number) {
    const sim = this.#environment;
    // Alternate short runs, including on small displays. Resizes are clamped
    // again by moveToward, so a stale waypoint cannot take the bird off screen.
    let bagOffsetX;
    if (direction > 0) {
      bagOffsetX = -48;
    } else {
      bagOffsetX = 48;
    }
    return sim.body.safePoint({
      x: sim.body.x + direction * Math.min(260, sim.body.width * 0.45),
      y: sim.body.y + bagOffsetX,
    });
  }
  #stepCrime(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;
    if (!scene || (scene.kind !== "theft" && scene.kind !== "caper")) {
      return false;
    }
    const bag = sim.objects.snapshot().bag;
    if (!bag || scene.bagId !== bag.id) {
      this.#finish(dialogue.gullbert.crime.theEvidenceHasVanished);
      return true;
    }
    if (sim.clock.now >= scene.deadline) {
      this.#finish(dialogue.gullbert.crime.nothingToSeeHere);
      return true;
    }
    if (scene.phase === "approach") {
      if (sim.body.moveToward(bagGoal(sim), 190, dt)) {
        if (scene.kind === "theft") {
          this.#phase("grab", 1);
        } else {
          this.#phase("inspect", 1);
        }
        if (scene.kind === "theft") {
          sim.speech.say(dialogue.gullbert.crime.mineQuietly);
        } else {
          sim.speech.say(dialogue.gullbert.crime.aThoroughInspection);
        }
      } else if (sim.clock.now >= scene.until) {
        this.#finish(dialogue.gullbert.crime.tooFarBringItHere);
      }
    } else if (scene.kind === "theft") {
      this.#stepTheft(dt);
    } else {
      this.#stepCaper(dt);
    }
    if (sim.objects.snapshot().bag?.attached) {
      attachBag(sim);
    }
    return true;
  }
  #stepTheft(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;
    if (scene?.kind !== "theft") {
      return;
    }
    if (!sim.objects.snapshot().bag) {
      return;
    }
    if (scene.phase === "grab") {
      attachBag(sim);
      if (sim.clock.now >= scene.until) {
        this.#phase("drag", 7);
        scene.target = this.#escapePoint();
        scene.dragged = 0;
      }
    } else if (scene.phase === "drag") {
      if (!scene.target) {
        scene.target = this.#escapePoint();
      }
      scene.dragged = (scene.dragged ?? 0) + dt;
      attachBag(sim);
      const arrived = sim.body.moveToward(scene.target, 48, dt);
      attachBag(sim);
      if (!scene.pausedOnce && (scene.dragged >= 1.8 || arrived)) {
        scene.pausedOnce = true;
        this.#phase("suspicious", 1.1);
        sim.speech.say(dialogue.gullbert.crime.pause, 1.1);
      } else if (arrived || sim.clock.now >= scene.until) {
        sim.objects.releaseBag();
        this.#phase("release", 1.2);
        sim.speech.say(dialogue.gullbert.crime.relocationService, 2.5);
      }
    } else if (scene.phase === "innocent" || scene.phase === "suspicious") {
      if (sim.clock.now >= scene.until) {
        let resume: "approach" | "drag";
        if (scene.phase === "innocent") {
          resume = scene.resume;
        } else {
          resume = "drag";
        }
        if (resume === "approach") {
          this.#phase(resume, 8);
        } else {
          this.#phase(resume, 5);
        }
        sim.speech.say(dialogue.gullbert.crime.asIWasSaying, 1.5);
      }
    } else if (scene.phase === "release" && sim.clock.now >= scene.until) {
      this.#finish();
    }
  }
  #stepCaper(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;
    if (scene?.kind !== "caper") {
      return;
    }
    if (!sim.objects.snapshot().bag) {
      return;
    }
    if (scene.phase === "inspect" && sim.clock.now >= scene.until) {
      attachBag(sim);
      this.#phase("trapped", 1.1);
      sim.speech.say(dialogue.gullbert.crime.hello, 1.1);
    } else if (scene.phase === "trapped" && sim.clock.now >= scene.until) {
      this.#phase("panic", 4);
      if (sim.body.x < (sim.body.width - 96) / 2) {
        scene.direction = 1;
      } else {
        scene.direction = -1;
      }
      scene.target = this.#panicPoint(scene.direction);
      sim.speech.say(dialogue.gullbert.crime.bagHasGull, 2);
      sim.events.emit("squawk");
    } else if (scene.phase === "panic") {
      if (sim.body.moveToward(scene.target, 270, dt)) {
        if (scene.direction === 1) {
          scene.direction = -1;
        } else {
          scene.direction = 1;
        }
        scene.target = this.#panicPoint(scene.direction);
      }
      if (sim.clock.now >= scene.until) {
        this.#phase("shake", 1.5);
        sim.speech.say(dialogue.gullbert.crime.releaseTheSeagull, 1.5);
      }
    } else if (scene.phase === "shake" && sim.clock.now >= scene.until) {
      sim.objects.releaseBag({ x: sim.body.facing * 36, y: 24 });
      this.#phase("offended", 2.2);
      sim.speech.say(dialogue.gullbert.crime.thatWasDeliberate, 2.5);
    } else if (scene.phase === "offended" && sim.clock.now >= scene.until) {
      this.#finish();
    }
  }
}
