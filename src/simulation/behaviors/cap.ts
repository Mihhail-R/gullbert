import { enterPhase } from "../phase-timing.js";
import { scopeCapabilities } from "../capabilities.js";
import type { BehaviorCapabilities } from "../capabilities.js";
import { isPointOnScreen, beakOffsetX, clamp } from "../geometry.js";
import { dialogue } from "../dialogue.js";
import { capHitRect } from "../interaction.js";
import type { Point, PointerSample } from "../model.js";
import { observe } from "../observation.js";
import type { Pose } from "../poses.js";
import type { ReadonlyValue } from "../presentation.js";
import type { RoutinePresentation, SceneOwner } from "../routine.js";
import type { CapScene } from "../scenes.js";
import { contains } from "./touch.js";

type Environment = Pick<
  BehaviorCapabilities,
  "body" | "clock" | "activity" | "lifecycle" | "speech"
>;

const RUN_SPEED = 390;
const CAP_SPEED = 560;
const READY_SECONDS = 12;
const MATCH_SECONDS = 60;

/** A finite, click-driven game; the cap never becomes a durable belonging. */
export class CapRoutine implements SceneOwner {
  #environment: Environment;
  #scene: CapScene | null = null;
  #identity: object = Object.freeze({});

  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "body",
      "clock",
      "activity",
      "lifecycle",
      "speech",
    ]);
  }

  get scene(): ReadonlyValue<CapScene> | null {
    return observe(this.#scene);
  }

  get identity(): object {
    return this.#identity;
  }

  clear(): void {
    this.#scene = null;
  }

  start(name: string): boolean {
    if (name !== "play_cap") {
      return false;
    }

    const sim = this.#environment;
    const cap = this.#onScreen(this.#mouth());
    this.#scene = {
      kind: "cap",
      phase: "drop",
      started: sim.clock.now,
      phaseStarted: sim.clock.now,
      until: sim.clock.now + 0.45,
      deadline: sim.clock.now + MATCH_SECONDS,
      cap,
      target: this.#onScreen({
        x: sim.body.x + 48 + sim.body.facing * 70,
        y: sim.body.y + 72,
      }),
      pointer: null,
      rounds: 0,
      carrying: false,
    };
    this.#identity = Object.freeze({});
    sim.activity.beginRoutine("cap");
    sim.speech.say(dialogue.gullbert.cap.invitation, 4);
    return true;
  }

  pointerSample(point: PointerSample | null): void {
    const scene = this.#scene;

    if (!scene || !point || point.inside === false) {
      return;
    }

    if (
      !isPointOnScreen(
        point,
        this.#environment.body.width,
        this.#environment.body.height,
      )
    ) {
      return;
    }

    // Losing the pointer leaves the last known return destination intact.
    scene.pointer = { x: point.x, y: point.y };
  }

  flick(point: Point): boolean {
    const scene = this.#scene;
    const rect = capHitRect(scene);

    if (!scene || !rect) {
      return false;
    }

    if (
      !isPointOnScreen(
        point,
        this.#environment.body.width,
        this.#environment.body.height,
      ) ||
      !contains(rect, point)
    ) {
      return false;
    }

    const sim = this.#environment;
    let dx = scene.cap.x - point.x;
    let dy = scene.cap.y - point.y;

    if (Math.hypot(dx, dy) < 3) {
      dx = scene.cap.x - sim.body.x - 48;
      dy = scene.cap.y - sim.body.y - 48;
    }

    if (Math.hypot(dx, dy) < 3) {
      dx = sim.body.facing;
      dy = 0;
    }

    const distance = Math.hypot(dx, dy);
    let target = this.#onScreen({
      x: scene.cap.x + (dx / distance) * 230,
      y: scene.cap.y + (dy / distance) * 230,
    });

    // A kick into a display edge rebounds inward instead of getting stuck.
    if (Math.hypot(target.x - scene.cap.x, target.y - scene.cap.y) < 35) {
      target = this.#onScreen({
        x: scene.cap.x - (dx / distance) * 230,
        y: scene.cap.y - (dy / distance) * 230,
      });
    }

    scene.target = target;
    scene.pointer = { x: point.x, y: point.y };
    this.#phase("chase", 7);
    sim.speech.say(dialogue.gullbert.cap.chase, 0.8);
    return true;
  }

  resize(): void {
    const scene = this.#scene;

    if (!scene) {
      return;
    }

    scene.cap = this.#onScreen(scene.cap);

    if (scene.phase === "victory") {
      scene.target = this.#environment.body.safePoint(scene.target);
    } else {
      scene.target = this.#onScreen(scene.target);
    }

    if (scene.pointer) {
      scene.pointer = {
        x: clamp(scene.pointer.x, 0, this.#environment.body.width),
        y: clamp(scene.pointer.y, 0, this.#environment.body.height),
      };
    }
  }

  update(dt: number): "running" | "complete" {
    const sim = this.#environment;
    const scene = this.#scene;

    if (!scene) {
      return "complete";
    }

    if (sim.clock.now >= scene.deadline) {
      this.#finish(dialogue.gullbert.cap.abandoned);
      return "complete";
    }

    switch (scene.phase) {
      case "drop": {
        this.#slideCap(220, dt);

        if (sim.clock.now >= scene.until) {
          scene.cap = { ...scene.target };
          this.#phase("ready", READY_SECONDS);
        }

        break;
      }

      case "ready": {
        if (sim.clock.now >= scene.until) {
          this.#phase("collect", 7);
          sim.speech.say(dialogue.gullbert.cap.forfeit, 1.5);
        }

        break;
      }

      case "chase": {
        const stopped = this.#slideCap(CAP_SPEED, dt);
        const arrived = this.#approachCap(dt);

        if (stopped && arrived) {
          this.#phase("peck", 0.3);
        } else if (sim.clock.now >= scene.until) {
          this.#phase("collect", 7);
        }

        break;
      }

      case "peck": {
        if (sim.clock.now >= scene.until) {
          scene.rounds += 1;
          scene.target = this.#onScreen(scene.pointer ?? scene.cap);
          this.#phase("return", 6);

          if (scene.rounds >= 3) {
            sim.speech.say(dialogue.gullbert.cap.lastReturn, 1.4);
          } else {
            sim.speech.say(dialogue.gullbert.cap.yourMove, 1.4);
          }
        }

        break;
      }

      case "return": {
        if (this.#slideCap(CAP_SPEED, dt) || sim.clock.now >= scene.until) {
          scene.cap = { ...scene.target };

          if (scene.rounds >= 3) {
            this.#phase("collect", 7);
          } else {
            this.#phase("ready", READY_SECONDS);
          }
        }

        break;
      }

      case "collect": {
        if (this.#approachCap(dt)) {
          scene.carrying = true;
          let direction = 1;

          if (sim.body.x + 48 > sim.body.width / 2) {
            direction = -1;
          }

          scene.target = sim.body.safePoint({
            x: sim.body.x + direction * 150,
            y: sim.body.y,
          });
          this.#phase("victory", 1.5);
          sim.speech.say(dialogue.gullbert.cap.victory, 3);
        } else if (sim.clock.now >= scene.until) {
          this.#finish(dialogue.gullbert.cap.keepingTrophy);
        }

        break;
      }

      case "victory": {
        sim.body.moveToward(scene.target, 180, dt);
        scene.cap = this.#mouth();

        if (sim.clock.now >= scene.until) {
          this.#finish();
        }

        break;
      }
    }

    if (!this.#scene) {
      return "complete";
    }

    return "running";
  }

  complete(): void {
    this.#scene = null;
  }

  interrupt(): void {
    this.#scene = null;
  }

  visibility(visible: boolean): void {
    if (!visible && this.#scene) {
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
    let pose: Pose = "idle";
    let rotation = 0;

    if (["chase", "collect", "victory"].includes(scene.phase)) {
      pose = (["idle", "walkLeft", "idle", "walkRight"] as const)[
        Math.floor(sim.body.motionTime * 14) % 4
      ];
    } else if (scene.phase === "peck") {
      pose = "nibble";
    } else if (scene.phase === "drop") {
      pose = "bag-inspect";
    } else if (scene.phase === "ready" && sim.clock.now % 3 > 2.6) {
      pose = "blink";
    }

    if (["chase", "return"].includes(scene.phase)) {
      rotation = (sim.clock.now - scene.phaseStarted) * 720;
    }

    let cap = this.#onScreen(scene.cap);

    if (scene.carrying) {
      cap = this.#mouth();
    }

    return {
      pose,
      props: [
        {
          id: "football-cap",
          asset: "bottle_cap",
          x: cap.x - 14,
          y: cap.y - 14,
          width: 28,
          height: 28,
          rotation,
        },
      ],
    };
  }

  #onScreen(point: Point): Point {
    const body = this.#environment.body;
    return {
      x: clamp(point.x, 24, body.width - 24),
      y: clamp(point.y, 48, body.height - 48),
    };
  }

  #mouth(): Point {
    const body = this.#environment.body;
    return { x: body.x + beakOffsetX(body.facing), y: body.y + 42 };
  }

  #slideCap(speed: number, dt: number): boolean {
    const scene = this.#scene!;
    const dx = scene.target.x - scene.cap.x;
    const dy = scene.target.y - scene.cap.y;
    const distance = Math.hypot(dx, dy);

    if (distance <= speed * dt) {
      scene.cap = { ...scene.target };
      return true;
    }

    scene.cap.x += (dx / distance) * speed * dt;
    scene.cap.y += (dy / distance) * speed * dt;
    return false;
  }

  #approachCap(dt: number): boolean {
    const scene = this.#scene!;
    const body = this.#environment.body;
    let facing = -1;

    if (scene.cap.x >= body.x + 48) {
      facing = 1;
    }

    if (scene.cap.x < 78) {
      facing = -1;
    } else if (scene.cap.x > body.width - 78) {
      facing = 1;
    }

    return body.moveToward(
      {
        x: scene.cap.x - beakOffsetX(facing),
        y: scene.cap.y - 48,
        facing,
      },
      RUN_SPEED,
      dt,
    );
  }

  #phase(phase: CapScene["phase"], duration: number): void {
    const scene = this.#scene!;
    enterPhase(scene, phase, this.#environment.clock.now, duration);
    this.#environment.body.resetMotion();
  }

  #finish(text?: string): void {
    const sim = this.#environment;
    sim.lifecycle.complete();
    sim.lifecycle.rest(4);

    if (text) {
      sim.speech.say(text);
    }
  }
}
