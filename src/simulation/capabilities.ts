import type { Splat } from "./props.js";
import type { Body } from "./body.js";
import type { Props } from "./props.js";
import type { Activity } from "./activity.js";
import type { FoodPolicy } from "./food-policy.js";
import type { Belongings } from "./belongings.js";
import type { Mood } from "./behaviors/moods.js";
import type { RoutineCapabilities } from "./routine.js";
import type { Cleanup } from "./behaviors/cleanup.js";
import type { Motivation, MotivationState } from "./motivation.js";
import type { Pettiness } from "./pettiness.js";
import type { BoredomState } from "./boredom.js";

/** Operation groups for builtins; they cannot configure, resize or access native input. */
export interface BehaviorCapabilities extends RoutineCapabilities {
  readonly body: Pick<
    Body,
    | "x"
    | "y"
    | "facing"
    | "motionTime"
    | "width"
    | "height"
    | "snapshot"
    | "place"
    | "face"
    | "advanceMotion"
    | "resetMotion"
    | "safePoint"
    | "moveToward"
  >;
  readonly objects: Pick<
    Props,
    | "snapshot"
    | "nextId"
    | "placeBag"
    | "carryBag"
    | "consumeBag"
    | "placeCone"
    | "moveCone"
    | "clearCones"
    | "releaseBag"
    | "remove"
  >;
  readonly activity: Pick<
    Activity,
    | "mode"
    | "until"
    | "calmUntil"
    | "goal"
    | "flight"
    | "snapshot"
    | "beginRoutine"
    | "settleUntil"
    | "stopTravel"
  >;
  readonly food: Pick<
    FoodPolicy,
    | "snapshot"
    | "clearRequest"
    | "search"
    | "found"
    | "failed"
    | "deferEncounter"
    | "afterBagActivity"
    | "afterGuest"
  >;
  readonly belongings: Pick<
    Belongings,
    | "snapshot"
    | "remember"
    | "performed"
    | "refuseTrick"
    | "visited"
    | "collect"
    | "chooseGift"
    | "favouriteTreasure"
    | "placePerch"
    | "clearPerch"
    | "rewardTrick"
    | "rememberMeal"
    | "rememberScratchAfterPlay"
    | "forgetLearning"
    | "recallPoint"
    | "completeRecall"
  >;
  readonly moods: Pick<Mood, "set" | "settleOffence">;
  readonly motivation: Pick<Motivation, "enjoyed">;
  readonly pettiness: Pick<Pettiness, "settle">;
  readonly meals: { consumed(point: Point): void };
  readonly destinations: { randomPoint(): Point };
  readonly policy: {
    settings(): Readonly<Settings>;
    visible(): boolean;
    tidying(): boolean;
    cleanup(): ReturnType<Cleanup["snapshot"]>;
  };
  readonly commands: { action(name: string, point?: Point): void };
  readonly lifecycle: {
    complete(): void;
    interrupt(): void;
    rest(delay?: number): void;
  };
}

/** Runtime scopes contain only the operation groups declared by their owner. */
export function scopeCapabilities<Key extends keyof BehaviorCapabilities>(
  capabilities: Pick<BehaviorCapabilities, Key>,
  keys: readonly Key[],
): Pick<BehaviorCapabilities, Key> {
  const scope = {} as Pick<BehaviorCapabilities, Key>;

  for (const key of keys) {
    scope[key] = capabilities[key];
  }

  return Object.freeze(scope);
}
import type {
  Bag,
  Cone,
  Flight,
  Memory,
  MoodName,
  Point,
  Quiet,
  QuietName,
  SceneProp,
  Settings,
  Sound,
} from "./model.js";
import type { Pose } from "./poses.js";
import type { Scene } from "./scenes.js";
import type { ReadonlyValue } from "./presentation.js";
import type { PickupSnapshot } from "./behaviors/pickup.js";
import type { TouchSnapshot } from "./behaviors/touch.js";
import type { CleanupState } from "./behaviors/cleanup.js";

/** Detached observation used by stateless geometry and presentation calculations. */
export interface SimulationView extends Readonly<Point> {
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly facing: number;
  readonly mode: string;
  readonly until: number;
  readonly nextMischief: number;
  readonly settings: Readonly<Settings>;
  readonly splats: ReadonlyValue<Splat[]>;
  readonly events: readonly Sound[];
  readonly bubble: string;
  readonly bubbleUntil: number;
  readonly crumb: Readonly<Point> | null;
  readonly goal: Readonly<Point> | null;
  readonly serial: number;
  readonly motionTime: number;
  readonly flight: Readonly<Flight> | null;
  readonly quiet: Readonly<Quiet> | null;
  readonly scene: ReadonlyValue<Scene> | null;
  readonly visible: boolean;
  readonly nextNibble: number;
  readonly nextSnackRequest: number;
  readonly bag: Readonly<Bag> | null;
  readonly snackSearch: "found" | "failed" | null;
  readonly snackRequestAt: number | null;
  readonly nibbleEligibleAt: number | null;
  readonly nextBagVisit: number;
  readonly nextCrime: number;
  readonly memoryRevision: number;
  readonly motivation: Readonly<MotivationState>;
  readonly boredom: BoredomState;
  readonly memory: ReadonlyValue<Memory>;
  readonly nextPerchVisit: number;
  readonly calmUntil: number;
  readonly pendingPoop: Readonly<Point> | null;
  readonly cones: ReadonlyValue<Cone[]>;
  readonly looseChips: ReadonlyValue<(SceneProp & { id: number })[]>;
  readonly cleanup: ReadonlyValue<CleanupState>;
  readonly touch: TouchSnapshot;
  readonly pickup: PickupSnapshot;
  readonly rubbish: ReadonlyValue<(Point & { id: number; born: number })[]>;
  readonly gagSchedule?: {
    readonly at: number;
    readonly level: number;
    readonly last?: string;
  };
  readonly mood: { readonly name: MoodName; readonly until: number } | null;
  readonly lastMoodLine?: string;
  readonly nextQuiet?: number;
  readonly lastQuiet?: QuietName;
  readonly nextGuest?: number;
  readonly rareTheatre?: {
    readonly nextAllowed: number;
    readonly nextCheck: number;
    readonly recent: readonly string[];
  };
  readonly carriedItem: import("./items.js").Item | null;
  readonly tidying: boolean;
  readonly wantsPointer: boolean;
  readonly moving: boolean;
  readonly pose: Pose;
  readonly frame: number;
}
