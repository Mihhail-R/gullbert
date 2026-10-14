import { dialogue } from "../dialogue.js";
import { observe } from "../observation.js";
import {
  scopeCapabilities,
  type BehaviorCapabilities,
} from "../capabilities.js";
import type { CaretSample, Point, PointerSample, SceneProp } from "../model.js";
import type { ReadonlyValue } from "../presentation.js";
import type { SceneOwner, RoutinePresentation } from "../routine.js";
import type { Scene, TypingScene } from "../scenes.js";
import { beakOffsetX } from "../geometry.js";

type Environment = Pick<
  BehaviorCapabilities,
  | "body"
  | "clock"
  | "policy"
  | "activity"
  | "commands"
  | "lifecycle"
  | "speech"
  | "events"
  | "random"
>;

/** A bounded cosmetic caper that never modifies the user's text. */
export class TypingRoutine implements SceneOwner {
  #env: Environment;
  #scene: TypingScene | null = null;
  #identity = Object.freeze({});
  #caret: CaretSample | null = null;
  #seenAt = -Infinity;
  #activeAt = -Infinity;
  #nextAt = 8;
  #pointer: PointerSample | null = null;
  #pointerAt = -Infinity;
  #pointerMovedAt = -Infinity;
  #nest: string[] = [];
  #catches = 0;
  constructor(environment: Environment) {
    this.#env = scopeCapabilities(environment, [
      "body",
      "clock",
      "policy",
      "activity",
      "commands",
      "lifecycle",
      "speech",
      "events",
      "random",
    ]);
  }
  get scene() {
    return observe(this.#scene);
  }
  get identity() {
    return this.#identity;
  }
  install(scene: ReadonlyValue<Scene>): void {
    if (scene.kind === "typing") {
      this.#scene = structuredClone(scene);
      this.#identity = Object.freeze({});
    }
  }
  sample(sample: CaretSample | null): void {
    const env = this.#env;
    if (
      !sample ||
      !this.enabled() ||
      !Number.isFinite(sample.x) ||
      !Number.isFinite(sample.y) ||
      !Number.isFinite(sample.height) ||
      sample.height <= 0 ||
      sample.height > 160 ||
      sample.x < 0 ||
      sample.y < 0 ||
      sample.x >= env.body.width ||
      sample.y >= env.body.height
    ) {
      this.#caret = null;
      this.#activeAt = -Infinity;
      return;
    }
    const previous = this.#caret;
    if (
      previous?.context === sample.context &&
      (previous.position !== sample.position ||
        Math.hypot(previous.x - sample.x, previous.y - sample.y) > 2)
    ) {
      this.#activeAt = env.clock.now;
    } else if (!previous || previous.context !== sample.context) {
      this.#activeAt = -Infinity;
    }
    if (sample.source === "vision") {
      // Vision mode grazes on stationary text too; typing is not required.
      this.#activeAt = env.clock.now;
    }
    this.#caret = { ...sample };
    this.#seenAt = env.clock.now;
  }
  pointer(point: PointerSample | null): void {
    if (
      point &&
      Math.hypot(
        point.x - (this.#env.body.x + 48),
        point.y - (this.#env.body.y + 48),
      ) < 120 &&
      (!this.#pointer ||
        Math.hypot(point.x - this.#pointer.x, point.y - this.#pointer.y) > 3)
    ) {
      this.#pointerMovedAt = this.#env.clock.now;
    }
    this.#pointer = point;
    this.#pointerAt = this.#env.clock.now;
  }
  enabled(): boolean {
    const env = this.#env;
    return (
      env.policy.visible() &&
      !env.policy.settings().paused &&
      env.policy.settings().mischief > 0
    );
  }
  maybeStart(): boolean {
    const env = this.#env;
    if (
      !this.enabled() ||
      this.#scene ||
      !this.#fresh() ||
      env.clock.now < this.#nextAt ||
      env.clock.now - this.#activeAt > 5 ||
      env.policy.tidying() ||
      env.clock.now < env.policy.cleanup().suppressUntil
    ) {
      return false;
    }
    env.commands.action("caret_fishing");
    return true;
  }
  start(name: string): boolean {
    if (name !== "caret_fishing") {
      return false;
    }
    const env = this.#env;
    if (!this.enabled() || !this.#fresh() || !this.#caret) {
      env.lifecycle.rest();
      return true;
    }
    const bold = env.policy.settings().mischief >= 2;
    let delay = 65;
    if (bold) {
      delay = 25;
    }
    this.#nextAt = env.clock.now + delay + env.random() * 20;
    let glyph = "o";
    if (bold) {
      glyph = [";", ")", ",", "?", ":", "(", ".", "!"][this.#catches % 8];
    }
    if (
      this.#caret.source === "vision" &&
      this.#caret.glyph &&
      /^[!-~]$/.test(this.#caret.glyph)
    ) {
      glyph = this.#caret.glyph;
    }
    this.#scene = {
      kind: "typing",
      visual: this.#caret.source === "vision",
      source: this.#caret.context,
      phase: "approach",
      resume: "approach",
      until: env.clock.now + 1,
      deadline: env.clock.now + 22,
      target: this.#target(),
      glyph,
      carrying: false,
      steal: bold || env.random() < 0.35,
      buildNest: bold,
    };
    this.#identity = Object.freeze({});
    env.activity.beginRoutine("typing");
    env.speech.say(dialogue.gullbert.typing.somethingsBiting);
    return true;
  }
  #fresh(): boolean {
    let freshness = 1.2;
    if (this.#caret?.source === "vision") {
      freshness = 3;
    }
    return (
      this.#caret !== null && this.#env.clock.now - this.#seenAt < freshness
    );
  }
  #target(): Point {
    const env = this.#env;
    const caret = this.#caret!;
    // Approach from the left, keeping the beak beside the insertion point.
    return env.body.safePoint({
      x: caret.x - 82,
      y: caret.y + caret.height / 2 - 42,
    });
  }
  #nestPoint(): Point {
    const body = this.#env.body;
    return body.safePoint({ x: body.width - 160, y: body.height - 112 });
  }
  update(dt: number): "running" | "complete" {
    const env = this.#env;
    const scene = this.#scene;
    if (!scene) {
      return "complete";
    }
    if (!this.enabled() || env.clock.now >= scene.deadline) {
      return this.#finish();
    }
    const sourcePhase =
      scene.phase === "approach" ||
      scene.phase === "watch" ||
      scene.phase === "pounce" ||
      (scene.phase === "innocent" && !scene.carrying);
    if (
      sourcePhase &&
      !scene.visual &&
      (!this.#fresh() || this.#caret?.context !== scene.source)
    ) {
      return this.#finish();
    }
    const pointer = this.#pointer;
    const nearby =
      pointer &&
      pointer.inside !== false &&
      env.clock.now - this.#pointerAt < 0.6 &&
      Math.hypot(pointer.x - (env.body.x + 48), pointer.y - (env.body.y + 48)) <
        120;
    if (
      nearby &&
      (scene.phase === "innocent" || env.clock.now - this.#pointerMovedAt < 0.6)
    ) {
      if (scene.phase !== "innocent") {
        scene.resume = scene.phase;
        scene.phase = "innocent";
        env.speech.say(dialogue.gullbert.typing.justANormalBird, 2);
      }
      scene.until = env.clock.now + 1.1;
      return "running";
    }
    if (scene.phase === "innocent") {
      if (env.clock.now < scene.until) {
        return "running";
      }
      scene.phase = scene.resume;
      scene.until = env.clock.now + 0.7;
      env.speech.say(dialogue.gullbert.typing.pause, 0.8);
      return "running";
    }
    if (scene.phase === "approach") {
      if (!scene.visual) {
        scene.target = this.#target();
      }
      if (env.body.moveToward(scene.target, 240, dt)) {
        env.body.face(1);
        scene.phase = "watch";
        scene.until = env.clock.now + 1.4;
      }
    } else if (scene.phase === "watch") {
      let target = scene.target;
      if (!scene.visual) {
        target = this.#target();
      }
      if (
        Math.hypot(target.x - scene.target.x, target.y - scene.target.y) > 35
      ) {
        scene.phase = "approach";
      } else if (env.clock.now >= scene.until) {
        scene.phase = "pounce";
        scene.until = env.clock.now + 0.45;
      }
    } else if (scene.phase === "pounce" && env.clock.now >= scene.until) {
      if (!scene.steal) {
        env.speech.say(dialogue.gullbert.typing.itWasHereASecondAgo);
        return this.#finish();
      }
      scene.carrying = true;
      this.#catches++;
      scene.phase = "carry";
      env.events.emit("pop");
      env.speech.say(dialogue.gullbert.typing.youWerentUsingThis);
    } else if (scene.phase === "carry") {
      if (env.body.moveToward(this.#nestPoint(), 230, dt)) {
        scene.phase = "deposit";
        scene.until = env.clock.now + 1;
      }
    } else if (scene.phase === "deposit" && env.clock.now >= scene.until) {
      if (scene.buildNest) {
        let twig = scene.glyph;
        if (/[a-z0-9]/i.test(twig)) {
          twig = [";", ",", ")", ":"][this.#nest.length % 4];
        }
        this.#nest.push(twig);
        this.#nest = this.#nest.slice(-12);
        env.speech.say(dialogue.gullbert.typing.structuralPunctuation);
      } else {
        env.speech.say(dialogue.gullbert.typing.oDelicious);
        env.events.emit("munch");
      }
      scene.carrying = false;
      return this.#finish();
    }
    return "running";
  }
  #finish(): "complete" {
    this.#scene = null;
    this.#env.lifecycle.rest(3);
    return "complete";
  }
  clear(): void {
    this.#scene = null;
  }
  complete(): void {
    this.clear();
  }
  interrupt(): void {
    this.clear();
  }
  resetSensing(): void {
    this.sample(null);
    this.#pointer = null;
  }
  visibility(visible: boolean): void {
    if (!visible) {
      this.resetSensing();
      if (this.#scene) {
        this.#finish();
      }
    }
  }
  cleanNest(): void {
    this.#nest = [];
  }
  nestProps(): SceneProp[] {
    if (!this.#env.policy.visible() || this.#nest.length === 0) {
      return [];
    }
    const home = this.#nestPoint();
    const props: SceneProp[] = [
      {
        id: "punctuation-nest",
        asset: "punctuation-nest",
        x: home.x + 12,
        y: home.y + 65,
        width: 78,
        height: 28,
      },
    ];
    for (const [i, text] of this.#nest.entries()) {
      props.push({
        id: `nest-letter-${i}`,
        asset: "letter",
        text,
        x: home.x + 16 + (i % 6) * 10,
        y: home.y + 64 - Math.floor(i / 6) * 9,
        width: 20,
        height: 24,
        rotation: ((i % 3) - 1) * 25,
      });
    }
    return props;
  }
  presentation(): RoutinePresentation {
    const scene = this.#scene;
    if (!scene) {
      return {};
    }
    const env = this.#env;
    let pose: RoutinePresentation["pose"] = "crouch";
    if (scene.phase === "innocent") {
      pose = "blink";
    } else if (scene.phase === "pounce" || scene.phase === "deposit") {
      pose = "nibble";
    } else if (scene.phase === "approach" || scene.phase === "carry") {
      pose = (["idle", "walkLeft", "idle", "walkRight"] as const)[
        Math.floor(env.body.motionTime * 12) % 4
      ];
    }
    const props: SceneProp[] = [];
    if (scene.phase === "pounce") {
      props.push({
        id: "letter-bait",
        asset: "letter",
        text: scene.glyph,
        x: scene.target.x + 67,
        y: scene.target.y + 32,
        width: 22,
        height: 28,
      });
    }
    if (scene.carrying && scene.phase !== "innocent") {
      props.push({
        id: "stolen-letter",
        asset: "letter",
        text: scene.glyph,
        x: env.body.x + beakOffsetX(env.body.facing) - 7,
        y: env.body.y + 35,
        width: 22,
        height: 28,
        rotation: -15,
      });
    }
    return { pose, props };
  }
}
