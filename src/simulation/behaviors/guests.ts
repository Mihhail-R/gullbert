import { dialogue } from "../dialogue.js";
import { readingDuration } from "../speech.js";
import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import { scopeCapabilities } from "../capabilities.js";
import { clamp } from "../geometry.js";
import type { GuestScene } from "../scenes.js";
import type { SceneProp } from "../model.js";
import type { Pose } from "../poses.js";
import type { SimulationView, BehaviorCapabilities } from "../capabilities.js";
import type { SceneOwner } from "../routine.js";
import type { Scene, GuestScene as OwnedScene } from "../scenes.js";

const VISIT_LIMIT = 90;
const TURN_PAUSE = 0.4;

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

export function guestPose(
  sim: Pick<SimulationView, "scene" | "motionTime">,
): Pose | null {
  const scene = sim.scene;

  if (scene?.kind !== "guest") {
    return null;
  }

  if (scene.phase === "arrival") {
    return (["idle", "walkLeft", "idle", "walkRight"] as const)[
      Math.floor(sim.motionTime * 10) % 4
    ];
  }

  if (scene.phase === "squawk-main") {
    return "squawk";
  }

  if (["faceoff", "posture", "squawk-guest"].includes(scene.phase)) {
    return "bag-offended";
  }

  if (["inspect", "stare", "snatch"].includes(scene.phase)) {
    return "tilt";
  }

  if (scene.phase === "reaction") {
    return "nap-accuse";
  } else {
    return "blink";
  }
}

function guestAsset(scene: GuestScene, time: number) {
  let prefix;

  if (scene.species === "pigeon") {
    prefix = "pigeon";
  } else {
    prefix = "guest";
  }

  if (["arrival", "departure"].includes(scene.phase)) {
    let walkingPose;

    if (Math.floor(time * 9) % 2) {
      walkingPose = "walk";
    } else {
      walkingPose = "idle";
    }

    return `${prefix}-${walkingPose}`;
  }

  if (scene.phase === "squawk-guest") {
    return `${prefix}-squawk`;
  }

  if (["faceoff", "posture", "squawk-main"].includes(scene.phase)) {
    return `${prefix}-posture`;
  }

  if (scene.species === "pigeon" && scene.phase === "inspect") {
    return "pigeon-inspect";
  }

  return `${prefix}-idle`;
}

export function guestProps(
  sim: Pick<SimulationView, "scene" | "visible" | "time" | "width" | "height">,
) {
  const scene = sim.scene;

  if (!sim.visible || scene?.kind !== "guest") {
    return [];
  }

  const props: SceneProp[] = [
    {
      id: "visitor",
      asset: guestAsset(scene, sim.time),
      x: scene.guest.x,
      y: scene.guest.y,
      width: 96,
      height: 96,
      flip: scene.guest.facing < 0,
    },
  ];

  if (scene.species === "gull") {
    function chip(id: string, x: number, y: number) {
      return {
        id,
        asset: "chip",
        x: clamp(x, 0, sim.width - 24),
        y: clamp(y, 0, sim.height - 18),
        width: 24,
        height: 18,
      };
    }

    for (let i = 0; i < 5; i++) {
      props.push(
        chip(
          `ignored-chip-${i}`,
          scene.anchor.x - 58 + i * 25,
          scene.anchor.y + 28 + (i % 2) * 8,
        ),
      );
    }

    if (!scene.chipTaken) {
      props.push(
        chip("disputed-chip", scene.anchor.x - 12, scene.anchor.y - 8),
      );
    } else {
      let beakOffsetX;

      if (scene.guest.facing < 0) {
        beakOffsetX = 6;
      } else {
        beakOffsetX = 66;
      }

      props.push({
        id: "snatched-chip",
        asset: "chip",
        x: scene.guest.x + beakOffsetX,
        y: scene.guest.y + 38,
        width: 24,
        height: 18,
      });
    }
  }

  return props;
}

export function guestSpeech(
  sim: Pick<SimulationView, "scene" | "visible" | "time">,
) {
  const scene = sim.scene;

  if (!sim.visible || scene?.kind !== "guest") {
    return null;
  }

  if (
    !scene.guestText ||
    sim.time < scene.guestStarts ||
    sim.time > scene.guestUntil
  ) {
    return null;
  }

  return {
    text: scene.guestText,
    x: scene.guest.x + 48,
    y: scene.guest.y - 35,
  };
}

