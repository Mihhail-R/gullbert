import { submitPreviewAction } from "../../actions/preview.js";
import { dialogue } from "../../simulation/dialogue.js";
import type { ActionMessage, PreviewMessage } from "../../platform/bridge.js";
import { createPickupDrag } from "../../platform/pickup-drag.js";
import { createCursorBiteBridge } from "../../platform/cursor-bite.js";
import { MemoryPersistence } from "../../platform/roommate-store.js";
import { createPointerTracker } from "../../platform/pointer.js";
import { WorkObserver } from "../../platform/work-observer.js";
import { contains } from "../../simulation/behaviors/touch.js";
import type { Point, PointerSample, Settings } from "../../simulation/model.js";
import type { CursorScene } from "../../simulation/scenes.js";
import type {
  ApplicationDependencies,
  ApplicationEvents,
  ApplicationPointerEvent,
  PointerListener,
} from "./application-contracts.js";
import { Targeting } from "./targeting.js";

type Lifecycle = "new" | "starting" | "running" | "disposed";
interface CursorLeaseScene {
  token: object;
  phase: CursorScene["phase"];
  cursorId?: number;
}

/** Owns the overlay lifecycle; dependencies never need to manage its pending work. */
export class PetApplication {
  #lifecycle: Lifecycle = "new";
  #generation = 0;
  #startup: Promise<void> | null = null;
  #shutdown: Promise<void> | null = null;
  readonly #startupCommands: (() => void)[] = [];
  readonly #unlisteners: (() => void)[] = [];
  #visible = true;
  readonly #targeting: Targeting;
  #tidyPoint: Point | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #biteTimer: ReturnType<typeof setTimeout> | undefined;
  #last = 0;
  #frame: number | undefined;
  #renderFrame: number | undefined;
  #initialized = false;
  #statusKey = "";
  #storageError = "";
  #chewingToken: object | null = null;
  #cursorLeaseScene: CursorLeaseScene | null = null;
  #reactionLease: { token: object; id: number } | null = null;
  #pickupReaction: object | null = null;
  readonly #persistence: MemoryPersistence;
  readonly #drag: ReturnType<typeof createPickupDrag>;
  readonly #bite: ReturnType<typeof createCursorBiteBridge>;
  readonly #pointer: ReturnType<typeof createPointerTracker>;
  readonly #work: WorkObserver | null;

  readonly #dependencies: ApplicationDependencies;

