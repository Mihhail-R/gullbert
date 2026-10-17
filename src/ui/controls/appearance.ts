import { requiredElement } from "../dom.js";

type Theme = "light" | "dark";
type ThemePreference = Theme | "system";
const appearanceKey = "gullbert.appearance.v1";

function themePreference(value: string | null | undefined): ThemePreference {
  switch (value) {
    case "light":
    case "dark":
      return value;

    default:
      return "system";
  }
}

/** Appearance belongs to this webview, independent of the companion's settings schema. */
export function setupAppearance(): void {
  let preference: ThemePreference = "system";
  const systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");
  const frame = document.querySelector<HTMLIFrameElement>("iframe");
  const buttons = document.querySelectorAll<HTMLButtonElement>("button[data-theme]");
  const error = requiredElement("#theme-error");

  try {
    preference = themePreference(localStorage.getItem(appearanceKey));
  } catch {
    error.textContent = "Appearance storage is unavailable. Changes last for this visit.";
    error.hidden = false;
  }

  function applyTheme() {
    let theme: Theme;

    if (preference === "system") {
      theme = systemAppearance.matches ? "dark" : "light";
    } else {
      theme = preference;
    }

    document.body.dataset.theme = theme;

    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.theme === preference));
    }

    // The playground is a same-origin document. Never reach into another site's frame.
    if (frame?.contentDocument?.body) {
      frame.contentDocument.body.dataset.theme = theme;
    }
  }

  applyTheme();
  frame?.addEventListener("load", applyTheme);
  systemAppearance.addEventListener("change", applyTheme);

  for (const button of buttons) {
    button.addEventListener("click", () => {
      preference = themePreference(button.dataset.theme);
      applyTheme();

      try {
        localStorage.setItem(appearanceKey, preference);
        error.hidden = true;
      } catch {
        error.textContent = "Could not save appearance. This choice lasts for this visit.";
        error.hidden = false;
      }
    });
  }

  function receiveAppearanceChange(event: StorageEvent) {
    if (event.key !== appearanceKey && event.key !== null) {
      return;
    }

    preference = themePreference(event.newValue);
    applyTheme();
  }

  window.addEventListener("storage", receiveAppearanceChange);
  window.addEventListener("pagehide", () => {
    window.removeEventListener("storage", receiveAppearanceChange);
    systemAppearance.removeEventListener("change", applyTheme);
    frame?.removeEventListener("load", applyTheme);
  });
}
