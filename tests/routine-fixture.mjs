import { Belongings } from "../web-dist/simulation/belongings.js";
import { Activity } from "../web-dist/simulation/activity.js";
import { Props } from "../web-dist/simulation/props.js";
import { RoutineRegistry } from "../web-dist/simulation/registry.js";
import { Body } from "../web-dist/simulation/body.js";
import { clamp, SIZE } from "../web-dist/simulation/geometry.js";

// Controlled built-in capabilities for isolated routine clocks and world objects.
// Integration tests use Gullbert's operations and detached snapshots instead.
export function routineFixture(Routine, random = () => 0.5) {
  const sim = {
    width: 900,
    height: 650,
    x: 495,
    y: 460,
    facing: 1,
    time: 0,
    motionTime: 0,
    mode: "idle",
    until: 3,
    serial: 0,
    visible: true,
    settings: { paused: true, sound: false, mischief: 0 },
    random,
    bubble: "",
    bubbleUntil: 0,
    goal: null,
    bag: null,
    cones: [],
    events: [],
    cleanup: { suppressUntil: 0 },
    tidying: false,
    nextBagVisit: 0,
    snackRequestAt: null,
    nibbleEligibleAt: null,
    safePoint(point) {
      return {
        x: clamp(point.x, 0, this.width - SIZE),
        y: clamp(point.y, 0, this.height - SIZE),
      };
    },
    say(text, duration = 2.5) {
      this.bubble = text;
      this.bubbleUntil = this.time + duration;
    },
    rest(delay = 2) {
      this.mode = "idle";
      this.goal = null;
      this.until = this.time + delay;
    },
    cancelScene() {
      registry.interrupt();
    },
    completeRoutine() {
      registry.complete();
    },
    configure(settings) {
      Object.assign(this.settings, settings);
    },
    setVisible(visible) {
      this.visible = visible;
      registry.visibility(visible);
    },
    action(name, point) {
      registry.interrupt();
      this.tidying = name === "tidy";

      switch (name) {
        case "place_bag":
          this.objects.placeBag(point);
          break;

        case "cancel":
        case "tidy":
          this.rest();
          break;

        default:
          registry.start(name, point);
          break;
      }
    },
    startRecall(recall) {
      return registry.startRecall(recall);
    },
    resize(width, height) {
      this.width = width;
      this.height = height;
      Object.assign(this, this.safePoint(this));
      this.objects.resize(width, height);
    },
    step(delta) {
      if (!this.visible) {
        return;
      }

      const dt = Math.min(delta, 0.1);
      this.time += dt;
      registry.update(dt);
    },
    get scene() {
      return registry.scene;
    },
    get nextGuest() {
      return this.routine.nextGuest;
    },
    get rareTheatre() {
      return this.routine.rareTheatre;
    },
    get gagSchedule() {
      return this.routine.gagSchedule;
    },
  };

  // Keep shared fixture values live through accessors.
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(sim),
  )) {
    if (!Object.hasOwn(descriptor, "value")) {
      continue;
    }

    if (typeof descriptor.value === "function") {
      if (key !== "random") {
        sim[key] = descriptor.value.bind(sim);
      }

      continue;
    }

    let value = descriptor.value;
    Object.defineProperty(sim, key, {
      enumerable: true,
      configurable: true,
      get() {
        return value;
      },
      set(next) {
        value = next;
      },
    });
  }

  const body = new Body(sim.width, sim.height);
  body.place({ x: sim.x, y: sim.y });

  for (const field of ["x", "y", "facing", "motionTime", "width", "height"]) {
    Object.defineProperty(sim, field, {
      enumerable: true,
      configurable: true,
      get() {
        return body[field];
      },
      set(value) {
        switch (field) {
          case "x":
            body.place({ x: value, y: body.y });
            break;

          case "y":
            body.place({ x: body.x, y: value });
            break;

          case "facing":
            body.face(value);
            break;

          case "motionTime":
            body.resetMotion();
            body.advanceMotion(value);
            break;

          case "width":
            body.resize(value, body.height);
            break;

          case "height":
            body.resize(body.width, value);
            break;
        }
      },
    });
  }

  const capabilities = Object.create(
    null,
    Object.getOwnPropertyDescriptors(sim),
  );
  const objects = new Props(sim.width, sim.height);
  sim.objects = objects;

  for (const field of [
    "bag",
    "crumb",
    "cones",
    "rubbish",
    "splats",
    "looseChips",
    "serial",
  ]) {
    Object.defineProperty(sim, field, {
      enumerable: true,
      configurable: true,
      get() {
        return objects.snapshot()[field];
      },
    });
    Object.defineProperty(
      capabilities,
      field,
      Object.getOwnPropertyDescriptor(sim, field),
    );
  }

  capabilities.objects = objects;
  capabilities.body = body;
  capabilities.belongings = new Belongings(sim.width, sim.height);
  capabilities.meals = {
    consumed(point) {
      capabilities.belongings.rememberMeal(point);
    },
  };
  capabilities.random = () => sim.random();
  capabilities.clock = {
    get now() {
      return sim.time;
    },
  };
  capabilities.speech = {
    say(text, duration) {
      sim.say(text, duration);
    },
  };
  capabilities.movement = {
    moveTo(point) {
      Object.assign(sim, sim.safePoint(point));
    },
    face(direction) {
      sim.facing = direction;
    },
  };
  capabilities.events = {
    emit(sound) {
      sim.events.push(sound);
    },
  };
  const activity = new Activity(body, objects, {
    random() {
      return sim.random();
    },
    mood(name) {
      sim.mood = { name, until: sim.time + 35 };
    },
    emit(sound) {
      sim.events.push(sound);
    },
  });
  Object.defineProperties(sim, {
    mode: {
      get() {
        return activity.mode;
      },
      set(mode) {
        switch (mode) {
          case "idle":
            activity.rest(sim.time);
            break;

          case "walk":
            activity.walk(body.snapshot());
            break;

          default:
            activity.beginRoutine(mode);
            break;
        }
      },
    },
    until: {
      get() {
        return activity.until;
      },
      set(until) {
        activity.linger(until);
      },
    },
    goal: {
      get() {
        return activity.goal;
      },
      set(goal) {
        if (goal === null) {
          activity.stopTravel();
        } else {
          activity.walk(goal);
        }
      },
    },
  });
  capabilities.activity = activity;
  capabilities.lifecycle = {
    interrupt() {
      registry.interrupt();
    },
    complete() {
      registry.complete();
    },
    rest(delay) {
      sim.rest(delay);
    },
  };
  capabilities.commands = {
    action(name, point) {
      sim.action(name, point);
    },
  };
  capabilities.policy = {
    visible() {
      return sim.visible;
    },
    settings() {
      return sim.settings;
    },
    tidying() {
      return sim.tidying;
    },
    cleanup() {
      return sim.cleanup;
    },
  };
  capabilities.food = {
    clearRequest() {
      sim.snackRequestAt = null;
      sim.nibbleEligibleAt = null;
    },
    afterGuest() {
      sim.nextBagVisit = Math.max(sim.nextBagVisit, sim.time + 20);
    },
  };
  capabilities.speech.clear = () => {
    sim.bubble = "";
  };
  capabilities.speech.forget = () => {
    sim.bubbleUntil = 0;
  };
  sim.routine = new Routine(capabilities);
  const registry = new RoutineRegistry([sim.routine], new Map());
  return sim;
}
