import type { Point } from "../simulation/model.js";
import type { CursorScene } from "../simulation/scenes.js";

type BiteScene = Pick<CursorScene, "phase" | "cursorId">;
interface CursorBiteOptions {
  tug: (id: number | undefined, point: Point) => Promise<boolean>;
  release: (id: number) => Promise<void>;
  failed: (scene: BiteScene) => void;
}

export interface CursorBiteBridge {
  sync(scene: BiteScene | null, point?: Point | null): void;
  stop(): void;
}

// One in-flight tug at a time. Old IPC replies must never affect a new scene.
class CursorBiteController implements CursorBiteBridge {
  private current: BiteScene | null = null;
  private pending = false;
  private readonly released = new WeakSet<BiteScene>();

  constructor(private readonly options: CursorBiteOptions) {}

  sync(scene: BiteScene | null, point: Point | null = null): void {
    if (scene !== this.current) {
      this.releaseScene(this.current);
      this.current = scene;
    }
    if (!scene || this.released.has(scene)) {
      return;
    }
    if (scene.phase === "recoil") {
      this.releaseScene(scene);
      return;
    }
    if (scene.phase !== "chew" || !point || this.pending) {
      return;
    }
    this.pending = true;
    void this.tugPointer(scene, point);
  }

  stop(): void {
    this.sync(null);
  }

  private releaseScene(scene: BiteScene | null): void {
    if (!scene || this.released.has(scene)) {
      return;
    }
    this.released.add(scene);
    if (scene.cursorId != null) {
      this.options.release(scene.cursorId).catch(() => {
        // Native expiry still releases the pointer if IPC fails.
      });
    }
  }

  private isCurrent(scene: BiteScene): boolean {
    return this.current === scene && !this.released.has(scene);
  }

  private async tugPointer(scene: BiteScene, point: Point): Promise<void> {
    // Allow synchronous cancellation to invalidate a queued tug before dispatch.
    await Promise.resolve();
    let succeeded = true;
    try {
      if (this.isCurrent(scene)) {
        succeeded = await this.options.tug(scene.cursorId, point);
      }
    } catch {
      succeeded = false;
    }
    this.pending = false;
    if (succeeded || !this.isCurrent(scene)) {
      return;
    }
    this.releaseScene(scene);
    this.options.failed(scene);
  }
}

export function createCursorBiteBridge(
  options: CursorBiteOptions,
): CursorBiteBridge {
  return new CursorBiteController(options);
}
