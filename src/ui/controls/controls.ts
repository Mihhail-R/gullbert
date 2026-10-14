import { requiredElement } from "../dom.js";
import {
  native,
  invoke,
  type RoommateStatus,
  type PreviewMessage,
} from "../../platform/bridge.js";
import type { Settings } from "../../simulation/model.js";
import {
  ITEMS,
  isCollectible,
  type Collectible,
} from "../../simulation/items.js";
import { normalizeHat } from "../../simulation/behaviors/hats.js";

let settings: Settings = {
  paused: false,
  sound: false,
  mischief: 1,
  hat: "none",
};
let visible = true;
let saving = false;
const preferencesKey = "gullbert.preferences.v1";
const $ = requiredElement;
const frame = $<HTMLIFrameElement>("iframe");
function error(message: string) {
  $("#error").textContent = message;
  $("#error").hidden = !message;
}
function render() {
  $<HTMLInputElement>("#paused").checked = settings.paused;
  $<HTMLInputElement>("#vision").checked = settings.vision === true;
  $<HTMLInputElement>("#sound").checked = settings.sound;
  $<HTMLSelectElement>("#mischief").value = String(settings.mischief);
  $<HTMLSelectElement>("#hat").value = normalizeHat(settings.hat);
  if (!visible) {
    $("#status").textContent = "Off causing problems elsewhere";
  } else if (settings.paused) {
    $("#status").textContent = "Loitering. Judging. Waiting.";
  } else {
    $("#status").textContent = "On patrol. Hide your chips.";
  }
  const visibilityButton = $("#visibility-toggle");
  if (visible) {
    visibilityButton.dataset.action = "hide";
    visibilityButton.textContent = "Send him away";
    $("#status-dot").style.background = "#637b60";
  } else {
    visibilityButton.dataset.action = "show";
    visibilityButton.textContent = "Return / resume";
    $("#status-dot").style.background = "#b2b7ac";
  }
  let pausedLabel;
  if (settings.paused) {
    pausedLabel = "Paused";
  } else {
    pausedLabel = "";
  }
  let soundLabel;
  if (settings.sound) {
    soundLabel = "Sound on";
  } else {
    soundLabel = "Sound off";
  }
  $("#preferences-summary").textContent = [
    ["Polite-ish", "Menace", "Public enemy"][settings.mischief],
    pausedLabel,
    soundLabel,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Keep one category open, including on older webviews without details[name].
const sections =
  document.querySelectorAll<HTMLDetailsElement>(".control-section");
for (const section of sections) {
  section.querySelector("summary")?.addEventListener("click", () => {
    if (section.open) {
      return;
    }
    for (const other of sections) {
      if (other !== section) {
        other.open = false;
      }
    }
  });
}
function post(data: PreviewMessage) {
  frame.contentWindow?.postMessage(data, location.origin);
}
async function act(action: string) {
  error("");
  try {
    if (native) {
      await invoke("act", { action });
    } else {
      if (action === "quit") {
        visible = false;
        post({ type: "visible", visible });
        error("Preview: in the installed app, this quits Gullbert.");
      } else if (action === "hide" || action === "show") {
        visible = action === "show";
        post({ type: "visible", visible });
      } else {
        if (action !== "clean" && action !== "cancel") {
          visible = true;
          post({ type: "visible", visible });
        }
        if (
          ["place_bag", "place_perch", "chip_toss", "tidy"].includes(action)
        ) {
          post({ type: "action", action: "target", purpose: action });
        } else {
          post({ type: "action", action });
        }
      }
      render();
    }
  } catch (e) {
    error(String(e));
  }
}
for (const button of document.querySelectorAll<HTMLElement>("[data-action]")) {
  button.addEventListener("click", () => {
    return act(button.dataset.action ?? "");
  });
}
async function save() {
  if (saving) {
    return;
  }
  saving = true;
  const next = {
    paused: $<HTMLInputElement>("#paused").checked,
    vision: $<HTMLInputElement>("#vision").checked,
    sound: $<HTMLInputElement>("#sound").checked,
    mischief: Number($<HTMLSelectElement>("#mischief").value),
    hat: normalizeHat($<HTMLSelectElement>("#hat").value),
  };
  const enablingVision = next.vision && !settings.vision;
  for (const el of document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement
  >("select,input")) {
    el.disabled = true;
  }
  try {
    if (native) {
      await invoke("update_settings", { settings: next });
      if (enablingVision) {
        await visionStatus(true);
      }
    } else {
      localStorage.setItem(preferencesKey, JSON.stringify(next));
      post({ type: "settings", settings: next });
    }
    settings = next;
    error("");
  } catch (e) {
    error(`Could not save preferences: ${e}`);
  } finally {
    saving = false;
    for (const el of document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("select,input")) {
      el.disabled = false;
    }
    render();
    void visionStatus();
  }
}
for (const el of document.querySelectorAll<
  HTMLInputElement | HTMLSelectElement
>("select,input")) {
  el.addEventListener("change", save);
}
function roommate(data: RoommateStatus) {
  if (data.mood) {
    $("#mood").textContent = `Feeling ${data.mood}.`;
  } else {
    $("#mood").textContent = "Contentedly gull.";
  }
  const memory = data.memory;
  const entries = Object.entries(memory?.collection ?? {}).filter(
    (entry): entry is [Collectible, number] => {
      return isCollectible(entry[0]) && entry[1] > 0;
    },
  );
  const count = entries.reduce((sum, [, count]) => {
    return sum + count;
  }, 0);
  $("#collection-count").textContent = String(count);
  if (count) {
    $("#belongings-summary").textContent = `${count} collected`;
  } else {
    $("#belongings-summary").textContent = "No treasures yet";
  }
  $("#collection-empty").hidden = entries.length > 0;
  $("#collection-items").replaceChildren(
    ...entries.map(([id, count]) => {
      const item = ITEMS[id];
      const li = document.createElement("li");
      const img = document.createElement("img");
      const label = document.createElement("strong");
      const description = document.createElement("small");
      const quantity = document.createElement("span");
      img.src = `assets/belongings/${id}.svg`;
      img.alt = "";
      label.textContent = item.name;
      description.textContent = item.description;
      label.append(description);
      quantity.textContent = `×${count}`;
      li.append(img, label, quantity);
      return li;
    }),
  );
  const storageError = $("#storage-error");
  storageError.textContent = data.error ?? "";
  storageError.hidden = !data.error;
}
if (native) {
  await native.event.listen("gullbert-roommate", (e) => {
    return roommate(e.payload);
  });
  await invoke("request_roommate");
  await native.event.listen("gullbert-settings", (e) => {
    settings = e.payload;
    render();
  });
  await native.event.listen("gullbert-visible", (e) => {
    visible = e.payload;
    render();
  });
  try {
    const s = await invoke("snapshot");
    settings = s.settings;
    visible = s.visible;
    if (s.shortcut_errors.length) {
      error(
        "A shortcut is already in use. All actions are still available here and in the tray.",
      );
    }
  } catch (e) {
    error(String(e));
  }
} else {
  document.body.classList.add("preview");
  $("#demo").hidden = false;
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? "null");
    if (saved && typeof saved === "object") {
      let mischief;
      if ([0, 1, 2].includes(saved.mischief)) {
        mischief = saved.mischief;
      } else {
        mischief = 1;
      }
      settings = {
        paused: saved.paused === true,
        sound: saved.sound === true,
        mischief: mischief,
        hat: normalizeHat(saved.hat),
      };
    }
  } catch {
    /* Missing or invalid preferences use the defaults. */
  }
  window.addEventListener("message", (e: MessageEvent<PreviewMessage>) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) {
      return;
    }
    if (e.data.type === "roommate") {
      roommate(e.data);
    }
    if (e.data.type === "ready") {
      post({ type: "settings", settings });
      post({ type: "visible", visible });
    }
  });
  frame.src = "pet.html";
}
render();

