import { dialogue } from "../dialogue.js";
import type { Bag, Point, Settings, Flight } from "../model.js";
import type { Pose } from "../poses.js";
import type { Mood } from "./moods.js";
import type { Body } from "../body.js";
import type { Props, PropSnapshot } from "../props.js";
import type { Scene } from "../scenes.js";
import type { ReadonlyValue } from "../presentation.js";

type Geometry = ReadonlyValue<Omit<PropSnapshot, "serial">>;
interface DirectGeometry extends Geometry {
  readonly visible: boolean;
  readonly scene: ReadonlyValue<Scene> | null;
  readonly mode: string;
}
export interface CleanupObservation extends DirectGeometry {
  readonly time: number;
  readonly flight: Readonly<Flight> | null;
  readonly settings: Readonly<Settings>;
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  readonly motionTime: number;
}
export interface CleanupHost {
  observe(): CleanupObservation;
  readonly body: Pick<Body, "face" | "moveToward">;
  readonly objects: Pick<Props, "remove" | "restoreBag">;
  readonly moods: Pick<Mood, "set" | "settleOffence">;
  readonly speech: { say(text: string, duration?: number): void };
  random(): number;
  rest(delay?: number): void;
  action(name: string): void;
  splat(point: Point): void;
}

// Selection extends beyond painted bounds; highlights use the unpadded shape.
export const CLEANUP_HIT_PADDING = 8;
export const CLEANUP_GEOMETRY = {
  bag: { width: 48, height: 48, offsetX: 0, offsetY: 0 },
  chip: { width: 18, height: 12, offsetX: 0, offsetY: 0 },
  splat: { width: 48, height: 30, offsetX: -24, offsetY: -15 },
  rubbish: { width: 48, height: 48, offsetX: 0, offsetY: 0 },
  cone: { width: 28, height: 36, offsetX: -14, offsetY: -36 },
} as const;
export type CleanupKind = keyof typeof CLEANUP_GEOMETRY;
export interface CleanupTarget extends Point {
  kind: CleanupKind;
  id?: number;
  width: number;
  height: number;
}
interface Session {
  direct?: boolean;
  until: number;
  removals: number;
  recent: number[];
  bag: Bag | null;
}
export interface CleanupState {
  session: Session | null;
  pointer: Point | null;
  level: number;
  reactionUntil: number;
  sulkUntil: number;
  away: number;
  apology: boolean;
  retaliation: { at: number; kind: "bag" | "splat"; bag: Bag | null } | null;
  retaliationAllowedAt: number;
  suppressUntil: number;
  lines: Partial<Record<CleanupKind | "escalation" | "sulk", number>>;
}
export function createCleanupState(): CleanupState {
  return {
    session: null,
    pointer: null,
    level: 0,
    reactionUntil: 0,
    sulkUntil: 0,
    away: 1,
    apology: false,
    retaliation: null,
    retaliationAllowedAt: 0,
    suppressUntil: 0,
    lines: {},
  };
}
const lines = dialogue.gullbert.cleanup.reactions;
export function cleanupObjects(sim: Geometry): CleanupTarget[] {
  const objects: CleanupTarget[] = [];
  function add(kind: CleanupKind, point: Point, id?: number) {
    const geometry = CLEANUP_GEOMETRY[kind];
    objects.push({
      kind,
      id,
      x: point.x + geometry.offsetX,
      y: point.y + geometry.offsetY,
      width: geometry.width,
      height: geometry.height,
    });
  }

  if (sim.bag) {
    add("bag", sim.bag, sim.bag.id);
  }

  for (const rubbish of sim.rubbish) {
    add("rubbish", rubbish, rubbish.id);
  }

  if (sim.crumb) {
    add("chip", sim.crumb);
  }

  for (const chip of sim.looseChips) {
    objects.push({
      kind: "chip",
      id: chip.id,
      x: chip.x,
      y: chip.y,
      width: chip.width,
      height: chip.height,
    });
  }

  for (const splat of sim.splats) {
    const scale = splat.scale ?? 1;
    objects.push({
      kind: "splat",
      id: splat.id,
      x: splat.x - 24 * scale,
      y: splat.y - 15 * scale,
      width: 48 * scale,
      height: 30 * scale,
    });
  }

  for (const cone of sim.cones) {
    add("cone", cone, cone.id);
  }

  return objects;
}
export function cleanupTarget(
  sim: Geometry,
  point: Point,
): CleanupTarget | null {
  return findTarget(cleanupObjects(sim), point);
}

