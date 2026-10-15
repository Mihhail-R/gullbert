import { catalog } from "./catalog.js";
import type { ActionName } from "./catalog.js";
import type { Point } from "../simulation/model.js";

interface Effects {
  replace(): void;
  visibility(visible: boolean): void;
  command(command: string, point?: Point): void;
  target(purpose: string, preparation: string): void;
  center(): Point;
  quit(): void;
}

/** Validate and perform immediate routing; Targeting and animations finish later. */
export function submitPreviewAction(name: string, effects: Effects): void {
  if (!Object.hasOwn(catalog, name)) {
    throw new Error(`Unknown action: ${name}`);
  }
  const action = catalog[name as ActionName];
  if (action.availability !== "all") {
    throw new Error(`Action unavailable in preview: ${name}`);
  }
  effects.replace();
  if (action.visibility === "show") {
    effects.visibility(true);
  } else if (action.visibility === "hide") {
    effects.visibility(false);
  }
  switch (action.route) {
    case "target":
      if ("purpose" in action && "preparation" in action) {
        effects.target(action.purpose, action.preparation);
      }
      return;
    case "pointer":
      if ("command" in action) {
        effects.command(action.command, effects.center());
      }
      return;
    case "command":
      if ("command" in action) {
        effects.command(action.command);
      }
      return;
    case "cursor":
      effects.command("eat_cursor");
      return;
    case "quit":
      effects.visibility(false);
      effects.quit();
      return;
  }
}
