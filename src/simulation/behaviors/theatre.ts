import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import { scopeCapabilities } from "../capabilities.js";
function beak(sim: Pick<SimulationView, "x" | "facing" | "y">) {
  return {
    x: sim.x + beakOffsetX(sim.facing),
    y: sim.y + 42,
  };
}
function pointOnScreen(
  sim: Pick<SimulationView, "width" | "height">,
  point: Point,
  margin = 16,
) {
  return {
    x: clamp(point.x, margin, sim.width - margin),
    y: clamp(point.y, margin, sim.height - margin),
  };
}
import { beakOffsetX, clamp } from "../geometry.js";
import {
  isTheatre,
  type TheatreScene,
  type Bubble,
  type TossScene,
  type BubblesScene,
} from "../scenes.js";
import type { SceneProp } from "../model.js";
import type { Pose } from "../poses.js";
import type { Point } from "../model.js";
import type { SimulationView, BehaviorCapabilities } from "../capabilities.js";
import type { SceneOwner } from "../routine.js";
import type { Scene, TheatreScene as OwnedScene } from "../scenes.js";

const COMMANDS: Partial<Record<string, TheatreScene["kind"]>> = {
  blow_bubbles: "bubbles",
  bath_time: "bath",
  chip_toss: "toss",
  baguette_parade: "baguette",
};

export function theatrePose(
  sim: Pick<SimulationView, "scene" | "motionTime" | "time">,
): Pose | null {
  const scene = sim.scene;
  if (!isTheatre(scene)) {
    return null;
  }
  const walk = (["idle", "walkLeft", "idle", "walkRight"] as const)[
    Math.floor(sim.motionTime * 10) % 4
  ];
  if (scene.kind === "bubbles") {
    return (
      (
        {
          peck: "nibble",
          startle: "nap-startle",
          proud: "blink",
        } as Partial<Record<BubblesScene["phase"], Pose>>
      )[scene.phase] ?? walk
    );
  }
  if (scene.kind === "bath") {
    if (scene.phase === "splash") {
      return "bath-wet";
    }
    if (scene.phase === "shake") {
      if (Math.floor(sim.time * 12) % 2) {
        return "bath-shake-a";
      } else {
        return "bath-shake-b";
      }
    }
    return walk;
  }
  if (scene.kind === "toss") {
    if (scene.phase === "takeoff") {
      return "crouch";
    }
    if (scene.phase === "intercept") {
      if (Math.floor(sim.time * 10) % 2) {
        return "wingUp";
      } else {
        return "wingDown";
      }
    }
    if (scene.phase === "land") {
      return "wingDown";
    }
    if (scene.phase === "miss-flail") {
      if (Math.floor(sim.time * 12) % 2) {
        return "nap-startle";
      } else {
        return "wingDown";
      }
    }
    if (scene.phase === "miss") {
      return "bag-offended";
    }
    if (scene.phase === "eat") {
      return "nibble";
    }
    return walk;
  }
  if (
    ["carry", "exit"].includes(scene.phase) &&
    Math.floor(sim.motionTime * 8) % 2
  ) {
    return walk;
  } else {
    return "nibble";
  }
}

