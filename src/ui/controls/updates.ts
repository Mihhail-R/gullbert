import { invoke, native } from "../../platform/bridge.js";
import { requiredElement as $ } from "../dom.js";
import { UpdateController } from "./update-controller.js";

export async function setupUpdates() {
  if (!native) {
    return;
  }

  const panel = $<HTMLDetailsElement>("#updates");
  const check = $<HTMLButtonElement>("#update-check");
  const install = $<HTMLButtonElement>("#update-install");
  const beta = $<HTMLInputElement>("#update-beta");
  const status = $("#update-status");
  const notes = $("#update-notes");
  const progress = $<HTMLProgressElement>("#update-progress");
  panel.hidden = false;
  check.disabled = true;
  const controller = new UpdateController({
    check: (includeBeta) => {
      return invoke("check_update", { beta: includeBeta });
    },
    install: () => {
      return invoke("install_update");
    },
    render: (state) => {
      check.disabled = state.busy;
      beta.disabled = state.busy;
      install.hidden = !state.available;
      install.disabled = state.busy;
      status.textContent = state.status;
      notes.textContent = state.notes;
      notes.hidden = !state.notes;
      progress.hidden = !state.busy;
      progress.max = 1;

      if (state.progress === null) {
        progress.removeAttribute("value");
      } else {
        progress.value = state.progress;
      }
    },
  });

  try {
    const version = await invoke("app_version");
    $(".version").textContent = `v${version}`;
    beta.checked = version.includes("-");
    await native.event.listen("gullbert-update-progress", ({ payload }) => {
      controller.progress(
        payload.downloaded,
        payload.total,
        payload.installing,
      );
    });
    await native.event.listen("gullbert-open-updates", () => {
      for (const section of document.querySelectorAll<HTMLDetailsElement>(
        ".control-section",
      )) {
        section.open = section === panel;
      }

      panel.scrollIntoView({ block: "nearest" });
    });
    check.disabled = false;
    check.addEventListener("click", () => {
      void controller.check(beta.checked);
    });
    install.addEventListener("click", () => {
      void controller.install();
    });
    beta.addEventListener("change", () => {
      controller.reset();
    });
  } catch (error) {
    status.textContent = `Could not initialize updates: ${String(error)}`;
  }
}
