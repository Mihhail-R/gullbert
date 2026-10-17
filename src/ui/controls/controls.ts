import { setupAppearance } from "./appearance.js";
import { setupNavigation } from "./navigation.js";
import { portraitPresentation } from "../../simulation/presentation.js";
import { memoryDescription, memoryLocation } from "./memory-view.js";
import type { ActionName } from "../../actions/catalog.js";
import { setupUpdates } from "./updates.js";
import { requiredElement } from "../dom.js";
import {
  native,
  invoke,
  type RoommateStatus,
  type PreviewMessage,
} from "../../platform/bridge.js";
import type { Memory, MemoryEpisode, Settings } from "../../simulation/model.js";
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
const settingInputs = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
  "#paused, #vision, #sound, #mischief, #hat",
);
setupAppearance();
setupNavigation();

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
    $("#status").textContent = "Away for a little while.";
  } else if (settings.paused) {
    $("#status").textContent = "Loitering. Judging. Waiting.";
  } else {
    $("#status").textContent = "On patrol. Hide your chips.";
  }

  const visibilityButton = $("#visibility-toggle");

  if (visible) {
    visibilityButton.dataset.action = "hide";
    visibilityButton.textContent = "Send him away";
    $("#status-dot").style.background = "var(--amber)";
  } else {
    visibilityButton.dataset.action = "show";
    visibilityButton.textContent = "Return / resume";
    $("#status-dot").style.background = "var(--muted)";
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

  $("#pause-label").textContent = settings.paused ? "Resume antics" : "Pause antics";
  $("#pause-toggle use")
    .setAttribute(
      "href",
      settings.paused ? "ui/icons.svg#play" : "ui/icons.svg#pause",
    );
  $("#mischief-label").textContent = ["Polite-ish", "Menace", "Public enemy"][settings.mischief];
  renderPortraits();
  $("#preferences-summary").textContent = [
    ["Polite-ish", "Menace", "Public enemy"][settings.mischief],
    pausedLabel,
    soundLabel,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderPortraits() {
  const portrait = portraitPresentation(settings);

  for (const bird of document.querySelectorAll<HTMLElement>(".portrait-bird")) {
    bird.style.backgroundPositionX = `${-portrait.frame * 96}px`;
    const hat = $<HTMLImageElement>(".portrait-hat", bird);
    const placement = portrait.hatPlacement;
    hat.hidden = !placement;

    if (placement) {
      hat.src = `assets/theatre/${placement.asset}.svg`;
      hat.style.left = `${placement.x}px`;
      hat.style.top = `${placement.y}px`;
      hat.style.width = `${placement.width}px`;
      hat.style.height = `${placement.height}px`;
    }
  }
}

function post(data: PreviewMessage) {
  frame.contentWindow?.postMessage(data, location.origin);
}
async function act(action: string) {
  error("");

  try {
    if (native) {
      await invoke("act", { action: action as ActionName });
    } else {
      post({ type: "action", action });
      frame.scrollIntoView?.({ block: "center" });
    }
  } catch (e) {
    error(String(e));
  }
}

for (const button of document.querySelectorAll<HTMLElement>("[data-action]")) {
  if (native && button.closest("#demo")) {
    continue;
  }

  button.addEventListener("click", () => {
    return act(button.dataset.action ?? "");
  });
}

async function save() {
  if (saving) {
    return;
  }

  saving = true;
  $<HTMLButtonElement>("#pause-toggle").disabled = true;
  const next = {
    paused: $<HTMLInputElement>("#paused").checked,
    vision: $<HTMLInputElement>("#vision").checked,
    sound: $<HTMLInputElement>("#sound").checked,
    mischief: Number($<HTMLSelectElement>("#mischief").value),
    hat: normalizeHat($<HTMLSelectElement>("#hat").value),
  };
  const enablingVision = next.vision && !settings.vision;

  for (const el of settingInputs) {
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
    $<HTMLButtonElement>("#pause-toggle").disabled = false;

    for (const el of settingInputs) {
      el.disabled = false;
    }

    render();
    void visionStatus();
  }
}

for (const el of settingInputs) {
  el.addEventListener("change", save);
}

$("#pause-toggle")
  .addEventListener("click", () => {
    $<HTMLInputElement>("#paused").checked = !settings.paused;
    void save();
  });

async function cancelPlacement() {
  try {
    if (native) {
      await invoke("cancel_targeting", {});
    } else {
      post({ type: "escape" });
    }
  } catch (cause) {
    error(String(cause));
  }
}
$("#cancel-placement")
  .addEventListener("click", cancelPlacement);

function roommate(data: RoommateStatus) {
  if (data.mood) {
    $("#mood").textContent = `Feeling ${data.mood}.`;
  } else {
    $("#mood").textContent = "Contentedly gull.";
  }

  const memory = data.memory;
  let knownTricks = 0;

  for (const trick of ["come", "spin", "dead"] as const) {
    const count = memory?.learned?.tricks[trick] ?? 0;
    let label = "New trick";

    if (count >= 6) {
      label = "Professional nuisance · 6/6";
    } else if (count >= 3) {
      label = `Learned · ${count}/6`;
    } else if (count > 0) {
      label = `Making the connection · ${count}/3`;
    }

    if (count >= 3) {
      knownTricks += 1;
    }

    const performed = memory?.performances?.[trick] ?? 0;

    if (performed > 0) {
      label += ` · ${performed} performed`;
    }

    if (performed > 0 && count === 0) {
      label = `${performed} performed · no chip rewards yet`;
    }

    $(`#lesson-${trick}`).textContent = label;
  }

  let summary = "Getting to know you";

  if (knownTricks === 1) {
    summary = "1 questionable trick learned";
  } else if (knownTricks > 1) {
    summary = `${knownTricks} questionable tricks learned`;
  }

  $("#learning-summary").textContent = summary;

  const meals = memory?.learned?.snackSpot?.meals ?? 0;
  let snack = "Feed him in the same spot a few times. He’ll remember.";

  if (meals >= 3) {
    snack =
      "Snack spot remembered. He’ll occasionally check the usual establishment.";
  } else if (meals > 0) {
    snack = `Noticing a snack spot · ${meals}/3 meals here.`;
  }

  $("#snack-ritual").textContent = snack;

  const scratches = memory?.learned?.scratchesAfterPlay ?? 0;
  let scratch =
    "Scratch his head after cap football or a chip toss to start a ritual.";

  if (scratches >= 3) {
    scratch =
      "After-play scratches remembered. He’ll present his head after a game.";
  } else if (scratches > 0) {
    scratch = `Learning your after-play ritual · ${scratches}/3 head scratches.`;
  }

  $("#scratch-ritual").textContent = scratch;

  renderMemories(memory?.episodes ?? []);
  renderCollection(memory?.collection ?? {});

  const perch = memory?.perch;
  $("#perch-summary").textContent = perch
    ? `Remembered · ${Math.round(perch.x)}, ${Math.round(perch.y)} on his desktop`
    : "Not chosen yet";
  const pigeonVisits = memory?.visits?.pigeon ?? 0;
  const gullVisits = memory?.visits?.gull ?? 0;
  $("#visitor-summary").textContent = pigeonVisits + gullVisits > 0
    ? `Visits remembered · Pigeon: ${pigeonVisits} · Other gull: ${gullVisits}`
    : "No familiar visitors yet.";

  const storageError = $("#storage-error");
  storageError.textContent = data.error ?? "";
  storageError.hidden = !data.error;
}

function renderMemories(episodes: readonly MemoryEpisode[]) {
  let memorySummary = "A fresh start";

  if (episodes.length === 1) {
    memorySummary = "1 recent memory";
  } else if (episodes.length > 1) {
    memorySummary = `${episodes.length} recent memories`;
  }

  $("#memory-summary").textContent = memorySummary;
  $("#memory-empty").hidden = episodes.length > 0;
  $("#memory-items")
    .replaceChildren(
      ...episodes
        .slice(-12)
        .reverse()
        .map((event) => {
          const listItem = document.createElement("li");
          const label = document.createElement("strong");
          const context = document.createElement("small");
          const time = document.createElement("time");

          label.textContent = memoryDescription(event);
          const date = new Date(event.at);
          time.dateTime = date.toISOString();
          time.textContent = date.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });

          context.append(time, ` · ${memoryLocation(event)}`);
          listItem.append(label, context);
          return listItem;
        }),
    );
  $("#today-memory-empty").hidden = episodes.length > 0;
  const recentRows = Array.from($("#memory-items").children)
    .slice(0, 3)
    .map((row) => {
      return row.cloneNode(true)
    });
  $("#today-memories")
    .replaceChildren(...recentRows);
}