// The playground's controls retain focus after a button click. Escape works here too.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }
  if (native) {
    invoke("cancel_targeting").catch((e) => {
      return error(String(e));
    });
  } else {
    post({ type: "action", action: "escape" });
  }
});

async function caretAccess(prompt = false): Promise<void> {
  const label = $("#caret-status");
  const button = $<HTMLButtonElement>("#caret-access");
  if (!native) {
    label.textContent = "Try typing in the playground. Your text stays intact.";
    return;
  }
  try {
    const access = await invoke("caret_access", { prompt });
    button.hidden = access.available || access.platform !== "macos";
    if (access.available) {
      label.textContent =
        "Ready in supported text fields. Polite-ish switches it off.";
    } else if (access.platform === "macos") {
      label.textContent =
        "Allow Gullbert in System Settings → Privacy & Security → Accessibility. No screen recording needed.";
    } else {
      label.textContent = "Caret sensing is unavailable on this platform.";
    }
  } catch {
    label.textContent = "Could not check caret access.";
  }
}
$("#caret-access").addEventListener("click", () => {
  void caretAccess(true);
});
window.addEventListener("focus", () => {
  void caretAccess();
});
void caretAccess();

async function visionStatus(prompt = false): Promise<void> {
  const label = $("#vision-status");
  const button = $("#vision-access");
  const toggle = $<HTMLInputElement>("#vision");
  $("#vision-setting").hidden = !native;
  if (!native) {
    return;
  }
  label.hidden = false;
  try {
    const status = await invoke("vision_status", { prompt });
    toggle.disabled = !status.supported || saving;
    button.hidden = !status.supported || status.granted || !settings.vision;
    const messages: Record<string, string> = {
      unsupported:
        "Local vision needs macOS 14 or newer. Caret sensing is still available.",
      off: "Vision is off. Enable it to hunt visible words, including chat messages.",
      permission:
        "Allow Gullbert in System Settings → Privacy & Security → Screen & System Audio Recording, then restart him if macOS asks.",
      paused: "Vision is paused while hidden, paused, or Polite-ish.",
      waiting: "Waiting to look. Point near some text on Gullbert’s display.",
      scanning: "Looking for nearby words…",
      text_found:
        "Text spotted! He’ll investigate when free. Move the mouse away once he approaches.",
      no_text: "No text spotted near the mouse. Try pointing beside a word.",
      failed:
        "Screen reading did not finish. Check screen access; Gullbert will retry.",
    };
    label.textContent = messages[status.state] ?? "Waiting for vision status.";
  } catch {
    label.textContent = "Could not read vision status.";
  }
}
$("#vision-access").addEventListener("click", () => {
  void visionStatus(true);
});
window.addEventListener("focus", () => {
  void visionStatus();
});
const visionStatusTimer = window.setInterval(() => {
  if (!document.hidden) {
    void visionStatus();
  }
}, 1500);
window.addEventListener("pagehide", () => {
  clearInterval(visionStatusTimer);
});
void visionStatus();