export function theatreProps(
  sim: Pick<
    SimulationView,
    | "scene"
    | "visible"
    | "width"
    | "height"
    | "time"
    | "x"
    | "y"
    | "motionTime"
    | "facing"
  >,
): SceneProp[] {
  const scene = sim.scene;
  if (!sim.visible || !isTheatre(scene)) {
    return [];
  }
  if (scene.kind === "bubbles") {
    return [
      ...scene.bubbles.map((bubble) => {
        return {
          id: bubble.id,
          asset: "bubble",
          x: bubble.x - 15,
          y: bubble.y - 15,
          width: 30,
          height: 30,
        };
      }),
      ...scene.pops.map((pop) => {
        return {
          id: `pop-${pop.id}`,
          asset: "pop",
          x: pop.x - 21,
          y: pop.y - 21,
          width: 42,
          height: 42,
        };
      }),
    ];
  }
  if (scene.kind === "bath") {
    const props: SceneProp[] = [
      {
        id: "bath",
        asset: "bath",
        x: clamp(scene.bath.x, 0, sim.width - 84),
        y: clamp(scene.bath.y, 0, sim.height - 40),
        width: 84,
        height: 40,
      },
    ];
    if (["splash", "shake"].includes(scene.phase)) {
      for (let index = 0; index < 8; index += 1) {
        const age = ((sim.time - scene.phaseStarted) * 1.5 + index / 8) % 1;
        let direction: -1 | 1;
        if (index % 2) {
          direction = 1;
        } else {
          direction = -1;
        }
        props.push({
          id: `drop-${index}`,
          asset: "drop",
          x: clamp(
            sim.x + 46 + direction * age * (25 + index * 5),
            0,
            sim.width - 9,
          ),
          y: clamp(
            sim.y + 55 - Math.sin(age * Math.PI) * (30 + index * 3),
            0,
            sim.height - 12,
          ),
          width: 9,
          height: 12,
          opacity: 1 - age * 0.7,
        });
      }
    }
    return props;
  }
  if (scene.kind === "toss") {
    // Rendering can run synchronously on resize before the next physics tick.
    const chip = scene.chip && pointOnScreen(sim, scene.chip, 18);
    if (scene.chip && chip) {
      let rotation;
      if (["takeoff", "intercept"].includes(scene.phase)) {
        rotation = (sim.time - scene.started) * 360;
      } else {
        rotation = 0;
      }
      return [
        {
          id: scene.chip.id,
          asset: "chip",
          x: chip.x - 12,
          y: chip.y - 12,
          width: 24,
          height: 24,
          rotation: rotation,
        },
      ];
    } else {
      return [];
    }
  }
  const mouth = beak(sim);
  const offset = theatreOffset(sim);
  let horizontalOffset;
  if (scene.phase === "pause") {
    horizontalOffset = 13;
  } else {
    horizontalOffset = Math.sin(sim.motionTime * 8) * 5;
  }
  return [
    {
      id: "baguette",
      asset: "baguette",
      x: mouth.x - 78 + offset.x,
      y: mouth.y - 5,
      width: 156,
      height: 24,
      rotation: sim.facing * horizontalOffset,
      opacity: offset.opacity,
    },
  ];
}