type Environment = Pick<
  BehaviorCapabilities,
  | "clock"
  | "random"
  | "speech"
  | "body"
  | "objects"
  | "activity"
  | "lifecycle"
  | "food"
  | "policy"
  | "events"
  | "commands"
  | "belongings"
>;
interface GuestExchange {
  readonly gullbert: string;
  readonly visitor: string;
}

export class GuestRoutine implements SceneOwner {
  #dialogueIndex = 0;

  #exchange(
    phase: GuestScene["phase"],
    duration: number,
    lines: readonly GuestExchange[],
  ): void {
    const pair = lines[this.#dialogueIndex % lines.length];
    this.#stage(phase, duration, pair.gullbert, pair.visitor);
  }

  #environment: Environment;
  #scene: OwnedScene | null = null;
  #identity: object = Object.freeze({});
  #nextGuest?: number;
  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "clock",
      "random",
      "speech",
      "body",
      "objects",
      "activity",
      "lifecycle",
      "food",
      "policy",
      "events",
      "commands",
      "belongings",
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
    const handled = this.#startGuest(name);

    if (handled && this.#scene) {
      this.#identity = Object.freeze({});
    }

    return handled;
  }
  update(dt: number): "running" | "complete" {
    this.#stepGuest(dt);

    if (!this.#scene) {
      return "complete";
    }

    return "running";
  }
  complete(): void {
    this.#cancelGuest();
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
    const props = guestProps(observation);
    const looseProps = props.filter(function looseChip(prop) {
      return prop.asset === "chip" && prop.id !== "snatched-chip";
    });
    return observe({
      pose: guestPose(observation) ?? undefined,
      props,
      looseProps,
      guestSpeech: guestSpeech(observation),
    });
  }
  interrupt(): void {
    this.#cancelGuest();
    this.#scene = null;
  }
  visibility(visible: boolean): void {
    if (!visible && this.#scene) {
      this.#environment.lifecycle.interrupt();
      this.#environment.lifecycle.rest();
    }
  }
  get nextGuest() {
    return this.#nextGuest;
  }
  #cooldown() {
    const sim = this.#environment;
    this.#nextGuest = sim.clock.now + 240 + sim.random() * 180;
  }
  #stage(
    phase: GuestScene["phase"],
    duration: number,
    mainText = "",
    guestText = "",
  ) {
    const sim = this.#environment;
    const scene = this.#scene;

    if (scene?.kind !== "guest") {
      return;
    }

    scene.phase = phase;
    scene.phaseStarted = sim.clock.now;
    let mainDuration = 0;

    if (mainText) {
      mainDuration = readingDuration(mainText);
    }

    let guestDelay = 0;

    if (mainText && guestText) {
      guestDelay = mainDuration + TURN_PAUSE;
    }

    let guestDuration = 0;

    if (guestText) {
      guestDuration = readingDuration(guestText);
    }

    scene.guestStarts = sim.clock.now + guestDelay;
    scene.guestUntil = scene.guestStarts + guestDuration;
    scene.until = Math.max(
      sim.clock.now + duration,
      sim.clock.now + mainDuration,
      scene.guestUntil,
    );
    scene.guestText = guestText;
    sim.speech.clear();
    sim.speech.forget();

    if (mainText) {
      sim.speech.say(mainText, mainDuration);
    }

    sim.body.resetMotion();
  }
  #startGuest(name: string) {
    const sim = this.#environment;

    if (!["invite_pigeon", "gull_argument"].includes(name)) {
      return false;
    }

    let species: GuestScene["species"];

    if (name === "invite_pigeon") {
      species = "pigeon";
    } else {
      species = "gull";
    }

    const bag = sim.objects.snapshot().bag;
    const hasSnack = species === "pigeon" && bag !== null && bag.servings > 0;
    // A shared stage keeps both birds and the snack readable on the display.
    let anchorX;

    if (hasSnack && bag) {
      anchorX = bag.x + 25;
    } else {
      anchorX = sim.body.x + 100;
    }

    let anchorY;

    if (hasSnack && bag) {
      anchorY = bag.y + 30;
    } else {
      anchorY = sim.body.y + 72;
    }

    const anchor = {
      x: clamp(
        anchorX,
        Math.min(132, sim.body.width / 2),
        Math.max(sim.body.width / 2, sim.body.width - 132),
      ),
      y: clamp(
        anchorY,
        Math.min(80, sim.body.height / 2),
        sim.body.height - 20,
      ),
    };
    const mainTarget = sim.body.safePoint({
      x: anchor.x - 120,
      y: anchor.y - 72,
    });
    const guestTarget = sim.body.safePoint({
      x: anchor.x + 24,
      y: anchor.y - 72,
    });
    let bagId: number | null;

    if (hasSnack && bag) {
      bagId = bag.id;
    } else {
      bagId = null;
    }

    this.#scene = {
      kind: "guest",
      species,
      started: sim.clock.now,
      deadline: sim.clock.now + VISIT_LIMIT,
      anchor,
      mainTarget,
      mainOrigin: { x: sim.body.x, y: sim.body.y },
      guestTarget,
      guest: { x: sim.body.width + 12, y: guestTarget.y, facing: -1 },
      entryX: sim.body.width + 12,
      bagId: bagId,
      hasSnack,
      chipTaken: false,
      phase: "arrival",
      phaseStarted: sim.clock.now,
      until: sim.clock.now,
      guestText: "",
      guestStarts: sim.clock.now,
      guestUntil: sim.clock.now,
      departureOrigin: guestTarget,
    };
    sim.activity.beginRoutine("guest");
    sim.activity.stopTravel();
    this.#cooldown();
    this.#dialogueIndex = sim.belongings.snapshot().memory.visits[species];

    if (species === "pigeon") {
      this.#exchange("arrival", 2.6, dialogue.guests.pigeon.arrival);
    } else {
      this.#exchange("arrival", 2.6, dialogue.guests.seagull.arrival);
    }

    return true;
  }
  #cancelGuest() {
    const sim = this.#environment;

    if (this.#scene?.kind !== "guest") {
      return false;
    }

    this.#scene = null;
    sim.speech.clear();
    sim.speech.forget();
    this.#cooldown();
    return true;
  }
  #depart(lines: readonly GuestExchange[]) {
    const scene = this.#scene;

    if (scene?.kind !== "guest") {
      return;
    }

    scene.departureOrigin = { x: scene.guest.x, y: scene.guest.y - 35 };
    scene.guest.facing = 1;
    this.#exchange("departure", 2.4, lines);
    // Finish the farewell while both birds are still readable, then walk out.
    scene.until += 2.4;
  }
  #finish() {
    const sim = this.#environment;
    this.#cancelGuest();
    sim.lifecycle.rest(4);
    sim.food.afterGuest(sim.clock.now);
  }
  #stepGuest(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;

    if (scene?.kind !== "guest") {
      return false;
    }

    if (!sim.policy.visible() || sim.clock.now >= scene.deadline) {
      this.#finish();
      return true;
    }

    const guest = scene.guest;
    const mainTarget = sim.body.safePoint(scene.mainTarget);
    const guestTarget = sim.body.safePoint(scene.guestTarget);
    scene.anchor.x = clamp(scene.anchor.x, 12, sim.body.width - 12);
    scene.anchor.y = clamp(scene.anchor.y, 12, sim.body.height - 12);

    if (scene.phase === "arrival") {
      const progress = clamp((sim.clock.now - scene.phaseStarted) / 2.6, 0, 1);
      guest.x = lerp(scene.entryX, guestTarget.x, progress);
      guest.y = guestTarget.y;
      const target = sim.body.safePoint({
        x: lerp(scene.mainOrigin.x, mainTarget.x, progress),
        y: lerp(scene.mainOrigin.y, mainTarget.y, progress),
      });
      sim.body.moveToward(
        target,
        Math.max(sim.body.width, sim.body.height),
        dt,
      );

      if (sim.clock.now >= scene.until) {
        sim.belongings.visited(scene.species, mainTarget);
        sim.body.place({ x: mainTarget.x, y: sim.body.y });
        sim.body.place({ x: sim.body.x, y: mainTarget.y });
        guest.x = guestTarget.x;
        sim.body.face(1 as -1 | 1);

        if (scene.species === "pigeon") {
          this.#exchange("inspect", 2, dialogue.guests.pigeon.inspect);
        } else {
          this.#exchange("stare", 2, dialogue.guests.seagull.stare);
        }
      }
    } else if (scene.phase === "departure") {
      const progress = clamp((sim.clock.now - (scene.until - 2.4)) / 2.4, 0, 1);
      guest.x = lerp(scene.departureOrigin.x, sim.body.width + 100, progress);
      guest.y = guestTarget.y;

      if (sim.clock.now >= scene.until) {
        this.#finish();
      }
    } else {
      guest.x = guestTarget.x;
      guest.y = guestTarget.y;
      sim.body.place({ x: mainTarget.x, y: sim.body.y });
      sim.body.place({ x: sim.body.x, y: mainTarget.y });
      sim.body.face(1 as -1 | 1);
      guest.facing = -1;
      // The mirrored gull's beak centre is (18, 47). Move it onto the chip
      // before possession changes, then retreat with the chip at the beak.
      const snatchTarget = sim.body.safePoint({
        x: clamp(scene.anchor.x - 12, 0, sim.body.width - 24) + 12 - 18,
        y: clamp(scene.anchor.y - 8, 0, sim.body.height - 18) + 9 - 47,
      });

      if (scene.phase === "snatch") {
        const progress = clamp(
          (sim.clock.now - scene.phaseStarted) / 0.56,
          0,
          1,
        );
        guest.x = lerp(guestTarget.x, snatchTarget.x, progress);
        guest.y = lerp(guestTarget.y, snatchTarget.y, progress);
      } else if (scene.phase === "reaction") {
        const progress = clamp(
          (sim.clock.now - scene.phaseStarted) / 0.65,
          0,
          1,
        );
        guest.x = lerp(snatchTarget.x, guestTarget.x, progress);
        guest.y = lerp(snatchTarget.y, guestTarget.y, progress);
      }

      // Missing or emptied bags turn the same visit into judgmental looks.
      if (scene.species === "pigeon" && scene.hasSnack) {
        const bag = sim.objects.snapshot().bag;

        if (scene.bagId !== bag?.id || !((bag?.servings ?? 0) > 0)) {
          scene.hasSnack = false;
          this.#exchange("inspect", 1.5, dialogue.guests.pigeon.snackRemoved);
        }
      }

      if (sim.clock.now >= scene.until) {
        if (scene.species === "pigeon") {
          this.#stepPigeon();
        } else {
          this.#stepArgument();
        }
      }
    }

    return true;
  }
  #stepPigeon() {
    const scene = this.#scene;

    if (scene?.kind !== "guest") {
      return;
    }

    if (scene.phase === "inspect") {
      if (scene.hasSnack) {
        this.#exchange(
          "faceoff",
          2.4,
          dialogue.guests.pigeon.faceoffWithSnacks,
        );
      } else {
        this.#exchange(
          "faceoff",
          2.4,
          dialogue.guests.pigeon.faceoffWithoutSnacks,
        );
      }
    } else if (scene.phase === "faceoff") {
      if (scene.hasSnack) {
        this.#exchange(
          "judgment",
          1.8,
          dialogue.guests.pigeon.judgmentWithSnacks,
        );
      } else {
        this.#exchange(
          "judgment",
          1.8,
          dialogue.guests.pigeon.judgmentWithoutSnacks,
        );
      }
    } else if (scene.phase === "judgment") {
      this.#depart(dialogue.guests.pigeon.departure);
    }
  }
  #stepArgument() {
    const sim = this.#environment;
    const scene = this.#scene;

    if (scene?.kind !== "guest") {
      return;
    }

    switch (scene.phase) {
      case "stare": {
        this.#exchange("posture", 1.8, dialogue.guests.seagull.posture);

        break;
      }

      case "posture": {
        this.#exchange(
          "squawk-main",
          1.4,
          dialogue.guests.seagull.gullbertSquawk,
        );
        sim.events.emit("squawk");

        break;
      }

      case "squawk-main": {
        this.#exchange(
          "squawk-guest",
          1.4,
          dialogue.guests.seagull.visitorSquawk,
        );
        sim.events.emit("squawk");

        break;
      }

      case "squawk-guest": {
        this.#exchange("snatch", 0.8, dialogue.guests.seagull.snatch);

        break;
      }

      case "snatch": {
        scene.chipTaken = true;
        this.#exchange("reaction", 2, dialogue.guests.seagull.reaction);

        break;
      }

      case "reaction": {
        this.#depart(dialogue.guests.seagull.departure);

        break;
      }
    }
  }
  maybeGuest() {
    const sim = this.#environment;

    if (this.#nextGuest == null) {
      this.#nextGuest = sim.clock.now + 180 + sim.random() * 180;
    }

    if (
      !sim.policy.visible() ||
      sim.policy.settings().paused ||
      sim.policy.settings().mischief <= 0
    ) {
      return false;
    }

    if (this.#scene || sim.activity.mode !== "idle") {
      return false;
    }

    if (sim.clock.now < this.#nextGuest) {
      return false;
    }

    if (sim.random() < 0.65) {
      sim.commands.action("invite_pigeon");
    } else {
      sim.commands.action("gull_argument");
    }

    return true;
  }
}
