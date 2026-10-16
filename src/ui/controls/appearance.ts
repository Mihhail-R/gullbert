import { requiredElement } from "../dom.js";

type Theme = "light" | "dark";
const appearanceKey = "gullbert.appearance.v1";

/** Appearance belongs to this webview, independent of the companion's settings schema. */
export function setupAppearance(): void {
  let theme: Theme = "light";
  const frame = document.querySelector<HTMLIFrameElement>("iframe");
  const buttons = document.querySelectorAll<HTMLButtonElement>("button[data-theme]");
  const error = requiredElement("#theme-error");

  try {
    if (localStorage.getItem(appearanceKey) === "dark") {
      theme = "dark";
    }
  } catch {
    error.textContent = "Appearance storage is unavailable. Changes last for this visit.";
    error.hidden = false;
  }

  const apply = () => {
    document.body.dataset.theme = theme;

    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
    }

    // The playground is a same-origin document. Never reach into another site's frame.
    if (frame?.contentDocument?.body) {
      frame.contentDocument.body.dataset.theme = theme;
    }
  };
  apply();
  frame?.addEventListener("load", apply);

  for (const button of buttons) {
    button.addEventListener("click", () => {
      theme = button.dataset.theme === "dark" ? "dark" : "light";
      apply();

      try {
        localStorage.setItem(appearanceKey, theme);
        error.hidden = true;
      } catch {
        error.textContent = "Could not save appearance. This choice lasts for this visit.";
        error.hidden = false;
      }
    });
  }

  const receive = (event: StorageEvent) => {
    if (event.key !== appearanceKey) {
      return;
    }

    theme = event.newValue === "dark" ? "dark" : "light";
    apply();
  };
  window.addEventListener("storage", receive);
  window.addEventListener("pagehide", () => {
    window.removeEventListener("storage", receive);
    frame?.removeEventListener("load", apply);
  });
}