// The simulation remains in safe desktop coordinates while the short entrance
// and departure move the complete carried silhouette beyond the display edge.
export function theatreOffset(sim: Pick<SimulationView, "scene" | "time">) {
  const scene = sim.scene;
  if (scene?.kind !== "baguette") {
    return { x: 0, opacity: 1 };
  }
  const progress = clamp((sim.time - scene.phaseStarted) / 0.8, 0, 1);
  if (scene.phase === "entrance") {
    return { x: -scene.direction * 220 * (1 - progress), opacity: 1 };
  }
  if (scene.phase === "departure") {
    return { x: scene.direction * 220 * progress, opacity: 1 };
  }
  let opacity;
  if (scene.phase === "gone") {
    opacity = 0;
  } else {
    opacity = 1;
  }
  return { x: 0, opacity: opacity };
}

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
>;
export class TheatreRoutine implements SceneOwner {
  #environment: Environment;
  #scene: OwnedScene | null = null;
  #identity: object = Object.freeze({});
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
  start(name: string, point?: import("../model.js").Point): boolean {
    const handled = this.#startTheatre(name, point);
    if (handled && this.#scene) {
      this.#identity = Object.freeze({});
    }
    return handled;
  }
  update(dt: number): "running" | "complete" {
    this.#stepTheatre(dt);
    if (!this.#scene) {
      return "complete";
    }
    return "running";
  }
  complete(): void {
    this.#cancelTheatre();
    this.#scene = null;
  }
  presentation() {
    const sim = this.#environment;
    const observation = {
      ...sim.body.snapshot(),
      ...sim.activity.snapshot(),
      time: sim.clock.now,
      visible: sim.policy.visible(),
      scene: this.#scene,
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
    this.#scene = null;
  }
  visibility(visible: boolean): void {
    void visible;
  }
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
  #beak() {
    const sim = this.#environment;
    return {
      x: sim.body.x + beakOffsetX(sim.body.facing),
      y: sim.body.y + 42,
    };
  }
  #pointOnScreen(point: Point, margin = 16) {
    const sim = this.#environment;
    return {
      x: clamp(point.x, margin, sim.body.width - margin),
      y: clamp(point.y, margin, sim.body.height - margin),
    };
  }
  #phase(name: TheatreScene["phase"], duration: number) {
    const sim = this.#environment;
    if (!isTheatre(this.#scene)) {
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
      const mouth = this.#beak();
      const bubbles = Array.from({ length: 6 }, (_, index) => {
        return {
          id: sim.objects.nextId(),
          ...this.#pointOnScreen({
            x: mouth.x + sim.body.facing * (55 + index * 38),
            y: mouth.y + 10 + (index % 3) * 22,
          }),
          vx: sim.body.facing * (4 + index),
          vy: -3 - index,
          expires: sim.clock.now + 10 + index * 0.7,
        };
      });
      this.#scene = { ...clock, kind, phase: "chase", bubbles, pops: [] };
      this.#phase("chase", 14);
      sim.speech.say("floating trespassers.");
    } else if (kind === "bath") {
      const target = sim.body.safePoint({
        x: (point?.x ?? sim.body.x + 100) - 48,
        y: (point?.y ?? sim.body.y + 76) - 76,
      });
      this.#scene = {
        ...clock,
        kind,
        phase: "approach",
        target,
        bath: { x: target.x + 6, y: target.y + 56 },
        exit: target,
      };
      this.#phase("approach", 7);
      sim.speech.say("a private seaside resort.");
    } else if (kind === "toss") {
      const end = this.#pointOnScreen(
        point ?? { x: sim.body.width * 0.7, y: sim.body.y + 75 },
      );
      let direction: -1 | 1;
      if (end.x >= sim.body.x + 48) {
        direction = 1;
      } else {
        direction = -1;
      }
      const start = this.#pointOnScreen({
        x: sim.body.x + 48 - direction * 150,
        y: sim.body.y + 88,
      });
      const arc = {
        start,
        end,
        duration: 2.2,
        height: Math.min(140, sim.body.height * 0.25),
      };
      this.#scene = {
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
      this.#phase("takeoff", this.#scene.reaction);
      sim.speech.say("airborne lunch.");
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
      this.#scene = {
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
    if (!isTheatre(this.#scene)) {
      return;
    }
    sim.speech.clear();
    sim.speech.forget();
    if (this.#scene.kind === "baguette") {
      sim.body.place(sim.body.safePoint(this.#scene.origin));
    }
    if (this.#scene?.kind === "toss") {
      sim.body.place({
        x: sim.body.x,
        y: sim.body.safePoint({ x: sim.body.x, y: this.#scene.groundY }).y,
      });
    }
  }
  maybeTheatre() {
    const sim = this.#environment;
    const memory = this.#rareMemory();
    if (
      !sim.policy.visible() ||
      sim.policy.settings().paused ||
      sim.policy.settings().mischief <= 0 ||
      this.#scene ||
      sim.activity.mode !== "idle" ||
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
    const scene = this.#scene;
    if (!isTheatre(scene)) {
      return false;
    }
    if (sim.clock.now >= scene.deadline) {
      this.#finish();
      return true;
    }
    if (scene.kind === "bubbles") {
      this.#stepBubbles(dt);
    } else if (scene.kind === "bath") {
      this.#stepBath(dt);
    } else if (scene.kind === "toss") {
      this.#stepToss(dt);
    } else {
      this.#stepBaguette(dt);
    }
    return true;
  }
  #stepBubbles(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;
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
        this.#pointOnScreen({
          x: bubble.x + bubble.vx * dt,
          y: bubble.y + bubble.vy * dt,
        }),
      );
    }
    if (scene.phase === "chase") {
      const mouth = this.#beak();
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
        this.#finish("airspace secured.");
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
      const contact = this.#beak();
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
        sim.speech.say("AMBUSH.", 0.8);
      } else if (scene.phase === "startle") {
        this.#phase("proud", 0.8);
        sim.speech.say("exactly as planned.", 1.2);
      } else {
        this.#phase("chase", 14);
      }
    }
  }
  #stepBath(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;
    if (scene?.kind !== "bath") {
      return;
    }
    if (scene.phase === "approach") {
      if (sim.body.moveToward(scene.target, 220, dt)) {
        this.#phase("splash", 2.8);
        sim.speech.say("luxury.", 2);
      } else if (sim.clock.now >= scene.until) {
        this.#finish("the sea is too far away.");
      }
    } else if (scene.phase === "splash" && sim.clock.now >= scene.until) {
      this.#phase("shake", 2.2);
      sim.speech.say("every feather. individually.", 2.5);
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
        this.#finish("naturally immaculate.");
      }
    }
  }
  #chipPosition(scene: TossScene, elapsed: number) {
    const { start, end, duration, height } = scene.arc;
    const t = clamp(elapsed / duration, 0, 1);
    return this.#pointOnScreen(
      {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t - 4 * height * t * (1 - t),
      },
      18,
    );
  }
  #landToss(caught: boolean) {
    const sim = this.#environment;
    const scene = this.#scene;
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
      sim.speech.say("beak of the match.");
    } else {
      sim.speech.say("the wind cheated.", 2.5);
    }
  }
  #stepToss(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;
    if (scene?.kind !== "toss") {
      return;
    }
    const elapsed = sim.clock.now - scene.started;
    // A landed chip must follow display changes just like one still in flight.
    if (scene.chip) {
      Object.assign(scene.chip, this.#pointOnScreen(scene.chip, 18));
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
    } else if (scene.phase === "miss-flail") {
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
    } else if (scene.phase === "land") {
      const t = clamp((sim.clock.now - scene.phaseStarted) / 0.65, 0, 1);
      const ground = sim.body.safePoint({ x: sim.body.x, y: scene.groundY }).y;
      sim.body.place({
        x: sim.body.x,
        y: sim.body.safePoint({
          x: sim.body.x,
          y: scene.landFrom + (ground - scene.landFrom) * t,
        }).y,
      });
      if (sim.clock.now >= scene.until) {
        if (scene.caught) {
          this.#phase("eat", 1.1);
        } else {
          this.#phase("miss", 1.1);
        }
      }
    } else if (scene.phase === "miss" && sim.clock.now >= scene.until) {
      this.#phase("retrieve", 8);
      sim.speech.say("ground lunch is still lunch.");
    } else if (scene.phase === "retrieve" && scene.chip) {
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
        this.#phase("eat", 1.1);
      } else if (sim.clock.now >= scene.until) {
        this.#finish("saving that for later.");
      }
    } else if (scene.phase === "eat" && sim.clock.now >= scene.until) {
      this.#finish();
    }
  }
  #stepBaguette(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;
    if (scene?.kind !== "baguette") {
      return;
    }
    const speed = Math.max(70, sim.body.width / 9);
    if (scene.phase === "entrance" && sim.clock.now >= scene.until) {
      this.#phase("carry", 6);
    } else if (scene.phase === "carry") {
      if (
        sim.body.moveToward(scene.target, speed, dt) ||
        sim.clock.now >= scene.until
      ) {
        this.#phase("pause", 1.7);
      }
    } else if (scene.phase === "pause" && sim.clock.now >= scene.until) {
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
    } else if (scene.phase === "exit") {
      if (
        sim.body.moveToward(scene.target, speed, dt) ||
        sim.clock.now >= scene.until
      ) {
        this.#phase("departure", 0.8);
      }
    } else if (scene.phase === "departure" && sim.clock.now >= scene.until) {
      this.#phase("gone", 0.4);
    } else if (scene.phase === "gone" && sim.clock.now >= scene.until) {
      this.#finish();
    }
    sim.body.face(scene.direction as -1 | 1);
  }
}
