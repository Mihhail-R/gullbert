import type { Collectible } from "./items.js";
import type { Preferences } from "./preferences.js";
import type { LongTermMemory } from "./long-term-memory.js";

export interface Point {
  x: number;
  y: number;
}
export interface PointerSample extends Point {
  inside?: boolean;
}
export interface WorkSample {
  window: Point & { id: number; width: number; height: number };
  keyDownCount: number;
  idleSeconds: number;
}
export type Direction = -1 | 1;
export type Hat =
  "none" | "captain" | "cone" | "beanie" | "paper-crown" | "fried-egg";
export interface Settings {
  paused: boolean;
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
export type Trick = "come" | "spin" | "dead";
export interface LearnedHabits {
  tricks: Record<Trick, number>;
  snackSpot: (Point & { meals: number }) | null;
  snackCandidate: (Point & { meals: number }) | null;
  scratchesAfterPlay: number;
}
export interface Memory {
  version: 3;
  longTerm: LongTermMemory;
  episodes: MemoryEpisode[];
  performances: Record<Trick, number>;
  unpaidTricks: number;
  trickCooldownUntilMs: number | null;
  trickRefusals: number;
  visits: Record<"pigeon" | "gull", number>;
  learned: LearnedHabits;
  perch: Point | null;
  nest: (Point & { items: Collectible[] }) | null;
  collection: Partial<Record<Collectible, number>>;
  preferences: Preferences;
  greetings: {
    seen: boolean;
    lastAt: number;
    lastLine: string;
    lastDiscovery: Collectible | null;
  };
}
export interface MemoryEpisode {
  id: number;
  at: number;
  kind:
    | "trick"
    | "reward"
    | "meal"
    | "play"
    | "scratch"
    | "gift"
    | "perch"
    | "visit"
    | "activity"
    | "recall";
  detail: string;
  location: Point & { width: number; height: number };
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
