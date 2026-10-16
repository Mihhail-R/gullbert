import { dialogue } from "./dialogue.js";
import { Body } from "./body.js";
import { Props } from "./props.js";
import { Activity } from "./activity.js";
import { Speech } from "./speech.js";
import { FoodPolicy } from "./food-policy.js";
import { Belongings } from "./belongings.js";
import { RoutineRegistry } from "./registry.js";
import { ScopedRoutine } from "./scoped-routine.js";
import type {
  RoutineFactory,
  SceneOwner,
  RoutinePresentation,
} from "./routine.js";
import type { BehaviorCapabilities, SimulationView } from "./capabilities.js";
import {
  projectPresentation,
  type PetPresentation,
  type ReadonlyValue,
} from "./presentation.js";
import { interactionRects } from "./interaction.js";
import { SIZE, clamp } from "./geometry.js";
export { SIZE, clamp } from "./geometry.js";
import { POSES, type Pose } from "./poses.js";
export { POSES } from "./poses.js";
import type {
  CaretSample,
  Point,
  PointerSample,
  Settings,
  Memory,
  SceneProp,
  Sound,
} from "./model.js";
import type { Scene } from "./scenes.js";
import { Mood } from "./behaviors/moods.js";
import { QuietRoutine } from "./behaviors/quiet.js";
import { Pickup, canPickup, pickupRect } from "./behaviors/pickup.js";
import { Touch, canTouch } from "./behaviors/touch.js";
import { Cleanup, directCleanupTarget } from "./behaviors/cleanup.js";
import { normalizeHat, hatRemark } from "./behaviors/hats.js";
import { GagRoutine, gagOffset } from "./behaviors/gags.js";
import { TheatreRoutine, theatreOffset } from "./behaviors/theatre.js";
import { GuestRoutine } from "./behaviors/guests.js";
import { GiftRoutine } from "./behaviors/gifts.js";
import { PerchRoutine } from "./behaviors/perch.js";
import { CrimeRoutine } from "./behaviors/crime.js";
import { CursorRoutine, cursorBeak } from "./behaviors/cursor.js";
import { TypingRoutine } from "./behaviors/typing.js";
import { SnackRoutine } from "./behaviors/snacks.js";
import { CapRoutine } from "./behaviors/cap.js";
import { LearningRoutine } from "./behaviors/learning.js";

