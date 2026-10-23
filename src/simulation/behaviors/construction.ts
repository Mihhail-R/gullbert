import { scopeCapabilities, type BehaviorCapabilities } from "../capabilities.js";
import { dialogue } from "../dialogue.js";
import { beakOffsetX, clamp } from "../geometry.js";
import type { Point, PointerSample } from "../model.js";
import type { RoutinePresentation, SceneOwner } from "../routine.js";
import type { ConstructionScene } from "../scenes.js";
import { SceneState } from "../scene-state.js";

export const CONSTRUCTION_COOLDOWN_SECONDS = 600;
const phases = [
  ["inspect", 3], ["carry-first", 3], ["fetch-second", 2], ["carry-second", 3],
  ["adjust", 3], ["admire", 4], ["sit", 3], ["collapse", 2],
  ["blame", 3], ["tidy-first", 2], ["tidy-second", 2], ["leave", 2],
] as const;
type Environment = Pick<BehaviorCapabilities,
  "body" | "clock" | "activity" | "speech" | "belongings" | "policy" | "commands"
  | "lifecycle"
>;

/** Borrows presentation only; the nest and collection remain durable and untouched. */
export class ConstructionRoutine implements SceneOwner {
  readonly #environment: Environment;
  readonly #state = new SceneState<ConstructionScene>();
  #nextBuild = CONSTRUCTION_COOLDOWN_SECONDS;
  #pointer: Point | null = null;

  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "body", "clock", "activity", "speech", "belongings", "policy", "commands", "lifecycle",
    ]);
  }

  get scene() {
    return this.#state.snapshot();
  }

  get identity() {
    return this.#state.identity;
  }

  clear(): void {
    this.#state.clear();
    this.#pointer = null;
  }

  interrupt(): void {
    this.clear();
    this.#environment.speech.clear();
  }

  complete(): void {
    const sim = this.#environment;

    if (this.#state.current?.phase === "leave") {
      sim.belongings.remember("activity", "construction_chair", sim.body.snapshot());
    }

    this.clear();
    sim.lifecycle.rest(5);
  }

  visibility(visible: boolean): void {
    if (!visible) {
      this.#environment.lifecycle.interrupt();
      this.#environment.lifecycle.rest();
    }
  }

  pointerSample(point: PointerSample | null): void {
    if (!point || point.inside === false) {
      return;
    }

    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      this.#pointer = { x: point.x, y: point.y };
    }
  }

  start(name: string): boolean {
    if (name !== "build_something") {
      return false;
    }

    const sim = this.#environment;
    const nest = sim.belongings.snapshot().memory.nest;

    if (!nest || nest.items.length < 2) {
      sim.speech.say(dialogue.gullbert.construction.missing);
      sim.lifecycle.rest();
      return true;
    }

    this.#state.current = {
      kind: "construction", phase: "inspect", phaseIndex: 0,
      started: sim.clock.now, until: sim.clock.now + 3,
      origin: { x: sim.body.x, y: sim.body.y },
      items: [nest.items[0], nest.items[1]], borrowedSlots: [], props: [],
    };
    this.#state.activate();
    this.#nextBuild = sim.clock.now + CONSTRUCTION_COOLDOWN_SECONDS;
    sim.activity.beginRoutine("construction");
    return true;
  }

  maybeBuild(): boolean {
    const sim = this.#environment;

    if (!sim.policy.visible() || sim.policy.settings().paused) {
      return false;
    }

    if (sim.activity.mode !== "idle" || sim.clock.now < sim.activity.until) {
      return false;
    }

    const nest = sim.belongings.snapshot().memory.nest;

    if (!nest || nest.items.length < 2 || sim.clock.now < this.#nextBuild) {
      return false;
    }

    sim.commands.action("build_something");
    return true;
  }

  update(): "running" | "complete" {
    const sim = this.#environment;
    const scene = this.#state.current;
    const nest = sim.belongings.snapshot().memory.nest;

    if (!scene || !nest) {
      this.interrupt();
      return "complete";
    }

    if (sim.clock.now >= scene.until) {
      const next = phases[scene.phaseIndex + 1];

      if (!next) {
        return "complete";
      }

      scene.phaseIndex += 1;
      scene.phase = next[0];
      scene.started = sim.clock.now;
      scene.until = sim.clock.now + next[1];
      scene.origin = { x: sim.body.x, y: sim.body.y };

      if (scene.phase === "admire") {
        sim.speech.say(dialogue.gullbert.construction.admire, 3);
      }
    }

    const progress = clamp((sim.clock.now - scene.started) / (scene.until - scene.started), 0, 1);
    const side = nest.x < sim.body.width / 2 ? 1 : -1;
    const chair = sim.body.safePoint({ x: nest.x + side * 100, y: nest.y });
    const home = sim.body.safePoint(nest);
    let target = chair;
    let travel = progress;

    switch (scene.phase) {
      case "inspect":
        target = home;
        travel = Math.min(1, progress * 2);
        break;

      case "fetch-second":
      case "tidy-first":
      case "tidy-second":
        target = home;
        break;

      case "adjust":
        target = sim.body.safePoint({ x: chair.x - side * 28, y: chair.y });
        travel = Math.min(1, progress * 3);
        break;

      case "admire":
        target = sim.body.safePoint({
          x: chair.x - side * Math.cos(progress * Math.PI * 2) * 28,
          y: chair.y - Math.sin(progress * Math.PI) * 22,
        });
        travel = 1;
        break;

      case "sit":
        target = sim.body.safePoint({ x: chair.x, y: chair.y - 9 });
        travel = Math.min(1, progress * 3);
        break;

      case "collapse":
      case "blame":
        travel = Math.min(1, progress * 8);
        break;

      case "leave":
        target = sim.body.safePoint({ x: nest.x - side * 90, y: nest.y });
        break;
    }

    // The second return includes walking back to retrieve the remaining piece.
    if (scene.phase === "tidy-second") {
      const outward = progress < 0.5;
      scene.origin = outward ? home : chair;
      target = outward ? chair : home;
      travel = outward ? progress * 2 : (progress - 0.5) * 2;
    }

    const origin = sim.body.safePoint(scene.origin);
    const previousX = sim.body.x;
    sim.body.place(sim.body.safePoint({
      x: origin.x + (target.x - origin.x) * travel,
      y: origin.y + (target.y - origin.y) * travel,
    }));

    if (Math.abs(sim.body.x - previousX) > 0.01) {
      sim.body.face(sim.body.x > previousX ? 1 : -1);
    }

    if (scene.phase === "adjust" && progress > 0.3) {
      sim.body.face(side);
    }

    if (scene.phase === "blame" && progress > 0.3) {
      if (!scene.accused) {
        sim.speech.say(dialogue.gullbert.construction.blame, 2);
        scene.accused = true;
      }

      sim.body.face((this.#pointer?.x ?? sim.body.width / 2) >= sim.body.x + 48 ? 1 : -1);
    }

    this.#presentTreasures(scene, chair, progress);
    return "running";
  }

  #presentTreasures(scene: ConstructionScene, chair: Point, progress: number): void {
    const sim = this.#environment;
    scene.borrowedSlots = [];
    scene.props = [];

    for (let slot = 0; slot < 2; slot += 1) {
      const borrowedPhase = slot === 0 ? "carry-first" : "carry-second";
      const returnedPhase = slot === 0 ? "tidy-second" : "leave";
      const borrowedAt = phases.findIndex(([phase]) => phase === borrowedPhase);
      const returnedAt = phases.findIndex(([phase]) => phase === returnedPhase);

      if (scene.phaseIndex < borrowedAt || scene.phaseIndex >= returnedAt) {
        continue;
      }

      scene.borrowedSlots.push(slot);
      const carryingOut = scene.phaseIndex === borrowedAt && progress < 0.85;
      const carryingHome = scene.phase === "tidy-first" && slot === 0;
      const carryingLast = scene.phase === "tidy-second" && progress >= 0.5;
      const carrying = carryingOut || carryingHome || carryingLast;
      let x = chair.x + 36 + slot * 3;
      let y = chair.y + 68 - slot * 15;
      let rotation = slot === 0 ? -12 : 14;

      const collapseIndex = phases.findIndex(([phase]) => phase === "collapse");

      if (scene.phaseIndex >= collapseIndex) {
        const spread = scene.phase === "collapse" ? Math.min(1, progress * 5) : 1;
        x += (slot === 0 ? -28 : 30) * spread;
        y += (slot === 0 ? 0 : 15) * spread;
        rotation += (slot === 0 ? -65 : 80) * spread;
      } else if (scene.phase === "adjust") {
        rotation += Math.sin(progress * Math.PI * 6) * 7;
      }

      if (carrying) {
        x = sim.body.x + beakOffsetX(sim.body.facing) - 12;
        y = sim.body.y + 39;
        rotation = -15;
      }

      scene.props.push({
        id: `construction-${slot}`, asset: scene.items[slot],
        x, y, width: 24, height: 24, rotation,
      });
    }
  }

  presentation(): RoutinePresentation {
    const scene = this.#state.current;

    if (!scene) {
      return {};
    }

    const elapsed = this.#environment.clock.now - scene.started;
    let pose: RoutinePresentation["pose"] = Math.floor(elapsed * 9) % 2
      ? "walkLeft" : "walkRight";
    let rotation = 0;

    switch (scene.phase) {
      case "inspect":
        pose = elapsed > 1.5 ? "tilt" : pose;
        rotation = elapsed > 2 ? -6 : 0;
        break;

      case "carry-first":
      case "carry-second":
        pose = elapsed > 2.55 ? "nibble" : pose;
        break;

      case "adjust":
        pose = Math.floor(elapsed * 4) % 2 ? "nibble" : "tilt";
        break;

      case "sit":
        pose = "crouch";
        break;

      case "collapse":
        pose = "nap-startle";
        break;

      case "blame":
        pose = elapsed < 0.9 ? "nap-startle" : "nap-accuse";
        rotation = elapsed < 0.9 ? 0 : -4;
        break;
    }

    return { pose, rotation, props: scene.props };
  }
}
