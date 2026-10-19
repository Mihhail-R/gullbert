import { SceneState } from "../scene-state.js";
import { dialogue } from "../dialogue.js";
import type { ReadonlyValue } from "../presentation.js";
import { scopeCapabilities } from "../capabilities.js";
import type { RecallReservation } from "../long-term-memory.js";
import type { Pose } from "../poses.js";
import type { Point } from "../model.js";
import type { SimulationView, BehaviorCapabilities } from "../capabilities.js";
import type { RecallOwner } from "../routine.js";
import type { Scene, GiftPurpose, GiftScene as OwnedScene } from "../scenes.js";
import { ITEMS } from "../items.js";

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
  | "meals"
>;
export class GiftRoutine implements RecallOwner {
  #environment: Environment;
  #state = new SceneState<OwnedScene>();

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
      "meals",
    ]);
  }
  get scene(): ReadonlyValue<OwnedScene> | null {
    return this.#state.snapshot();
  }

  get identity(): object {
    return this.#state.identity;
  }
  install(scene: ReadonlyValue<Scene>): void {
    this.#state.install(scene as ReadonlyValue<OwnedScene>);
  }
  clear(): void {
    this.#state.clear();
  }
  start(name: string): boolean {
    const handled = this.#startGift(name);

    if (handled) {
      this.#state.activate();
    }

    return handled;
  }
  update(dt: number): "running" | "complete" {
    this.#stepGift(dt);

    if (!this.#state.current) {
      return "complete";
    }

    return "running";
  }
  complete(): void {
    this.#ground();
    this.#state.clear();
  }
  presentation() {
    const sim = this.#environment;
    return {
      pose:
        giftPose({
          ...sim.body.snapshot(),
          ...sim.activity.snapshot(),
          time: sim.clock.now,
          scene: this.#state.current,
        }) ?? undefined,
    };
  }
  interrupt(): void {
    this.#ground();
    this.#state.clear();
  }
  visibility(): void {}

  #ground(): void {
    if (!this.#state.current) {
      return;
    }

    const body = this.#environment.body;
    const origin = body.safePoint(this.#state.current.origin);
    body.place(body.safePoint({ x: body.x, y: origin.y }));
  }

  #finish(delay = 6) {
    const sim = this.#environment;
    sim.activity.settleUntil(sim.clock.now + delay);
    sim.lifecycle.complete();
    sim.lifecycle.rest(delay);
  }
  #startGift(name: string) {
    const sim = this.#environment;

    if (name !== "bring_gift") {
      return false;
    }

    this.#beginGift({
      purpose: "discovery",
      item: sim.belongings.chooseGift(sim.random),
    });
    return true;
  }

  startRecall(recall: RecallReservation): boolean {
    const memory = recall.memory;

    if (memory.kind !== "treasure") {
      return false;
    }

    const collection = this.#environment.belongings.snapshot().memory.collection;

    if ((collection[memory.item] ?? 0) <= 0) {
      return false;
    }

    this.#beginGift({
      purpose: "retrieve-keepsake",
      item: memory.item,
      recall: structuredClone(recall),
    });
    this.#state.activate();
    return true;
  }

  #beginGift(gift: GiftPurpose): void {
    const sim = this.#environment;
    let side: -1 | 1;

    if (sim.body.x < sim.body.width / 2) {
      side = -1;
    } else {
      side = 1;
    }

    this.#state.current = {
      kind: "gift",
      phase: "takeoff",
      ...gift,
      carrying: false,
      origin: sim.body.safePoint({ x: sim.body.x, y: sim.body.y }),
      side: side,
      until: sim.clock.now + 0.45,
      deadline: sim.clock.now + 20,
      speed: Math.max(360, sim.body.width / 1.8),
    };
    sim.activity.beginRoutine("gift");
    const line = gift.purpose === "retrieve-keepsake"
      ? dialogue.gullbert.gifts.fetchingSomething
      : dialogue.gullbert.gifts.backSoonExcellentJudgementAwaits;
    sim.speech.say(line, 2);
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
  #reveal(scene: OwnedScene): void {
    const sim = this.#environment;

    if (scene.purpose === "retrieve-keepsake") {
      const line = scene.item === "bent_spoon"
        ? dialogue.gullbert.gifts.stillAnExcellentSpoon
        : dialogue.gullbert.gifts.keptThis;
      sim.speech.say(line, 3);
      return;
    }

    const favourite = sim.belongings.favouriteTreasure();
    const line = scene.item === favourite
      ? dialogue.gullbert.gifts.myFavourite
      : ITEMS[scene.item].reveal;
    sim.speech.say(line, 3);
  }

  #stepGift(dt: number) {
    const sim = this.#environment;
    const scene = this.#state.current;

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
          const line = scene.purpose === "retrieve-keepsake"
            ? dialogue.gullbert.gifts.keptThis
            : dialogue.gullbert.gifts.beholdMyImpeccableTaste;
          sim.speech.say(line, 2);
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
          this.#reveal(scene);

          if (scene.item === "chip") {
            sim.events.emit("munch");
            sim.meals.consumed({ x: sim.body.x, y: sim.body.y });
          }
        }

        break;
      }

      case "reveal": {
        if (sim.clock.now >= scene.until) {
          if (scene.purpose === "retrieve-keepsake") {
            sim.belongings.completeRecall(scene.recall, sim.body);
          } else if (scene.item !== "chip") {
            sim.belongings.collect(scene.item, sim.body);
          }

          this.#finish();
        }

        break;
      }
    }

    return true;
  }
}
