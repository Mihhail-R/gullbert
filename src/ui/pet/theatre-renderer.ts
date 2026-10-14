import type { Prop } from "../../simulation/model.js";
import { requiredElement } from "../dom.js";
import type { PetPresentation } from "../../simulation/presentation.js";

// These toys share the existing click-through world and the bird's coordinate
// system. Nodes are keyed and removed with the scene; none owns a timer.
export function createTheatreRenderer(
  world: HTMLElement,
  gull: HTMLElement,
  sprite: HTMLElement,
) {
  const layer = document.createElement("div");
  layer.id = "theatre-props";
  const dialogue = document.createElement("div");
  dialogue.id = "guest-speech";
  const hat = document.createElement("img");
  hat.id = "tiny-hat";
  hat.alt = "";
  hat.hidden = true;
  requiredElement("#bird", gull).append(hat);
  world.append(layer, dialogue);
  const nodes = new Map<string | number, HTMLImageElement | HTMLSpanElement>();
  function draw(node: HTMLImageElement | HTMLSpanElement, prop: Prop) {
    if (node.dataset.asset !== prop.asset) {
      node.dataset.asset = prop.asset;
      if (node instanceof HTMLImageElement) {
        let filename = `${prop.asset}.svg`;
        if (prop.asset.endsWith(".png")) {
          filename = prop.asset;
        }
        node.src = `assets/theatre/${filename}`;
      }
    }
    if (prop.text !== undefined) {
      node.textContent = prop.text;
    }
    node.style.left = `${Math.round(prop.x)}px`;
    node.style.top = `${Math.round(prop.y)}px`;
    node.style.width = `${prop.width}px`;
    node.style.height = `${prop.height}px`;
    node.style.opacity = String(prop.opacity ?? 1);
    let scaleX;
    if (prop.flip) {
      scaleX = -1;
    } else {
      scaleX = 1;
    }
    node.style.transform = `rotate(${prop.rotation ?? 0}deg) scaleX(${scaleX})`;
  }
  function renderTheatre(sim: PetPresentation) {
    const props = sim.props;
    const alive = new Set(
      props.map((prop) => {
        return prop.id;
      }),
    );
    for (const [id, node] of nodes) {
      if (!alive.has(id)) {
        node.remove();
        nodes.delete(id);
      }
    }
    for (const prop of props) {
      let node = nodes.get(prop.id);
      if (!node) {
        if (prop.text !== undefined) {
          node = document.createElement("span");
        } else {
          const image = document.createElement("img");
          image.alt = "";
          node = image;
        }
        node.setAttribute("aria-hidden", "true");
        node.className = "theatre-prop";
        node.dataset.prop = String(prop.id);
        layer.append(node);
        nodes.set(prop.id, node);
      }
      draw(node, prop);
    }
    const message = sim.guestSpeech;
    dialogue.hidden = !message;
    if (message) {
      dialogue.textContent = message.text;
      dialogue.style.left = `${Math.max(90, Math.min(sim.width - 90, message.x))}px`;
      dialogue.style.top = `${Math.max(6, Math.min(sim.height - 45, message.y))}px`;
    } else {
      dialogue.textContent = "";
    }
    const placement = sim.hatPlacement;
    hat.hidden = !placement;
    if (placement) {
      draw(hat, placement);
    }
    gull.dataset.hat = sim.hat;
    // Keep the feet rigid through the walk cycle. The pet renderer supplies a
    // one-pixel bob; the old extended-leg frames stay in the editable artwork.
    const walkingPose = sim.pose === "walkLeft" || sim.pose === "walkRight";
    // New bath poses are editable pixel SVGs.
    const bathPose = ["bath-wet", "bath-shake-a", "bath-shake-b"].includes(
      sim.pose,
    );
    if (bathPose) {
      sprite.style.backgroundImage = `url("assets/theatre/${sim.pose}.svg")`;
    } else {
      sprite.style.backgroundImage = "";
    }
    if (bathPose) {
      sprite.style.backgroundPosition = "0 0";
    } else {
      let frame;
      if (walkingPose) {
        frame = 0;
      } else {
        frame = sim.frame;
      }
      sprite.style.backgroundPosition = `${-frame * 96}px 0`;
    }
  }
  function dispose() {
    layer.remove();
    dialogue.remove();
    hat.remove();
    nodes.clear();
  }
  return Object.assign(renderTheatre, { dispose });
}
