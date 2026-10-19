import { observe } from "./observation.js";
import type { ReadonlyValue } from "./presentation.js";

/** Internal scene storage; routines retain their own completion and interruption rules. */
export class SceneState<Scene> {
  current: Scene | null = null;
  #identity: object = Object.freeze({});

  get identity(): object {
    return this.#identity;
  }

  snapshot(): ReadonlyValue<Scene> | null {
    return observe(this.current);
  }

  install(scene: ReadonlyValue<Scene>): void {
    this.current = structuredClone(scene) as Scene;
    this.#identity = Object.freeze({});
  }

  activate(): void {
    if (this.current) {
      this.#identity = Object.freeze({});
    }
  }

  clear(): void {
    this.current = null;
  }
}
