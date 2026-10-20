import { enterPhase } from "../phase-timing.js";
import { theatreBeak, theatrePointOnScreen } from "./theatre-geometry.js";
import { dialogue } from "../dialogue.js";
import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import { scopeCapabilities } from "../capabilities.js";
import { beakOffsetX, clamp } from "../geometry.js";
import {
  isTheatre,
  type TheatreScene,
  type Bubble,
  type TossScene,
} from "../scenes.js";
import type { Point } from "../model.js";
import type { BehaviorCapabilities } from "../capabilities.js";
import type { SceneOwner } from "../routine.js";
import { SceneState } from "../scene-state.js";
import type { TheatreScene as OwnedScene } from "../scenes.js";
import {
  theatrePose,
  theatreProps,
  theatreOffset,
} from "./theatre-presentation.js";

export { theatrePose, theatreProps, theatreOffset };

const COMMANDS: Partial<Record<string, TheatreScene["kind"]>> = {
  blow_bubbles: "bubbles",
  bath_time: "bath",
  chip_toss: "toss",
  baguette_parade: "baguette",
};

type Environment = Pick<
  BehaviorCapabilities,
  | "random"
  | "body"
  | "clock"
  | "lifecycle"
  | "speech"
  | "activity"
  | "objects"
  | "policy"
  | "commands"
  | "events"
  | "food"
  | "meals"
