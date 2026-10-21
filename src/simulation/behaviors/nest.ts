import { SceneState } from "../scene-state.js";
import { dialogue } from "../dialogue.js";
import { scopeCapabilities, type BehaviorCapabilities } from "../capabilities.js";
import type { Point } from "../model.js";
import type { NestScene } from "../scenes.js";
import type { SceneOwner, RoutinePresentation } from "../routine.js";

type Environment = Pick<BehaviorCapabilities,
  "belongings" | "body" | "clock" | "activity" | "speech" | "policy" | "commands"
  | "lifecycle"
>;

/** Owns quiet home visits; durable placement and treasure ownership stay in Belongings. */
export class NestRoutine implements SceneOwner {
  readonly #environment: Environment;
  readonly #state = new SceneState<NestScene>();
  #nextVisit = 120;

  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "belongings", "body", "clock", "activity", "speech", "policy", "commands",
      "lifecycle",
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
  }

  interrupt(): void {
    this.clear();
  }

  complete(): void {
    const sim = this.#environment;
    this.clear();
    sim.activity.settleUntil(sim.clock.now + 5);
    sim.lifecycle.rest(5);
  }

  visibility(): void {}

  start(name: string, point?: Point): boolean {
    const sim = this.#environment;
    const lines = dialogue.gullbert.nest;

    switch (name) {
      case "clear_nest":
        sim.belongings.clearNest();
        sim.speech.say(lines.removed);
        return true;

      case "place_nest": {
        const feet = point ?? { x: sim.body.x + 48, y: sim.body.y + 86 };
        sim.belongings.placeNest({ x: feet.x - 48, y: feet.y - 86 });
        sim.speech.say(lines.placed);
        break;
      }

      case "visit_nest":
        sim.speech.say(lines.visit);
        break;

      default:
        return false;
    }

    if (!sim.belongings.snapshot().memory.nest) {
      sim.speech.say(lines.missing);
      return true;
    }

    this.#state.current = { kind: "nest", phase: "approach", until: sim.clock.now + 30 };
    this.#state.activate();
    this.#nextVisit = sim.clock.now + 180;
    sim.activity.beginRoutine("nest");
    return true;
  }

  update(delta: number): "running" | "complete" {
    const sim = this.#environment;
    const scene = this.#state.current;
    const nest = sim.belongings.snapshot().memory.nest;

    if (!scene || !nest) {
      return "complete";
    }

    switch (scene.phase) {
      case "approach":
        if (sim.body.moveToward(nest, 150, delta)) {
          scene.phase = "arrange";
          scene.until = sim.clock.now + 2;
          sim.body.resetMotion();
        } else if (sim.clock.now >= scene.until) {
          return "complete";
        }

        break;

      case "arrange":
        sim.body.place(nest);

        if (sim.clock.now >= scene.until) {
          sim.belongings.arrangeNest();
          sim.belongings.remember("activity", "nest", nest);
          sim.speech.say(dialogue.gullbert.nest.sleep);
          scene.phase = "sleep";
          scene.until = sim.clock.now + 12;
        }

        break;

      case "sleep":
        sim.body.place(nest);

        if (sim.clock.now >= scene.until) {
          return "complete";
        }

        break;
    }

    return "running";
  }

  presentation(): RoutinePresentation {
    const sim = this.#environment;

    switch (this.#state.current?.phase) {
      case "approach":
        return { pose: Math.floor(sim.clock.now * 9) % 2 ? "walkLeft" : "walkRight" };

      case "arrange":
        return { pose: Math.floor(sim.clock.now * 4) % 2 ? "crouch" : "tilt" };

      case "sleep":
        return { pose: sim.clock.now % 4 < 3 ? "nap-sleep" : "nap-wobble" };

      default:
        return {};
    }
  }

  maybeVisit(): boolean {
    const sim = this.#environment;

    if (!sim.policy.visible() || sim.policy.settings().paused) {
      return false;
    }

    if (sim.activity.mode !== "idle" || !sim.belongings.snapshot().memory.nest) {
      return false;
    }

    if (sim.clock.now < this.#nextVisit || sim.clock.now < sim.activity.until) {
      return false;
    }

    sim.commands.action("visit_nest");
    return true;
  }
}
