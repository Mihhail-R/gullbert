import type { PreviewMessage } from "../../platform/bridge.js";
import type { CaretSample, Point } from "../../simulation/model.js";
import type { PetPresentation } from "../../simulation/presentation.js";
import { requiredElement } from "../dom.js";
import type {
  ApplicationBrowser,
  ApplicationEvents,
  ApplicationPointerEvent,
  ApplicationView,
  ApplicationViewState,
} from "./application-contracts.js";
import { createPetRenderer } from "./pet-renderer.js";

export class PetBrowser implements ApplicationBrowser {
  constructor(
    private readonly window: Window,
    private readonly document: Document,
  ) {}

  caret(): CaretSample | null {
    const editor = this.document.getElementById("typing-demo");
    const selection = this.window.getSelection();
    if (
      !editor ||
      editor.hidden ||
      this.document.activeElement !== editor ||
      !selection?.isCollapsed ||
      !selection.rangeCount ||
      !editor.contains(selection.anchorNode)
    ) {
      return null;
    }
    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getClientRects()[0];
    if (!rect || rect.height <= 0) {
      return null;
    }
    return {
      x: rect.x,
      y: rect.y,
      height: rect.height,
      context: "playground-editor",
      position: String(selection.anchorOffset),
    };
  }

  size(): { width: number; height: number } {
    return { width: this.window.innerWidth, height: this.window.innerHeight };
  }

  listen<K extends keyof ApplicationEvents>(
    name: K,
    callback: (event: ApplicationEvents[K]) => void,
  ): () => void {
    let target: EventTarget = this.document;
    if (["blur", "resize", "message", "pagehide"].includes(name)) {
      target = this.window;
    } else if (name === "cancel") {
      target = requiredElement("#cancel", this.document);
    }
    let eventName: string = name;
    if (name === "cancel") {
      eventName = "click";
    }
    const listener = (event: Event) => {
      if (name === "message") {
        const message = event as MessageEvent<PreviewMessage>;
        if (
          message.origin !== this.window.location.origin ||
          message.source !== this.window.parent
        ) {
          return;
        }
        callback(message.data as ApplicationEvents[K]);
      } else if (name === "keydown") {
        callback((event as KeyboardEvent).key as ApplicationEvents[K]);
      } else if (name === "cancel") {
        event.stopPropagation();
        callback(undefined as ApplicationEvents[K]);
      } else if (name.startsWith("pointer") && name !== "pointerleave") {
        callback(
          this.pointerEvent(event as PointerEvent) as ApplicationEvents[K],
        );
      } else if (name === "lostpointercapture") {
        callback(
          this.pointerEvent(event as PointerEvent) as ApplicationEvents[K],
        );
      } else {
        callback(undefined as ApplicationEvents[K]);
      }
    };
    target.addEventListener(eventName, listener);
    return () => {
      target.removeEventListener(eventName, listener);
    };
  }

  capture(pointerId: number): void {
    this.document.documentElement.setPointerCapture(pointerId);
  }

  releaseCapture(pointerId: number): void {
    if (this.document.documentElement.hasPointerCapture(pointerId)) {
      this.document.documentElement.releasePointerCapture(pointerId);
    }
  }

  publish(message: PreviewMessage): void {
    if (this.window.parent !== this.window) {
      this.window.parent.postMessage(message, this.window.location.origin);
    }
  }

  private pointerEvent(event: PointerEvent): ApplicationPointerEvent {
    let onBanner = false;
    if (event.target instanceof Element) {
      onBanner = event.target.closest("#target-banner") !== null;
    }
    return {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      button: event.button,
      buttons: event.buttons,
      onBanner,
      preventDefault: () => {
        event.preventDefault();
      },
    };
  }
}

const targetDescriptions: Record<string, readonly [string, string]> = {
  tidy: [
    "Tidy up. Under protest.",
    "Click mess to remove it. Belongings stay put. Done or Esc finishes; 30 seconds maximum.",
  ],
  chip_toss: [
    "Aim an airborne chip.",
    "Click a landing spot. Gullbert will attempt a catch. Esc cancels.",
  ],
  poop: [
    "Pick a parking spot.",
    "Click anywhere to deliver a gift. Esc cancels.",
  ],
  place_bag: [
    "Pick a snack spot.",
    "Click anywhere to place a bag of chips. Esc cancels.",
  ],
  place_perch: [
    "Pick his favourite loitering spot.",
    "Click to choose where he likes to perch. Esc cancels.",
  ],
};

export class PetView implements ApplicationView {
  private readonly world: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly cancel: HTMLElement;
  private readonly caughtPointer: HTMLElement;
  private readonly draw: ReturnType<typeof createPetRenderer>;

  constructor(private readonly document: Document) {
    this.world = requiredElement("#world", document);
    this.banner = requiredElement("#target-banner", document);
    this.title = requiredElement("strong", this.banner);
    this.description = requiredElement("span", this.banner);
    this.cancel = requiredElement("#cancel", document);
    this.draw = createPetRenderer(this.world);
    this.caughtPointer = document.createElement("div");
    this.caughtPointer.id = "caught-pointer";
    this.caughtPointer.hidden = true;
    this.caughtPointer.setAttribute("aria-hidden", "true");
    this.world.append(this.caughtPointer);
  }

  render(presentation: PetPresentation): void {
    this.draw(presentation);
  }

  update(state: ApplicationViewState): void {
    const copy = targetDescriptions[state.purpose] ?? targetDescriptions.poop;
    this.title.textContent = copy[0];
    this.description.textContent = copy[1];
    if (state.purpose === "tidy") {
      this.cancel.textContent = "Done";
    } else {
      this.cancel.textContent = "Never mind";
    }
    this.world.hidden = !state.visible;
    this.banner.hidden = !state.targeting;
    const body = this.document.body;
    body.classList.toggle("sleeping", !state.visible);
    body.classList.toggle("targeting", state.targeting);
    body.classList.toggle(
      "tidying",
      state.targeting && state.purpose === "tidy",
    );
    body.classList.toggle("gull-dragging", state.dragging);
    body.classList.toggle("gull-grabbable", state.grabbable);
    body.classList.toggle("interactive-hover", state.interactiveHover);
    body.classList.toggle("cursor-caught", state.caughtPointer !== null);
    this.caughtPointer.hidden = state.caughtPointer === null;
    if (state.caughtPointer) {
      this.showCaughtPointer(state.caughtPointer);
    }
  }

  dispose(): void {
    this.draw.dispose();
    this.caughtPointer.remove();
    this.banner.hidden = true;
    this.world.hidden = true;
    this.document.body.classList.remove(
      "sleeping",
      "targeting",
      "tidying",
      "gull-dragging",
      "gull-grabbable",
      "interactive-hover",
      "cursor-caught",
    );
  }

  private showCaughtPointer(point: Point): void {
    this.caughtPointer.style.transform = `translate(${point.x}px, ${point.y}px) rotate(-20deg)`;
  }
}