const remarks = dialogue.gullbert.general.remarks;
export class Gullbert {
  #objects: Props;
  #body: Body;
  #belongings: Belongings;
  #wallNow: () => number;
  #capabilities: BehaviorCapabilities;
  #registry: RoutineRegistry;
  #gags: GagRoutine;
  #theatre: TheatreRoutine;
  #guests: GuestRoutine;
  #gifts: GiftRoutine;
  #perch: PerchRoutine;
  #crime: CrimeRoutine;
  #cursor: CursorRoutine;
  #snacks: SnackRoutine;
  #typing: TypingRoutine;
  #cap: CapRoutine;
  #learning: LearningRoutine;
  #random: () => number;
  #time: number;
  #nextMischief: number;
  #settings: Settings;
  #sounds: Sound[];
  #quiet: QuietRoutine;
  #visible: boolean;
  #cleanup: Cleanup;
  #touch: Touch;
  #pickup: Pickup;
  #food: FoodPolicy;
  #activity: Activity;
  #speech = new Speech();
  #moods: Mood;
  constructor(
    width = 1200,
    height = 800,
    random = Math.random,
    options: { now?: () => number; routines?: readonly RoutineFactory[] } = {},
  ) {
    this.#random = random;
    this.#time = 0;
    this.#nextMischief = 25;
    this.#settings = { paused: false, sound: false, mischief: 1, hat: "none" };
    this.#sounds = [];
    this.#visible = true;
    this.#body = new Body(width, height);
    this.#objects = new Props(width, height);
    this.#wallNow = options.now ?? Date.now;
    this.#belongings = new Belongings(width, height, this.#wallNow);
    this.#moods = new Mood(
      () => {
        return this.#random();
      },
      (text) => {
        this.#say(text);
      },
    );
    this.#activity = new Activity(this.#body, this.#objects, {
      random: () => {
        return this.#random();
      },
      mood: (name) => {
        this.#moods.set(name, this.#time);
      },
      emit: (sound) => {
        this.#sounds.push(sound);
      },
      ateChip: (point) => {
        this.#learning.ateChip(point);
      },
    });
    this.#food = new FoodPolicy(this.#random);
    this.#capabilities = this.#createCapabilities();
    this.#gags = new GagRoutine(this.#capabilities);
    this.#theatre = new TheatreRoutine(this.#capabilities);
    this.#guests = new GuestRoutine(this.#capabilities);
    this.#gifts = new GiftRoutine(this.#capabilities);
    this.#perch = new PerchRoutine(this.#capabilities);
    this.#crime = new CrimeRoutine(this.#capabilities);
    this.#cursor = new CursorRoutine(this.#capabilities);
    this.#snacks = new SnackRoutine(this.#capabilities);
    this.#typing = new TypingRoutine(this.#capabilities);
    this.#cap = new CapRoutine(this.#capabilities);
    this.#learning = new LearningRoutine(this.#capabilities);
    this.#cleanup = new Cleanup({
      observe: () => {
        return this.#baseObservation();
      },
      body: this.#body,
      objects: this.#objects,
      moods: this.#moods,
      speech: this.#capabilities.speech,
      random: () => {
        return this.#random();
      },
      rest: (delay) => {
        this.#rest(delay);
      },
      action: (name) => {
        this.action(name);
      },
      splat: (point) => {
        this.splat(point);
      },
    });
    this.#touch = new Touch({
      scratched: () => {
        this.#learning.scratched();
      },
      body: this.#body,
      clock: this.#capabilities.clock,
      speech: this.#capabilities.speech,
      available: () => {
        return canTouch(this.#baseObservation());
      },
      sleeping: () => {
        return this.#activity.mode === "nap";
      },
      rest: (delay) => {
        this.#rest(delay);
      },
    });
    this.#pickup = new Pickup({
      body: this.#body,
      objects: this.#objects,
      clock: this.#capabilities.clock,
      speech: this.#capabilities.speech,
      events: this.#capabilities.events,
      random: () => {
        return this.#random();
      },
      touch: this.#touch,
      settings: () => {
        return Object.freeze({ ...this.#settings });
      },
      visible: () => {
        return this.#visible;
      },
      tidying: () => {
        return this.tidying;
      },
      visual: () => {
        const view = this.#observe();
        const theatre = theatreOffset(view);
        const gag = gagOffset(view);
        return {
          x: theatre.x + gag.x,
          opacity: theatre.opacity * gag.opacity,
          gone: view.scene?.kind === "gift" && view.scene.phase === "away",
        };
      },
      pickLoose: (point) => {
        return this.#cleanup.directPick(point);
      },
      offend: () => {
        this.#moods.set("offended", this.#time, { speak: false });
      },
      beginDragging: () => {
        this.#beginDragging();
      },
      carry: () => {
        this.#activity.carry();
      },
      rest: (delay) => {
        this.#rest(delay);
      },
      install: (scene) => {
        this.#registry.install(scene);

        if (scene.kind === "cursor") {
          this.#activity.beginRoutine("cursor");
        }
      },
      cancel: () => {
        this.#cancelScene();
      },
      cursorRetaliation: () => {
        return this.#cursor.retaliation();
      },
      consumeTrail: (nextAt) => {
        this.#cursor.consumeTrail(nextAt);
      },
    });
    this.#quiet = new QuietRoutine({
      clock: this.#capabilities.clock,
      random: this.#capabilities.random,
      speech: this.#capabilities.speech,
      events: this.#capabilities.events,
      moods: this.#moods,
      isPaused: () => {
        return this.#settings.paused;
      },
      activity: {
        beginQuiet: (name, until) => {
          this.#activity.beginQuiet(name, until);
        },
        rest: (delay) => {
          this.#rest(delay);
        },
        snapshot: () => {
          return this.#activity.snapshot();
        },
      },
    });
    const owners = new Map<Scene["kind"], SceneOwner>();

    for (const kind of [
      "pretend_leave",
      "cursor_egg",
      "municipal_gull",
      "apology",
      "postcards",
    ] as const) {
      owners.set(kind, this.#gags);
    }

    for (const kind of ["bubbles", "bath", "toss", "baguette"] as const) {
      owners.set(kind, this.#theatre);
    }

    owners.set("relocation", this.#pickup);
    owners.set("guest", this.#guests);
    owners.set("gift", this.#gifts);
    owners.set("perch", this.#perch);
    owners.set("theft", this.#crime);
    owners.set("caper", this.#crime);
    owners.set("cursor", this.#cursor);
    owners.set("snack", this.#snacks);
    owners.set("typing", this.#typing);
    owners.set("cap", this.#cap);
    owners.set("trick", this.#learning);
    owners.set("habit", this.#learning);
    const additional = (options.routines ?? []).map((factory) => {
      return new ScopedRoutine(factory, this.#capabilities, () => {
        return this.#visible;
      });
    });
    this.#registry = new RoutineRegistry(
      [
        this.#gags,
        this.#theatre,
        this.#guests,
        this.#gifts,
        this.#perch,
        this.#crime,
        this.#cursor,
        this.#snacks,
        this.#typing,
        this.#cap,
        this.#learning,
        this.#quiet,
        ...additional,
      ],
      owners,
    );
    this.#perch.scheduleFirstVisit();
    this.resize(width, height);
  }

  greet(now = this.#wallNow()): boolean {
    if (!this.#visible) {
      return false;
    }

    const line = this.#belongings.greet(now, this.#random);

    if (!line) {
      return false;
    }

    this.#say(line, 4);
    return true;
  }
  exportMemory(): Memory {
    return this.#belongings.exportMemory();
  }
  restoreMemory(data: unknown) {
    this.#learning.cancelAssociations();
    this.#cancelScene();
    this.#cancelFlight();
    this.#rest();
    this.#belongings.restore(data);
  }
  resize(width: number, height: number): void {
    this.#body.resize(width, height);
    this.#objects.resize(this.#body.width, this.#body.height);
    this.#gags.resizeGags();
    this.#cap.resize();
    this.#learning.resize();
    this.#belongings.resize(this.#body.width, this.#body.height);
    this.#activity.resize();
  }
  #randomPoint() {
    return this.#body.safePoint({
      x: 24 + this.#random() * (this.#body.width - 144),
      y: 70 + this.#random() * (this.#body.height - 240),
    });
  }
  #say(text: string, duration = 2.5): void {
    this.#speech.say(text, this.#time, duration);
  }
  #rest(delay = 2): void {
    this.#quiet.interrupt();
    this.#activity.rest(this.#time, delay);
  }
  #cancelFlight(): void {
    this.#activity.interruptFlight();
  }
  get carriedItem() {
    const scene = this.#registry.scene;

    if (scene?.kind === "gift" && scene.carrying) {
      return scene.item;
    } else {
      return null;
    }
  }
  get tidying() {
    return this.#cleanup.tidying;
  }
  tidyPointer(point: Point | null): void {
    this.#cleanup.point(point);
  }
  cleanupTarget(point: Point) {
    return this.#cleanup.target(point);
  }
  get wantsPointer() {
    if (this.#visible && this.#registry.scene?.kind === "cap") {
      return true;
    }

    if (this.#visible && this.#registry.scene?.kind === "cursor_egg") {
      return true;
    }

    if (!this.#visible || this.#settings.paused) {
      return false;
    }

    const scene = this.#registry.scene;
    return scene?.kind === "cursor" && scene.phase !== "chew";
  }
  pointer(point: PointerSample | null): void {
    this.#touch.pointer(point);
    this.#gags.gagPointer(point);
    this.#cursor.pointerSample(point);
    this.#typing.pointer(point);
    this.#cap.pointerSample(point);
  }
  caret(sample: CaretSample | null): void {
    this.#typing.sample(sample);
  }
  setVisible(visible: boolean): void {
    this.#visible = visible;
    this.#registry.visibility(visible);

    if (!visible) {
      this.#learning.cancelAssociations();
      this.#typing.resetSensing();
      this.#pickup.cancel();
      this.#touch.reset();
      this.#cleanup.cancel();
      this.#sounds = [];
    }
  }
  #cancelScene(): void {
    this.#objects.releaseBag();
    this.#registry.interrupt();
  }
  #replaceActivity() {
    this.#learning.cancelAssociations();
    this.#objects.discardFood();
    this.#cancelScene();
    this.#cancelFlight();
    this.#quiet.interrupt();
    this.#body.resetMotion();
    this.#sounds = [];
    this.#speech.clear();
    this.#activity.clearPendingDrop();
    this.#activity.stopTravel();
  }
  #beginTidying() {
    this.#learning.cancelAssociations();
    this.#cleanup.cancel();
    // A cancelled routine loses its scene props. Keep only unconsumed loose
    // chips in the same painted rectangles; held snacks leave with their owner.
    const chips = this.#registry.presentation().looseProps ?? [];
    this.#objects.preserveChips(chips);
    this.#cancelScene();
    this.#cancelFlight();
    this.#activity.clearPendingDrop();
    this.#sounds = [];
    this.#rest();
    this.#cleanup.begin();
    this.#say(dialogue.gullbert.general.iWasUsingThatMess);
  }
  #beginDragging(): void {
    this.#learning.cancelAssociations();
    this.#cancelScene();
    this.#cancelFlight();
    this.#cleanup.cancel();
    this.#touch.reset();
    this.#activity.clearPendingDrop();
    this.#objects.clearCrumb();
    this.#sounds = [];
    this.#rest();
    this.#say(
      [
        dialogue.gullbert.general.ohRelocation,
        dialogue.gullbert.general.excuseMe,
        dialogue.gullbert.general.putMeDown,
      ][this.#settings.mischief] ?? dialogue.gullbert.general.excuseMe,
    );
  }
  clean() {
    this.#learning.cancelAssociations();
    this.#typing.cleanNest();
    this.#objects.clear();
    this.#pickup.cancel();
    this.#cleanup.cancel();
    this.#cancelScene();
    this.#food.clearRequest();
    this.#cancelFlight();
    this.#quiet.interrupt();

    this.#activity.clearPendingDrop();
    this.#rest();
    this.#cleanup.bulk();
  }
  action(name: string, point?: Point) {
    if (point && (!Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      return;
    }

    if (name === "prepare_chip") {
      if (this.#learning.rewardCandidate()) {
        return;
      }

      name = "cancel";
    }

    if (name === "direct_pick") {
      if (point && this.flickCap(point)) {
        return;
      }

      if (point && !this.#cleanup.directPick(point)) {
        this.#touch.poke(point);
      }

      return;
    }

    this.#pickup.cancel();
    this.#touch.reset();

    // Picking must preserve the other props, especially the loose chip.
    if (name === "tidy_pick") {
      if (point) {
        this.#cleanup.pick(point);
      }

      return;
    }

    if (name === "tidy_cancel") {
      this.#cleanup.cancel();
      return;
    }

    if (name === "tidy_done") {
      this.#cleanup.finish();
      return;
    }

    if (name === "tidy") {
      this.#beginTidying();
      return;
    }

    if (name === "clean") {
      this.clean();
      return;
    }

    const wasOffended =
      this.#moods.snapshot().mood?.name === "offended" ||
      this.#cleanup.snapshot().level > 0;
    this.#cleanup.cancel();

    if (name === "feed" || name === "feed_here") {
      this.#cleanup.settle();
    }

    if (name === "caught" && this.#crime.caughtCrime()) {
      return;
    }

    let reward = null;

    if (name === "feed" || name === "feed_here") {
      reward = this.#learning.rewardCandidate();
    }

    this.#replaceActivity();

    if (this.#startRoutine(name, point)) {
      return;
    }

    if (name === "cancel") {
      this.#rest();
      return;
    }

    if (name === "summon") {
      const destination = this.#body.safePoint({
        x: (point?.x ?? this.#body.width / 2) - SIZE / 2,
        y: (point?.y ?? this.#body.height / 2) - SIZE / 2,
      });
      this.#body.place(destination);
      this.#rest(3);
      this.greet();
      return;
    }

    if (name === "feed" || name === "feed_here") {
      this.#food.clearRequest();
      this.#learning.offerReward(reward);
      let destination = { x: this.#body.x, y: this.#body.y };

      if (point) {
        destination = { x: point.x - 60, y: point.y - 78 };
      }

      this.#activity.fetch(destination);

      if (wasOffended) {
        this.#say(dialogue.gullbert.general.weCanSettleOutOfCourt, 2);
      } else {
        this.#say(dialogue.gullbert.general.chipDetected, 2);
      }

      return;
    }

    if (name === "squawk") {
      this.#activity.squawk(this.#time);
      this.#say(
        hatRemark({ ...this.#observe(), random: this.#random }) ??
          this.#moods.remark(this.#time) ??
          remarks[Math.floor(this.#random() * remarks.length)],
      );
      this.#sounds.push("squawk");
      return;
    }

    if (name === "poop") {
      this.#activity.beginDrop(
        point ?? { x: this.#body.x + 48, y: this.#body.y + 86 },
        this.#time,
      );
      this.#say(dialogue.gullbert.general.precisionArtistry, 2);
    }
  }
  #startRoutine(name: string, point?: Point): boolean {
    if (this.#registry.start(name, point)) {
      if (
        (name === "steal_bag" || name === "bag_caper") &&
        this.#registry.scene
      ) {
        this.#food.afterCrime(this.#time, this.#random);
      }

      return true;
    }

    return false;
  }
  splat(point: Point): void {
    this.#activity.splat(point, this.#time);
  }
  step(delta: number): void {
    if (!this.#visible) {
      return;
    }

    // Clamp after sleep or suspension: no teleporting or prank backlog.
    const dt = clamp(delta, 0, 0.1);
    this.#time += dt;
    this.#expireTransientState();

    if (this.#stepActiveRoutine(dt)) {
      return;
    }

    if (this.#activity.update(this.#time, dt)) {
      return;
    }

    this.#stepAutonomy();
  }

  #expireTransientState(): void {
    this.#moods.update(this.#time);
    this.#objects.expire(this.#time);
    this.#speech.expire(this.#time);
  }
  #stepActiveRoutine(delta: number): boolean {
    if (this.#pickup.snapshot().held) {
      return true;
    }

    if (this.#registry.scene?.kind === "relocation") {
      return this.#registry.update(delta);
    }

    this.#pickup.trail();

    if (this.#cleanup.update(delta)) {
      return true;
    }

    if (this.#touch.update()) {
      return true;
    }

    return this.#registry.update(delta);
  }

  #stepAutonomy(): void {
    if (this.#activity.mode !== "idle" || this.#settings.paused) {
      return;
    }

    if (this.#time < this.#activity.calmUntil) {
      return;
    }

    if (this.#learning.maybeStart()) {
      return;
    }

    if (this.#typing.maybeStart()) {
      return;
    }

    if (this.#gags.maybeGag()) {
      return;
    }

    if (
      this.#time >= this.#cleanup.snapshot().suppressUntil &&
      (this.#theatre.maybeTheatre() || this.#guests.maybeGuest())
    ) {
      return;
    }

    if (this.#perch.maybeVisitPerch()) {
      return;
    }

    if (
      this.#objects.snapshot().bag &&
      this.#time >= this.#cleanup.snapshot().suppressUntil
    ) {
      if (
        this.#settings.mischief > 0 &&
        this.#time >= this.#food.snapshot().nextCrime
      ) {
        if (this.#random() < 0.55) {
          this.action("steal_bag");
        } else {
          this.action("bag_caper");
        }

        return;
      }
    }

    if (
      (this.#objects.snapshot().bag?.servings ?? 0) > 0 &&
      this.#time >= this.#food.snapshot().nextBagVisit
    ) {
      this.action("search_snack");
      return;
    }

    if (this.#settings.mischief > 0) {
      if (this.#food.eligible(this.#time)) {
        this.action("nibble_cursor");
        return;
      }

      if (
        !this.#objects.snapshot().bag?.servings &&
        this.#food.requestDue(this.#time)
      ) {
        this.#food.request(this.#time, this.#random);
        this.#say(dialogue.gullbert.general.aChipForAHardworkingGull, 4);
        this.#activity.linger(this.#time + 3);
        return;
      }
    }

    if (this.#settings.mischief > 0 && this.#time >= this.#nextMischief) {
      let mischiefDelay;

      if (this.#settings.mischief === 2) {
        mischiefDelay = 12;
      } else {
        mischiefDelay = 35;
      }

      this.#nextMischief = this.#time + mischiefDelay + this.#random() * 20;

      if (
        this.#time >= this.#cleanup.snapshot().suppressUntil &&
        this.#random() < 0.35
      ) {
        this.action("poop");
      } else {
        this.action("squawk");
      }
    } else if (this.#time >= this.#activity.until) {
      const quiet = this.#quiet.choose();

      if (quiet) {
        this.#registry.start(quiet);
        return;
      }

      this.#activity.walk(this.#randomPoint());
    }
  }
  configure(settings: Partial<Settings>) {
    const previousHat = this.#settings.hat;
    const previousMischief = this.#settings.mischief;
    const previousVision = this.#settings.vision;

    if (
      settings.paused ||
      (settings.mischief != null &&
        settings.mischief !== this.#settings.mischief)
    ) {
      this.#learning.cancelAssociations();
      this.#pickup.cancel();

      if (
        this.#registry.scene?.kind === "relocation" ||
        (this.#registry.scene?.kind === "cursor" &&
          this.#registry.scene.retaliation)
      ) {
        this.#cancelScene();
        this.#rest();
      }
    }

    this.#settings = {
      ...this.#settings,
      ...settings,
      hat: normalizeHat(settings.hat ?? this.#settings.hat),
    };
    this.#cleanup.configure();

    if (
      settings.paused ||
      this.#settings.mischief !== previousMischief ||
      this.#settings.vision !== previousVision
    ) {
      this.#typing.resetSensing();

      if (this.#registry.scene?.kind === "typing") {
        this.#cancelScene();
        this.#rest();
      }
    }

    if (this.#settings.hat !== previousHat) {
      const remark = hatRemark({ ...this.#observe(), random: this.#random });

      if (remark) {
        this.#say(remark);
      }
    }

    if (settings.paused && this.#activity.mode === "walk") {
      this.#rest();
    }

    if (settings.paused) {
      switch (this.#registry.scene?.kind) {
        case "cursor":
        case "cap":
        case "trick":
        case "habit":
          this.#cancelScene();
          this.#rest();
          break;
      }
    }

    if (settings.paused || settings.mischief === 0) {
      this.#food.clearRequest();
    }

    let mischiefDelay;

    if (settings.mischief === 2) {
      mischiefDelay = 12;
    } else {
      mischiefDelay = 35;
    }

    this.#nextMischief = this.#time + mischiefDelay;
  }
  get moving() {
    if (
      this.#pickup.snapshot().held?.dragged ||
      this.#registry.active ||
      this.#activity.goal
    ) {
      return true;
    }

    return ["drop", "land", "nap", "preen", "tilt", "stretch"].includes(
      this.#activity.mode,
    );
  }
  get pose(): Pose {
    const routinePose = this.#activeRoutinePose();

    if (routinePose) {
      return routinePose;
    }

    if (
      ["walk", "fetch"].includes(this.#activity.mode) &&
      this.#activity.goal
    ) {
      const cycle: Pose[] = ["idle", "walkLeft", "idle", "walkRight"];
      let stepsPerSecond;

      if (this.#activity.mode === "fetch") {
        stepsPerSecond = 14;
      } else {
        stepsPerSecond = 8;
      }

      return cycle[Math.floor(this.#body.motionTime * stepsPerSecond) % 4];
    }

    if (this.#activity.mode === "takeoff" && this.#activity.flight) {
      if (this.#activity.until - this.#time > 0.25) {
        return "crouch";
      } else {
        return "wingUp";
      }
    }

    if (this.#activity.mode === "fly" || this.#activity.mode === "drop") {
      if (Math.floor(this.#time * 10) % 2) {
        return "wingUp";
      } else {
        return "wingDown";
      }
    }

    if (this.#activity.mode === "land" && this.#activity.flight) {
      if (this.#activity.until - this.#time > 0.2) {
        return "wingDown";
      } else {
        return "crouch";
      }
    }

    if (this.#activity.mode === "squawk" || this.#activity.mode === "eat") {
      if (Math.floor(this.#time * 8) % 2) {
        return "squawk";
      } else {
        return "idle";
      }
    }

    if (this.#activity.mode === "proud") {
      return "blink";
    }

    const mood = this.#moods.pose(this.#activity.mode, this.#time);

    if (mood) {
      return mood;
    }

    if (this.#time % 5 > 4.75) {
      return "blink";
    }

    return "idle";
  }
  #activeRoutinePose(): Pose | null {
    const pickup = this.#pickup.pose();

    if (pickup) {
      return pickup;
    }

    const cleanup = this.#cleanup.pose();

    if (cleanup) {
      return cleanup;
    }

    const touch = this.#touch.pose();

    if (touch) {
      return touch;
    }

    return (
      this.#registry.presentation().pose ?? this.#learning.expectationPose()
    );
  }
  get frame() {
    return frameFor(this.pose);
  }

  #routineProps: SceneProp[] = [];

  #createCapabilities(): BehaviorCapabilities {
    const runtime = this;
    return Object.freeze({
      clock: Object.freeze({
        get now() {
          return runtime.#time;
        },
      }),
      random: () => {
        return runtime.#random();
      },
      movement: Object.freeze({
        get position() {
          return Object.freeze({ x: runtime.#body.x, y: runtime.#body.y });
        },
        get bounds() {
          return Object.freeze({
            width: runtime.#body.width,
            height: runtime.#body.height,
          });
        },
        moveTo(point: Point) {
          runtime.#body.place(point);
        },
        face(direction: -1 | 1) {
          runtime.#body.face(direction);
        },
      }),
      speech: Object.freeze({
        say(text: string, duration?: number) {
          runtime.#say(text, duration);
        },
        clear() {
          runtime.#speech.clear();
        },
        forget() {
          runtime.#speech.forget();
        },
      }),
      props: Object.freeze({
        add(prop: Omit<SceneProp, "id">) {
          const id = runtime.#objects.nextId();
          runtime.#routineProps.push({ ...prop, id });
          return id;
        },
        remove(id: number) {
          runtime.#routineProps = runtime.#routineProps.filter(
            function keep(prop) {
              return prop.id !== id;
            },
          );
        },
      }),
      events: Object.freeze({
        emit(sound: Sound) {
          runtime.#sounds.push(sound);
        },
      }),
      body: this.#body,
      objects: this.#objects,
      activity: this.#activity,
      food: this.#food,
      belongings: this.#belongings,
      moods: this.#moods,
      destinations: Object.freeze({
        randomPoint() {
          return runtime.#randomPoint();
        },
      }),
      policy: Object.freeze({
        settings() {
          return Object.freeze({ ...runtime.#settings });
        },
        visible() {
          return runtime.#visible;
        },
        tidying() {
          return runtime.tidying;
        },
        cleanup() {
          return runtime.#cleanup.snapshot();
        },
      }),
      commands: Object.freeze({
        action(name: string, point?: Point) {
          runtime.action(name, point);
        },
      }),
      lifecycle: Object.freeze({
        complete() {
          runtime.#completeRoutine();
        },
        interrupt() {
          runtime.#cancelScene();
        },
        rest(delay?: number) {
          runtime.#rest(delay);
        },
      }),
    });
  }
  #observe(): SimulationView {
    const pose = this.pose;
    return { ...this.#baseObservation(), pose, frame: frameFor(pose) };
  }
  #baseObservation(): SimulationView {
    const pose: Pose = "idle";
    const belongings = this.#belongings.snapshot();
    return {
      ...this.#body.snapshot(),
      ...this.#objects.snapshot(),
      ...this.#activity.snapshot(),
      ...this.#food.snapshot(),
      ...this.#moods.snapshot(),
      ...this.#quiet.snapshot(),
      ...this.#speech.snapshot(),
      time: this.#time,
      nextMischief: this.#nextMischief,
      settings: { ...this.#settings },
      events: [...this.#sounds],
      scene: this.#registry.scene,
      visible: this.#visible,
      memory: belongings.memory,
      memoryRevision: belongings.revision,
      nextPerchVisit: this.#perch.nextPerchVisit,
      cleanup: this.#cleanup.snapshot(),
      touch: this.#touch.snapshot(),
      pickup: this.#pickup.snapshot(),
      gagSchedule: this.#gags.gagSchedule,
      nextGuest: this.#guests.nextGuest,
      rareTheatre: this.#theatre.rareTheatre,
      carriedItem: this.carriedItem,
      tidying: this.tidying,
      wantsPointer: this.wantsPointer,
      moving: this.moving,
      pose,
      frame: frameFor(pose),
    };
  }

  #completeRoutine(): void {
    const scene = this.#registry.scene;
    let played = false;

    switch (scene?.kind) {
      case "cap":
        played = scene.phase === "victory" && scene.rounds >= 3;
        break;

      case "toss":
        played = scene.phase === "eat";
        break;
    }

    if (
      scene &&
      !["trick", "habit", "guest", "gift", "typing"].includes(scene.kind)
    ) {
      if (played) {
        this.#belongings.remember("play", scene.kind, this.#body);
      } else {
        this.#belongings.remember("activity", scene.kind, this.#body);
      }
    }

    this.#objects.releaseBag();
    this.#registry.complete();

    if (played) {
      this.#learning.playCompleted();
    }
  }
  #tokens = new WeakMap<object, object>();
  #reactionToken: object | null = null;
  #tokenFor(identity: object): object {
    let token = this.#tokens.get(identity);

    if (!token) {
      token = Object.freeze({});
      this.#tokens.set(identity, token);
    }

    return token;
  }
  inspect(): SimulationSnapshot {
    return freezeObservation(this.#observe());
  }
  present(pointer: Point | null = null, interactive = true): PetPresentation {
    const routine: RoutinePresentation = this.#registry.presentation();
    let props = [...(routine.props ?? [])];

    if (this.#visible) {
      props = [...props, ...this.#routineProps, ...this.#typing.nestProps()];
    }

    const presentation = { ...routine, props };
    return freezeObservation(
      projectPresentation(this.#observe(), pointer, interactive, presentation),
    );
  }
  status() {
    return Object.freeze({
      watchTyping: this.#typing.enabled(),
      memoryRevision: this.#belongings.snapshot().revision,
      mood: this.#moods.snapshot().mood?.name ?? "",
      sound: this.#settings.sound,
      tidying: this.tidying,
      idle: this.#activity.mode === "idle",
      animate:
        this.moving ||
        this.tidying ||
        ["eat", "squawk"].includes(this.#activity.mode),
      held: Boolean(this.#pickup.snapshot().held),
      dragged: Boolean(this.#pickup.snapshot().held?.dragged),
    });
  }
  drainSounds(): Sound[] {
    const sounds = this.#sounds;
    this.#sounds = [];
    return sounds;
  }
  interactionRects(interactive = true) {
    return interactionRects(this.#observe(), interactive);
  }
  pickupRect() {
    return pickupRect(this.#observe());
  }
  canPickup(): boolean {
    return canPickup(this.#observe());
  }
  directCleanupAt(point: Point): boolean {
    return directCleanupTarget(this.#observe(), point) !== null;
  }
  flickCap(point: Point): boolean {
    if (!this.#visible || this.tidying) {
      return false;
    }

    return this.#cap.flick(point);
  }
  beginPickup(point: Point, now: number): boolean {
    return this.#pickup.begin(point, now);
  }
  movePickup(point: Point): void {
    this.#pickup.move(point);
  }
  finishPickup(cancelled: boolean, now: number): object | null {
    if (cancelled) {
      this.#pickup.cancel();
      return null;
    }

    this.#pickup.finish(now);
    const scene = this.#registry.scene;

    if (scene?.kind === "relocation" && scene.revenge !== "none") {
      this.#reactionToken = this.#tokenFor(this.#pickup.identity);
      return this.#reactionToken;
    }

    this.#reactionToken = null;
    return null;
  }
  currentReaction(token: object): boolean {
    const scene = this.#registry.scene;

    if (token !== this.#reactionToken) {
      return false;
    }

    switch (scene?.kind) {
      case "relocation":
        return true;

      case "cursor":
        return Boolean(scene.retaliation);

      default:
        return false;
    }
  }
  armReaction(token: object, id: number): boolean {
    if (!Number.isFinite(id) || !this.currentReaction(token)) {
      return false;
    }

    if (this.#registry.scene?.kind === "relocation") {
      this.#pickup.authorize(id);
      return true;
    }

    if (this.#registry.scene?.kind === "cursor") {
      this.#cursor.authorize(id);
      return true;
    }

    return false;
  }
  reactionMovesCursor(): boolean {
    const scene = this.#registry.scene;

    if (scene?.kind === "relocation") {
      return scene.revenge === "chase" || scene.revenge === "trail";
    }

    return scene?.kind === "cursor" && Boolean(scene.retaliation);
  }
  updatePickupClock(now: number): void {
    this.#pickup.updateClock(now);
  }
  cursorEncounter() {
    const scene = this.#registry.scene;

    if (scene?.kind !== "cursor" || !scene.takeover) {
      return null;
    }

    return Object.freeze({
      token: this.#tokenFor(this.#cursor.identity),
      phase: scene.phase,
      cursorId: scene.cursorId,
      beak: Object.freeze(cursorBeak(this.#body)),
    });
  }
  releaseCursor(reason?: string, token?: object): void {
    const scene = this.#registry.scene;

    if (scene?.kind !== "cursor") {
      return;
    }

    if (token && this.#tokenFor(this.#cursor.identity) !== token) {
      return;
    }

    this.#cursor.releaseCursor(reason);
  }
  authorizeCursor(id: number): void {
    if (Number.isFinite(id)) {
      this.#cursor.authorize(id);
    }
  }
}

export type SimulationSnapshot = ReadonlyValue<SimulationView>;
function freezeObservation<T>(value: T): ReadonlyValue<T> {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) {
      freezeObservation(child);
    }

    Object.freeze(value);
  }

  return value as ReadonlyValue<T>;
}

function frameFor(pose: Pose): number {
  if (pose in POSES) {
    return POSES[pose as keyof typeof POSES];
  }

  return 0;
}