function findTarget(
  objects: CleanupTarget[],
  point: Point,
): CleanupTarget | null {
  return (
    objects.reverse()
      .find((object) => {
        const withinWidth =
          point.x >= object.x - CLEANUP_HIT_PADDING &&
        point.x <= object.x + object.width + CLEANUP_HIT_PADDING;
        const withinHeight =
          point.y >= object.y - CLEANUP_HIT_PADDING &&
        point.y <= object.y + object.height + CLEANUP_HIT_PADDING;
        return withinWidth && withinHeight;
      }) ?? null
  );
}
// Everyday clicks only select loose, visible mess. Scene-owned food and
// carried bags stay with their routine until it is over.
export function directCleanupObjects(sim: DirectGeometry): CleanupTarget[] {
  if (!sim.visible || (sim.scene?.kind === "cursor" && sim.scene.takeover)) {
    return [];
  }

  return cleanupObjects(sim)
    .filter((object) => {
      switch (object.kind) {
        case "bag":
          if (sim.bag?.attached) {
            return false;
          }

          return (
            !sim.scene ||
          !["theft", "caper", "snack", "guest"].includes(sim.scene.kind)
          );

        case "chip":
          return object.id != null || !["fetch", "eat"].includes(sim.mode);

        case "cone":
          return sim.scene?.kind !== "municipal_gull";

        default:
          return true;
      }
    });
}
export function directCleanupTarget(sim: DirectGeometry, point: Point) {
  return findTarget(directCleanupObjects(sim), point);
}
/** Owns each tidy session and the reactions that may outlive its last click. */
export class Cleanup {
  readonly #host: CleanupHost;
  #state = createCleanupState();

  constructor(host: CleanupHost) {
    this.#host = host;
  }

