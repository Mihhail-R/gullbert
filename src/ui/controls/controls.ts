import { setupAppearance } from "./appearance.js";
import { setupNavigation } from "./navigation.js";
import { portraitPresentation } from "../../simulation/presentation.js";
import { memoryDescription, memoryLocation } from "./memory-view.js";
import { favouriteTreasure, normalizePreferences } from "../../simulation/preferences.js";
import type { ActionName } from "../../actions/catalog.js";
import { setupUpdates } from "./updates.js";
import { requiredElement } from "../dom.js";
import {
  native,
  invoke,
  type RoommateStatus,
  type PreviewMessage,
  type TargetNotice,
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
  "#paused, #sound, #mischief, #hat",
);
setupAppearance();
setupNavigation();

function error(message: string) {
  $("#error").textContent = message;
  $("#error").hidden = !message;
}
function render() {
  $<HTMLInputElement>("#paused").checked = settings.paused;
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
    sound: $<HTMLInputElement>("#sound").checked,
    mischief: Number($<HTMLSelectElement>("#mischief").value),
    hat: normalizeHat($<HTMLSelectElement>("#hat").value),
  };

  for (const el of settingInputs) {
    el.disabled = true;
  }

  try {
    if (native) {
      await invoke("update_settings", { settings: next });
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
      label = "Practiced · 6/6";
    } else if (count >= 3) {
      label = `Learned · ${count}/6`;
    } else if (count > 0) {
      label = `Learning · ${count}/3`;
    }

    if (count >= 3) {
      knownTricks += 1;
    }

    const performed = memory?.performances?.[trick] ?? 0;

    if (performed > 0) {
      label += ` · ${performed} performed`;
    }

    if (performed > 0 && count === 0) {
      label = `${performed} performed · unrewarded`;
    }

    $(`#lesson-${trick}`).textContent = label;
  }

  let summary = "No tricks learned yet";

  if (knownTricks === 1) {
    summary = "1 trick learned";
  } else if (knownTricks > 1) {
    summary = `${knownTricks} tricks learned`;
  }

  $("#learning-summary").textContent = summary;

  const meals = memory?.learned?.snackSpot?.meals ?? 0;
  let snack = "Feed him in one spot 3 times to teach a snack stop.";

  if (meals >= 3) {
    snack = "Snack spot learned. He’ll return for food.";
  } else if (meals > 0) {
    snack = `Learning a snack spot · ${meals}/3 meals here.`;
  }

  $("#snack-ritual").textContent = snack;

  const scratches = memory?.learned?.scratchesAfterPlay ?? 0;
  let scratch = "Scratch his head after games 3 times to start a ritual.";

  if (scratches >= 3) {
    scratch = "Scratch ritual learned. He’ll ask after games.";
  } else if (scratches > 0) {
    scratch = `Learning a scratch ritual · ${scratches}/3 head scratches.`;
  }

  $("#scratch-ritual").textContent = scratch;

  renderMemories(memory?.episodes ?? []);
  const preferences = normalizePreferences(memory?.preferences);
  const favourite = favouriteTreasure(
    preferences,
    memory?.collection ?? {},
  );
  renderCollection(memory?.collection ?? {}, favourite);

  let hangout = "Still exploring for a spot of his own.";

  if (preferences.hangout) {
    hangout = "Getting to know a spot he found himself.";

    if (preferences.hangout.visits >= 3) {
      hangout = "He’s settled on his own favourite hangout.";
    }
  }

  $("#hangout-summary").textContent = hangout;
  const nest = memory?.nest;
  $("#nest-summary").textContent = nest
    ? `${nest.items.length} of 3 treasures on display`
    : "A little home for his questionable treasures.";
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
  let memorySummary = "No memories yet";

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

function renderCollection(collection: Memory["collection"], favourite: Collectible | null) {
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
        description.textContent = id === favourite ? "Gullbert’s favourite" : item.description;
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
  let target: { id: number; purpose: string } | null = null;
  await native.event.listen("gullbert-shutdown-error", ({ payload }) => {
    error(payload);
  });
  await native.event.listen("gullbert-target", ({ payload }: { payload: TargetNotice }) => {
    if (payload.outcome === "started") {
      target = { id: payload.id, purpose: payload.purpose };
      $("#placement-notice").hidden = false;
      $("#placement-status").textContent = payload.purpose === "tidy"
        ? "Click loose mess on your desktop. Escape finishes tidying."
        : "Choose a spot on your desktop. Escape cancels.";
      $("#cancel-placement").textContent = payload.purpose === "tidy" ? "Done" : "Never mind";
      return;
    }

    if (!target || payload.id !== target.id) {
      return;
    }

    if (payload.outcome === "selected" && target.purpose === "tidy") {
      return;
    }

    target = null;
    $("#placement-notice").hidden = true;
  });
  await native.event.listen("gullbert-roommate", (e) => {
    return roommate(e.payload);
  });
  await invoke("request_roommate");
  let receivedSettings = false;
  let receivedVisibility = false;
  await native.event.listen("gullbert-settings", (event) => {
    receivedSettings = true;
    settings = event.payload;
    render();
  });
  await native.event.listen("gullbert-visible", (event) => {
    receivedVisibility = true;
    visible = event.payload;
    render();
  });

  try {
    const snapshot = await invoke("snapshot");

    // The snapshot is a startup baseline; delivered events take precedence.
    if (!receivedSettings) {
      settings = snapshot.settings;
    }

    if (!receivedVisibility) {
      visible = snapshot.visible;
    }

    if (snapshot.shortcut_errors.length) {
      error(
        "A shortcut is already in use. You can still use the tray and control room.",
      );
    }
  } catch (e) {
    error(String(e));
  }
} else {
  document.documentElement.classList.add("preview");
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

  window.addEventListener("message", (event: MessageEvent<PreviewMessage>) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) {
      return;
    }

    switch (event.data.type) {
      case "roommate":
        roommate(event.data);
        break;

      case "visible":
        visible = event.data.visible;
        render();
        break;

      case "preview-quit":
        error("Preview: in the installed app, this quits Gullbert.");
        break;

      case "ready":
        post({ type: "settings", settings });
        post({ type: "visible", visible });
        break;
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

setupUpdates();