  constructor(dependencies: ApplicationDependencies) {
    this.#dependencies = dependencies;
    const native = dependencies.native;
    this.#targeting = new Targeting({
      clock: dependencies.clock,
      action: (action, point) => dependencies.simulation.action(action, point),
      running: () => this.#running(),
      prepare: () => {
        this.#cancelDrag();
      },
      cancelDrag: () => this.#cancelDrag(),
      clearPointer: () => {
        this.#tidyPoint = null;
        dependencies.simulation.tidyPointer(null);
      },
      syncPointer: () => this.#syncPointer(),
      updateView: () => this.#updateView(),
      resize: () => this.#resizeSimulation(),
      render: () => this.#render(),
      wake: () => this.#wake(),
      size: () => dependencies.browser.size(),
      pick: native
        ? (id, point) => native.invoke("target_picked", { id, ...point })
        : null,
      cancelNative: (id) => this.#cancelNativeTargeting(id),
      reportError: (error) => dependencies.reportError(error),
    });
    this.#persistence = new MemoryPersistence({
      storage: dependencies.storage,
      clock: dependencies.clock,
      restore: (memory) => dependencies.simulation.restoreMemory(memory),
      revision: () => dependencies.simulation.status().memoryRevision,
      snapshot: () => dependencies.simulation.exportMemory(),
      result: (error) => this.#storageResult(error),
    });
    this.#drag = createPickupDrag({
      acquire: (rect) => {
        const native = this.#dependencies.native;

        if (native) {
          return native.invoke("begin_pickup", { rect });
        }

        return Promise.resolve(0);
      },
      release: (id, retaliate) => {
        const native = this.#dependencies.native;

        if (native) {
          return native.invoke("end_pickup", {
            id,
            retaliate,
            tug: this.#dependencies.simulation.reactionMovesCursor(),
          });
        }

        return Promise.resolve(null);
      },
      begin: (point) => {
        return this.#dependencies.simulation.beginPickup(
          point,
          this.#dependencies.clock.wallNow(),
        );
      },
      move: (point) => {
        this.#dependencies.simulation.movePickup(point);
        this.#requestRender();
        this.#syncBite();
      },
      finish: (cancelled, pointerId) => {
        return this.#finishPickup(cancelled, pointerId);
      },
      current: (reaction) => {
        return (
          this.#running() &&
          !this.#drag.active &&
          this.#dependencies.simulation.currentReaction(reaction)
        );
      },
      armed: (reaction, id) => {
        if (
          this.#running() &&
          this.#dependencies.simulation.armReaction(reaction, id)
        ) {
          this.#reactionLease = { token: reaction, id };
        } else {
          this.#releaseCursorLease(id);
        }
      },
      discard: (id) => {
        this.#releaseCursorLease(id);
      },
      schedule: this.#dependencies.clock.schedule,
      cancel: this.#dependencies.clock.cancel,
    });
    this.#bite = createCursorBiteBridge({
      tug: (id, point) => {
        const native = this.#dependencies.native;

        if (!native || id == null || !this.#running()) {
          return Promise.resolve(false);
        }

        return native.invoke("tug_cursor", { id, ...point });
      },
      release: (id) => {
        const native = this.#dependencies.native;

        if (native) {
          return native.invoke("release_cursor", { id });
        }

        return Promise.resolve();
      },
      failed: (scene) => {
        if (!this.#running()) {
          return;
        }

        const owned = scene as CursorLeaseScene;
        this.#dependencies.simulation.releaseCursor(
          dialogue.gullbert.cursor.tooSlippery,
          owned.token,
        );
        this.#render();
        this.#syncPointer();
      },
    });
    let read = null;

    if (this.#dependencies.native) {
      read = () => {
        return this.#readNativePointer();
      };
    }

    this.#pointer = createPointerTracker({
      read,
      listen: (sample) => {
        return this.#listenPointer(sample);
      },
      sample: (point) => {
        this.#samplePointer(point);
      },
      now: () => {
        return this.#dependencies.clock.now();
      },
      schedule: this.#dependencies.clock.schedule,
      cancel: this.#dependencies.clock.cancel,
    });
    this.#work = null;

    if (native) {
      this.#work = new WorkObserver({
        read: () => native.invoke("work_activity"),
        stop: () => this.#runNative(native.invoke("stop_work_activity")),
        sample: (sample, nowMs) => dependencies.simulation.observeWork(sample, nowMs),
        now: () => dependencies.clock.now(),
        schedule: dependencies.clock.schedule,
        cancel: dependencies.clock.cancel,
      });
    }
  }

  start(): Promise<void> {
    if (this.#lifecycle === "disposed") {
      return Promise.resolve();
    }

    if (this.#startup) {
      return this.#startup;
    }

    this.#lifecycle = "starting";
    const generation = ++this.#generation;
    this.#installBrowserListeners();
    this.#startup = this.#initialize(generation);
    return this.#startup;
  }

  dispose(): Promise<void> {
    if (this.#shutdown) {
      return this.#shutdown;
    }

    this.#shutdown = this.#persistence.dispose();
    this.#lifecycle = "disposed";
    this.#startupCommands.length = 0;
    this.#generation++;
    this.#cancelTick();
    this.#cancelRender();
    this.#targeting.stopDeadline();
    this.#dependencies.clock.cancel(this.#biteTimer);
    this.#timer = undefined;
    this.#biteTimer = undefined;
    this.#cancelDrag();
    this.#dependencies.simulation.setVisible(false);
    this.#pointer.stop();
    this.#work?.stop();
    this.#releaseInteraction();
    this.#bite.stop();

    if (this.#reactionLease) {
      this.#releaseCursorLease(this.#reactionLease.id);
      this.#reactionLease = null;
    }

    this.#targeting.dispose();

    for (const unlisten of this.#unlisteners.splice(0)) {
      unlisten();
    }

    this.#dependencies.audio.dispose();
    this.#dependencies.view.dispose();
    return this.#shutdown;
  }

  #running(): boolean {
    return this.#lifecycle === "running";
  }

  #current(generation: number): boolean {
    return this.#lifecycle !== "disposed" && this.#generation === generation;
  }

  async #initialize(generation: number): Promise<void> {
    const native = this.#dependencies.native;

    try {
      if (native) {
        await this.#installNativeListeners(generation);

        if (!this.#current(generation)) {
          return;
        }

        const state = await native.invoke("pet_ready");

        if (!this.#current(generation)) {
          return;
        }

        await this.#persistence.restore();

        if (!this.#current(generation)) {
          return;
        }

        this.#dependencies.simulation.configure(state.settings);
        this.#visible = state.visible;
      } else {
        await this.#persistence.restore();

        if (!this.#current(generation)) {
          return;
        }
      }

      this.#initialized = true;
      this.#resizeSimulation();
    } catch (error) {
      if (!this.#current(generation)) {
        return;
      }

      this.#startupCommands.length = 0;
      this.#dependencies.reportError(error);
      this.#visible = false;
      this.#storageError =
        "Could not restore Gullbert’s belongings. Restart to try again; saved " +
        "belongings have not been replaced.";

      if (native) {
        this.#runNative(
          native.invoke("publish_roommate", {
            status: { error: this.#storageError },
          }),
        );
      } else {
        this.#dependencies.browser.publish({
          type: "roommate",
          error: this.#storageError,
        });
      }
    }

    if (!this.#current(generation)) {
      return;
    }

    this.#lifecycle = "running";
    this.#dependencies.simulation.setVisible(this.#visible);
    this.#dependencies.simulation.greet();

    // Restore and greet before replaying input so neither can replace its effects.
    // Native state is the startup baseline; delivered commands take precedence.
    for (const command of this.#startupCommands.splice(0)) {
      command();
    }

    if (this.#initialized) {
      this.#persistence.start();
    }

    this.#publishRoommate(true);

    if (!native) {
      this.#dependencies.browser.publish({ type: "ready" });
    }

    this.#wake();
  }

  async #installNativeListeners(generation: number): Promise<void> {
    const native = this.#dependencies.native;

    if (!native) {
      return;
    }

    const subscriptions = [
      () => {
        return native.listen("gullbert-roommate-request", () => {
          this.#publishRoommate(true);
        });
      },
      () => {
        return native.listen("gullbert-action", (event) => {
          this.#receiveCommand(() => {
            this.#action(event.payload);
          });
        });
      },
      () => {
        return native.listen("gullbert-target", (event) => {
          this.#receiveCommand(() => {
            this.#targeting.notice(event.payload);
          });
        });
      },
      () => {
        return native.listen("gullbert-settings", (event) => {
          this.#receiveCommand(() => {
            this.#configure(event.payload);
          });
        });
      },
      () => {
        return native.listen("gullbert-visible", (event) => {
          this.#receiveCommand(() => {
            this.#changeVisibility(event.payload);
          });
        });
      },
    ];

    for (const subscribe of subscriptions) {
      const unlisten = await subscribe();

      if (!this.#current(generation)) {
        unlisten();
        return;
      }

      this.#unlisteners.push(unlisten);
    }
  }

  #listen<K extends keyof ApplicationEvents>(
    name: K,
    callback: (event: ApplicationEvents[K]) => void,
  ): void {
    this.#unlisteners.push(this.#dependencies.browser.listen(name, callback));
  }

  #installBrowserListeners(): void {
    this.#listen("cancel", () => {
      this.#cancel();
    });
    this.#listen("pointerdown", (event) => {
      this.#pointerDown(event);
    });
    this.#listen("pointerup", (event) => {
      this.#pointerUp(event);
    });
    this.#listen("pointercancel", (event) => {
      if (event.pointerId === this.#drag.pointerId) {
        this.#cancelDrag();
      }
    });
    this.#listen("lostpointercapture", (event) => {
      if (event.pointerId === this.#drag.pointerId) {
        this.#cancelDrag();
      }
    });
    this.#listen("blur", () => {
      this.#cancelDrag();
    });
    this.#listen("pointermove", (event) => {
      this.#pointerMove(event);
    });
    this.#listen("pointerleave", () => {
      this.#pointerLeave();
    });
    this.#listen("keydown", (key) => {
      if (key === "Escape") {
        this.#cancel();
      }
    });
    this.#listen("resize", () => {
      if (!this.#running()) {
        return;
      }

      this.#cancelDrag();
      this.#work?.stop();

      if (this.#dependencies.simulation.cursorEncounter()) {
        this.#dependencies.simulation.action("cancel");
      }

      this.#resizeSimulation();
      this.#render();
      this.#syncPointer();
    });
    this.#listen("message", (message) => {
      if (!this.#dependencies.native) {
        this.#receiveCommand(() => {
          this.#previewMessage(message);
        });
      }
    });
    this.#listen("pagehide", () => {
      void this.dispose();
    });
  }

  #receiveCommand(command: () => void): void {
    if (this.#lifecycle === "starting") {
      this.#startupCommands.push(command);
      return;
    }

    if (this.#running()) {
      command();
    }
  }

  #previewMessage(message: PreviewMessage): void {
    switch (message.type) {
      case "action":
        if (!this.#running()) {
          return;
        }

        try {
          submitPreviewAction(message.action, {
            replace: () => {
              this.#targeting.replace();
            },
            visibility: (visible) => {
              this.#changeVisibility(visible);
              this.#dependencies.browser.publish({ type: "visible", visible });
            },
            command: (action, point) => {
              this.#action({ action, point });
            },
            target: (purpose, preparation) => {
              this.#targeting.startPreview(purpose, preparation);
            },
            center: () => {
              const size = this.#dependencies.browser.size();
              return { x: size.width / 2, y: size.height / 2 };
            },
            quit: () => {
              this.#dependencies.browser.publish({ type: "preview-quit" });
            },
          });
        } catch (error) {
          this.#dependencies.reportError(error);
        }

        return;

      case "escape":
        this.#cancel();
        return;

      case "settings":
        this.#configure(message.settings);
        return;

      case "visible":
        this.#changeVisibility(message.visible);
        return;
    }
  }

  #configure(settings: Settings): void {
    if (!this.#running()) {
      return;
    }

    this.#cancelDrag();
    this.#dependencies.simulation.configure(settings);
    this.#wake();
  }

  #storageResult(error: unknown): void {
    if (!this.#running()) {
      return;
    }

    if (error) {
      this.#storageError =
        "Could not save Gullbert's memories. They remain available for this " +
        "session; retrying shortly.";
    } else {
      this.#storageError = "";
    }

    this.#publishRoommate(true);
  }

  #publishRoommate(force = false): void {
    if (!this.#running() || !this.#initialized) {
      return;
    }

    const status = this.#dependencies.simulation.status();
    const key = `${status.memoryRevision}:${status.mood ?? ""}:${this.#storageError}`;

    if (!force && key === this.#statusKey) {
      return;
    }

    this.#statusKey = key;
    let mood = null;

    if (status.mood) {
      mood = status.mood;
    }

    const data = {
      type: "roommate" as const,
      memory: this.#dependencies.simulation.exportMemory(),
      mood,
      error: this.#storageError,
    };
    const native = this.#dependencies.native;

    if (native) {
      this.#runNative(native.invoke("publish_roommate", { status: data }));
    } else {
      this.#dependencies.browser.publish(data);
    }
  }

  #remember(): void {
    if (!this.#running() || !this.#initialized) {
      return;
    }

    this.#persistence.remember();
  }

  #requestRender(): void {
    if (
      !this.#running() ||
      this.#renderFrame !== undefined ||
      this.#frame !== undefined
    ) {
      return;
    }

    // Input can arrive faster than the display can paint. Keep the latest
    // simulation state, and project it only once for a burst of input.
    this.#renderFrame = this.#dependencies.clock.requestFrame(() => {
      this.#renderFrame = undefined;
      this.#render();
    });
  }

  #cancelRender(): void {
    if (this.#renderFrame !== undefined) {
      this.#dependencies.clock.cancelFrame(this.#renderFrame);
      this.#renderFrame = undefined;
    }
  }

  #render(): void {
    this.#cancelRender();

    if (!this.#running()) {
      return;
    }

    this.#dependencies.view.render(
      this.#dependencies.simulation.present(
        this.#tidyPoint,
        !this.#targeting.active,
      ),
    );
    this.#updateView();
    this.#remember();
    this.#publishRoommate();

    for (const sound of this.#dependencies.simulation.drainSounds()) {
      if (this.#dependencies.simulation.status().sound) {
        this.#dependencies.audio.play(sound);
      }
    }
  }

  #updateView(): void {
    if (!this.#running()) {
      return;
    }

    const sim = this.#dependencies.simulation;
    const encounter = sim.cursorEncounter();
    let caughtPointer = null;

    if (
      !this.#dependencies.native &&
      this.#visible &&
      !this.#targeting.active
    ) {
      if (encounter?.phase === "chew") {
        caughtPointer = encounter.beak;
      }
    }

    let grabbable = false;
    let interactiveHover = false;

    if (this.#tidyPoint) {
      grabbable =
        sim.canPickup() && contains(sim.pickupRect(), this.#tidyPoint);

      if (!this.#targeting.active) {
        const point = this.#tidyPoint;
        interactiveHover = sim.interactionRects()
          .some((rect) => {
            return contains(rect, point);
          });
      }
    }

    this.#dependencies.view.update({
      visible: this.#visible,
      targeting: this.#targeting.active,
      purpose: this.#targeting.purpose,
      dragging: sim.status().dragged,
      grabbable,
      interactiveHover,
      caughtPointer,
    });
  }

  #tick(): void {
    this.#timer = undefined;

    if (!this.#running() || !this.#visible) {
      return;
    }

    const now = this.#dependencies.clock.now();
    const sim = this.#dependencies.simulation;
    this.#syncWork();
    sim.updatePickupClock(this.#dependencies.clock.wallNow());

    if (this.#drag.active && !sim.status().held) {
      this.#cancelDrag();
    }

    if (!this.#targeting.active || this.#targeting.purpose === "tidy") {
      sim.step((now - this.#last) / 1000);
    }

    this.#last = now;
    this.#render();
    this.#syncPointer();

    if (sim.status().animate) {
      this.#frame = this.#dependencies.clock.requestFrame(() => {
        this.#frame = undefined;
        this.#tick();
      });
    } else {
      this.#timer = this.#dependencies.clock.schedule(() => {
        this.#tick();
      }, 100);
    }
  }

  #cancelTick(): void {
    this.#dependencies.clock.cancel(this.#timer);
    this.#timer = undefined;

    if (this.#frame !== undefined) {
      this.#dependencies.clock.cancelFrame(this.#frame);
      this.#frame = undefined;
    }
  }

  #wake(): void {
    if (!this.#running()) {
      return;
    }

    this.#cancelTick();
    this.#timer = undefined;
    this.#last = this.#dependencies.clock.now();
    this.#dependencies.simulation.setVisible(this.#visible);
    this.#syncPointer();
    this.#syncWork();

    if (!this.#visible) {
      this.#dependencies.audio.suspend();
      this.#render();
    } else {
      this.#tick();
    }
  }

  #syncWork(): void {
    if (!this.#work) {
      return;
    }

    const available = this.#running() && this.#visible && !this.#targeting.active;

    if (available && this.#dependencies.simulation.status().workEnabled) {
      this.#work.start();
    } else {
      this.#work.stop();
    }
  }

  #changeVisibility(next: boolean): void {
    if (!this.#running()) {
      return;
    }

    const returning = !this.#visible && next;
    this.#visible = next;
    this.#dependencies.simulation.setVisible(next);

    if (!next) {
      this.#cancelDrag();
      this.#tidyPoint = null;
      this.#targeting.replace();
    }

    if (
      returning &&
      this.#initialized &&
      this.#dependencies.simulation.status().idle
    ) {
      this.#dependencies.simulation.greet();
    }

    this.#wake();
  }

  #cancel(): void {
    if (!this.#running()) {
      return;
    }

    if (this.#targeting.cancel()) {
      return;
    }

    const sim = this.#dependencies.simulation;

    if (!this.#drag.active && !sim.cursorEncounter()) {
      if (!this.#pickupReaction || !sim.currentReaction(this.#pickupReaction)) {
        return;
      }
    }

    this.#cancelDrag();
    sim.action("cancel");
    this.#wake();
  }

  #action(message: ActionMessage): void {
    if (!this.#running()) {
      return;
    }

    const sim = this.#dependencies.simulation;
    this.#cancelDrag();
    this.#targeting.replace();
    this.#resizeSimulation();
    sim.action(message.action, message.point);

    if (message.cursor_id != null) {
      sim.authorizeCursor(message.cursor_id);
    }

    this.#wake();
  }

  #pointerDown(event: ApplicationPointerEvent): void {
    if (!this.#running() || event.button !== 0 || !this.#visible) {
      return;
    }

    const sim = this.#dependencies.simulation;
    const point = { x: event.x, y: event.y };

    if (!this.#targeting.active) {
      if (sim.flickCap(point)) {
        event.preventDefault();
        this.#releaseInteraction();
        this.#wake();
        return;
      }

      const rect = sim.pickupRect();

      if (sim.canPickup() && contains(rect, point)) {
        if (this.#drag.begin(event.pointerId, point, rect)) {
          event.preventDefault();
          this.#dependencies.browser.capture(event.pointerId);
          this.#render();
        }
      } else if (sim.directCleanupAt(point)) {
        sim.action("direct_pick", point);
        this.#releaseInteraction();
        this.#wake();
      }

      return;
    }

    if (event.onBanner) {
      return;
    }

    this.#targeting.select(point);
  }

  #pointerUp(event: ApplicationPointerEvent): void {
    if (event.pointerId !== this.#drag.pointerId || event.button !== 0) {
      return;
    }

    this.#drag.move({ x: event.x, y: event.y });
    this.#drag.finish();
    this.#dependencies.browser.releaseCapture(event.pointerId);
  }

  #pointerMove(event: ApplicationPointerEvent): void {
    if (!this.#running()) {
      return;
    }

    if (event.pointerId === this.#drag.pointerId) {
      if (!(event.buttons & 1)) {
        this.#cancelDrag();
        return;
      }

      this.#drag.move({ x: event.x, y: event.y });
    }

    if (this.#targeting.active && this.#targeting.purpose === "tidy") {
      this.#tidyPoint = { x: event.x, y: event.y };
      this.#dependencies.simulation.tidyPointer(this.#tidyPoint);
      this.#requestRender();
    }
  }

  #pointerLeave(): void {
    if (!this.#running()) {
      return;
    }

    this.#tidyPoint = null;
    this.#dependencies.simulation.tidyPointer(null);

    if (
      !this.#dependencies.native &&
      this.#dependencies.simulation.cursorEncounter()?.phase === "chew"
    ) {
      this.#dependencies.simulation.releaseCursor(
        dialogue.gullbert.cursor.tooSlippery,
      );
      this.#syncPointer();
    }

    this.#render();
  }

  #cancelDrag(): void {
    const pointerId = this.#drag.pointerId;
    this.#drag.finish(true);

    if (pointerId != null) {
      this.#dependencies.browser.releaseCapture(pointerId);
    }
  }

  #finishPickup(cancelled: boolean, pointerId: number): object | null {
    this.#dependencies.browser.releaseCapture(pointerId);
    const reaction = this.#dependencies.simulation.finishPickup(
      cancelled,
      this.#dependencies.clock.wallNow(),
    );
    this.#pickupReaction = reaction;
    this.#render();
    this.#syncPointer();
    return reaction;
  }

  async #readNativePointer(): Promise<PointerSample | null | undefined> {
    const native = this.#dependencies.native;

    if (!native) {
      return null;
    }

    const revision = this.#drag.revision;
    const generation = this.#generation;
    let rects: ReturnType<
      ApplicationDependencies["simulation"]["interactionRects"]
    > = [];

    if (this.#visible && !this.#targeting.active) {
      rects = this.#dependencies.simulation.interactionRects();
    }

    const point = await native
      .invoke("sync_interaction", {
        rects,
        pickupId: this.#drag.leaseId,
      })
      .catch(() => {
        return null;
      });

    if (this.#current(generation) && revision === this.#drag.revision) {
      return point;
    }

    return undefined;
  }

  #listenPointer(sample: PointerListener): () => void {
    let latest: PointerSample = { x: -1, y: -1, inside: false };
    const unmove = this.#dependencies.browser.listen("pointermove", (event) => {
      latest = { x: event.x, y: event.y, inside: true };
      sample(latest);
    });
    const unleave = this.#dependencies.browser.listen("pointerleave", () => {
      latest = { x: -1, y: -1, inside: false };
      sample(latest);
    });
    let active = true;
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    const beat = () => {
      if (!active) {
        return;
      }

      if (latest.inside) {
        sample(latest);
      }

      heartbeat = this.#dependencies.clock.schedule(beat, 100);
    };
    heartbeat = this.#dependencies.clock.schedule(beat, 100);
    return () => {
      active = false;
      this.#dependencies.clock.cancel(heartbeat);
      unmove();
      unleave();
    };
  }

  #samplePointer(point: PointerSample | null): void {
    if (!this.#running()) {
      return;
    }

    if (this.#drag.active && (!point || point.inside === false)) {
      this.#cancelDrag();
    }

    this.#dependencies.simulation.pointer(point);

    if (point && point.inside !== false) {
      this.#tidyPoint = point;
    } else {
      this.#tidyPoint = null;
    }

    this.#render();
    this.#syncPointer();
  }

  #syncPointer(): void {
    if (!this.#running()) {
      return;
    }

    this.#syncBite();

    if (this.#visible && !this.#targeting.active) {
      this.#pointer.start();
    } else if (this.#pointer.running) {
      this.#pointer.stop();
      this.#releaseInteraction();
    }
  }

  #syncBite(): void {
    if (!this.#running()) {
      return;
    }

    const sim = this.#dependencies.simulation;

    if (
      this.#reactionLease &&
      !sim.currentReaction(this.#reactionLease.token)
    ) {
      const id = this.#reactionLease.id;
      this.#reactionLease = null;
      this.#releaseCursorLease(id);
    }

    let encounter = sim.cursorEncounter();

    if (!this.#visible || this.#targeting.active) {
      encounter = null;
    }

    let token = null;

    if (encounter?.phase === "chew") {
      token = encounter.token;
    }

    if (this.#chewingToken !== token) {
      this.#dependencies.clock.cancel(this.#biteTimer);
      this.#biteTimer = undefined;
      this.#chewingToken = token;

      if (token) {
        const chewingToken = token;
        this.#biteTimer = this.#dependencies.clock.schedule(() => {
          const current = sim.cursorEncounter();

          if (
            this.#running() &&
            current?.token === chewingToken &&
            current.phase === "chew"
          ) {
            sim.releaseCursor(undefined, chewingToken);
            this.#render();
            this.#syncPointer();
          }
        }, 1200);
      }
    }

    if (this.#dependencies.native) {
      if (encounter?.cursorId != null) {
        if (this.#cursorLeaseScene?.token !== encounter.token) {
          this.#cursorLeaseScene = {
            token: encounter.token,
            phase: encounter.phase,
            cursorId: encounter.cursorId,
          };
        } else {
          this.#cursorLeaseScene.phase = encounter.phase;
          this.#cursorLeaseScene.cursorId = encounter.cursorId;
        }

        let point = null;

        if (encounter.phase === "chew") {
          point = encounter.beak;
        }

        this.#bite.sync(this.#cursorLeaseScene, point);
      } else {
        this.#cursorLeaseScene = null;
        this.#bite.sync(null);
      }
    }

    this.#updateView();
  }

  #resizeSimulation(): void {
    const size = this.#dependencies.browser.size();
    this.#dependencies.simulation.resize(size.width, size.height);
  }

  #releaseInteraction(): void {
    const native = this.#dependencies.native;

    if (native) {
      this.#runNative(native.invoke("sync_interaction", { rects: [] }));
    }
  }

  #releaseCursorLease(id: number): void {
    const native = this.#dependencies.native;

    if (native) {
      this.#runNative(native.invoke("release_cursor", { id }));
    }
  }

  #cancelNativeTargeting(id: number | null): void {
    const native = this.#dependencies.native;

    if (native) {
      this.#runNative(
        native.invoke("cancel_targeting", { id: id ?? undefined }),
      );
    }
  }

  #runNative(operation: Promise<unknown>): void {
    operation.catch((error) => {
      this.#dependencies.reportError(error);
    });
  }
}