function renderCollection(collection: Memory["collection"]) {
  const entries = Object.entries(collection)
    .filter(
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
  $("#collection-items")
    .replaceChildren(
      ...entries.map(([id, count]) => {
        const item = ITEMS[id];
        const listItem = document.createElement("li");
        const image = document.createElement("img");
        const label = document.createElement("strong");
        const description = document.createElement("small");
        const quantity = document.createElement("span");

        image.src = `assets/belongings/${id}.svg`;
        image.alt = "";
        label.textContent = item.name;
        description.textContent = item.description;
        label.append(description);
        quantity.textContent = `×${count}`;

        listItem.append(image, label, quantity);
        return listItem;
      }),
    );
  $("#today-collection-empty").hidden = entries.length > 0;
  const shelfItems = Array.from($("#collection-items").children)
    .slice(0, 3)
    .map((row) => {
      return row.cloneNode(true)
    });
  $("#today-collection")
    .replaceChildren(...shelfItems);
}

if (native) {
  let targetId: number | null = null;
  await native.event.listen("gullbert-target", ({ payload }) => {
    if (payload.outcome === "started") {
      targetId = payload.id;
      $("#placement-notice").hidden = false;
      $("#placement-status").textContent = payload.purpose === "tidy"
        ? "Click loose mess on your desktop. Escape finishes tidying."
        : "Choose a spot on your desktop. Escape cancels.";
      $("#cancel-placement").textContent = payload.purpose === "tidy" ? "Done" : "Never mind";
      return;
    }

    if (payload.id !== targetId) {
      return;
    }

    targetId = null;
    $("#placement-notice").hidden = true;
  });
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
        "A shortcut is already in use. You can still use the tray and control room.",
      );
    }
  } catch (e) {
    error(String(e));
  }
} else {
  document.body.classList.add("preview");
  $("#demo").hidden = false;
  $("#reset-preview")
    .addEventListener("click", () => {
      post({ type: "action", action: "cancel" });
      post({ type: "action", action: "clean" });
      post({ type: "action", action: "summon" });
    });

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

    if (e.data.type === "visible") {
      visible = e.data.visible;
      render();
    }

    if (e.data.type === "preview-quit") {
      error("Preview: in the installed app, this quits Gullbert.");
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

  void cancelPlacement();
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
        "Allow Gullbert in System Settings → Privacy & Security → Accessibility. " +
        "No screen recording needed.";
    } else {
      label.textContent = "Caret sensing is unavailable on this platform.";
    }
  } catch {
    label.textContent = "Could not check caret access.";
  }
}
$("#caret-access")
  .addEventListener("click", () => {
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
        "Local vision needs macOS 14+ or Windows 10 version 2004+. Caret sensing " +
        "is still available.",
      off: "Vision is off. Enable it to hunt visible words, including chat messages.",
      permission:
        "Allow Gullbert in System Settings → Privacy & Security → Screen & " +
        "System Audio Recording, then restart him if macOS asks.",
      paused: "Vision is paused while hidden, paused, or Polite-ish.",
      waiting: "Waiting to look. Point near some text on Gullbert’s display.",
      scanning: "Looking for nearby words…",
      text_found:
        "Text spotted! He’ll investigate when free. Move the mouse away once he approaches.",
      no_text: "No text spotted near the mouse. Try pointing beside a word.",
      failed:
        "Screen capture or local OCR failed. Protected screens may be " +
        "unavailable; Gullbert will retry.",
    };
    label.textContent = messages[status.state] ?? "Waiting for vision status.";
  } catch {
    label.textContent = "Could not read vision status.";
  }
}
$("#vision-access")
  .addEventListener("click", () => {
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

setupUpdates();
