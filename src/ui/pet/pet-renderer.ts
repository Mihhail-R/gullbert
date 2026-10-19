import { runoffMarkup } from "./splat-art.js";
import { splatBounds } from "../../simulation/props.js";
import type { PetPresentation } from "../../simulation/presentation.js";
import { clamp } from "../../simulation/geometry.js";
import type { Item } from "../../simulation/items.js";
import { requiredElement, updateText } from "../dom.js";
import { createTheatreRenderer } from "./theatre-renderer.js";

// Rendering projects simulation state into the DOM. It never advances time,
// persists data, requests native input, or emits sound.
export function createPetRenderer(world: HTMLElement) {
  const gull = requiredElement("#gull");
  const sprite = requiredElement(".sprite");
  const bird = requiredElement("#bird");
  const speech = requiredElement("#speech");
  const crumb = requiredElement("#crumb");
  const splats = requiredElement("#splats");
  const hitLayer = document.createElement("div");
  hitLayer.id = "interaction-regions";
  const hitNodes: HTMLElement[] = [];
  world.append(hitLayer);
  const rubbishNodes = new Map<number, HTMLElement>();
  const carriedRubbish = document.createElement("div");
  carriedRubbish.className = "rubbish-bag";
  carriedRubbish.hidden = true;
  gull.append(carriedRubbish);
  const nodes = new Map<number, HTMLElement>();
  const cones = new Map<number, HTMLImageElement>();
  const chips = new Map<number, HTMLImageElement>();
  const chipLayer = document.createElement("div");
  chipLayer.id = "loose-chips";
  const coneLayer = document.createElement("div");
  coneLayer.id = "municipal-cones";
  const highlight = document.createElement("div");
  highlight.id = "tidy-highlight";
  highlight.hidden = true;
  world.append(chipLayer, coneLayer, highlight);
  const bag = document.createElement("div");
  bag.id = "chip-bag";
  bag.hidden = true;
  world.prepend(bag);
  const renderTheatre = createTheatreRenderer(world, gull, sprite);
  const perch = document.createElement("div");
  const carried = document.createElement("img");
  perch.id = "perch-spot";
  carried.id = "carried-treasure";
  carried.className = "treasure-prop";
  carried.alt = "";
  world.prepend(perch);
  gull.append(carried);
  function prop(node: HTMLImageElement, item: Item | null | undefined) {
    node.hidden = !item;

    if (item && node.dataset.item !== item) {
      node.dataset.item = item;
      node.src = `assets/belongings/${item}.svg`;
    }
  }
  function renderBelongings(sim: PetPresentation) {
    const spot = sim.perch;
    perch.hidden = !spot;

    if (spot) {
      perch.style.left = `${spot.x + 33}px`;
      perch.style.top = `${spot.y + 84}px`;
    }

    prop(carried, sim.carriedItem);
    let carriedItemX;

    if (sim.facing === 1) {
      carriedItemX = 69;
    } else {
      carriedItemX = 3;
    }

    carried.style.left = `${carriedItemX}px`;
    gull.hidden = sim.gullHidden;
    gull.dataset.mood = sim.mood;
  }
  function render(sim: PetPresentation) {
    const hits = sim.hitRegions;

    while (hitNodes.length > hits.length) {
      hitNodes.pop()!.remove();
    }

    hits.forEach((rect, index) => {
      let node = hitNodes[index];

      if (!node) {
        node = document.createElement("div");
        hitNodes.push(node);
        hitLayer.append(node);
      }

      Object.assign(node.style, {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    });
    renderBelongings(sim);
    const visualX = Math.round(sim.x + sim.visualOffset.x);
    gull.style.transform = `translate(${visualX}px,${Math.round(sim.y)}px)`;
    gull.style.opacity = String(sim.visualOffset.opacity);
    gull.className = sim.mode;
    gull.dataset.pose = sim.pose;
    gull.dataset.affection = sim.affection.kind;
    gull.dataset.fluff = String(sim.affection.fluff);
    bird.style.setProperty("--affection-x", `${sim.affection.x}px`);
    bird.style.setProperty("--affection-y", `${sim.affection.y}px`);
    bird.style.setProperty("--routine-rotation", `${sim.rotation}deg`);
    // Match the raised-step head position used by hatPlacement.
    let stepOffsetY;

    if (sim.pose === "walkLeft") {
      stepOffsetY = -3;
    } else {
      stepOffsetY = 0;
    }

    sprite.style.transform = `translateY(${stepOffsetY}px) scaleX(${sim.facing})`;
    renderTheatre(sim);
    updateText(speech, sim.bubble);
    speech.style.left = `${clamp(48, 95 - visualX, sim.width - visualX - 95)}px`;

    if (sim.y < 80) {
      speech.style.bottom = "-40px";
    } else if (sim.hat === "none") {
      speech.style.bottom = "86px";
    } else {
      speech.style.bottom = "112px";
    }

    if (sim.crumb) {
      crumb.style.display = "block";
      crumb.style.left = `${Math.round(sim.crumb.x)}px`;
      crumb.style.top = `${Math.round(sim.crumb.y)}px`;
    } else {
      crumb.style.display = "none";
    }

    bag.hidden = sim.bagHidden;
    gull.dataset.pickups = String(sim.pickupCount);
    carriedRubbish.hidden = !sim.carryingRubbish;
    let carriedRubbishX;

    if (sim.facing === 1) {
      carriedRubbishX = 62;
    } else {
      carriedRubbishX = -14;
    }

    carriedRubbish.style.left = `${carriedRubbishX}px`;
    carriedRubbish.style.top = "45px";
    const liveRubbish = new Set(
      sim.rubbish.map((item) => {
        return item.id;
      }),
    );

    for (const [id, node] of rubbishNodes) {
      if (!liveRubbish.has(id)) {
        node.remove();
        rubbishNodes.delete(id);
      }
    }

    for (const item of sim.rubbish) {
      let node = rubbishNodes.get(item.id);

      if (!node) {
        node = document.createElement("div");
        node.className = "rubbish-bag loose-rubbish";
        world.append(node);
        rubbishNodes.set(item.id, node);
      }

      node.style.left = `${item.x}px`;
      node.style.top = `${item.y}px`;
    }

    gull.dataset.phase = sim.phase;

    if (sim.bag) {
      bag.style.left = `${Math.round(sim.bag.x)}px`;
      bag.style.top = `${Math.round(sim.bag.y)}px`;
      bag.classList.toggle("empty", sim.bag.servings === 0);
      bag.classList.toggle("attached", sim.bag.attached);

      if (sim.bag.servings) {
        let servingLabel;

        if (sim.bag.servings === 1) {
          servingLabel = "chip";
        } else {
          servingLabel = "chips";
        }

        bag.dataset.servings = `${sim.bag.servings} ${servingLabel}`;
      } else {
        bag.dataset.servings = "empty";
      }
    }

    const objects = sim.cleanupObjects;
    const liveChips = new Set(
      sim.looseChips.map((chip) => {
        return chip.id;
      }),
    );

    for (const [id, node] of chips) {
      if (!liveChips.has(id)) {
        node.remove();
        chips.delete(id);
      }
    }

    for (const chip of sim.looseChips) {
      let node = chips.get(chip.id);

      if (!node) {
        node = document.createElement("img");
        node.className = "loose-chip";
        node.src = "assets/theatre/chip.svg";
        node.alt = "";
        node.dataset.chip = String(chip.id);
        chipLayer.append(node);
        chips.set(chip.id, node);
      }

      node.style.left = `${Math.round(chip.x)}px`;
      node.style.top = `${Math.round(chip.y)}px`;
      node.style.width = `${chip.width}px`;
      node.style.height = `${chip.height}px`;
      node.style.transform = `rotate(${chip.rotation ?? 0}deg)`;
    }

    const coneRects = objects.filter((object) => {
      return object.kind === "cone";
    });
    const liveCones = new Set(
      coneRects.map((cone) => {
        return cone.id;
      }),
    );

    for (const [id, node] of cones) {
      if (!liveCones.has(id)) {
        node.remove();
        cones.delete(id);
      }
    }

    for (const cone of coneRects) {
      if (cone.id == null) {
        continue;
      }

      let node = cones.get(cone.id);

      if (!node) {
        node = document.createElement("img");
        node.className = "municipal-cone";
        node.src = "assets/theatre/cone.svg";
        node.alt = "";
        node.dataset.cone = String(cone.id);
        coneLayer.append(node);
        cones.set(cone.id, node);
      }

      node.style.left = `${Math.round(cone.x)}px`;
      node.style.top = `${Math.round(cone.y)}px`;
      node.style.width = `${cone.width}px`;
      node.style.height = `${cone.height}px`;
    }

    const target = sim.highlight;
    gull.dataset.touch = sim.touchReaction;
    highlight.dataset.direct = String(!sim.tidying);
    highlight.hidden = !target;

    if (target) {
      highlight.dataset.kind = target.kind;
      highlight.style.left = `${Math.round(target.x - 8)}px`;
      highlight.style.top = `${Math.round(target.y - 8)}px`;
      highlight.style.width = `${target.width + 16}px`;
      highlight.style.height = `${target.height + 16}px`;
    }

    renderSplats(sim);
  }

  function renderSplats(sim: PetPresentation) {
    const alive = new Set(
      sim.splats.map((splat) => {
        return splat.id;
      }),
    );

    for (const [id, node] of nodes) {
      if (!alive.has(id)) {
        node.remove();
        nodes.delete(id);
      }
    }

    for (const splat of sim.splats) {
      let node = nodes.get(splat.id);

      if (!node) {
        node = document.createElement("div");
        node.className = "splat";
        node.innerHTML =
          '<svg class="splat-impact" viewBox="0 0 16 10" aria-hidden="true">' +
          '<path fill="#c4ced5" d="M3 1h2v1h1v1h4V2h1V0h2v1h1v2h-1v1h1v1h2v2h-1v1' +
          'h-3v1h-2v1H7V9H5v1H3V8H1V7H0V5h2V4h2V3H3Z"/>' +
          '<path fill="#f6f3e8" d="M4 ' +
          '2h1v1h1v1h5V3h1V1h1v2h-1v2h2v1h1v1h-3v1h-2v1H7V8H4v1H3V7H1V6h2V5h2V3H4Z"/>' +
          '<path fill="#93a9b5" d="M7 4h3v1h2v2h-2v1H7V7H5V5h2Z"/>' +
          '<path fill="#c4ced5" d="M7 4h3v1H7ZM6 5h2v1H6Z"/>' +
          '</svg>' +
          '<svg class="splat-runoff" aria-hidden="true"></svg>';
        splats.append(node);
        nodes.set(splat.id, node);
      }

      const scale = splat.scale ?? 1;
      const trailLength = splat.trailLength ?? 0;
      const bounds = splatBounds(splat);
      const left = splat.x - 24 * scale;
      const top = splat.y - 15 * scale;
      const bottom = top + (30 + trailLength) * scale;
      const right = left + 48 * scale;
      node.style.left = `${splat.x}px`;
      node.style.top = `${splat.y}px`;
      const runoff = node.querySelector<SVGElement>(".splat-runoff")!;
      const artworkKey = `${splat.id}:${trailLength}`;

      if (runoff.dataset.artwork !== artworkKey) {
        runoff.setAttribute("viewBox", `0 0 48 ${30 + trailLength}`);
        runoff.innerHTML = runoffMarkup(splat.id, trailLength);
        runoff.dataset.artwork = artworkKey;
      }

      node.style.clipPath = splat.clip
        ? `inset(${bounds.y - top}px ${right - bounds.x - bounds.width}px ` +
          `${bottom - bounds.y - bounds.height}px ${bounds.x - left}px)`
        : "none";
      node.classList.toggle("dripping", splat.trailLength !== undefined);
      node.style.width = `${48 * scale}px`;
      node.style.height = `${(30 + trailLength) * scale}px`;
      node.style.setProperty("--splat-height", `${30 * scale}px`);
      node.style.marginLeft = `${-24 * scale}px`;
      node.style.marginTop = `${-15 * scale}px`;
      node.dataset.scale = String(scale);
      node.classList.toggle("old", sim.time - splat.born >= 32);
    }
  }
  function dispose() {
    renderTheatre.dispose();

    for (const node of rubbishNodes.values()) {
      node.remove();
    }

    for (const node of nodes.values()) {
      node.remove();
    }

    for (const node of [
      hitLayer,
      carriedRubbish,
      chipLayer,
      coneLayer,
      highlight,
      bag,
      perch,
      carried,
    ]) {
      node.remove();
    }

    rubbishNodes.clear();
    nodes.clear();
    cones.clear();
    chips.clear();
    hitNodes.length = 0;
  }
  return Object.assign(render, { dispose });
}
