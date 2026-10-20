import type { ReadonlyValue } from "./presentation.js";
import type { Point, SceneProp, Sound } from "./model.js";
import type { Pose } from "./poses.js";
import type { Scene } from "./scenes.js";
import type { RecallReservation } from "./long-term-memory.js";

/** Shared operation groups used by built-in routines. */
export interface RoutineCapabilities {
  readonly clock: { readonly now: number };
  readonly random: () => number;
  readonly movement: {
    moveTo(point: Point): void;
    face(direction: -1 | 1): void;
  };
  readonly speech: {
    say(text: string, duration?: number): void;
    clear(): void;
    forget(): void;
  };
  readonly events: { emit(sound: Sound): void };
}
export interface Routine {
  start(name: string, point?: Point): boolean;
  update(delta: number): "running" | "complete";
  complete(): void;
  interrupt(): void;
  visibility(visible: boolean): void;
  presentation(): RoutinePresentation;
}

/** Registry bookkeeping is separate from the shared routine lifecycle. */
export interface SceneOwner extends Routine {
  readonly scene: ReadonlyValue<Scene> | null;
  readonly identity: object;
  install(scene: ReadonlyValue<Scene>): void;
  clear(): void;
}

/** A scene owner that can perform a reserved memory callback. */
export interface RecallOwner extends SceneOwner {
  startRecall(recall: RecallReservation): boolean;
}

export interface RoutinePresentation {
  readonly rotation?: number;
  readonly pose?: Pose;
  readonly props?: readonly SceneProp[];
  readonly looseProps?: readonly SceneProp[];
  readonly offset?: { readonly x: number; readonly opacity: number };
  readonly guestSpeech?: {
    readonly text: string;
    readonly x: number;
    readonly y: number;
  } | null;
}
