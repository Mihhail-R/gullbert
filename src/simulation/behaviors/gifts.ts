import { dialogue } from "../dialogue.js";
import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import { scopeCapabilities } from "../capabilities.js";
import type { Item, Collectible } from "../items.js";
import type { Pose } from "../poses.js";
import type { Point } from "../model.js";
import type { SimulationView, BehaviorCapabilities } from "../capabilities.js";
import type { SceneOwner } from "../routine.js";
import type { Scene, GiftScene as OwnedScene } from "../scenes.js";
import { ITEMS } from "../items.js";

const treasures: Collectible[] = [
  "bottle_cap",
  "bent_spoon",
  "sock",
  "glass_diamond",
];
const gifts: Item[] = [...treasures, "parking_ticket", "chip"];
export function giftPose(
  sim: Pick<SimulationView, "scene" | "time">,
): Pose | null {
  const scene = sim.scene;

  if (scene?.kind !== "gift") {
    return null;
  }

  if (scene.phase === "takeoff") {
    if (scene.until - sim.time > 0.25) {
      return "crouch";
    } else {
      return "wingUp";
    }
  }

  if (scene.phase === "land") {
    if (scene.until - sim.time > 0.2) {
      return "wingDown";
    } else {
      return "crouch";
    }
  }

  if (scene.phase === "reveal") {
    if (scene.item === "chip") {
      if (Math.floor(sim.time * 6) % 2) {
        return "bag-inspect";
      } else {
        return "squawk";
      }
    }

    if (scene.item === "parking_ticket") {
      return "bag-offended";
    } else {
      return "blink";
    }
  }

  if (Math.floor(sim.time * 10) % 2) {
    return "wingUp";
  } else {
    return "wingDown";
  }
}

type Environment = Pick<
  BehaviorCapabilities,
  | "belongings"
  | "random"
  | "activity"
  | "clock"
  | "lifecycle"
  | "body"
  | "speech"
  | "events"
>;
export class GiftRoutine implements SceneOwner {
  #environment: Environment;
  #scene: OwnedScene | null = null;
  #identity: object = Object.freeze({});

  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "belongings",
      "random",
      "activity",
      "clock",
      "lifecycle",
      "body",
      "speech",
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
    const handled = this.#startGift(name);

    if (handled && this.#scene) {
      this.#identity = Object.freeze({});
    }