  snapshot(): ReadonlyValue<CleanupState> {
    return structuredClone(this.#state);
  }
  get tidying(): boolean {
    return this.#state.session !== null && !this.#state.session.direct;
  }

  begin(): void {
    this.cancel();
    this.#state.session = {
      until: this.#host.observe().time + 30,
      removals: 0,
      recent: [],
      bag: null,
    };
  }
  point(point: Point | null): void {
    if (point) {
      this.#state.pointer = { ...point };
    } else {
      this.#state.pointer = null;
    }
  }
  target(point: Point): CleanupTarget | null {
    return cleanupTarget(this.#host.observe(), point);
  }
  directTarget(point: Point): CleanupTarget | null {
    return directCleanupTarget(this.#host.observe(), point);
  }
  pose(): Pose | null {
    const view = this.#host.observe();
    return cleanupPose({
      cleanup: this.#state,
      tidying: this.tidying,
      scene: view.scene,
      flight: view.flight,
      mode: view.mode,
      time: view.time,
      motionTime: view.motionTime,
    });
  }
  #remark(category: keyof typeof lines): void {
    const next =
      ((this.#state.lines[category] ?? -1) + 1) % lines[category].length;
    this.#state.lines[category] = next;
    this.#host.speech.say(lines[category][next], 3);
  }
  directPick(point: Point) {
    const sim = this.#host.observe();
    const target = directCleanupTarget(sim, point);

    if (!target) {
      return false;
    }

    if (!this.#state.session) {
      this.cancel();
      this.#state.session = {
        direct: true,
        until: sim.time + 4,
        removals: 0,
        recent: [],
        bag: null,
      };
    }

    if (this.#state.session.direct) {
      this.#state.session.until = sim.time + 4;
    }

    this.#pickTarget(point, target);
    return true;
  }
  cancel() {
    const state = this.#state;
    state.session = null;
    state.pointer = null;
    state.retaliation = null;
    state.apology = false;
    state.sulkUntil = 0;
    state.reactionUntil = 0;
    state.level = 0;
  }
  pick(point: Point): void {
    if (!this.#state.session) {
      return;
    }

    this.#state.pointer = { ...point };
    const target = this.target(point);

    if (target) {
      this.#pickTarget(point, target);
    }
  }
  #pickTarget(point: Point, target: CleanupTarget): void {
    const sim = this.#host.observe();
    const state = this.#state;
    const session = state.session;

    if (!session) {
      return;
    }

    state.pointer = { ...point };

    if (target.kind === "bag") {
      if (sim.bag?.servings === 0) {
        session.bag = { ...sim.bag, attached: false };
      } else {
        session.bag = null;
      }
    }

    this.#host.objects.remove(target.kind, target.id);
    session.removals += 1;
    session.recent = session.recent.filter((time) => {
      return sim.time - time <= 20;
    });
    session.recent.push(sim.time);
    state.level = Math.min(3, session.recent.length);
    state.reactionUntil = sim.time + 3;
    this.#host.moods.set("offended", sim.time, { speak: false });
    this.#remark(target.kind);
  }
  finish() {
    const sim = this.#host.observe();
    const state = this.#state;
    const session = state.session;

    if (!session) {
      return;
    }

    state.session = null;
    state.pointer = null;

    if (!session.direct) {
      this.#host.rest();
    }

    if (!session.removals) {
      return;
    }

    state.sulkUntil = sim.time + 10;
    state.away = sim.facing * -1;

    if (!session.direct || (!sim.scene && !sim.flight)) {
      this.#host.body.face(state.away);
    }

    this.#remark("sulk");
    this.#scheduleRetaliation(session, sim);
    state.apology =
      !state.retaliation && !sim.settings.paused && this.#host.random() < 0.25;
  }
  #scheduleRetaliation(session: Session, sim: CleanupObservation): void {
    const state = this.#state;
    const level = sim.settings.mischief;

    if (session.removals < 2 || sim.settings.paused || level <= 0) {
      return;
    }

    if (sim.time < state.retaliationAllowedAt) {
      return;
    }

    if (!session.bag && level < 2) {
      return;
    }

    let reactionChance = 0.35;

    if (level >= 2) {
      reactionChance = 0.6;
    }

    if (!(this.#host.random() < reactionChance)) {
      return;
    }

    let kind: "bag" | "splat";

    if (level === 1 || (session.bag && this.#host.random() < 0.5)) {
      kind = "bag";
    } else {
      kind = "splat";
    }

    state.retaliation = { at: sim.time + 5, kind, bag: session.bag };
    state.retaliationAllowedAt = sim.time + 90;
  }
  bulk() {
    const sim = this.#host.observe();
    this.cancel();
    this.#state.suppressUntil = sim.time + 30;
    this.#state.reactionUntil = sim.time + 2;
    this.#state.level = 2;
    this.#host.moods.set("offended", sim.time, { speak: false });
    this.#host.speech.say(dialogue.gullbert.cleanup.youveRuinedTheAtmosphere);
  }
  configure() {
    const sim = this.#host.observe();
    const state = this.#state;

    if (sim.settings.paused || sim.settings.mischief === 0) {
      state.retaliation = null;
    } else if (
      sim.settings.mischief === 1 &&
      state.retaliation?.kind === "splat"
    ) {
      state.retaliation = null;
    }

    if (sim.settings.paused) {
      state.apology = false;
    }
  }
  settle() {
    this.cancel();
    this.#host.moods.settleOffence();
  }
  update(dt: number): boolean {
    const sim = this.#host.observe();
    const state = this.#state;

    if (state.session && sim.time >= state.session.until) {
      this.finish();
    }

    const retaliation = state.retaliation;

    if (retaliation && sim.time >= retaliation.at) {
      state.retaliation = null;

      if (!sim.scene && sim.mode === "idle" && !sim.settings.paused) {
        if (retaliation.kind === "bag" && !sim.bag && retaliation.bag) {
          this.#host.objects.restoreBag(retaliation.bag);
          this.#host.speech.say(dialogue.gullbert.cleanup.iPutItBack);
        } else if (retaliation.kind === "splat" && sim.settings.mischief >= 2) {
          this.#host.splat({ x: sim.x + 48, y: sim.y + 86 });
          this.#host.rest();
          this.#host.moods.set("offended", sim.time, { speak: false });
          this.#host.speech.say(
            dialogue.gullbert.cleanup.aReplacementAtmosphere,
          );
        }
      }
    }

    // Direct cleanup never stalls an unrelated show or flight.
    if (!this.tidying) {
      if (sim.scene || sim.flight || !["idle", "walk"].includes(sim.mode)) {
        return false;
      }
    }

    if (state.session) {
      if (state.level >= 3 && state.pointer) {
        this.#host.body.moveToward(
          { x: state.pointer.x - 48, y: state.pointer.y - 96 },
          75,
          dt,
        );

        if (sim.time >= state.reactionUntil) {
          this.#remark("escalation");
          state.reactionUntil = sim.time + 5;
        }
      }

      return true;
    }

    if (state.sulkUntil > sim.time) {
      if (Math.floor((state.sulkUntil - sim.time) * 2) % 6 === 0) {
        this.#host.body.face(-state.away);
      } else {
        this.#host.body.face(state.away);
      }

      return true;
    }

    if (state.sulkUntil) {
      state.sulkUntil = 0;
      state.level = 0;
      this.#host.moods.settleOffence();

      if (state.apology) {
        if (!sim.scene && sim.mode === "idle" && !sim.settings.paused) {
          state.apology = false;
          this.#host.action("apology");
          return true;
        }
      }

      state.apology = false;
    }

    return state.reactionUntil > sim.time;
  }
}
export function cleanupPose(
  sim: ReadonlyValue<{
    cleanup: CleanupState;
    tidying: boolean;
    scene: Scene | null;
    flight: Flight | null;
    mode: string;
    time: number;
    motionTime: number;
  }>,
): Pose | null {
  const state = sim.cleanup;

  if (!sim.tidying) {
    if (sim.scene || sim.flight || !["idle", "walk"].includes(sim.mode)) {
      return null;
    }
  }

  if (
    !state.session &&
    state.sulkUntil <= sim.time &&
    state.reactionUntil <= sim.time
  ) {
    return null;
  }

  if (state.sulkUntil > sim.time) {
    return "bag-offended";
  }

  if (state.level >= 3 && state.pointer) {
    return (["walkLeft", "bag-offended", "walkRight", "bag-offended"] as const)[
      Math.floor(sim.motionTime * 8) % 4
    ];
  }

  if (state.level >= 2) {
    if (Math.floor(sim.time * 4) % 2) {
      return "bag-offended";
    } else {
      return "squawk";
    }
  }

  if (state.level === 1) {
    return "tilt";
  } else if (sim.time % 5 > 4.75) {
    return "blink";
  } else {
    return "idle";
  }
}
