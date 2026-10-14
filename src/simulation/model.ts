import type { Collectible } from "./items.js";

export interface Point {
  x: number;
  y: number;
}
export interface PointerSample extends Point {
  inside?: boolean;
}
/** Target geometry and a position marker; vision also supplies one display glyph. */
export interface CaretSample extends Point {
  height: number;
  context: string;
  position: string;
  source?: "caret" | "vision";
  glyph?: string | null;
}
export type Direction = -1 | 1;
export type Hat = "none" | "captain" | "cone";
export interface Settings {
  paused: boolean;
  vision?: boolean;
  sound: boolean;
  mischief: number;
  hat: Hat;
}
export type MoodName =
  "sleepy" | "curious" | "smug" | "snack-minded" | "offended";
export interface Cone extends Point {
  id: number;
  born: number;
}
export type QuietName = "nap" | "preen" | "tilt" | "stretch";
export type Sound = "squawk" | "plop" | "munch" | "pop" | "splash";
export interface Memory {
  version: 1;
  perch: Point | null;
  collection: Partial<Record<Collectible, number>>;
  greetings: {
    seen: boolean;
    lastAt: number;
    lastLine: string;
    lastDiscovery: Collectible | null;
  };
}
export interface Bag extends Point {
  id: number;
  servings: number;
  attached: boolean;
}
export interface Flight {
  groundY: number;
  takeoffY: number;
  landingY: number;
  startedY: number;
}
export interface Quiet {
  name: QuietName;
  started: number;
  sleep: number;
  startled: boolean;
  woke: boolean;
}
export interface Prop extends Point {
  asset: string;
  text?: string;
  width: number;
  height: number;
  opacity?: number;
  rotation?: number;
  flip?: boolean;
}
export interface SceneProp extends Prop {
  id: number | string;
}
