import type { ReadonlyValue } from "./presentation.js";
import type { Point, Direction, Trick } from "./model.js";
import type { Item } from "./items.js";

// Each routine owns its state. Narrow on kind before reading routine-specific fields.
interface TimedScene {
  until: number;
}
export interface CursorScene extends TimedScene {
  kind: "cursor";
  phase: "stare" | "stalk" | "peck" | "chew" | "recoil";
  takeover: boolean;
  started: number;
  deadline: number;
  pointer: Point | null;
  caughtAt?: number;
  cursorId?: number;
  retaliation?: boolean;
  retaliationSource?: RelocationScene;
  trail?: number;
  nextSplat?: number;
}
export interface SnackScene extends TimedScene {
  kind: "snack";
  phase: "search" | "approach" | "eat" | "disappointed";
  started: number;
  bagId?: number;
  target: Point;
}
export interface CrimeScene extends TimedScene {
  kind: "theft" | "caper";
  phase:
    | "approach"
    | "grab"
    | "inspect"
    | "drag"
    | "suspicious"
    | "release"
    | "innocent"
    | "trapped"
    | "panic"
    | "shake"
    | "offended";
  started: number;
  deadline: number;
  phaseStarted: number;
  bagId: number;
  pausedOnce: boolean;
  resume: "approach" | "drag";
  target: Point;
  dragged: number;
  direction: Direction;
}
export interface GiftScene extends TimedScene {
  kind: "gift";
  phase: "takeoff" | "depart" | "away" | "return" | "land" | "reveal";
  item: Item;
  carrying: boolean;
  origin: Point;
  side: Direction;
  deadline: number;
  speed: number;
}
export interface PerchScene extends TimedScene {
  kind: "perch";
  phase: "approach" | "settle" | "loiter";
}
export interface CapScene extends TimedScene {
  kind: "cap";
  phase: "drop" | "ready" | "chase" | "peck" | "return" | "collect" | "victory";
  started: number;
  deadline: number;
  phaseStarted: number;
  cap: Point;
  target: Point;
  pointer: Point | null;
  rounds: number;
  carrying: boolean;
}
export interface LearningScene extends TimedScene {
  kind: "trick" | "habit";
  trick: Trick;
  phase: "consider" | "perform" | "reward" | "check" | "refuse";
  phaseStarted: number;
  target: Point;
  origin: Point;
  facing: Direction;
  practiced: boolean;
  unsolicited: boolean;
  reluctant: boolean;
}
interface TheatreClock extends TimedScene {
  started: number;
  deadline: number;
  phaseStarted: number;
}
export interface Bubble extends Point {
  id: number;
  vx: number;
  vy: number;
  expires: number;
}
export interface BubblesScene extends TheatreClock {
  kind: "bubbles";
  phase: "chase" | "peck" | "startle" | "proud";
  bubbles: Bubble[];
  pops: (Bubble & { until: number })[];
  targetId?: number;
}
export interface BathScene extends TheatreClock {
  kind: "bath";
  phase: "approach" | "splash" | "shake" | "exit";
  target: Point;
  bath: Point;
  exit: Point;
}
export interface TossScene extends TheatreClock {
  kind: "toss";
  phase:
    | "takeoff"
    | "intercept"
    | "land"
    | "miss-flail"
    | "eat"
    | "miss"
    | "retrieve";
  groundY: number;
  chip: (Point & { id: number }) | null;
  arc: { start: Point; end: Point; duration: number; height: number };
  reaction: number;
  caught: boolean;
  landFrom: number;
  recoilFrom: Point;
  contact?: { beak: Point; chip: Point; distance: number };
}
export interface BaguetteScene extends TheatreClock {
  kind: "baguette";
  phase: "entrance" | "carry" | "pause" | "exit" | "departure" | "gone";
  origin: Point;
  direction: Direction;
  target: Point;
}
export interface GuestScene extends TheatreClock {
  kind: "guest";
  species: "pigeon" | "gull";
  phase:
    | "arrival"
    | "departure"
    | "inspect"
    | "stare"
    | "faceoff"
    | "judgment"
    | "posture"
    | "squawk-main"
    | "squawk-guest"
    | "snatch"
    | "reaction";
  anchor: Point;
  mainTarget: Point;
  mainOrigin: Point;
  guestTarget: Point;
  guest: Point & { facing: Direction };
  entryX: number;
  bagId: number | null;
  hasSnack: boolean;
  chipTaken: boolean;
  guestText: string;
  guestStarts: number;
  guestUntil: number;
  departureOrigin: Point;
}
export interface DepartureScene extends TheatreClock {
  kind: "pretend_leave";
  phase: "approach" | "depart" | "away" | "peek" | "reenter" | "return";
  side: Direction;
  origin: Point;
}
export interface EggScene extends TheatreClock {
  kind: "cursor_egg";
  phase: "approach" | "settle" | "inspect";
  pointer: Point | null;
  stablePoint: Point | null;
  stableSince: number;
  nest: Point | null;
}
export interface MunicipalScene extends TheatreClock {
  kind: "municipal_gull";
  phase: "place" | "inspect" | "retrieve" | "move" | "leave";
  patch: Point;
  placements: Point[];
  placed: number;
  movedId: number | null;
  target: Point;
}
export interface ApologyScene extends TheatreClock {
  kind: "apology";
  phase: "carry" | "offer" | "eat";
  target: Point;
}
export interface PostcardScene extends TheatreClock {
  kind: "postcards";
  phase: "approach" | "reach" | "pull" | "carry" | "show" | "tuck";
  side: Direction;
  target: Point;
  photo: string;
  caption: string;
}
export type GagScene =
  DepartureScene | EggScene | MunicipalScene | ApologyScene | PostcardScene;
export const gagKinds = [
  "pretend_leave",
  "cursor_egg",
  "municipal_gull",
  "apology",
  "postcards",
] as const satisfies readonly GagScene["kind"][];

export function isGagKind(kind: string): kind is GagScene["kind"] {
  return gagKinds.some((gagKind) => gagKind === kind);
}

export function isGag(
  scene: ReadonlyValue<Scene> | null,
): scene is ReadonlyValue<GagScene> {
  return scene !== null && isGagKind(scene.kind);
}
export type TheatreScene = BubblesScene | BathScene | TossScene | BaguetteScene;
export interface RelocationScene extends TimedScene {
  kind: "relocation";
  phase: "settle" | "sulk" | "collect" | "return";
  deadline: number;
  cursorId?: number;
  revenge: "none" | "chase" | "trail" | "big" | "trash";
  origin: Point;
  target: Point;
}
export type Scene =
  | RelocationScene
  | CursorScene
  | SnackScene
  | CrimeScene
  | GiftScene
  | PerchScene
  | CapScene
  | LearningScene
  | TheatreScene
  | GuestScene
  | GagScene;
export function isTheatre(
  scene: ReadonlyValue<Scene> | null,
): scene is ReadonlyValue<TheatreScene> {
  switch (scene?.kind) {
    case "bubbles":
    case "bath":
    case "toss":
    case "baguette":
      return true;

    default:
      return false;
  }
}
