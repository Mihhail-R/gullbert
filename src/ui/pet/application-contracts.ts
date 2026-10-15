import type {
  Invoke,
  NativeBridge,
  PreviewMessage,
} from "../../platform/bridge.js";
import type { Gullbert } from "../../simulation/engine.js";
import type {
  CaretSample,
  Memory,
  Point,
  PointerSample,
  Sound,
} from "../../simulation/model.js";
import type { PetPresentation } from "../../simulation/presentation.js";

export interface ApplicationClock {
  now(): number;
  wallNow(): number;
  schedule: typeof setTimeout;
  cancel: typeof clearTimeout;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
}

export interface ApplicationPointerEvent extends Point {
  pointerId: number;
  button: number;
  buttons: number;
  onBanner: boolean;
  preventDefault(): void;
}

export interface ApplicationEvents {
  pointerdown: ApplicationPointerEvent;
  pointerup: ApplicationPointerEvent;
  pointercancel: ApplicationPointerEvent;
  lostpointercapture: ApplicationPointerEvent;
  pointermove: ApplicationPointerEvent;
  pointerleave: undefined;
  keydown: string;
  blur: undefined;
  resize: undefined;
  message: PreviewMessage;
  pagehide: undefined;
  cancel: undefined;
}

export interface ApplicationBrowser {
  caret?(): CaretSample | null;
  size(): { width: number; height: number };
  listen<K extends keyof ApplicationEvents>(
    name: K,
    callback: (event: ApplicationEvents[K]) => void,
  ): () => void;
  capture(pointerId: number): void;
  releaseCapture(pointerId: number): void;
  publish(message: PreviewMessage): void;
}

export interface ApplicationViewState {
  visible: boolean;
  targeting: boolean;
  purpose: string;
  dragging: boolean;
  grabbable: boolean;
  interactiveHover: boolean;
  caughtPointer: Point | null;
}

export interface ApplicationView {
  render(presentation: PetPresentation): void;
  update(state: ApplicationViewState): void;
  dispose(): void;
}

export interface ApplicationStorage {
  load(): unknown | Promise<unknown>;
  save(memory: Memory): void | Promise<void>;
}

export interface ApplicationAudio {
  play(sound: Sound): void;
  suspend(): void;
  dispose(): void;
}

export type ApplicationSimulation = Pick<
  Gullbert,
  | "present"
  | "status"
  | "exportMemory"
  | "restoreMemory"
  | "drainSounds"
  | "interactionRects"
  | "pickupRect"
  | "canPickup"
  | "directCleanupAt"
  | "flickCap"
  | "beginPickup"
  | "movePickup"
  | "finishPickup"
  | "currentReaction"
  | "armReaction"
  | "reactionMovesCursor"
  | "updatePickupClock"
  | "cursorEncounter"
  | "releaseCursor"
  | "authorizeCursor"
  | "action"
  | "configure"
  | "resize"
  | "pointer"
  | "caret"
  | "tidyPointer"
  | "greet"
  | "setVisible"
  | "step"
>;

export interface ApplicationDependencies {
  simulation: ApplicationSimulation;
  browser: ApplicationBrowser;
  view: ApplicationView;
  native: { invoke: Invoke; listen: NativeBridge["event"]["listen"] } | null;
  storage: ApplicationStorage;
  clock: ApplicationClock;
  audio: ApplicationAudio;
  reportError(error: unknown): void;
}

export type PointerListener = (point: PointerSample) => void;
