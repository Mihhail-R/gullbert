import type { MemoryEpisode } from "../../simulation/model.js";
import { ITEMS, isCollectible } from "../../simulation/items.js";

const tricks: Record<string, string> = {
  come: "Come here",
  spin: "Spin",
  dead: "Play dead",
};
const activities: Record<string, string> = {
  cursor: "Investigated the pointer",
  snack: "Went looking for snacks",
  theft: "Investigated a chip bag",
  caper: "Got into a chip bag",
  perch: "Visited his favourite spot",
  cap: "Played with a bottle cap",
  bubbles: "Played with bubbles",
  bath: "Splashed in the birdbath",
  toss: "Chased a tossed chip",
  baguette: "Wrestled with a baguette",
  pretend_leave: "Threatened to move out",
  cursor_egg: "Nested over the pointer",
  municipal_gull: "Inspected the desktop roadworks",
  apology: "Offered a questionable apology",
  postcards: "Showed off his postcards",
  relocation: "Moved to a new spot",
};
export function memoryDescription(event: MemoryEpisode): string {
  const trick = tricks[event.detail] ?? event.detail;
  switch (event.kind) {
    case "trick":
      return `Performed ${trick}`;
    case "reward":
      return `Earned a chip for ${trick}`;
    case "meal":
      return "Ate a chip";
    case "scratch":
      return "Got a head scratch after playing";
    case "perch":
      return "Remembered a favourite spot";
    case "gift":
      if (isCollectible(event.detail)) {
        return `Brought home ${ITEMS[event.detail].name.toLowerCase()}`;
      }
      return "Brought home a treasure";
    case "visit":
      if (event.detail === "pigeon") {
        return "Met the pigeon";
      }
      return "Met the other gull";
    case "play":
      if (event.detail === "cap") {
        return "Finished cap football";
      }
      return "Caught a tossed chip";
    case "activity":
      return activities[event.detail] ?? "Explored the desktop";
  }
}

export function memoryLocation(event: MemoryEpisode): string {
  const { x, y, width, height } = event.location;
  let horizontal = "centre";
  if (x / width < 1 / 3) {
    horizontal = "left";
  } else if (x / width > 2 / 3) {
    horizontal = "right";
  }
  let vertical = "middle";
  if (y / height < 1 / 3) {
    vertical = "upper";
  } else if (y / height > 2 / 3) {
    vertical = "lower";
  }
  return `${vertical} ${horizontal} · ${Math.round(x)}, ${Math.round(y)}`;
}
