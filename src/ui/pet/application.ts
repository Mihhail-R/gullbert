import type { ActionMessage, PreviewMessage } from "../../platform/bridge.js";
import { createPickupDrag } from "../../platform/pickup-drag.js";
import { createCursorBiteBridge } from "../../platform/cursor-bite.js";
import { createMemoryWriter } from "../../platform/roommate-store.js";
import { CaretTracker } from "../../platform/caret.js";
import { createPointerTracker } from "../../platform/pointer.js";
import { contains } from "../../simulation/behaviors/touch.js";
import type { Point, PointerSample, Settings } from "../../simulation/model.js";
import type { CursorScene } from "../../simulation/scenes.js";
import type {
  ApplicationDependencies,
  ApplicationEvents,
  ApplicationPointerEvent,
  PointerListener,
} from "./application-contracts.js";

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
  readonly #unlisteners: (() => void)[] = [];
  #visible = true;
  #targeting = false;
  #targetGeneration = 0;
  #targetPurpose = "poop";
  #tidyPoint: Point | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #targetTimer: ReturnType<typeof setTimeout> | undefined;
  #biteTimer: ReturnType<typeof setTimeout> | undefined;
  #last = 0;
  #initialized = false;
  #savedRevision = -1;
  #statusKey = "";
  #storageError = "";
  #chewingToken: object | null = null;
  #cursorLeaseScene: CursorLeaseScene | null = null;
  #reactionLease: { token: object; id: number } | null = null;
  readonly #memoryWriter: ReturnType<typeof createMemoryWriter>;
  readonly #drag: ReturnType<typeof createPickupDrag>;
  readonly #bite: ReturnType<typeof createCursorBiteBridge>;
  readonly #caret: CaretTracker;
  readonly #pointer: ReturnType<typeof createPointerTracker>;

  readonly #dependencies: ApplicationDependencies;

  constructor(dependencies: ApplicationDependencies) {
    this.#dependencies = dependencies;
    this.#memoryWriter = createMemoryWriter(
      (memory) => {
        return this.#dependencies.storage.save(memory);
      },
      (error) => {
        this.#storageResult(error);
      },
    );
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
        this.#render();
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
          "too slippery.",
          owned.token,
        );
        this.#render();
        this.#syncPointer();
      },
    });
    this.#caret = new CaretTracker({
      read: () => {
        const native = this.#dependencies.native;
        if (native) {
          return native.invoke("caret_position");
        }
        return Promise.resolve(this.#dependencies.browser.caret?.() ?? null);
      },
      sample: (sample) => {
        this.#dependencies.simulation.caret(sample);
      },
      schedule: this.#dependencies.clock.schedule,
      cancel: this.#dependencies.clock.cancel,
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
    this.#lifecycle = "disposed";
    this.#generation++;
    this.#targetGeneration++;
    this.#dependencies.clock.cancel(this.#timer);
    this.#dependencies.clock.cancel(this.#targetTimer);
    this.#dependencies.clock.cancel(this.#biteTimer);
    this.#timer = undefined;
    this.#targetTimer = undefined;
    this.#biteTimer = undefined;
    this.#cancelDrag();
    this.#dependencies.simulation.setVisible(false);
    this.#pointer.stop();
    this.#caret.stop();
    this.#releaseInteraction();
    this.#bite.stop();
    if (this.#reactionLease) {
      this.#releaseCursorLease(this.#reactionLease.id);
      this.#reactionLease = null;
    }
    if (this.#targeting) {
      this.#cancelNativeTargeting();
    }
    this.#targeting = false;
    for (const unlisten of this.#unlisteners.splice(0)) {
      unlisten();
    }
    this.#dependencies.audio.dispose();
    this.#dependencies.view.dispose();
    this.#shutdown = this.#memoryWriter.flush();
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
        const memory = await this.#dependencies.storage.load();
        if (!this.#current(generation)) {
          return;
        }
        this.#dependencies.simulation.restoreMemory(memory);
        this.#dependencies.simulation.configure(state.settings);
        this.#visible = state.visible;
      } else {
        const memory = await this.#dependencies.storage.load();
        if (!this.#current(generation)) {
          return;
        }
        this.#dependencies.simulation.restoreMemory(memory);
      }
      this.#initialized = true;
      this.#resizeSimulation();
    } catch (error) {
      if (!this.#current(generation)) {
        return;
      }
      this.#dependencies.reportError(error);
      this.#visible = false;
      this.#storageError =
        "Could not restore Gullbert’s belongings. Restart to try again; saved belongings have not been replaced.";
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
    this.#remember();
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
          this.#action(event.payload);
        });
      },
      () => {
        return native.listen("gullbert-settings", (event) => {
          this.#configure(event.payload);
        });
      },
      () => {
        return native.listen("gullbert-visible", (event) => {
          this.#changeVisibility(event.payload);
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
      if (this.#dependencies.simulation.cursorEncounter()) {
        this.#dependencies.simulation.action("cancel");
      }
      this.#resizeSimulation();
      this.#render();
      this.#syncPointer();
    });
    this.#listen("message", (message) => {
      if (!this.#dependencies.native) {
        this.#previewMessage(message);
      }
    });
    this.#listen("pagehide", () => {
      void this.dispose();
    });
  }

  #previewMessage(message: PreviewMessage): void {
    if (message.type === "action") {
      this.#action(message);
    } else if (message.type === "settings") {
      this.#configure(message.settings);
    } else if (message.type === "visible") {
      this.#changeVisibility(message.visible);
    }
  }

  #configure(settings: Settings): void {
    if (!this.#running()) {
      return;
    }
    this.#cancelDrag();
    this.#caret.stop();
    this.#dependencies.simulation.configure(settings);
    this.#wake();
  }

  #storageResult(error: unknown): void {
    if (!this.#running()) {
      return;
    }
    if (error) {
      this.#storageError =
        "Could not save Gullbert's belongings. They remain available for this session.";
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
    const revision = this.#dependencies.simulation.status().memoryRevision;
    if (
      !this.#running() ||
      !this.#initialized ||
      this.#savedRevision === revision
    ) {
      return;
    }
    this.#savedRevision = revision;
    void this.#memoryWriter.save(this.#dependencies.simulation.exportMemory());
  }

  #render(): void {
    if (!this.#running()) {
      return;
    }
    this.#dependencies.view.render(
      this.#dependencies.simulation.present(this.#tidyPoint, !this.#targeting),
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
      !this.#targeting &&
      encounter?.phase === "chew"
    ) {
      caughtPointer = encounter.beak;
    }
    let grabbable = false;
    let interactiveHover = false;
    if (this.#tidyPoint) {
      grabbable =
        sim.canPickup() && contains(sim.pickupRect(), this.#tidyPoint);
      if (!this.#targeting) {
        const point = this.#tidyPoint;
        interactiveHover = sim.interactionRects().some((rect) => {
          return contains(rect, point);
        });
      }
    }
    this.#dependencies.view.update({
      visible: this.#visible,
      targeting: this.#targeting,
      purpose: this.#targetPurpose,
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
    sim.updatePickupClock(this.#dependencies.clock.wallNow());
    if (this.#drag.active && !sim.status().held) {
      this.#cancelDrag();
    }
    if (!this.#targeting || this.#targetPurpose === "tidy") {
      sim.step((now - this.#last) / 1000);
    }
    this.#last = now;
    this.#render();
    this.#syncPointer();
    let delay = 100;
    if (sim.status().animate) {
      delay = 33;
    }
    this.#timer = this.#dependencies.clock.schedule(() => {
      this.#tick();
    }, delay);
  }

  #wake(): void {
    if (!this.#running()) {
      return;
    }
    this.#dependencies.clock.cancel(this.#timer);
    this.#timer = undefined;
    this.#last = this.#dependencies.clock.now();
    this.#dependencies.simulation.setVisible(this.#visible);
    this.#syncPointer();
    if (!this.#visible) {
      this.#dependencies.audio.suspend();
      this.#render();
    } else {
      this.#tick();
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
      this.#targetMode(false);
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

  #targetMode(active: boolean, purpose = "poop"): void {
    if (active) {
      this.#cancelDrag();
      this.#targetPurpose = purpose;
    }
    this.#dependencies.clock.cancel(this.#targetTimer);
    this.#targetTimer = undefined;
    const generation = ++this.#targetGeneration;
    this.#targeting = active;
    if (!active) {
      this.#tidyPoint = null;
      this.#dependencies.simulation.tidyPointer(null);
    }
    this.#syncPointer();
    if (active) {
      let timeout = 12000;
      if (this.#targetPurpose === "tidy") {
        timeout = 30000;
      }
      this.#targetTimer = this.#dependencies.clock.schedule(() => {
        if (this.#running() && generation === this.#targetGeneration) {
          this.#cancel();
        }
      }, timeout);
    }
    this.#updateView();
  }

  #cancel(): void {
    if (!this.#running()) {
      return;
    }
    this.#cancelDrag();
    const wasTidying = this.#dependencies.simulation.status().tidying;
    this.#targetMode(false);
    if (wasTidying) {
      this.#dependencies.simulation.action("tidy_done");
    } else {
      this.#dependencies.simulation.action("cancel");
    }
    if (this.#visible) {
      this.#wake();
    }
    this.#cancelNativeTargeting();
  }

  #action(message: ActionMessage): void {
    if (!this.#running()) {
      return;
    }
    const sim = this.#dependencies.simulation;
    this.#caret.stop();
    this.#cancelDrag();
    if (message.action === "escape") {
      this.#cancel();
      return;
    }
    if (message.action === "target") {
      if (message.purpose === "tidy") {
        sim.action("tidy");
      } else {
        sim.action("cancel");
      }
      this.#targetMode(true, message.purpose);
      this.#wake();
      return;
    }
    if (message.action === "tidy_pick") {
      if (this.#targeting && this.#targetPurpose === "tidy") {
        sim.action(message.action, message.point);
        this.#render();
      }
      return;
    }
    if (message.action === "tidy_done" && !sim.status().tidying) {
      return;
    }
    if (message.action === "cancel_target") {
      if (sim.status().tidying) {
        sim.action("cancel");
      }
      this.#targetMode(false);
      this.#syncPointer();
      return;
    }
    this.#targetMode(false);
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
    if (!this.#targeting) {
      const rect = sim.pickupRect();
      if (sim.canPickup() && contains(rect, point)) {
        if (this.#drag.begin(event.pointerId, point, rect)) {
          event.preventDefault();
          this.#dependencies.browser.capture(event.pointerId);
          this.#render();
        }
      } else if (sim.directCleanupAt(point)) {
        sim.action("direct_pick", point);
        this.#render();
        this.#releaseInteraction();
      }
      return;
    }
    if (event.onBanner) {
      return;
    }
    const tidy = this.#targetPurpose === "tidy";
    if (!tidy) {
      this.#targetMode(false);
    }
    const generation = this.#targetGeneration;
    const lifecycleGeneration = this.#generation;
    const native = this.#dependencies.native;
    if (native) {
      native.invoke("target_picked", point).catch((error) => {
        if (
          !this.#current(lifecycleGeneration) ||
          generation !== this.#targetGeneration
        ) {
          return;
        }
        this.#dependencies.reportError(error);
        sim.action("cancel");
        this.#targetMode(false);
        this.#cancelNativeTargeting();
        this.#wake();
      });
    } else {
      let pickedAction = this.#targetPurpose;
      if (tidy) {
        pickedAction = "tidy_pick";
      }
      this.#action({ action: pickedAction, point });
    }
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
    if (this.#targeting && this.#targetPurpose === "tidy") {
      this.#tidyPoint = { x: event.x, y: event.y };
      this.#dependencies.simulation.tidyPointer(this.#tidyPoint);
      this.#render();
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
      this.#dependencies.simulation.releaseCursor("too slippery.");
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
    if (this.#visible && !this.#targeting) {
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
    if (
      this.#visible &&
      !this.#targeting &&
      !this.#drag.active &&
      this.#dependencies.simulation.status().watchTyping
    ) {
      this.#caret.start();
    } else {
      this.#caret.stop();
    }
    if (this.#visible && !this.#targeting) {
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
    if (!this.#visible || this.#targeting) {
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
    this.#caret.stop();
    this.#dependencies.simulation.caret(null);
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

  #cancelNativeTargeting(): void {
    const native = this.#dependencies.native;
    if (native) {
      this.#runNative(native.invoke("cancel_targeting"));
    }
  }

  #runNative(operation: Promise<unknown>): void {
    operation.catch((error) => {
      this.#dependencies.reportError(error);
    });
  }
}
