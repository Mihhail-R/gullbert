import type { ReadonlyValue } from "./presentation.js";
import type { Routine, SceneOwner, RecallOwner } from "./routine.js";
import type { Point } from "./model.js";
import type { Scene } from "./scenes.js";
import type { RecallReservation } from "./long-term-memory.js";

function ownsScene(routine: Routine): routine is SceneOwner {
  return "scene" in routine && "install" in routine;
}

function recallsMemory(routine: Routine): routine is RecallOwner {
  return "startRecall" in routine;
}

/** Chooses exactly one activity and separates completion from interruption. */
export class RoutineRegistry {
  #routines: readonly Routine[];
  #owners: ReadonlyMap<Scene["kind"], SceneOwner>;
  #active: Routine | null = null;
  constructor(
    routines: readonly Routine[],
    owners: ReadonlyMap<Scene["kind"], SceneOwner>,
  ) {
    this.#routines = routines;
    this.#owners = owners;
  }
  get scene(): ReadonlyValue<Scene> | null {
    if (this.#active && ownsScene(this.#active)) {
      return this.#active.scene;
    }

    return null;
  }
  get identity(): object | null {
    if (this.#active && ownsScene(this.#active)) {
      return this.#active.identity;
    }

    return this.#active;
  }
  get active(): boolean {
    return this.#active !== null;
  }
  start(name: string, point?: Point): boolean {
    for (const routine of this.#routines) {
      if (routine.start(name, point)) {
        this.#activate(routine);
        return true;
      }
    }

    return false;
  }
  startRecall(recall: RecallReservation): boolean {
    for (const routine of this.#routines) {
      if (recallsMemory(routine) && routine.startRecall(recall)) {
        this.#activate(routine);
        return true;
      }
    }

    return false;
  }

  #activate(routine: Routine): void {
    if (!ownsScene(routine) || routine.scene) {
      this.#active = routine;
    }
  }

  update(delta: number): boolean {
    const owner = this.#active;

    if (!owner) {
      return false;
    }

    const result = owner.update(delta);

    if (this.#active === owner && result === "complete") {
      this.complete();
    }

    return true;
  }
  install(scene: ReadonlyValue<Scene>): void {
    const owner = this.#owners.get(scene.kind);

    if (!owner) {
      throw new Error(`No routine owns ${scene.kind}`);
    }

    if (this.#active && this.#active !== owner) {
      if (ownsScene(this.#active)) {
        this.#active.clear();
      } else {
        this.#active.interrupt();
      }
    }

    owner.install(scene);
    this.#active = owner;
  }
  presentation() {
    return this.#active?.presentation() ?? {};
  }
  visibility(visible: boolean): void {
    this.#active?.visibility(visible);
  }
  complete(): void {
    const active = this.#active;
    this.#active = null;
    active?.complete();
  }
  interrupt(): void {
    const active = this.#active;
    this.#active = null;
    active?.interrupt();
  }
}
