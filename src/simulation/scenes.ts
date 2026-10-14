import type { ReadonlyValue } from "./presentation.js";
import type { Point, Direction } from "./model.js";
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
export function isGag(
  scene: ReadonlyValue<Scene> | null,
): scene is ReadonlyValue<GagScene> {
  return (
    scene !== null &&
    [
      "pretend_leave",
      "cursor_egg",
      "municipal_gull",
      "apology",
      "postcards",
    ].includes(scene.kind)
  );
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
  | TypingScene
  | RelocationScene
  | CursorScene
  | SnackScene
  | CrimeScene
  | GiftScene
  | PerchScene
  | TheatreScene
  | GuestScene
  | GagScene;
export interface TypingScene extends TimedScene {
  kind: "typing";
  visual?: boolean;
  source: string;
  phase: "approach" | "watch" | "pounce" | "carry" | "deposit" | "innocent";
  resume: "approach" | "watch" | "pounce" | "carry" | "deposit";
  deadline: number;
  target: Point;
  glyph: string;
  carrying: boolean;
  steal: boolean;
  buildNest: boolean;
}
export function isTheatre(
  scene: ReadonlyValue<Scene> | null,
): scene is ReadonlyValue<TheatreScene> {
  return (
    scene !== null &&
    (scene.kind === "bubbles" ||
      scene.kind === "bath" ||
      scene.kind === "toss" ||
      scene.kind === "baguette")
  );
}