>;
export class TheatreRoutine implements SceneOwner {
  #environment: Environment;
  #state = new SceneState<OwnedScene>();
  #rareTheatre?: { nextAllowed: number; nextCheck: number; recent: string[] };
  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "random",
      "body",
      "clock",
      "lifecycle",
      "speech",
      "activity",
      "objects",
      "policy",
      "commands",
      "events",
      "food",
      "meals",
    ]);
  }
  get scene(): ReadonlyValue<OwnedScene> | null {
    return this.#state.snapshot();
  }

  get identity(): object {
    return this.#state.identity;
  }
  clear(): void {
    this.#state.clear();
  }
  start(name: string, point?: Point): boolean {
    const handled = this.#startTheatre(name, point);

    if (handled) {
      this.#state.activate();
    }

    return handled;
  }
  update(dt: number): "running" | "complete" {
    this.#stepTheatre(dt);

    if (!this.#state.current) {
      return "complete";
    }

    return "running";
  }
  complete(): void {
    this.#cancelTheatre();
    this.#state.clear();
  }
  presentation() {
    const sim = this.#environment;
    const observation = {
      ...sim.body.snapshot(),
      ...sim.activity.snapshot(),
      time: sim.clock.now,
      visible: sim.policy.visible(),
      scene: this.#state.current,
    };
    const props = theatreProps(observation);
    const looseProps = props.filter(function looseChip(prop) {
      return prop.asset === "chip" && prop.id !== "snatched-chip";
    });
    return observe({
      pose: theatrePose(observation) ?? undefined,
      props,
      looseProps,
      offset: theatreOffset(observation),
    });
  }
  interrupt(): void {
    this.#cancelTheatre();
    this.#state.clear();
  }
  visibility(): void {}
  get rareTheatre() {
    return observe(this.#rareTheatre);
  }
  #tossReactionDelay(): number {
    const sim = this.#environment;

    if (sim.random() < 0.2) {
      return 0.9;
    }

    return 0.3;
  }
  #phase(name: TheatreScene["phase"], duration: number) {
    const sim = this.#environment;

    if (!isTheatre(this.#state.current)) {
      return;
    }

    enterPhase(this.#state.current, name, sim.clock.now, duration);
    sim.body.resetMotion();
  }
  #finish(message?: string) {
    const sim = this.#environment;
    sim.lifecycle.complete();
    sim.lifecycle.rest(4);

    if (message) {
      sim.speech.say(message);
    }
  }
  #rareMemory() {
    // sim.clock.now is visible simulation time; hidden time never enters this clock.
    if (!this.#rareTheatre) {
      this.#rareTheatre = {
        nextAllowed: 1200,
        nextCheck: 1200,
        recent: [],
      };
    }

    return this.#rareTheatre;
  }
  #startTheatre(name: string, point?: Point) {
    const sim = this.#environment;
    const kind = COMMANDS[name];

    if (!kind) {
      return false;
    }

    const clock = {
      started: sim.clock.now,
      deadline: sim.clock.now + 18,
      phaseStarted: sim.clock.now,
      until: sim.clock.now,
    };
    sim.activity.beginRoutine(kind);

    if (kind === "bubbles") {
      const mouth = theatreBeak(sim.body);
      const bubbles = Array.from({ length: 6 }, (_, index) => {
        return {
          id: sim.objects.nextId(),
          ...theatrePointOnScreen(sim.body, {
            x: mouth.x + sim.body.facing * (55 + index * 38),
            y: mouth.y + 10 + (index % 3) * 22,
          }),
          vx: sim.body.facing * (4 + index),
          vy: -3 - index,
          expires: sim.clock.now + 10 + index * 0.7,
        };
      });
      this.#state.current = { ...clock, kind, phase: "chase", bubbles, pops: [] };
      this.#phase("chase", 14);
      sim.speech.say(dialogue.gullbert.theatre.floatingTrespassers);
    } else if (kind === "bath") {
      const target = sim.body.safePoint({
        x: (point?.x ?? sim.body.x + 100) - 48,
        y: (point?.y ?? sim.body.y + 76) - 76,
      });
      this.#state.current = {
        ...clock,
        kind,
        phase: "approach",
        target,
        bath: { x: target.x + 6, y: target.y + 56 },
        exit: target,
      };
      this.#phase("approach", 7);
      sim.speech.say(dialogue.gullbert.theatre.aPrivateSeasideResort);
    } else if (kind === "toss") {
      const end = theatrePointOnScreen(
        sim.body,
        point ?? { x: sim.body.width * 0.7, y: sim.body.y + 75 },
      );
      let direction: -1 | 1;

      if (end.x >= sim.body.x + 48) {
        direction = 1;
      } else {
        direction = -1;
      }

      const start = theatrePointOnScreen(sim.body, {
        x: sim.body.x + 48 - direction * 150,
        y: sim.body.y + 88,
      });
      const arc = {
        start,
        end,
        duration: 2.2,
        height: Math.min(140, sim.body.height * 0.25),
      };
      this.#state.current = {
        ...clock,
        kind,
        phase: "takeoff",
        groundY: sim.body.y,
        chip: { id: sim.objects.nextId(), ...start },
        arc,
        reaction: this.#tossReactionDelay(),
        caught: false,
        landFrom: sim.body.y,
        recoilFrom: { x: sim.body.x, y: sim.body.y },
      };
      this.#phase("takeoff", this.#state.current.reaction);
      sim.speech.say(dialogue.gullbert.theatre.airborneLunch);
    } else {
      const memory = this.#rareMemory();
      memory.nextAllowed = sim.clock.now + 1200;
      memory.nextCheck = memory.nextAllowed;
      memory.recent = [...memory.recent, kind].slice(-3);
      let direction: -1 | 1;

      if (sim.body.x < sim.body.width / 2) {
        direction = 1;
      } else {
        direction = -1;
      }

      const origin = { x: sim.body.x, y: sim.body.y };

      if (direction === 1) {
        sim.body.place({ x: 0, y: sim.body.y });
      } else {
        sim.body.place({ x: sim.body.width - 96, y: sim.body.y });
      }

      sim.body.face(direction as -1 | 1);
      this.#state.current = {
        ...clock,
        kind,
        phase: "entrance",
        origin,
        direction,
        target: sim.body.safePoint({
          x: sim.body.width / 2 - 48,
          y: sim.body.y,
        }),
      };
      this.#phase("entrance", 0.8);
    }

    return true;
  }
  #cancelTheatre() {
    const sim = this.#environment;

    if (!isTheatre(this.#state.current)) {
      return;
    }

    sim.speech.clear();
    sim.speech.forget();

    if (this.#state.current.kind === "baguette") {
      sim.body.place(sim.body.safePoint(this.#state.current.origin));
    }

    if (this.#state.current?.kind === "toss") {
      sim.body.place({
        x: sim.body.x,
        y: sim.body.safePoint({ x: sim.body.x, y: this.#state.current.groundY }).y,
      });
    }
  }
  maybeTheatre() {
    const sim = this.#environment;
    const memory = this.#rareMemory();

    if (
      !sim.policy.visible() ||
      sim.policy.settings().paused ||
      sim.policy.settings().mischief <= 0
    ) {
      return false;
    }

    if (this.#state.current || sim.activity.mode !== "idle") {
      return false;
    }

    if (
      sim.clock.now < memory.nextAllowed ||
      sim.clock.now < memory.nextCheck
    ) {
      return false;
    }

    memory.nextCheck = sim.clock.now + 60;

    if (sim.random() >= 0.08) {
      return false;
    }

    // Keep a bounded history now; additional rare scenes can join this list
    // without ever immediately repeating the last available alternative.
    const choices = ["baguette"];
    let candidates;

    if (choices.length > 1) {
      candidates = choices.filter((kind) => {
        return kind !== memory.recent.at(-1);
      });
    } else {
      candidates = choices;
    }

    const selected = candidates[Math.floor(sim.random() * candidates.length)];

    if (selected === "baguette") {
      sim.commands.action("baguette_parade");
    }

    return true;
  }
  #stepTheatre(dt: number) {
    const sim = this.#environment;
    const scene = this.#state.current;

    if (!isTheatre(scene)) {
      return false;
    }

    if (sim.clock.now >= scene.deadline) {
      this.#finish();
      return true;
    }

    switch (scene.kind) {
      case "bubbles":
        this.#stepBubbles(dt);
        break;

      case "bath":
        this.#stepBath(dt);
        break;

      case "toss":
        this.#stepToss(dt);
        break;

      case "baguette":
        this.#stepBaguette(dt);
        break;
    }

    return true;
  }
  #stepBubbles(dt: number) {
    const sim = this.#environment;
    const scene = this.#state.current;

    if (scene?.kind !== "bubbles") {
      return;
    }

    scene.pops = scene.pops.filter((pop) => {
      return sim.clock.now < pop.until;
    });
    scene.bubbles = scene.bubbles.filter((bubble) => {
      return sim.clock.now < bubble.expires;
    });

    for (const bubble of scene.bubbles) {
      Object.assign(
        bubble,
        theatrePointOnScreen(sim.body, {
          x: bubble.x + bubble.vx * dt,
          y: bubble.y + bubble.vy * dt,
        }),
      );
    }

    if (scene.phase === "chase") {
      const mouth = theatreBeak(sim.body);
      const target = scene.bubbles.reduce<Bubble | null>((best, bubble) => {
        if (
          !best ||
          Math.hypot(bubble.x - mouth.x, bubble.y - mouth.y) <
            Math.hypot(best.x - mouth.x, best.y - mouth.y)
        ) {
          return bubble;
        } else {
          return best;
        }
      }, null);

      if (!target) {
        this.#finish(dialogue.gullbert.theatre.airspaceSecured);
        return;
      }

      let facing;

      if (target.x >= sim.body.x + 48) {
        facing = 1;
      } else {
        facing = -1;
      }

      scene.targetId = target.id;
      sim.body.moveToward(
        {
          x: target.x - beakOffsetX(facing),
          y: target.y - 42,
          facing,
        },
        175,
        dt,
      );
      sim.body.face(facing as -1 | 1);
      const contact = theatreBeak(sim.body);

      if (Math.hypot(contact.x - target.x, contact.y - target.y) <= 22) {
        scene.bubbles = scene.bubbles.filter((bubble) => {
          return bubble.id !== target.id;
        });
        scene.pops.push({ ...target, until: sim.clock.now + 0.35 });
        sim.events.emit("pop");
        this.#phase("peck", 0.16);
      }
    } else if (sim.clock.now >= scene.until) {
      if (scene.phase === "peck") {
        this.#phase("startle", 0.55);
        sim.speech.say(dialogue.gullbert.theatre.ambush, 0.8);
      } else if (scene.phase === "startle") {
        this.#phase("proud", 0.8);
        sim.speech.say(dialogue.gullbert.theatre.exactlyAsPlanned, 1.2);
      } else {
        this.#phase("chase", 14);
      }
    }
  }
  #stepBath(dt: number) {
    const sim = this.#environment;
    const scene = this.#state.current;

    if (scene?.kind !== "bath") {
      return;
    }

    if (scene.phase === "approach") {
      if (sim.body.moveToward(scene.target, 220, dt)) {
        this.#phase("splash", 2.8);
        sim.speech.say(dialogue.gullbert.theatre.luxury, 2);
      } else if (sim.clock.now >= scene.until) {
        this.#finish(dialogue.gullbert.theatre.theSeaIsTooFarAway);
      }
    } else if (scene.phase === "splash" && sim.clock.now >= scene.until) {
      this.#phase("shake", 2.2);
      sim.speech.say(dialogue.gullbert.theatre.everyFeatherIndividually, 2.5);
    } else if (scene.phase === "shake" && sim.clock.now >= scene.until) {
      this.#phase("exit", 2);
      let exitOffsetX;

      if (sim.body.x < sim.body.width / 2) {
        exitOffsetX = 110;
      } else {
        exitOffsetX = -110;
      }

      scene.exit = sim.body.safePoint({
        x: sim.body.x + exitOffsetX,
        y: sim.body.y,
      });
    } else if (scene.phase === "exit") {
      if (
        sim.body.moveToward(scene.exit, 90, dt) ||
        sim.clock.now >= scene.until
      ) {
        this.#finish(dialogue.gullbert.theatre.naturallyImmaculate);
      }
    }
  }
  #chipPosition(scene: TossScene, elapsed: number) {
    const sim = this.#environment;
    const { start, end, duration, height } = scene.arc;
    const t = clamp(elapsed / duration, 0, 1);
    return theatrePointOnScreen(
      sim.body,
      {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t - 4 * height * t * (1 - t),
      },
      18,
    );
  }
  #landToss(caught: boolean) {
    const sim = this.#environment;
    const scene = this.#state.current;

    if (scene?.kind !== "toss") {
      return;
    }

    scene.caught = caught;
    scene.landFrom = sim.body.y;

    if (caught) {
      this.#phase("land", 0.65);
    } else {
      this.#phase("miss-flail", 0.45);
    }

    scene.recoilFrom = { x: sim.body.x, y: sim.body.y };

    if (caught) {
      scene.chip = null;
      sim.events.emit("munch");
      sim.food.clearRequest();
      sim.meals.consumed({ x: sim.body.x, y: sim.body.y });
      sim.speech.say(dialogue.gullbert.theatre.beakOfTheMatch);
    } else {
      sim.speech.say(dialogue.gullbert.theatre.theWindCheated, 2.5);
    }
  }
  #stepToss(dt: number) {
    const sim = this.#environment;
    const scene = this.#state.current;

    if (scene?.kind !== "toss") {
      return;
    }

    const elapsed = sim.clock.now - scene.started;

    // A landed chip must follow display changes just like one still in flight.
    if (scene.chip) {
      Object.assign(scene.chip, theatrePointOnScreen(sim.body, scene.chip, 18));
    }

    if (["takeoff", "intercept"].includes(scene.phase) && scene.chip) {
      Object.assign(scene.chip, this.#chipPosition(scene, elapsed));

      if (elapsed >= scene.reaction) {
        if (scene.phase === "takeoff") {
          this.#phase("intercept", 3);
        }

        const target = this.#chipPosition(scene, elapsed + 0.12);
        let facing;

        if (scene.chip.x >= sim.body.x + 48) {
          facing = 1;
        } else {
          facing = -1;
        }

        sim.body.moveToward(
          {
            x: target.x - beakOffsetX(facing),
            y: target.y - 47,
            facing,
          },
          260,
          dt,
        );
        sim.body.face(facing as -1 | 1);
        // Both flight frames have their painted beak around native (26, 15.7),
        // or (78, 47) at 3×; the shared play anchor sits too high for catches.
        const mouth = {
          x: sim.body.x + beakOffsetX(facing),
          y: sim.body.y + 47,
        };
        const distance = Math.hypot(
          mouth.x - scene.chip.x,
          mouth.y - scene.chip.y,
        );

        if (elapsed < scene.arc.duration && distance <= 10) {
          scene.contact = { beak: mouth, chip: { ...scene.chip }, distance };
          this.#landToss(true);
          return;
        }
      }

      if (elapsed >= scene.arc.duration) {
        this.#landToss(false);
      }

      return;
    }

    switch (scene.phase) {
      case "miss-flail": {
        const t = clamp((sim.clock.now - scene.phaseStarted) / 0.45, 0, 1);
        sim.body.place(
          sim.body.safePoint({
            x: scene.recoilFrom.x + sim.body.facing * 34 * t,
            y: scene.recoilFrom.y - Math.sin(t * Math.PI) * 22,
          }),
        );

        if (sim.clock.now >= scene.until) {
          scene.landFrom = sim.body.y;
          this.#phase("land", 0.65);
        }

        break;
      }

      case "land": {
        const t = clamp((sim.clock.now - scene.phaseStarted) / 0.65, 0, 1);
        const ground = sim.body.safePoint({
          x: sim.body.x,
          y: scene.groundY,
        }).y;
        sim.body.place({
          x: sim.body.x,
          y: sim.body.safePoint({
            x: sim.body.x,
            y: scene.landFrom + (ground - scene.landFrom) * t,
          }).y,
        });

        if (sim.clock.now >= scene.until) {
          if (scene.caught) {
            this.#phase("eat", 1.75);
          } else {
            this.#phase("miss", 1.1);
          }
        }

        break;
      }

      case "miss": {
        if (sim.clock.now >= scene.until) {
          this.#phase("retrieve", 8);
          sim.speech.say(dialogue.gullbert.theatre.groundLunchIsStillLunch);
        }

        break;
      }

      case "retrieve": {
        if (scene.chip) {
          let facing;

          if (scene.chip.x >= sim.body.x + 48) {
            facing = 1;
          } else {
            facing = -1;
          }

          sim.body.moveToward(
            {
              x: scene.chip.x - beakOffsetX(facing),
              y: scene.chip.y - 65,
              facing,
            },
            180,
            dt,
          );
          sim.body.face(facing as -1 | 1);

          // A lowered peck reaches below the normal flying beak.
          if (
            Math.hypot(
              sim.body.x + beakOffsetX(facing) - scene.chip.x,
              sim.body.y + 65 - scene.chip.y,
            ) <= 24
          ) {
            scene.chip = null;
            sim.events.emit("munch");
            sim.food.clearRequest();
            sim.meals.consumed({ x: sim.body.x, y: sim.body.y });
            this.#phase("eat", 1.75);
          } else if (sim.clock.now >= scene.until) {
            this.#finish(dialogue.gullbert.theatre.savingThatForLater);
          }
        }

        break;
      }

      case "eat": {
        if (sim.clock.now >= scene.until) {
          this.#finish();
        }

        break;
      }
    }
  }
  #stepBaguette(dt: number) {
    const sim = this.#environment;
    const scene = this.#state.current;

    if (scene?.kind !== "baguette") {
      return;
    }

    const speed = Math.max(70, sim.body.width / 9);

    switch (scene.phase) {
      case "entrance": {
        if (sim.clock.now >= scene.until) {
          this.#phase("carry", 6);
        }

        break;
      }

      case "carry": {
        if (
          sim.body.moveToward(scene.target, speed, dt) ||
          sim.clock.now >= scene.until
        ) {
          this.#phase("pause", 1.7);
        }

        break;
      }

      case "pause": {
        if (sim.clock.now >= scene.until) {
          this.#phase("exit", 6);
          let exitX;

          if (scene.direction === 1) {
            exitX = sim.body.width - 96;
          } else {
            exitX = 0;
          }

          scene.target = sim.body.safePoint({
            x: exitX,
            y: sim.body.y,
          });
        }

        break;
      }

      case "exit": {
        if (
          sim.body.moveToward(scene.target, speed, dt) ||
          sim.clock.now >= scene.until
        ) {
          this.#phase("departure", 0.8);
        }

        break;
      }

      case "departure": {
        if (sim.clock.now >= scene.until) {
          this.#phase("gone", 0.4);
        }

        break;
      }

      case "gone": {
        if (sim.clock.now >= scene.until) {
          this.#finish();
        }

        break;
      }
    }

    sim.body.face(scene.direction as -1 | 1);
  }
}
