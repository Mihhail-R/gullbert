import type { PetPresentation } from "../../simulation/presentation.js";

/** Persistent scenery sits below the bird and never intercepts desktop input. */
export function createNestRenderer(world: HTMLElement) {
  const root = document.createElement("div");
  root.id = "rubbish-nest";
  root.setAttribute("aria-hidden", "true");
  const bed = document.createElement("img");
  bed.src = "assets/belongings/nest.svg";
  bed.alt = "";
  bed.className = "nest-bed";
  const treasures = Array.from({ length: 3 }, (_, index) => {
    const image = document.createElement("img");
    image.className = `nest-treasure nest-slot-${index}`;
    image.alt = "";
    return image;
  });
  root.append(bed, ...treasures);
  world.prepend(root);

  function render(
    nest: PetPresentation["nest"],
    arranging: boolean,
    borrowedSlot: number | null = null,
  ) {
    root.hidden = !nest;
    root.classList.toggle("arranging", arranging);

    if (!nest) {
      return;
    }

    root.style.left = `${nest.x}px`;
    root.style.top = `${nest.y + 62}px`;

    for (const [index, image] of treasures.entries()) {
      const item = nest.items[index];
      image.hidden = !item || index === borrowedSlot;

      if (item && image.dataset.item !== item) {
        image.src = `assets/belongings/${item}.svg`;
        image.dataset.item = item;
      }
    }
  }

  return Object.assign(render, { dispose: () => root.remove() });
}
