import type { Point } from "../simulation/model.js";
import type { HitRect } from "../simulation/behaviors/touch.js";

interface DragOptions {
  acquire: (rect: HitRect) => Promise<number | null>;
  release: (id: number, retaliate: boolean) => Promise<number | null>;
  begin: (point: Point) => boolean;
  move: (point: Point) => void;
  finish: (cancelled: boolean, pointerId: number) => object | null;
  armed: (reaction: object, id: number) => void;
  discard: (id: number) => void;
  current: (reaction: object) => boolean;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}

export interface PickupDrag {
  begin(pointerId: number, point: Point, rect: HitRect): boolean;
  move(point: Point): void;
  finish(cancelled?: boolean): void;
  readonly revision: number;
  readonly pointerId: number | undefined;
  readonly leaseId: number | null;
  readonly active: boolean;
}

interface Gesture {
  pointerId: number;
  lease: Promise<number | null>;
  id: number | null;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_HOLD_MILLISECONDS = 30_000;

// Each gesture owns its pending IPC. A late reply can only release its own lease.
class PickupDragController implements PickupDrag {
  private gesture: Gesture | null = null;
  private gestureRevision = 0;

  constructor(private readonly options: DragOptions) {}

  begin(pointerId: number, point: Point, rect: HitRect): boolean {
    if (this.gesture || !this.options.begin(point)) {
      return false;
    }
    const gesture: Gesture = {
      pointerId,
      id: null,
      lease: Promise.resolve(null),
      timer: (this.options.schedule ?? setTimeout)(() => {
        this.finish(true);
      }, MAX_HOLD_MILLISECONDS),
    };
    this.gesture = gesture;
    this.gestureRevision++;
    gesture.lease = this.acquireLease(gesture, rect);
    return true;
  }

  move(point: Point): void {
    if (this.gesture) {
      this.options.move(point);
    }
  }

  finish(cancelled = false): void {
    const gesture = this.gesture;
    if (!gesture) {
      return;
    }
    this.gesture = null;
    this.gestureRevision++;
    (this.options.cancel ?? clearTimeout)(gesture.timer);
    const reaction = this.options.finish(cancelled, gesture.pointerId);
    void this.releaseLease(gesture, reaction);
  }

  get revision(): number {
    return this.gestureRevision;
  }

  get pointerId(): number | undefined {
    if (this.gesture) {
      return this.gesture.pointerId;
    }
    return undefined;
  }

  get leaseId(): number | null {
    if (this.gesture) {
      return this.gesture.id;
    }
    return null;
  }

  get active(): boolean {
    return this.gesture !== null;
  }

  private async acquireLease(
    gesture: Gesture,
    rect: HitRect,
  ): Promise<number | null> {
    let id: number | null = null;
    try {
      id = await this.options.acquire(rect);
    } catch {
      // Failed acquisition cancels only the gesture that requested it.
    }
    gesture.id = id;
    if (id == null && this.gesture === gesture) {
      this.finish(true);
    }
    return id;
  }

  private async releaseLease(
    gesture: Gesture,
    reaction: object | null,
  ): Promise<void> {
    try {
      const id = await gesture.lease;
      if (id == null) {
        return;
      }
      let retaliate = false;
      if (reaction && this.options.current(reaction)) {
        retaliate = true;
      }
      const cursorId = await this.options.release(id, retaliate);
      if (cursorId == null) {
        return;
      }
      // The reaction can change while native release is still in flight.
      if (reaction && this.options.current(reaction)) {
        this.options.armed(reaction, cursorId);
      } else {
        this.options.discard(cursorId);
      }
    } catch {
      // Native leases also expire independently if IPC becomes unavailable.
    }
  }
}

export function createPickupDrag(options: DragOptions): PickupDrag {
  return new PickupDragController(options);
}
