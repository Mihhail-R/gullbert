import type { TargetNotice } from "../../platform/bridge.js";
import type { Point } from "../../simulation/model.js";
import type {
  ApplicationClock,
  ApplicationSimulation,
} from "./application-contracts.js";

interface TargetingDependencies {
  clock: Pick<ApplicationClock, "schedule" | "cancel">;
  action: ApplicationSimulation["action"];
  running(): boolean;
  prepare(): void;
  cancelDrag(): void;
  clearPointer(): void;
  syncPointer(): void;
  updateView(): void;
  resize(): void;
  render(): void;
  wake(): void;
  size(): { width: number; height: number };
  pick: ((id: number, point: Point) => Promise<unknown>) | null;
  cancelNative(id: number | null): void;
  reportError(error: unknown): void;
}

/** Owns Targeting identity, deadlines and outcomes for native and preview input. */
export class Targeting {
  #active = false;
  #generation = 0;
  #id: number | null = null;
  #lastId = 0;
  #purpose = "poop";
  #timer: ReturnType<typeof setTimeout> | undefined;

  readonly #dependencies: TargetingDependencies;

  constructor(dependencies: TargetingDependencies) {
    this.#dependencies = dependencies;
  }

  get active(): boolean {
    return this.#active;
  }

  get purpose(): string {
    return this.#purpose;
  }

  startPreview(purpose: string, preparation: string): void {
    this.notice({
      outcome: "started",
      id: this.#lastId + 1,
      purpose,
      preparation,
    });
  }

  replace(): void {
    this.#mode(false);
  }

  cancel(): boolean {
    if (this.#dependencies.pick) {
      // Native Escape remains authoritative even after its lease has ended.
      this.#dependencies.cancelNative(this.#id);
      return true;
    }

    if (this.#id === null) {
      return false;
    }

    this.notice({ id: this.#id, outcome: this.#end() });
    return true;
  }

  // Shutdown quiesces callbacks before releasing the other input leases.
  stopDeadline(): void {
    this.#generation++;
    this.#dependencies.clock.cancel(this.#timer);
    this.#timer = undefined;
  }

  dispose(): void {
    if (this.#active) {
      this.#dependencies.cancelNative(this.#id);
    }

    this.#active = false;
  }

  #mode(active: boolean, purpose = "poop"): void {
    if (active) {
      this.#dependencies.cancelDrag();
      this.#purpose = purpose;
    }

    this.#dependencies.clock.cancel(this.#timer);
    this.#timer = undefined;
    const generation = ++this.#generation;
    this.#active = active;

    if (!active) {
      this.#id = null;
      this.#dependencies.clearPointer();
    }

    this.#dependencies.syncPointer();

    if (active) {
      let timeout = 12000;

      if (this.#purpose === "tidy") {
        timeout = 30000;
      }

      const id = this.#id;
      this.#timer = this.#dependencies.clock.schedule(() => {
        if (
          this.#dependencies.running() &&
          generation === this.#generation &&
          id !== null
        ) {
          // Native expiry is independent. This remains a frontend fallback if
          // terminal event delivery fails after native ownership is released.
          this.#dependencies.cancelNative(id);
          this.notice({ id, outcome: this.#end() });
        }
      }, timeout);
    }

    this.#dependencies.updateView();
  }

  #end(): "finished_tidying" | "abandoned" {
    if (this.#purpose === "tidy") {
      return "finished_tidying";
    }

    return "abandoned";
  }

  notice(notice: TargetNotice): void {
    if (!this.#dependencies.running()) {
      return;
    }

    if (notice.outcome === "started") {
      if (notice.id <= this.#lastId) {
        return;
      }

      this.#lastId = notice.id;
      this.#mode(false);
      this.#id = notice.id;
      this.#dependencies.prepare();
      this.#dependencies.action(notice.preparation);
      this.#mode(true, notice.purpose);
      this.#dependencies.wake();
      return;
    }

    if (notice.id !== this.#id) {
      return;
    }

    const purpose = this.#purpose;

    if (notice.outcome === "selected" && purpose === "tidy") {
      this.#dependencies.action("tidy_pick", notice.point);
      this.#dependencies.render();
      return;
    }

    // Forget the accepted identity before applying a terminal simulation effect.
    this.#mode(false);

    switch (notice.outcome) {
      case "selected":
        this.#dependencies.resize();
        this.#dependencies.action(purpose, notice.point);
        break;

      case "abandoned":
        this.#dependencies.action("cancel");
        break;

      case "finished_tidying":
        this.#dependencies.action("tidy_done");
        break;

      case "replaced":
        break;
    }

    this.#dependencies.wake();
  }

  select(point: Point): void {
    const id = this.#id;

    if (id === null) {
      return;
    }

    const pick = this.#dependencies.pick;

    if (pick) {
      pick(id, point)
        .catch((error) => {
          if (!this.#dependencies.running() || id !== this.#id) {
            return;
          }

          this.#dependencies.reportError(error);
          this.#dependencies.cancelNative(id);
          this.notice({ outcome: "abandoned", id });
        });
    } else {
      const size = this.#dependencies.size();

      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        this.notice({ outcome: "abandoned", id });
        return;
      }

      if (point.x < 0 || point.y < 0) {
        this.notice({ outcome: "abandoned", id });
        return;
      }

      if (point.x >= size.width || point.y >= size.height) {
        this.notice({ outcome: "abandoned", id });
        return;
      }

      this.notice({ outcome: "selected", id, point });
    }
  }
}
