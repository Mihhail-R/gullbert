import type { Point } from "../simulation/model.js";
import type { Gullbert } from "../simulation/engine.js";
import { dialogue } from "../simulation/dialogue.js";

type Encounter = NonNullable<ReturnType<Gullbert["cursorEncounter"]>>;
type CursorSimulation = Pick<
  Gullbert,
  "cursorEncounter" | "currentReaction" | "armReaction" | "releaseCursor"
>;

interface CursorBiteOptions {
  simulation: CursorSimulation;
  schedule: typeof setTimeout;
  cancel: typeof clearTimeout;
  tug: ((id: number, point: Point) => Promise<boolean>) | null;
  release: (id: number) => Promise<unknown>;
  changed: () => void;
}

export interface CursorBiteBridge {
  readonly reacting: boolean;
  sync(available?: boolean): void;
  // Register the reaction before pickup release IPC can return its authorization.
  trackReaction(token: object | null): void;
  armReaction(token: object, id: number): void;
  discard(id: number): void;
  stop(): void;
}

interface Authorization {
  id: number;
  released: boolean;
}

interface ActiveEncounter {
  token: object;
  authorization: Authorization | null;
  chewing: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

// Simulation tokens identify encounters; snapshots never need stable object identity.
class CursorBiteController implements CursorBiteBridge {
  private current: ActiveEncounter | null = null;
  private reaction: { token: object; authorization: Authorization | null } | null = null;
  private available = false;
  private pending = false;
  private readonly retired = new WeakSet<object>();

  constructor(private readonly options: CursorBiteOptions) {}

  sync(available = true): void {
    if (!available) {
      this.stop();
      return;
    }

    this.available = true;
    const simulation = this.options.simulation;

    if (this.reaction && !simulation.currentReaction(this.reaction.token)) {
      this.release(this.reaction.authorization);
      this.reaction = null;
    }

    this.syncEncounter(simulation.cursorEncounter());
  }

  get reacting(): boolean {
    return this.reaction !== null && this.options.simulation.currentReaction(this.reaction.token);
  }

  trackReaction(token: object | null): void {
    if (this.reaction?.token === token) {
      return;
    }

    this.release(this.reaction?.authorization);
    this.reaction = token ? { token, authorization: null } : null;
  }

  armReaction(token: object, id: number): void {
    const reaction = this.reaction;

    if (!this.available || !reaction || reaction.token !== token) {
      this.discard(id);
      return;
    }

    if (!this.options.simulation.armReaction(token, id)) {
      this.discard(id);
      return;
    }

    const snapshot = this.options.simulation.cursorEncounter();

    if (snapshot && (snapshot.phase === "recoil" || this.retired.has(snapshot.token))) {
      this.discard(id);
      return;
    }

    if (reaction.authorization?.id === id) {
      return;
    }

    this.release(reaction.authorization);
    reaction.authorization = { id, released: false };
  }

  discard(id: number): void {
    // Native expiry still releases authorization if IPC fails.
    void this.options.release(id)
      .catch(() => {});
  }

  stop(): void {
    this.available = false;
    this.endEncounter();
    this.release(this.reaction?.authorization);
    this.reaction = null;
  }

  private syncEncounter(snapshot: Encounter | null): void {
    if (this.current?.token !== snapshot?.token) {
      this.endEncounter();
    }

    if (!snapshot || this.retired.has(snapshot.token)) {
      return;
    }

    if (!this.current) {
      this.current = {
        token: snapshot.token,
        authorization: null,
        chewing: false,
        timer: undefined,
      };
    }

    const encounter = this.current;
    this.syncAuthorization(encounter, snapshot.cursorId);

    if (snapshot.phase === "recoil") {
      this.endEncounter();
      return;
    }

    this.syncChewing(encounter, snapshot);
  }

  private syncChewing(encounter: ActiveEncounter, snapshot: Encounter): void {
    if (snapshot.phase !== "chew") {
      this.options.cancel(encounter.timer);
      encounter.timer = undefined;
      encounter.chewing = false;
      return;
    }

    if (!encounter.chewing) {
      encounter.chewing = true;
      encounter.timer = this.options.schedule(() => {
        this.finish(encounter);
      }, snapshot.holdMs ?? 1200);
    }

    const authorization = encounter.authorization;

    if (!authorization || authorization.released || this.pending) {
      return;
    }

    if (this.options.tug) {
      this.pending = true;
      void this.tugPointer(encounter, authorization, snapshot.beak);
    }
  }

  private syncAuthorization(encounter: ActiveEncounter, id: number | undefined): void {
    if (encounter.authorization?.id === id) {
      return;
    }

    this.release(encounter.authorization);
    encounter.authorization = null;

    if (id == null) {
      return;
    }

    // Relocation and its later cursor encounter share one release obligation.
    if (this.reaction?.authorization?.id === id) {
      encounter.authorization = this.reaction.authorization;
    } else {
      encounter.authorization = { id, released: false };
    }
  }

  private release(authorization: Authorization | null | undefined): void {
    if (!authorization || authorization.released) {
      return;
    }

    authorization.released = true;
    this.discard(authorization.id);
  }

  private endEncounter(): void {
    const encounter = this.current;

    if (!encounter) {
      return;
    }

    this.current = null;
    this.retired.add(encounter.token);
    this.options.cancel(encounter.timer);
    this.release(encounter.authorization);
  }

  private isCurrent(encounter: ActiveEncounter): boolean {
    return this.available && this.current === encounter;
  }

  private finish(encounter: ActiveEncounter, reason?: string): void {
    if (!this.isCurrent(encounter)) {
      return;
    }

    const snapshot = this.options.simulation.cursorEncounter();

    if (snapshot?.token !== encounter.token || snapshot.phase !== "chew") {
      return;
    }

    this.endEncounter();
    this.options.simulation.releaseCursor(reason, encounter.token);
    this.options.changed();
  }

  private async tugPointer(
    encounter: ActiveEncounter,
    authorization: Authorization,
    point: Point,
  ): Promise<void> {
    // Synchronous cancellation must invalidate a queued tug before dispatch.
    await Promise.resolve();
    let succeeded = true;

    try {
      if (this.isCurrent(encounter) && !authorization.released) {
        succeeded = await this.options.tug!(authorization.id, point);
      }
    } catch {
      succeeded = false;
    }

    this.pending = false;

    if (succeeded || authorization !== encounter.authorization) {
      return;
    }

    this.finish(encounter, dialogue.gullbert.cursor.tooSlippery);
  }
}

export function createCursorBiteBridge(options: CursorBiteOptions): CursorBiteBridge {
  return new CursorBiteController(options);
}
