import { SceneState } from "../scene-state.js";
import { dialogue } from "../dialogue.js";
import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import { scopeCapabilities } from "../capabilities.js";
import { isPointOnScreen, beakOffsetX, SIZE, clamp } from "../geometry.js";
import {
  isGag,
  isGagKind,
  gagKinds,
  type GagScene,
  type PostcardScene,
  type DepartureScene,
  type EggScene,
  type MunicipalScene,
  type ApologyScene,
} from "../scenes.js";
import type { Point, PointerSample, SceneProp } from "../model.js";
import type { Pose } from "../poses.js";
import type { SimulationView, BehaviorCapabilities } from "../capabilities.js";
import type { SceneOwner } from "../routine.js";
import type { Scene, GagScene as OwnedScene } from "../scenes.js";

const departureOutwardPhases: readonly DepartureScene["phase"][] = [
  "depart",
  "away",
];
const departureEdgePhases: readonly DepartureScene["phase"][] = [
  ...departureOutwardPhases,
  "peek",
  "reenter",
];

const automaticGagKinds = gagKinds.filter((kind) => kind !== "apology");
const walkingFrames = [
  "idle",
  "walkLeft",
  "idle",
  "walkRight",
] as const satisfies readonly Pose[];
const postcards = [
  { photo: "liberty", caption: dialogue.gullbert.gags.postcards.liberty },
  { photo: "giza", caption: dialogue.gullbert.gags.postcards.giza },
  { photo: "car", caption: dialogue.gullbert.gags.postcards.car },
  { photo: "eiffel", caption: dialogue.gullbert.gags.postcards.eiffel },
] as const satisfies readonly Pick<PostcardScene, "photo" | "caption">[];
export function gagPose(
  sim: Pick<SimulationView, "scene" | "motionTime">,
): Pose | null {
  const scene = sim.scene;

  if (!isGag(scene)) {
    return null;
  }

  const walk =
    walkingFrames[Math.floor(sim.motionTime * 10) % walkingFrames.length];

  if (scene.kind === "postcards") {
    if (scene.phase === "reach" || scene.phase === "pull") {
      return "nibble";
    }

    if (scene.phase === "show") {
      return "tilt";
    }

    if (scene.phase === "tuck") {
      return "preen";
    }

    return walk;
  }

  if (scene.kind === "pretend_leave") {
    if (scene.phase === "peek") {
      return "tilt";
    } else {
      return walk;
    }
  }

  if (scene.kind === "cursor_egg") {
    if (scene.phase === "settle") {
      return "crouch";
    } else if (scene.phase === "inspect") {
      return "tilt";
    } else {
      return walk;
    }
  }

  if (scene.kind === "municipal_gull") {
    if (scene.phase === "inspect") {
      return "bag-inspect";
    } else {
      return walk;
    }
  }

  if (scene.phase === "carry") {
    return walk;
  } else if (scene.phase === "offer") {
    return "tilt";
  } else {
    return "nibble";
  }
}
export function gagProps(
  sim: Pick<
    SimulationView,
    "scene" | "visible" | "x" | "facing" | "y" | "time" | "width" | "height"
  >,
): SceneProp[] {
  const scene = sim.scene;

  if (sim.visible && scene?.kind === "postcards") {
    if (scene.phase === "approach" || scene.phase === "reach") {
      return [];
    }

    const size = 96;
    let x = sim.x + beakOffsetX(sim.facing);

    if (sim.facing < 0) {
      x -= size;
    }

    let opacity = 1;

    if (scene.phase === "pull") {
      const progress = clamp((sim.time - scene.phaseStarted) / 0.9, 0, 1);
      let edge = sim.width;

      if (scene.side < 0) {
        edge = -size;
      }

      x = edge + (x - edge) * progress;
    } else {
      x = clamp(x, 0, sim.width - size);
    }

    let y = clamp(sim.y + 30, 0, sim.height - size);

    if (scene.phase === "tuck") {
      const progress = clamp((sim.time - scene.phaseStarted) / 0.6, 0, 1);
      opacity = 1 - progress;
      y = clamp(y + 12 * progress, 0, sim.height - size);
    }

    return [
      {
        id: "postcard",
        asset: `postcard-${scene.photo}.png`,
        x,
        y,
        width: size,
        height: size,
        opacity,
      },
    ];
  }

  if (!sim.visible || scene?.kind !== "apology" || scene.phase === "eat") {
    return [];
  }

  return [
    {
      id: "apology-chip",
      asset: "chip",
      x: sim.x + beakOffsetX(sim.facing) - 12,
      y: sim.y + 36,
      width: 24,
      height: 24,
    },
  ];
}
export function gagOffset(sim: Pick<SimulationView, "scene" | "time">) {
  const scene = sim.scene;

  if (scene?.kind !== "pretend_leave") {
    return { x: 0, opacity: 1 };
  }

  const elapsed = sim.time - scene.phaseStarted;

  if (scene.phase === "depart") {
    return { x: scene.side * 100 * clamp(elapsed / 0.7, 0, 1), opacity: 1 };
  }

  if (scene.phase === "away") {
    return { x: scene.side * 100, opacity: 0 };
  }

  if (scene.phase === "peek") {
    return { x: scene.side * 64, opacity: 1 };
  }

  if (scene.phase === "reenter") {
    return {
      x: scene.side * 64 * (1 - clamp(elapsed / 0.5, 0, 1)),
      opacity: 1,
    };
  }

  return { x: 0, opacity: 1 };
}

