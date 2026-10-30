import { dialogue } from "./dialogue.js";
import { Body } from "./body.js";
import { Props } from "./props.js";
import { Activity } from "./activity.js";
import { Speech } from "./speech.js";
import { FoodPolicy } from "./food-policy.js";
import { Belongings } from "./belongings.js";
import { Motivation } from "./motivation.js";
import { Pettiness } from "./pettiness.js";
import { Grudge } from "./grudge.js";
import { Boredom } from "./boredom.js";
import { RoutineRegistry } from "./registry.js";
import type { RoutinePresentation } from "./routine.js";
import type { Scene } from "./scenes.js";
import type { BehaviorCapabilities, SimulationView } from "./capabilities.js";
import {
  projectPresentation,
  type PetPresentation,
  type PresentationObservation,
  type ReadonlyValue,
} from "./presentation.js";
import { interactionRects } from "./interaction.js";
import { SIZE, clamp } from "./geometry.js";
export { SIZE, clamp } from "./geometry.js";
import { POSES, type Pose } from "./poses.js";
export { POSES } from "./poses.js";
import type {
  Point,
  PointerSample,
  Settings,
  Memory,
  Sound,
  WorkSample,
} from "./model.js";
import { Mood } from "./behaviors/moods.js";
import { QuietRoutine } from "./behaviors/quiet.js";
import { Pickup, canPickup, pickupRect } from "./behaviors/pickup.js";
import { Touch, canTouch } from "./behaviors/touch.js";
import { Cleanup, cleanupObjects, directCleanupTarget } from "./behaviors/cleanup.js";
import { normalizeHat, hatRemark } from "./behaviors/hats.js";
import { GagRoutine, gagOffset } from "./behaviors/gags.js";
import { TheatreRoutine, theatreOffset } from "./behaviors/theatre.js";
import { GuestRoutine } from "./behaviors/guests.js";
import { GiftRoutine } from "./behaviors/gifts.js";
import { NestPlayRoutine } from "./behaviors/nest-play.js";
import { ConstructionRoutine } from "./behaviors/construction.js";
import { NestRoutine } from "./behaviors/nest.js";
import { PerchRoutine } from "./behaviors/perch.js";
import { CrimeRoutine } from "./behaviors/crime.js";
import { CursorRoutine } from "./behaviors/cursor.js";
import { SnackRoutine } from "./behaviors/snacks.js";
import { CapRoutine } from "./behaviors/cap.js";
import { LearningRoutine } from "./behaviors/learning.js";
import { WorkRoutine } from "./behaviors/work.js";

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
  #nest: NestRoutine;
  #construction: ConstructionRoutine;
  #nestPlay: NestPlayRoutine;
  #crime: CrimeRoutine;
  #cursor: CursorRoutine;
  #snacks: SnackRoutine;
  #cap: CapRoutine;
  #learning: LearningRoutine;
  #work: WorkRoutine;
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
  #motivation = new Motivation();
  #pettiness = new Pettiness();
  #grudge = new Grudge();
  #boredom = new Boredom();
  #nextHangoutVisit = 60;
  #recallGraceSeconds = 0;
  constructor(
    width = 1200,
    height = 800,
    random = Math.random,
    options: { now?: () => number } = {},
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
        this.#grudge.soothe(3, this.#time);
        this.#learning.ateMeal(point);
      },
      walked: (point) => {
        this.#restAtHangout(point);
      },
    });
    this.#food = new FoodPolicy(this.#random);
    this.#capabilities = this.#createCapabilities();
    this.#gags = new GagRoutine(this.#capabilities);
    this.#theatre = new TheatreRoutine(this.#capabilities);
    this.#guests = new GuestRoutine(this.#capabilities);
    this.#gifts = new GiftRoutine(this.#capabilities);
    this.#perch = new PerchRoutine(this.#capabilities);
    this.#construction = new ConstructionRoutine(this.#capabilities);
    this.#nest = new NestRoutine(this.#capabilities);
    this.#nestPlay = new NestPlayRoutine(
      this.#capabilities,
      (pointer, cursorId, remainingSeconds) => {
        this.#cursor.startRetaliation({
          reaction: "chase",
          deadlineSeconds: this.#time + remainingSeconds,
          expiresAtMs: this.#wallNow() + remainingSeconds * 1000,
          pointer,
          cursorId,
          throwCursor: true,
        });
        this.#registry.activate(this.#cursor);
        this.#activity.beginRoutine("cursor");
      },
    );
    this.#crime = new CrimeRoutine(this.#capabilities);
    this.#cursor = new CursorRoutine(this.#capabilities);
    this.#snacks = new SnackRoutine(this.#capabilities);
    this.#cap = new CapRoutine(this.#capabilities);
    this.#learning = new LearningRoutine(this.#capabilities);
    this.#work = new WorkRoutine(this.#capabilities);
    this.#cleanup = new Cleanup({
      observe: () => {
        return {
          ...this.#geometryObservation(),
          flight: this.#activity.flight,
          settings: { ...this.#settings },
        };
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
      offended: () => {
        this.#grudge.offend("tidied", this.#time);
      },
    });
    this.#touch = new Touch({
      scratched: () => {
        this.#grudge.soothe(2, this.#time);
        this.#learning.scratched();
      },
      body: this.#body,
      clock: this.#capabilities.clock,
      speech: this.#capabilities.speech,
      available: () => {
        return canTouch({
          visible: this.#visible,
          pickup: this.#pickup.snapshot(),
          scene: this.#registry.scene,
          flight: this.#activity.flight,
          tidying: this.tidying,
          cleanup: this.#cleanup.snapshot(),
          time: this.#time,
          mode: this.#activity.mode,
        });
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
        const view = { scene: this.#registry.scene, time: this.#time };
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
        this.#grudge.offend("handled", this.#time);
        this.#moods.set("offended", this.#time, { speak: false });
      },
      grudge: () => {
        return this.#grudge.level(this.#time);
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
      relocated: () => {
        this.#registry.activate(this.#pickup);
      },
      cancel: () => {
        this.#cancelScene();
      },
      retaliate: (reaction) => {
        this.#cursor.startRetaliation(reaction);
        this.#registry.activate(this.#cursor);
        this.#activity.beginRoutine("cursor");
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
    this.#registry = new RoutineRegistry(
      [
        this.#gags,
        this.#theatre,
        this.#guests,
        this.#gifts,
        this.#perch,
        this.#nest,
        this.#construction,
        this.#nestPlay,
        this.#work,
        this.#crime,
        this.#cursor,
        this.#snacks,
        this.#cap,
        this.#learning,
        this.#quiet,
      ],
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
  checkpointMemory(): void {
    this.#belongings.checkpointActiveTime();
  }
  restoreMemory(data: unknown) {
    this.#pettiness.settle();
    this.#grudge.settle();
    this.#learning.cancelAssociations();
    this.#cancelScene();
    this.#cancelFlight();
    this.#rest();
    this.#belongings.restore(data);
    this.#recallGraceSeconds = 0;
    this.#learning.resetHabits();
    this.#boredom.reset(this.#belongings.snapshot().memory.episodes);
    this.#nextHangoutVisit = this.#time + 60;
  }
  resize(width: number, height: number): void {
    this.#work.reset();
    this.#body.resize(width, height);
    this.#objects.resize(this.#body.width, this.#body.height);
    this.#gags.resizeGags();
    this.#cap.resize();
    this.#nestPlay.resize();
    this.#belongings.resize(this.#body.width, this.#body.height);
    this.#learning.resize();
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
    return carriedItemIn(this.#registry.scene);
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
    if (!this.#visible) {
      return false;
    }

    return this.#sceneWantsPointer(this.#registry.scene);
  }
  #sceneWantsPointer(scene: ReadonlyValue<Scene> | null): boolean {
    switch (scene?.kind) {
      case "nest_play":
      case "cap":
      case "cursor_egg":
      case "construction":
        return true;

      case "cursor":
        return !this.#settings.paused && scene.phase !== "chew";

      default:
        return false;
    }
  }
  pointer(point: PointerSample | null): void {
    this.#touch.pointer(point);
    this.#gags.gagPointer(point);
    this.#cursor.pointerSample(point);
    this.#cap.pointerSample(point);
    this.#nestPlay.pointerSample(point);
    this.#construction.pointerSample(point);
  }
  observeWork(sample: WorkSample | null, nowMs: number): void {
    if (!this.#visible || this.#settings.paused || this.#settings.mischief === 0) {
      this.#work.reset();
      return;
    }

    this.#work.sample(sample, nowMs);
  }
  setVisible(visible: boolean): void {
    if (visible && !this.#visible) {
      this.#recallGraceSeconds = 0;
    }

    this.#visible = visible;
    this.#registry.visibility(visible);

    if (!visible) {
      this.#pettiness.settle();
      this.#grudge.settle();
      this.#work.reset();
      this.#learning.cancelAssociations();
      this.#pickup.cancel();
      this.#touch.reset();
      this.#cleanup.cancel();
      this.#sounds = [];
    }
  }
  #cancelScene(): void {
    this.#pettiness.interrupt();
    this.#objects.releaseBag();
    this.#registry.interrupt();
  }
  #replaceActivity(command: string) {
    this.#learning.replaceActivity(command);
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
    const removedSomething = cleanupObjects(this.#objects.snapshot()).length > 0;
    this.#learning.cancelAssociations();
    this.#objects.clear();
    this.#pickup.cancel();
    this.#cleanup.cancel();
    this.#cancelScene();
    this.#food.clearRequest();
    this.#cancelFlight();
    this.#quiet.interrupt();

    this.#activity.clearPendingDrop();
    this.#rest();
    this.#cleanup.bulk(removedSomething);
  }
  action(name: string, point?: Point) {
    if (point && (!Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      return;
    }

    if (name === "forget_learning") {
      this.#pettiness.settle();
    }

    if (name === "prepare_chip") {
      if (this.#learning.rewardCandidate()) {
        return;
      }

      name = "cancel";
    }

    // Direct picks preserve the current pickup and accumulated touch reactions.
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

    // Tidying has its own interruption rules and must preserve eligible props.
    switch (name) {
      case "tidy_pick":
        if (point) {
          this.#cleanup.pick(point);
        }

        return;

      case "tidy_cancel":
        this.#cleanup.cancel();
        return;

      case "tidy_done":
        this.#cleanup.finish();
        return;

      case "tidy":
        this.#beginTidying();
        return;

      case "clean":
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

    this.#replaceActivity(name);

    if (this.#startRoutine(name, point)) {
      if (name === "forget_learning") {
        this.#boredom.reset(this.#belongings.snapshot().memory.episodes);
      }

      return;
    }

    // Unknown commands still replace activity, but do not change its mode or deadline.
    switch (name) {
      case "cancel":
        this.#rest();
        return;

      case "summon": {
        const destination = this.#body.safePoint({
          x: (point?.x ?? this.#body.width / 2) - SIZE / 2,
          y: (point?.y ?? this.#body.height / 2) - SIZE / 2,
        });
        this.#body.place(destination);
        this.#rest(3);
        this.greet();
        return;
      }

      case "feed":
      case "feed_here": {
        this.#food.clearRequest();
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

      case "squawk":
        this.#activity.squawk(this.#time);
        this.#say(
          hatRemark({ ...this.#observe(), random: this.#random }) ??
            this.#moods.remark(this.#time) ??
            remarks[Math.floor(this.#random() * remarks.length)],
        );
        this.#sounds.push("squawk");
        return;

      case "poop":
        this.#activity.beginDrop(
          point ?? { x: this.#body.x + 48, y: this.#body.y + 86 },
          this.#time,
        );
        this.#say(dialogue.gullbert.general.precisionArtistry, 2);
        return;
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
    this.#boredom.observe(this.#belongings.snapshot().memory.episodes);

    if (!this.#settings.paused) {
      this.#recallGraceSeconds += dt;
      this.#belongings.creditActiveTime(dt * 1000, this.#random);
      this.#motivation.update(dt, this.#activity.mode);
      this.#boredom.update(dt, this.#activity.mode);
    }

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
    const pickup = this.#pickup.snapshot();

    if (pickup.held) {
      return true;
    }

    if (this.#registry.scene?.kind === "relocation") {
      return this.#registry.update(delta);
    }

    this.#cursor.maintainRetaliation(pickup.now);

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

    const motivation = this.#motivation.snapshot();
    const boredom = this.#boredom.snapshot();

    if (this.#stepPettyReaction()) {
      return;
    }

    if (this.#stepRecall()) {
      return;
    }

    if (this.#learning.maybeStart(motivation, boredom)) {
      const kind = this.#registry.scene?.kind;

      if (kind === "trick" || kind === "cap") {
        this.#pettiness.invited(this.#registry.identity);
      }

      return;
    }

    if (this.#work.maybeVisit()) {
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

    if (this.#construction.maybeBuild()) {
      return;
    }

    if (this.#nest.maybeVisit()) {
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

      // A grudge makes unprompted mischief sooner and messier, never different in kind.
      const grudge = this.#grudge.level(this.#time);
      const pace = [1, 0.75, 0.5][grudge];
      this.#nextMischief =
        this.#time + (mischiefDelay + this.#random() * 20) * pace;

      if (
        this.#time >= this.#cleanup.snapshot().suppressUntil &&
        this.#random() < [0.35, 0.5, 0.7][grudge]
      ) {
        this.action("poop");
      } else {
        this.action("squawk");
      }

      if (grudge > 0) {
        const lines = [
          dialogue.gullbert.grudge.annoyed,
          dialogue.gullbert.grudge.furious,
        ][grudge - 1];
        this.#say(lines[Math.floor(this.#random() * lines.length)], 3);
      }
    } else if (this.#time >= this.#activity.until) {
      const quiet = this.#quiet.choose(motivation, boredom);

      if (quiet) {
        this.#registry.start(quiet);
        return;
      }

      this.#wander();
    }
  }

  #stepRecall(): boolean {
    if (!this.#visible || this.#settings.paused || this.tidying) {
      return false;
    }

    if (this.#activity.mode !== "idle" || this.#registry.active || this.#activity.flight) {
      return false;
    }

    if (this.#recallGraceSeconds < 120 || this.#time < this.#activity.calmUntil) {
      return false;
    }

    const cleanup = this.#cleanup.snapshot();

    if (this.#time < cleanup.suppressUntil || this.#time < cleanup.reactionUntil) {
      return false;
    }

    if (this.#time < cleanup.sulkUntil || this.#pickup.snapshot().held) {
      return false;
    }

    if (this.#touch.snapshot().zone !== "" || this.#touch.animating) {
      return false;
    }

    if (this.#time < this.#speech.snapshot().bubbleUntil) {
      return false;
    }

    const recall = this.#belongings.reserveRecall(this.#random, ["snack", "trick", "treasure"]);

    if (!recall) {
      return false;
    }

    return this.#registry.startRecall(recall);
  }

  #wander(): void {
    let destination = this.#randomPoint();

    if (this.#time >= this.#nextHangoutVisit && this.#random() < 0.3) {
      const hangout = this.#belongings.hangoutPoint();
      const distance = Math.hypot(hangout.x - this.#body.x, hangout.y - this.#body.y);

      if (distance >= 32) {
        destination = hangout;
      }
    }

    this.#activity.walk(destination);
  }

  #restAtHangout(point: Point): void {
    if (this.#settings.paused || this.#time < this.#nextHangoutVisit) {
      return;
    }

    if (!this.#belongings.visitHangout(point)) {
      return;
    }

    this.#nextHangoutVisit = this.#time + 90;
    const visits = this.#belongings.snapshot().memory.preferences.hangout!.visits;
    const until = this.#time + 4 + Math.min(4, visits);
    this.#activity.linger(until);
    this.#activity.settleUntil(until);
    const line = visits >= 3
      ? dialogue.gullbert.hangout.usualSpot
      : dialogue.gullbert.hangout.gettingComfortable;
    this.#say(line, 3);
  }

  #stepPettyReaction(): boolean {
    if (this.#pettiness.waiting(this.#time)) {
      return true;
    }

    const action = this.#pettiness.take(this.#time, this.#settings);

    if (!action) {
      return false;
    }

    if (this.#time < this.#cleanup.snapshot().suppressUntil) {
      return false;
    }

    this.action(action);
    this.#moods.set("offended", this.#time, { speak: false });
    const line = action === "poop"
      ? dialogue.gullbert.pettiness.ignoredMess
      : dialogue.gullbert.pettiness.ignoredExit;
    this.#say(line, 4);
    return true;
  }

  configure(settings: Partial<Settings>) {
    const previousHat = this.#settings.hat;

    if (
      settings.paused ||
      (settings.mischief != null &&
        settings.mischief !== this.#settings.mischief)
    ) {
      this.#pettiness.settle();
      this.#learning.cancelAssociations();
      this.#pickup.cancel();

      const scene = this.#registry.scene;

      switch (scene?.kind) {
        case "cursor":
          if (!scene.retaliation) {
            break;
          }

          this.#cancelScene();
          this.#rest();
          break;

        case "nest_play":
        case "relocation":
          this.#cancelScene();
          this.#rest();
          break;
      }
    }

    this.#settings = {
      ...this.#settings,
      ...settings,
      hat: normalizeHat(settings.hat ?? this.#settings.hat),
    };
    this.#cleanup.configure();

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
      this.#grudge.settle();
      this.#food.clearRequest();
      this.#work.reset();
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
    if (this.#cleanup.moving || this.#touch.animating) {
      return true;
    }

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
    return this.#resolvePose();
  }
  #resolvePose(routine?: RoutinePresentation): Pose {
    const routinePose = this.#activeRoutinePose(routine);

    if (routinePose) {
      return routinePose;
    }

    switch (this.#activity.mode) {
      case "walk":
      case "fetch": {
        if (this.#activity.goal) {
          const cycle: Pose[] = ["idle", "walkLeft", "idle", "walkRight"];
          const stepsPerSecond = this.#activity.mode === "fetch" ? 14 : 8;
          return cycle[Math.floor(this.#body.motionTime * stepsPerSecond) % 4];
        }

        break;
      }

      case "takeoff":
        if (this.#activity.flight) {
          return this.#activity.until - this.#time > 0.25 ? "crouch" : "wingUp";
        }

        break;

      case "fly":
      case "drop":
        return Math.floor(this.#time * 10) % 2 ? "wingUp" : "wingDown";

      case "land":
        if (this.#activity.flight) {
          return this.#activity.until - this.#time > 0.2 ? "wingDown" : "crouch";
        }

        break;

      case "squawk":
      case "eat":
        return Math.floor(this.#time * 8) % 2 ? "squawk" : "idle";

      case "proud":
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
  #activeRoutinePose(routine?: RoutinePresentation): Pose | null {
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

    const presentation = routine ?? this.#registry.presentation();
    return presentation.pose ?? this.#learning.expectationPose();
  }
  get frame() {
    return frameFor(this.pose);
  }

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
      motivation: this.#motivation,
      pettiness: this.#pettiness,
      meals: Object.freeze({
        consumed(point: Point) {
          runtime.#learning.ateMeal(point);
        },
      }),
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
  #geometryObservation() {
    return {
      ...this.#body.snapshot(),
      ...this.#objects.snapshot(),
      scene: this.#registry.scene,
      time: this.#time,
      visible: this.#visible,
      tidying: this.tidying,
      mode: this.#activity.mode,
      memory: this.#belongings.snapshot().memory,
      settings: this.#settings,
    };
  }
  #presentationObservation(routine: RoutinePresentation): PresentationObservation {
    const geometry = this.#geometryObservation();
    const pose = this.#resolvePose(routine);

    return {
      ...geometry,
      ...this.#speech.snapshot(),
      ...this.#moods.snapshot(),
      settings: { ...this.#settings },
      until: this.#activity.until,
      memory: this.#belongings.snapshot().memory,
      touch: this.#touch.snapshot(),
      pickup: this.#pickup.snapshot(),
      carriedItem: carriedItemIn(geometry.scene),
      pose,
      frame: frameFor(pose),
    };
  }
  #baseObservation(): SimulationView {
    const pose: Pose = "idle";
    const belongings = this.#belongings.snapshot();
    const scene = this.#registry.scene;

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
      scene,
      visible: this.#visible,
      memory: belongings.memory,
      memoryRevision: belongings.revision,
      motivation: this.#motivation.snapshot(),
      boredom: this.#boredom.snapshot(),
      grudge: this.#grudge.snapshot(this.#time),
      nextPerchVisit: this.#perch.nextPerchVisit,
      cleanup: this.#cleanup.snapshot(),
      touch: this.#touch.snapshot(),
      pickup: this.#pickup.snapshot(),
      gagSchedule: this.#gags.gagSchedule,
      nextGuest: this.#guests.nextGuest,
      rareTheatre: this.#theatre.rareTheatre,
      carriedItem: carriedItemIn(scene),
      tidying: this.tidying,
      wantsPointer: this.#visible && this.#sceneWantsPointer(scene),
      moving: this.moving,
      pose,
      frame: frameFor(pose),
    };
  }

  #completeRoutine(): void {
    const scene = this.#registry.scene;
    const ignored = this.#pettiness.completed(
      this.#registry.identity,
      scene,
      this.#time,
      this.#settings,
      this.#random,
    );

    if (ignored) {
      this.#grudge.offend("ignored", this.#time);
    }

    const played = this.#learning.rememberCompletion(scene);

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
    const routine = this.#registry.presentation();

    return freezeObservation(
      projectPresentation(this.#presentationObservation(routine), pointer, interactive, routine),
    );
  }
  status() {
    return Object.freeze({
      memoryRevision: this.#belongings.snapshot().revision,
      mood: this.#moods.snapshot().mood?.name ?? "",
      sound: this.#settings.sound,
      tidying: this.tidying,
      idle: this.#activity.mode === "idle",
      workEnabled: this.#visible && !this.#settings.paused && this.#settings.mischief > 0,
      animate:
        this.moving ||
        this.tidying ||
        ["eat", "squawk"].includes(this.#activity.mode),
      held: Boolean(this.#pickup.snapshot().held) || this.#nestPlay.scene?.phase === "held",
      dragged: Boolean(this.#pickup.snapshot().held?.dragged)
        || this.#nestPlay.scene?.phase === "held",
    });
  }
  drainSounds(): Sound[] {
    const sounds = this.#sounds;
    this.#sounds = [];
    return sounds;
  }
  interactionRects(interactive = true) {
    return interactionRects(this.#geometryObservation(), interactive);
  }
  pickupRect() {
    return pickupRect({ ...this.#body.snapshot(), scene: this.#registry.scene, time: this.#time });
  }
  canPickup(): boolean {
    return canPickup({
      visible: this.#visible,
      tidying: this.tidying,
      scene: this.#registry.scene,
      time: this.#time,
    });
  }
  directCleanupAt(point: Point): boolean {
    return directCleanupTarget(this.#geometryObservation(), point) !== null;
  }
  flickCap(point: Point): boolean {
    if (!this.#visible || this.tidying) {
      return false;
    }

    const flicked = this.#cap.flick(point);

    if (flicked) {
      this.#pettiness.settle();
    }

    return flicked;
  }
  treasureRect(point: Point) {
    return this.#nestPlay.hitRect(point, this.#construction.scene?.borrowedSlots);
  }
  beginPickup(point: Point, now: number): boolean {
    if (this.treasureRect(point)) {
      if (this.#nestPlay.scene?.phase !== "ready") {
        const scene = this.#registry.scene;

        if (scene?.kind === "nest" && scene.phase === "sleep") {
          this.#moods.set("sleepy", this.#time, { speak: false });
        }

        this.#replaceActivity("nest_play");
        this.#touch.reset();
        this.#pickup.cancel();
      }

      if (this.#nestPlay.begin(point)) {
        this.#registry.activate(this.#nestPlay);
        return true;
      }
    }

    return this.#pickup.begin(point, now);
  }
  movePickup(point: Point): void {
    if (this.#nestPlay.scene?.phase === "held") {
      this.#nestPlay.move(point);
      return;
    }

    this.#pickup.move(point);
  }
  finishPickup(cancelled: boolean, now: number): object | null {
    if (this.#nestPlay.scene?.phase === "held") {
      if (cancelled) {
        this.#cancelScene();
        this.#rest();
        return null;
      }

      const retaliates = this.#nestPlay.release();
      this.#reactionToken = retaliates ? this.#tokenFor(this.#nestPlay.identity) : null;
      return this.#reactionToken;
    }

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
      case "nest_play":
        return scene.revenge !== "none";

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

    if (this.#registry.scene?.kind === "nest_play") {
      this.#nestPlay.authorize(id);
      return true;
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

    if (scene?.kind === "nest_play") {
      return scene.revenge === "cursor";
    }

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
      holdMs: scene.retaliation ? 2000 : 1200,
      beak: Object.freeze(this.#cursor.cursorTarget()),
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
function carriedItemIn(scene: ReadonlyValue<Scene> | null) {
  if (scene?.kind === "gift" && scene.carrying) {
    return scene.item;
  }

  return null;
}

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
