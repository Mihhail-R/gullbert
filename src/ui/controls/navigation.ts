import { requiredElement } from "../dom.js";

type Page = "today" | "play" | "world" | "settings";
type WorldPage = "memories" | "treasures" | "wardrobe" | "rituals";

export function showPage(page: Page, focus = true): void {
  for (const section of document.querySelectorAll<HTMLElement>("[data-destination]")) {
    section.hidden = section.dataset.destination !== page;
  }

  for (const button of document.querySelectorAll<HTMLElement>(".sidebar [data-page]")) {
    if (button.dataset.page === page) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }

  requiredElement("#pages").scrollTop = 0;

  if (focus) {
    requiredElement(`[data-destination="${page}"] h1`)
      .focus();
  }
}

function showWorld(page: WorldPage): void {
  for (const section of document.querySelectorAll<HTMLElement>("[data-world-panel]")) {
    section.hidden = section.dataset.worldPanel !== page;
  }

  for (const button of document.querySelectorAll<HTMLElement>(".subnav [data-world]")) {
    if (button.dataset.world === page) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }
}

export function setupNavigation(): void {
  for (const button of document.querySelectorAll<HTMLElement>("[data-page], [data-world]")) {
    button.addEventListener("click", () => {
      if (button.dataset.page) {
        showPage(button.dataset.page as Page);
      }

      if (button.dataset.world) {
        showWorld(button.dataset.world as WorldPage);
      }
    });
  }

  const date = requiredElement<HTMLTimeElement>("#journal-date");
  function updateDate() {
    const now = new Date();
    date.dateTime = now.toISOString();
    date.textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  updateDate();
  window.addEventListener("focus", updateDate);
  const dateTimer = window.setInterval(updateDate, 60_000);
  window.addEventListener("pagehide", () => {
    window.clearInterval(dateTimer);
    window.removeEventListener("focus", updateDate);
  });
}