type Environment = Pick<
  BehaviorCapabilities,
  | "body"
  | "clock"
  | "lifecycle"
  | "speech"
  | "policy"
  | "random"
  | "activity"
  | "objects"
  | "commands"
  | "movement"
  | "events"
  | "meals"
>;
export class GagRoutine implements SceneOwner {
  #environment: Environment;
  #state = new SceneState<OwnedScene>();
  #gagSchedule?: { at: number; level: number; last?: GagScene["kind"] };
  #lastPostcard?: (typeof postcards)[number]["photo"];
  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "body",
      "clock",
      "lifecycle",
      "speech",
      "policy",
      "random",
      "activity",
      "objects",
      "commands",
      "movement",
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
    const handled = this.#startGag(name);

    if (handled) {
      this.#state.activate();
    }

    return handled;
  }
  update(dt: number): "running" | "complete" {
    this.#stepGag(dt);

    if (!this.#state.current) {
      return "complete";
    }

    return "running";
  }
  complete(): void {
    this.#cancelGag();
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
    return observe({
      pose: gagPose(observation) ?? undefined,
      props: gagProps(observation),
      offset: gagOffset(observation),
    });
  }
  interrupt(): void {
    this.#cancelGag();
    this.#state.clear();
  }
  visibility(visible: boolean): void {
    if (!visible && this.#state.current) {
      this.#environment.lifecycle.interrupt();
      this.#environment.lifecycle.rest();
    }
  }
  get gagSchedule() {
    return observe(this.#gagSchedule);
  }
  #onScreen(p: Point) {
    const sim = this.#environment;
    return {
      x: clamp(p.x, 14, sim.body.width - 14),
      y: clamp(p.y, 36, sim.body.height),
    };
  }
  #phase<S extends GagScene>(
    scene: S,
    name: NoInfer<S["phase"]>,
    duration: number,
  ): void {
    const sim = this.#environment;

    if (scene !== this.#state.current) {
      return;
    }

    scene.phase = name;
    scene.phaseStarted = sim.clock.now;
    scene.until = sim.clock.now + duration;
    sim.body.resetMotion();
  }
  #finish(text?: string) {
    const sim = this.#environment;
    sim.lifecycle.complete();
    sim.lifecycle.rest(4);

    if (text) {
      sim.speech.say(text);
    }
  }
  #schedule() {
    const sim = this.#environment;
    const level = sim.policy.settings().mischief;
    let minimumDelay;

    if (level === 2) {
      minimumDelay = 120;
    } else {
      minimumDelay = 240;
    }

    let delayRange;

    if (level === 2) {
      delayRange = 120;
    } else {
      delayRange = 180;
    }

    return {
      at: sim.clock.now + minimumDelay + sim.random() * delayRange,
      level,
      last: this.#gagSchedule?.last,
    };
  }
  #startGag(name: string) {
    const sim = this.#environment;

    if (!isGagKind(name)) {
      return false;
    }

    const clock = {
      started: sim.clock.now,
      phaseStarted: sim.clock.now,
      until: sim.clock.now,
      deadline: sim.clock.now + 14.9,
    };
    this.#gagSchedule = { ...this.#schedule(), last: name };

    switch (name) {
      case "postcards": {
        const choices = postcards.filter((photo) => {
          return photo.photo !== this.#lastPostcard;
        });
        const photo =
          choices[
            Math.min(
              choices.length - 1,
              Math.floor(sim.random() * choices.length),
            )
          ];
        this.#lastPostcard = photo.photo;
        let side: -1 | 1 = 1;

        if (sim.body.x + SIZE / 2 < sim.body.width / 2) {
          side = -1;
        }

        this.#state.current = {
          ...clock,
          kind: "postcards",
          phase: "approach",
          side,
          ...photo,
          target: sim.body.safePoint({
            x: clamp(sim.body.x, 100, sim.body.width - SIZE - 100),
            y: clamp(sim.body.y, 0, sim.body.height - 126),
          }),
        };
        sim.speech.say(dialogue.gullbert.gags.waitIHaveHolidayPhotos);
        break;
      }

      case "pretend_leave": {
        let side: -1 | 1;

        if (sim.body.x + SIZE / 2 < sim.body.width / 2) {
          side = -1;
        } else {
          side = 1;
        }

        this.#state.current = {
          ...clock,
          kind: name,
          phase: "approach",
          side,
          origin: { x: sim.body.x, y: sim.body.y },
        };
        sim.speech.say(dialogue.gullbert.gags.fineIShallLeave);
        break;
      }

      case "cursor_egg": {
        this.#state.current = {
          ...clock,
          kind: name,
          phase: "approach",
          pointer: null,
          stablePoint: null,
          stableSince: sim.clock.now,
          nest: null,
          until: sim.clock.now + 8,
        };
        sim.speech.say(dialogue.gullbert.gags.aPromisingEgg);
        break;
      }

      case "municipal_gull": {
        sim.objects.clearCones();
        const patch = this.#onScreen({ x: sim.body.x + 48, y: sim.body.y + 78 });
        const placements = [
          { x: patch.x - 40, y: patch.y + 14 },
          { x: patch.x + 40, y: patch.y + 14 },
          { x: patch.x, y: patch.y - 30 },
        ].map((p) => {
          return this.#onScreen(p);
        });
        this.#state.current = {
          ...clock,
          kind: name,
          phase: "place",
          patch,
          placements,
          placed: 0,
          movedId: null,
          target: sim.body.safePoint({ x: patch.x + 90, y: patch.y - 78 }),
        };
        sim.speech.say(dialogue.gullbert.gags.essentialInfrastructure);
        break;
      }

      case "apology": {
        let sidestepDistance;

        if (sim.body.x < sim.body.width / 2) {
          sidestepDistance = 90;
        } else {
          sidestepDistance = -90;
        }

        this.#state.current = {
          ...clock,
          deadline: sim.clock.now + 9.9,
          kind: "apology",
          phase: "carry",
          target: sim.body.safePoint({
            x: sim.body.x + sidestepDistance,
            y: sim.body.y,
          }),
        };
        sim.speech.say(dialogue.gullbert.gags.aGestureOfGoodwill);
        break;
      }
    }

    if (this.#state.current) {
      sim.activity.beginRoutine(this.#state.current.kind);
    }

    return true;
  }
  maybeGag() {
    const sim = this.#environment;

    if (
      !this.#gagSchedule ||
      this.#gagSchedule.level !== sim.policy.settings().mischief
    ) {
      this.#gagSchedule = this.#schedule();
    }

    if (
      !sim.policy.visible() ||
      sim.policy.settings().paused ||
      sim.policy.settings().mischief <= 0
    ) {
      return false;
    }

    if (sim.policy.tidying() || this.#state.current || sim.activity.mode !== "idle") {
      return false;
    }

    if (
      sim.clock.now < this.#gagSchedule.at ||
      sim.clock.now < sim.policy.cleanup().suppressUntil
    ) {
      return false;
    }

    const choices = automaticGagKinds.filter((name) => {
      return name !== this.#gagSchedule?.last;
    });
    sim.commands.action(
      choices[
        Math.min(choices.length - 1, Math.floor(sim.random() * choices.length))
      ],
    );
    return true;
  }
  #cancelGag() {
    const sim = this.#environment;

    if (!isGag(this.#state.current)) {
      return;
    }

    sim.body.place(sim.body.safePoint(sim.body));
    sim.speech.clear();
    sim.speech.forget();
  }
  resizeGags() {
    const sim = this.#environment;

    const scene = this.#state.current;

    if (!isGag(scene)) {
      return;
    }

    if (scene.kind === "pretend_leave") {
      scene.origin = sim.body.safePoint(scene.origin);
    } else if (scene.kind === "cursor_egg") {
      if (
        scene.pointer &&
        (scene.pointer.x > sim.body.width || scene.pointer.y > sim.body.height)
      ) {
        this.gagPointer(null);
      }

      if (scene.nest) {
        scene.nest = {
          x: clamp(scene.nest.x, 0, sim.body.width),
          y: clamp(scene.nest.y, 0, sim.body.height),
        };
      }
    } else {
      scene.target = sim.body.safePoint(scene.target);

      if (scene.kind === "municipal_gull") {
        scene.patch = this.#onScreen(scene.patch);
        scene.placements = scene.placements.map((p) => {
          return this.#onScreen(p);
        });
      }
    }
  }
  gagPointer(point: PointerSample | null) {
    const sim = this.#environment;
    const scene = this.#state.current;

    if (scene?.kind !== "cursor_egg") {
      return;
    }

    if (
      !point ||
      point.inside === false ||
      !isPointOnScreen(point, sim.body.width, sim.body.height)
    ) {
      this.#finish(dialogue.gullbert.gags.theEggHasOtherCommitments);
      return;
    }

    scene.pointer = { x: point.x, y: point.y };

    if (
      !scene.stablePoint ||
      Math.hypot(point.x - scene.stablePoint.x, point.y - scene.stablePoint.y) >
        8
    ) {
      scene.stablePoint = { ...scene.pointer };
      scene.stableSince = sim.clock.now;
    }

    if (
      scene.phase === "settle" &&
      scene.nest &&
      Math.hypot(point.x - scene.nest.x, point.y - scene.nest.y) > 24
    ) {
      this.#phase(scene, "inspect", 1.3);
      sim.speech.say(dialogue.gullbert.gags.itHatched, 2.5);
    }
  }
  #stepGag(dt: number) {
    const sim = this.#environment;
    const scene = this.#state.current;

    if (!isGag(scene)) {
      return false;
    }

    if (sim.clock.now >= scene.deadline) {
      this.#finish();
      return true;
    }

    switch (scene.kind) {
      case "postcards":
        this.#stepPostcards(scene, dt);
        break;

      case "pretend_leave":
        this.#stepPretendLeave(scene, dt);
        break;

      case "cursor_egg":
        this.#stepCursorEgg(scene, dt);
        break;

      case "municipal_gull":
        this.#stepMunicipalGull(scene, dt);
        break;

      case "apology":
        this.#stepApology(scene, dt);
        break;
    }

    return true;
  }

  #stepPostcards(scene: PostcardScene, dt: number): void {
    const sim = this.#environment;
    let edge = sim.body.width - SIZE;

    if (scene.side < 0) {
      edge = 0;
    }

    const speed = Math.max(180, sim.body.width / 3);

    switch (scene.phase) {
      case "approach": {
        if (sim.body.moveToward({ x: edge, y: scene.target.y }, speed, dt)) {
          sim.movement.face(scene.side);
          this.#phase(scene, "reach", 0.6);
        }

        break;
      }

      case "reach": {
        if (sim.clock.now >= scene.until) {
          this.#phase(scene, "pull", 0.9);
          sim.speech.clear();
        }

        break;
      }

      case "pull": {
        const progress = clamp(
          (sim.clock.now - scene.phaseStarted) / 0.9,
          0,
          1,
        );
        sim.body.place(
          sim.body.safePoint({
            x: edge - scene.side * 96 * progress,
            y: scene.target.y,
          }),
        );
        sim.movement.face(scene.side);

        if (sim.clock.now >= scene.until) {
          this.#phase(scene, "carry", 3);
        }

        break;
      }

      case "carry": {
        const reached = sim.body.moveToward(scene.target, speed, dt);
        // Back away with the photograph still held in his beak.
        sim.movement.face(scene.side);

        if (reached || sim.clock.now >= scene.until) {
          this.#phase(scene, "show", 4.5);
          sim.speech.say(scene.caption, 4.5);
        }

        break;
      }

      case "show": {
        if (sim.clock.now >= scene.until) {
          this.#phase(scene, "tuck", 0.6);
        }

        break;
      }

      case "tuck": {
        if (sim.clock.now >= scene.until) {
          this.#finish(dialogue.gullbert.gags.aWelltravelledBird);
        }

        break;
      }
    }
  }

  #stepPretendLeave(scene: DepartureScene, dt: number): void {
    const sim = this.#environment;
    let edge;

    if (scene.side === -1) {
      edge = 0;
    } else {
      edge = sim.body.width - SIZE;
    }

    switch (scene.phase) {
      case "approach": {
        if (
          sim.body.moveToward(
            { x: edge, y: scene.origin.y },
            Math.max(150, sim.body.width / 5),
            dt,
          )
        ) {
          this.#phase(scene, "depart", 0.7);
        }

        break;
      }

      case "depart": {
        if (sim.clock.now >= scene.until) {
          this.#phase(scene, "away", 2);
        }

        break;
      }

      case "away": {
        if (sim.clock.now >= scene.until) {
          this.#phase(scene, "peek", 1.3);
          sim.speech.say(dialogue.gullbert.gags.forgotSomething, 3);
        }

        break;
      }

      case "peek": {
        if (sim.clock.now >= scene.until) {
          this.#phase(scene, "reenter", 0.5);
        }

        break;
      }

      case "reenter": {
        if (sim.clock.now >= scene.until) {
          this.#phase(scene, "return", 4);
        }

        break;
      }

      case "return": {
        if (
          sim.body.moveToward(
            scene.origin,
            Math.max(150, sim.body.width / 5),
            dt,
          )
        ) {
          this.#finish();
        }

        break;
      }
    }

    if (departureEdgePhases.includes(scene.phase)) {
      sim.movement.moveTo({ x: edge, y: sim.body.y });

      if (departureOutwardPhases.includes(scene.phase)) {
        sim.movement.face(scene.side as -1 | 1);
      } else {
        sim.movement.face(-scene.side as -1 | 1);
      }
    }
  }

  #stepCursorEgg(scene: EggScene, dt: number): void {
    const sim = this.#environment;

    switch (scene.phase) {
      case "approach": {
        if (sim.clock.now >= scene.until) {
          this.#finish(dialogue.gullbert.gags.notReadyForParenthood);
        } else if (!scene.pointer) {
          if (sim.clock.now - scene.started >= 1.5) {
            this.#finish(dialogue.gullbert.gags.whereDidMyEggGo);
          }
        } else {
          const reached = sim.body.moveToward(
            { x: scene.pointer.x - 48, y: scene.pointer.y - 76 },
            230,
            dt,
          );

          if (
            reached &&
            Math.hypot(
              sim.body.x + 48 - scene.pointer.x,
              sim.body.y + 76 - scene.pointer.y,
            ) <= 24 &&
            sim.clock.now - scene.stableSince >= 1
          ) {
            scene.nest = { ...scene.pointer };
            this.#phase(scene, "settle", 5);
            sim.speech.say(dialogue.gullbert.gags.doNotDisturbParenting, 2.5);
          }
        }

        break;
      }

      case "settle": {
        if (sim.clock.now >= scene.until) {
          this.#finish(dialogue.gullbert.gags.incubationPostponed);
        }

        break;
      }

      case "inspect": {
        if (sim.clock.now >= scene.until) {
          this.#finish(dialogue.gullbert.gags.itHatched);
        }

        break;
      }
    }
  }

  #stepMunicipalGull(scene: MunicipalScene, dt: number): void {
    const sim = this.#environment;

    switch (scene.phase) {
      case "place": {
        const point = scene.placements[scene.placed];

        if (
          sim.body.moveToward({ x: point.x - 48, y: point.y - 78 }, 150, dt) &&
          sim.clock.now >= scene.until
        ) {
          sim.objects.placeCone(point, sim.clock.now);
          scene.placed += 1;
          scene.until = sim.clock.now + 0.45;

          if (scene.placed === 3) {
            this.#phase(scene, "inspect", 1.5);
          }
        }

        break;
      }

      case "inspect": {
        if (sim.clock.now >= scene.until) {
          scene.movedId = sim.objects.snapshot().cones[0]?.id ?? null;
          this.#phase(scene, "retrieve", 2);
        }

        break;
      }

      case "retrieve": {
        const cone = sim.objects.snapshot().cones.find((c) => {
          return c.id === scene.movedId;
        });

        if (
          !cone ||
          sim.body.moveToward({ x: cone.x - 48, y: cone.y - 78 }, 150, dt) ||
          sim.clock.now >= scene.until
        ) {
          this.#phase(scene, "move", 2);
        }

        break;
      }

      case "move": {
        const cone = sim.objects.snapshot().cones.find((c) => {
          return c.id === scene.movedId;
        });
        const point = this.#onScreen({
          x: scene.patch.x - 20,
          y: scene.patch.y + 24,
        });
        const reached = sim.body.moveToward(
          { x: point.x - 48, y: point.y - 78 },
          110,
          dt,
        );

        if (cone) {
          sim.objects.moveCone(
            cone.id,
            this.#onScreen({ x: sim.body.x + 48, y: sim.body.y + 78 }),
          );
        }

        if (reached || sim.clock.now >= scene.until) {
          this.#phase(scene, "leave", 3);
          sim.speech.say(dialogue.gullbert.gags.worksOngoing, 3);
        }

        break;
      }

      case "leave": {
        if (
          sim.body.moveToward(scene.target, 90, dt) ||
          sim.clock.now >= scene.until
        ) {
          this.#finish(dialogue.gullbert.gags.worksOngoing);
        }

        break;
      }
    }
  }

  #stepApology(scene: ApologyScene, dt: number): void {
    const sim = this.#environment;

    switch (scene.phase) {
      case "carry": {
        if (sim.body.moveToward(scene.target, 120, dt)) {
          this.#phase(scene, "offer", 2);
          sim.speech.say(dialogue.gullbert.gags.forYou, 2);
        }

        break;
      }

      case "offer": {
        if (sim.clock.now >= scene.until) {
          this.#phase(scene, "eat", 1);
          sim.events.emit("munch");
          sim.meals.consumed({ x: sim.body.x, y: sim.body.y });
        }

        break;
      }

      case "eat": {
        if (sim.clock.now >= scene.until) {
          this.#finish(dialogue.gullbert.gags.gladWeResolvedThat);
        }

        break;
      }
    }
  }
}
