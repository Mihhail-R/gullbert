import type {
  Routine,
  RoutineCapabilities,
  RoutineFactory,
} from "./routine.js";
import type { Point, SceneProp, Sound } from "./model.js";

/** Lifecycle permission is local to one routine, including its owned props. */
export class ScopedRoutine implements Routine {
  #routine: Routine;
  #capabilities: RoutineCapabilities;
  #active = false;
  #visible = true;
  #props = new Set<number>();
  #isVisible: () => boolean;
  constructor(
    factory: RoutineFactory,
    capabilities: RoutineCapabilities,
    isVisible: () => boolean,
  ) {
    this.#isVisible = isVisible;
    this.#capabilities = capabilities;
    const owner = this;
    const scope: RoutineCapabilities = Object.freeze({
      clock: capabilities.clock,
      random() {
        if (owner.#active && owner.#visible) {
          return capabilities.random();
        }
        return 0;
      },
      movement: Object.freeze({
        get position() {
          return capabilities.movement.position;
        },
        get bounds() {
          return capabilities.movement.bounds;
        },
        moveTo(point: Point) {
          if (owner.#active && owner.#visible) {
            capabilities.movement.moveTo(point);
          }
        },
        face(direction: -1 | 1) {
          if (owner.#active && owner.#visible) {
            capabilities.movement.face(direction);
          }
        },
      }),
      speech: Object.freeze({
        say(text: string, duration?: number) {
          if (owner.#active && owner.#visible) {
            capabilities.speech.say(text, duration);
          }
        },
        clear() {
          if (owner.#active && owner.#visible) {
            capabilities.speech.clear();
          }
        },
        forget() {
          if (owner.#active && owner.#visible) {
            capabilities.speech.forget();
          }
        },
      }),
      props: Object.freeze({
        add(prop: Omit<SceneProp, "id">) {
          if (!owner.#active || !owner.#visible) {
            return 0;
          }
          const id = capabilities.props.add(prop);
          owner.#props.add(id);
          return id;
        },
        remove(id: number) {
          if (owner.#active && owner.#visible && owner.#props.delete(id)) {
            capabilities.props.remove(id);
          }
        },
      }),
      events: Object.freeze({
        emit(sound: Sound) {
          if (owner.#active && owner.#visible) {
            capabilities.events.emit(sound);
          }
        },
      }),
    });
    this.#routine = factory(scope);
  }
  start(name: string, point?: Point): boolean {
    if (["feed", "cancel", "summon", "squawk", "poop"].includes(name)) {
      return false;
    }
    this.#visible = this.#isVisible();
    this.#active = true;
    try {
      if (this.#routine.start(name, point)) {
        return true;
      }
    } catch (error) {
      this.#clear();
      throw error;
    }
    this.#clear();
    return false;
  }
  update(delta: number) {
    return this.#routine.update(delta);
  }
  complete(): void {
    try {
      this.#routine.complete();
    } finally {
      this.#clear();
    }
  }
  interrupt(): void {
    try {
      this.#routine.interrupt();
    } finally {
      this.#clear();
    }
  }
  visibility(visible: boolean): void {
    this.#visible = visible;
    this.#routine.visibility(visible);
  }
  presentation() {
    const presentation = this.#routine.presentation();
    if (!this.#visible) {
      return { ...presentation, props: [], looseProps: [], guestSpeech: null };
    }
    return presentation;
  }
  #clear(): void {
    this.#active = false;
    for (const id of this.#props) {
      this.#capabilities.props.remove(id);
    }
    this.#props.clear();
  }
}