    return handled;
  }
  update(dt: number): "running" | "complete" {
    this.#stepGift(dt);

    if (!this.#scene) {
      return "complete";
    }

    return "running";
  }
  complete(): void {
    this.#ground();
    this.#scene = null;
  }
  presentation() {
    const sim = this.#environment;
    return {
      pose:
        giftPose({
          ...sim.body.snapshot(),
          ...sim.activity.snapshot(),
          time: sim.clock.now,
          scene: this.#scene,
        }) ?? undefined,
    };
  }
  interrupt(): void {
    this.#ground();
    this.#scene = null;
  }
  visibility(): void {}

  #ground(): void {
    if (!this.#scene) {
      return;
    }

    const body = this.#environment.body;
    const origin = body.safePoint(this.#scene.origin);
    body.place(body.safePoint({ x: body.x, y: origin.y }));
  }

  #choose<T>(choices: T[]) {
    const sim = this.#environment;
    return choices[
      Math.min(choices.length - 1, Math.floor(sim.random() * choices.length))
    ];
  }
  #finish(delay = 6) {
    const sim = this.#environment;
    sim.activity.settleUntil(sim.clock.now + delay);
    sim.lifecycle.complete();
    sim.lifecycle.rest(delay);
  }
  #collect(item: Collectible) {
    this.#environment.belongings.collect(item, this.#environment.body);
  }
  #startGift(name: string) {
    const sim = this.#environment;

    if (name !== "bring_gift") {
      return false;
    }

    let side: -1 | 1;

    if (sim.body.x < sim.body.width / 2) {
      side = -1;
    } else {
      side = 1;
    }

    this.#scene = {
      kind: "gift",
      phase: "takeoff",
      item: this.#choose(gifts),
      carrying: false,
      origin: sim.body.safePoint({ x: sim.body.x, y: sim.body.y }),
      side: side,
      until: sim.clock.now + 0.45,
      deadline: sim.clock.now + 20,
      speed: Math.max(360, sim.body.width / 1.8),
    };
    sim.activity.beginRoutine("gift");
    sim.speech.say(dialogue.gullbert.gifts.backSoonExcellentJudgementAwaits, 2);
    return true;
  }
  #flyTo(target: Point, speed: number, dt: number) {
    const sim = this.#environment;
    const dx = target.x - sim.body.x;
    const dy = target.y - sim.body.y;
    const distance = Math.hypot(dx, dy);

    if (Math.abs(dx) > 1) {
      if (dx < 0) {
        sim.body.face(-1 as -1 | 1);
      } else {
        sim.body.face(1 as -1 | 1);
      }
    }

    sim.body.advanceMotion(dt);

    if (distance <= speed * dt) {
      sim.body.place({ x: target.x, y: sim.body.y });
      sim.body.place({ x: sim.body.x, y: target.y });
      return true;
    }

    sim.body.place({
      x: sim.body.x + (dx / distance) * speed * dt,
      y: sim.body.y,
    });
    sim.body.place({
      x: sim.body.x,
      y: sim.body.y + (dy / distance) * speed * dt,
    });
    return false;
  }
  #stepGift(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;

    if (scene?.kind !== "gift") {
      return false;
    }

    const origin = sim.body.safePoint(scene.origin);
    const airborneY = Math.max(0, origin.y - 70);
    // A display expansion must not turn a short outing into a timed-out flight.
    const speed = Math.max(scene.speed, sim.body.width / 1.8);

    if (sim.clock.now >= scene.deadline) {
      this.#finish();
      return true;
    }

    switch (scene.phase) {
      case "takeoff": {
        const progress = Math.min(1, 1 - (scene.until - sim.clock.now) / 0.45);
        sim.body.place({
          x: sim.body.x,
          y: origin.y + (airborneY - origin.y) * progress,
        });

        if (sim.clock.now >= scene.until) {
          scene.phase = "depart";
        }

        break;
      }

      case "depart": {
        let departureX;

        if (scene.side < 0) {
          departureX = -96;
        } else {
          departureX = sim.body.width;
        }

        if (this.#flyTo({ x: departureX, y: airborneY }, speed, dt)) {
          scene.phase = "away";
          scene.until = sim.clock.now + 2.2;
          sim.speech.clear();
        }

        break;
      }

      case "away": {
        if (sim.clock.now >= scene.until) {
          scene.phase = "return";
          scene.carrying = true;

          if (scene.side < 0) {
            sim.body.place({ x: -96, y: sim.body.y });
          } else {
            sim.body.place({ x: sim.body.width, y: sim.body.y });
          }

          sim.body.place({ x: sim.body.x, y: airborneY });
          sim.speech.say(dialogue.gullbert.gifts.beholdMyImpeccableTaste, 2);
        }

        break;
      }

      case "return": {
        if (this.#flyTo({ x: origin.x, y: airborneY }, speed, dt)) {
          scene.phase = "land";
          scene.until = sim.clock.now + 0.65;
        }

        break;
      }

      case "land": {
        const progress = Math.min(1, 1 - (scene.until - sim.clock.now) / 0.65);
        sim.body.place({
          x: sim.body.x,
          y: airborneY + (origin.y - airborneY) * progress,
        });

        if (sim.clock.now >= scene.until) {
          scene.phase = "reveal";
          scene.until = sim.clock.now + 1.8;
          sim.speech.say(ITEMS[scene.item].reveal, 3);

          if (scene.item === "chip") {
            sim.events.emit("munch");
          }
        }

        break;
      }

      case "reveal": {
        if (sim.clock.now >= scene.until) {
          if (scene.item !== "chip") {
            this.#collect(scene.item);
          }

          this.#finish();
        }

        break;
      }
    }

    return true;
  }
}
