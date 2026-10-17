import { scopeCapabilities, type BehaviorCapabilities } from "../capabilities.js";
import { dialogue } from "../dialogue.js";
import type { WorkSample } from "../model.js";
import { observe } from "../observation.js";
import type { Pose } from "../poses.js";
import type { ReadonlyValue } from "../presentation.js";
import type { SceneOwner } from "../routine.js";
import type { Scene, WorkScene } from "../scenes.js";

type Environment = Pick<
  BehaviorCapabilities,
  | "body"
  | "clock"
  | "random"
  | "activity"
  | "policy"
  | "speech"
  | "commands"
  | "lifecycle"
>;

/** Owns a short supervision visit and its ephemeral, content-free observations. */
export class WorkRoutine implements SceneOwner {
  readonly #environment: Environment;
  #scene: WorkScene | null = null;
  #identity: object = Object.freeze({});
  #sample: WorkSample | null = null;
  #sampleAtMs = 0;
  #seenAt = -Infinity;
  #activeSeconds = 0;
  #rate = 0;
  #typingUntil = 0;
  #nextVisit = 10;
  #lastRemark = "";

  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "body", "clock", "random", "activity", "policy", "speech", "commands", "lifecycle",
    ]);
  }

  get scene(): ReadonlyValue<WorkScene> | null {
    return observe(this.#scene);
  }

  get identity(): object {
    return this.#identity;
  }

  install(scene: ReadonlyValue<Scene>): void {
    if (scene.kind === "work") {
      this.#scene = structuredClone(scene);
      this.#identity = Object.freeze({});
    }
  }

  clear(): void {
    this.#scene = null;
  }

  sample(sample: WorkSample | null, nowMs: number): void {
    const now = this.#environment.clock.now;

    if (!sample || !this.#validSample(sample) || !Number.isFinite(nowMs)) {
      this.reset();
      return;
    }

    const previous = this.#sample;
    const elapsedSeconds = (nowMs - this.#sampleAtMs) / 1000;
    this.#sample = structuredClone(sample);
    this.#sampleAtMs = nowMs;
    this.#seenAt = now;

    if (!previous || previous.window.id !== sample.window.id) {
      this.#forgetActivity();
      this.#stopVisit();
      return;
    }

    // Suspension, counter reset, and wraparound establish a new baseline.
    if (elapsedSeconds <= 0 || elapsedSeconds > 2) {
      this.#forgetActivity();
      this.#stopVisit();
      return;
    }

    const count = sample.keyDownCount - previous.keyDownCount;

    if (count < 0 || count > 200) {
      this.#forgetActivity();
      return;
    }

    this.#rate = this.#rate * 0.6 + (count / elapsedSeconds) * 0.4;

    if (count > 0 && sample.idleSeconds < 2) {
      this.#typingUntil = now + 1.2;
      this.#activeSeconds = Math.min(8, this.#activeSeconds + elapsedSeconds);
    } else if (sample.idleSeconds > 3) {
      this.#activeSeconds = 0;
    }
  }

  #validSample(sample: WorkSample): boolean {
    if (!Number.isInteger(sample.keyDownCount) || sample.keyDownCount < 0) {
      return false;
    }

    if (!Number.isFinite(sample.idleSeconds) || sample.idleSeconds < 0) {
      return false;
    }

    const window = sample.window;

    if (!Number.isInteger(window.id) || window.id <= 0) {
      return false;
    }

    const geometry = [window.x, window.y, window.width, window.height];

    if (geometry.some((value) => !Number.isFinite(value))) {
      return false;
    }

    if (window.width < 200 || window.height < 120) {
      return false;
    }

    if (window.x < 0 || window.y < 0) {
      return false;
    }

    const body = this.#environment.body;
    return window.x + window.width <= body.width && window.y + window.height <= body.height;
  }

  reset(): void {
    this.#sample = null;
    this.#seenAt = -Infinity;
    this.#forgetActivity();
    this.#stopVisit();
  }

  #forgetActivity(): void {
    this.#activeSeconds = 0;
    this.#typingUntil = 0;
    this.#rate = 0;
  }

  #stopVisit(): void {
    if (this.#scene) {
      this.#environment.lifecycle.interrupt();
      this.#environment.speech.clear();
      this.#environment.lifecycle.rest(3);
    }
  }

  maybeVisit(): boolean {
    const sim = this.#environment;

    if (!this.#available() || this.#activeSeconds < 2 || sim.clock.now < this.#nextVisit) {
      return false;
    }

    if (sim.clock.now < sim.activity.until || sim.clock.now < sim.activity.calmUntil) {
      return false;
    }

    sim.commands.action("watch_work");
    return true;
  }

  #available(): boolean {
    const sim = this.#environment;
    const settings = sim.policy.settings();

    if (!sim.policy.visible() || settings.paused || settings.mischief === 0) {
      return false;
    }

    if (!this.#sample || sim.clock.now - this.#seenAt > 2) {
      return false;
    }

    return this.#sample.idleSeconds < 8;
  }

  start(name: string): boolean {
    if (name !== "watch_work") {
      return false;
    }

    const sim = this.#environment;

    if (!this.#available() || !this.#sample) {
      sim.lifecycle.rest();
      return true;
    }

    this.#identity = Object.freeze({});
    this.#scene = {
      kind: "work",
      phase: "approach",
      windowId: this.#sample.window.id,
      until: sim.clock.now + 35,
      nextRemark: sim.clock.now + 6,
    };
    sim.activity.beginRoutine("work");
    sim.speech.say(dialogue.gullbert.work.arrival, 3);
    return true;
  }

  update(delta: number): "running" | "complete" {
    const sim = this.#environment;
    const scene = this.#scene;
    const sample = this.#sample;

    if (!scene || !sample || !this.#available()) {
      return "complete";
    }

    if (scene.windowId !== sample.window.id) {
      return "complete";
    }

    if (sim.clock.now >= scene.until) {
      this.#leaveWork();
      return "complete";
    }

    const window = sample.window;
    let y = window.y - 86;

    if (y < 0) {
      y = window.y + 12;
    }

    const perch = sim.body.safePoint({ x: window.x + window.width - 120, y });

    if (scene.phase === "approach") {
      if (sim.body.moveToward(perch, 240, delta)) {
        scene.phase = "watch";
        sim.body.face(-1);
        scene.nextRemark = sim.clock.now + 4;
      }

      return "running";
    }

    sim.body.place(perch);

    if (sim.clock.now >= scene.nextRemark) {
      this.#remark();
      scene.nextRemark = sim.clock.now + 8 + sim.random() * 4;
    }

    return "running";
  }

  #remark(): void {
    const sim = this.#environment;
    const lines = dialogue.gullbert.work;
    let choices: readonly string[] = lines.steady;

    if (sim.clock.now > this.#typingUntil) {
      choices = lines.pause;
    } else if (this.#rate >= 5) {
      choices = lines.fast;
    } else if (this.#rate < 2) {
      choices = lines.slow;
    }

    const alternatives = choices.filter((line) => line !== this.#lastRemark);
    const line = alternatives[Math.floor(sim.random() * alternatives.length)];
    this.#lastRemark = line;
    sim.speech.say(line, 3);
  }

  #leaveWork(): void {
    const sim = this.#environment;
    const sample = this.#sample;
    const roll = sim.random();

    if (sim.policy.settings().mischief === 2 && roll < 0.25 && sample) {
      const window = sample.window;
      sim.commands.action("poop", {
        x: window.x + window.width * 0.7,
        y: window.y + Math.min(100, window.height - 24),
      });
    } else if (roll < 0.5) {
      sim.commands.action("nibble_cursor");
    } else {
      sim.speech.say(dialogue.gullbert.work.chips, 4);
    }
  }

  complete(): void {
    this.interrupt();
    this.#environment.lifecycle.rest(4);
    this.#environment.activity.settleUntil(this.#environment.clock.now + 4);
  }

  interrupt(): void {
    this.#scene = null;
    this.#activeSeconds = 0;
    const sim = this.#environment;
    const delay = sim.policy.settings().mischief === 2 ? 45 : 90;
    this.#nextVisit = sim.clock.now + delay;
  }

  visibility(visible: boolean): void {
    if (!visible) {
      this.reset();
    }
  }

  presentation(): { pose: Pose } {
    const now = this.#environment.clock.now;

    if (this.#scene?.phase === "approach") {
      return { pose: Math.floor(now * 8) % 2 ? "wingUp" : "wingDown" };
    }

    if (now < this.#typingUntil) {
      return { pose: Math.floor(now * 8) % 2 ? "nibble" : "crouch" };
    }

    return { pose: "tilt" };
  }
}
