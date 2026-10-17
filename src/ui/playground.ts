import { setupAppearance } from "./controls/appearance.js";
import { requiredElement } from "./dom.js";
import type { PreviewMessage } from "../platform/bridge.js";
import type { Settings } from "../simulation/model.js";

const frame = requiredElement<HTMLIFrameElement>("iframe");
const mischief = requiredElement<HTMLSelectElement>("#preview-mischief");
const sound = requiredElement<HTMLInputElement>("#preview-sound");
setupAppearance();

function post(message: PreviewMessage) {
  frame.contentWindow?.postMessage(message, location.origin);
}

function sendSettings() {
  const settings: Settings = {
    paused: false,
    sound: sound.checked,
    mischief: Number(mischief.value),
    hat: "none",
  };
  post({ type: "settings", settings });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
  button.addEventListener("click", () => {
    post({ type: "action", action: button.dataset.action ?? "" });
  });
}

mischief.addEventListener("change", sendSettings);
sound.addEventListener("change", sendSettings);
requiredElement("#reset-preview")
  .addEventListener("click", () => {
    post({ type: "action", action: "cancel" });
    post({ type: "action", action: "clean" });
    post({ type: "action", action: "summon" });
  });

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    post({ type: "escape" });
  }
});

window.addEventListener("message", (event: MessageEvent<PreviewMessage>) => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) {
    return;
  }

  if (event.data?.type !== "ready") {
    return;
  }

  // Each visit starts an active bird, independent of desktop control-room preferences.
  sendSettings();
  post({ type: "visible", visible: true });
});
frame.src = "pet.html";
