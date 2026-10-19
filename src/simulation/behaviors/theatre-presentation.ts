import { theatreBeak, theatrePointOnScreen } from "./theatre-geometry.js";
import type { SimulationView } from "../capabilities.js";
import { clamp } from "../geometry.js";
import type { SceneProp } from "../model.js";
import type { Pose } from "../poses.js";
import { isTheatre, type BubblesScene } from "../scenes.js";

export function theatrePose(
  sim: Pick<SimulationView, "scene" | "motionTime" | "time">,
): Pose | null {
  const scene = sim.scene;

  if (!isTheatre(scene)) {
    return null;
  }

  const walk = (["idle", "walkLeft", "idle", "walkRight"] as const)[
    Math.floor(sim.motionTime * 10) % 4
  ];

  switch (scene.kind) {
    case "bubbles":
      return (
        (
          {
            peck: "nibble",
            startle: "nap-startle",
            proud: "blink",
          } as Partial<Record<BubblesScene["phase"], Pose>>
        )[scene.phase] ?? walk
      );

    case "bath":
      switch (scene.phase) {
        case "splash":
          return "bath-wet";

        case "shake":
          return Math.floor(sim.time * 12) % 2
            ? "bath-shake-a"
            : "bath-shake-b";

        default:
          return walk;
      }

    case "toss":
      switch (scene.phase) {
        case "takeoff":
          return "crouch";

        case "intercept":
          return Math.floor(sim.time * 10) % 2 ? "wingUp" : "wingDown";

        case "land":
          return "wingDown";

        case "miss-flail":
          return Math.floor(sim.time * 12) % 2 ? "nap-startle" : "wingDown";

        case "miss":
          return "bag-offended";

        case "eat":
          return "nibble";

        default:
          return walk;
      }

    case "baguette":
      if (
        ["carry", "exit"].includes(scene.phase) &&
        Math.floor(sim.motionTime * 8) % 2
      ) {
        return walk;
      }

      return "nibble";
  }
}

export function theatreProps(
  sim: Pick<
    SimulationView,
    | "scene"
    | "visible"
    | "width"
    | "height"
    | "time"
    | "x"
    | "y"
    | "motionTime"
    | "facing"
  >,
): SceneProp[] {
  const scene = sim.scene;

  if (!sim.visible || !isTheatre(scene)) {
    return [];
  }

  switch (scene.kind) {
    case "bubbles": {
      return [
        ...scene.bubbles.map((bubble) => {
          return {
            id: bubble.id,
            asset: "bubble",
            x: bubble.x - 15,
            y: bubble.y - 15,
            width: 30,
            height: 30,
          };
        }),
        ...scene.pops.map((pop) => {
          return {
            id: `pop-${pop.id}`,
            asset: "pop",
            x: pop.x - 21,
            y: pop.y - 21,
            width: 42,
            height: 42,
          };
        }),
      ];
    }

    case "bath": {
      const props: SceneProp[] = [
        {
          id: "bath",
          asset: "bath",
          x: clamp(scene.bath.x, 0, sim.width - 84),
          y: clamp(scene.bath.y, 0, sim.height - 40),
          width: 84,
          height: 40,
        },
      ];

      if (["splash", "shake"].includes(scene.phase)) {
        for (let index = 0; index < 8; index += 1) {
          const age = ((sim.time - scene.phaseStarted) * 1.5 + index / 8) % 1;
          let direction: -1 | 1;

          if (index % 2) {
            direction = 1;
          } else {
            direction = -1;
          }

          props.push({
            id: `drop-${index}`,
            asset: "drop",
            x: clamp(
              sim.x + 46 + direction * age * (25 + index * 5),
              0,
              sim.width - 9,
            ),
            y: clamp(
              sim.y + 55 - Math.sin(age * Math.PI) * (30 + index * 3),
              0,
              sim.height - 12,
            ),
            width: 9,
            height: 12,
            opacity: 1 - age * 0.7,
          });
        }
      }

      return props;
    }

    case "toss": {
      // Rendering can run synchronously on resize before the next physics tick.
      const chip = scene.chip && theatrePointOnScreen(sim, scene.chip, 18);

      if (scene.chip && chip) {
        let rotation;

        if (["takeoff", "intercept"].includes(scene.phase)) {
          rotation = (sim.time - scene.started) * 360;
        } else {
          rotation = 0;
        }

        return [
          {
            id: scene.chip.id,
            asset: "chip",
            x: chip.x - 12,
            y: chip.y - 12,
            width: 24,
            height: 24,
            rotation: rotation,
          },
        ];
      } else {
        return [];
      }
    }

    case "baguette": {
      const mouth = theatreBeak(sim);
      const offset = theatreOffset(sim);
      let horizontalOffset;

      if (scene.phase === "pause") {
        horizontalOffset = 13;
      } else {
        horizontalOffset = Math.sin(sim.motionTime * 8) * 5;
      }

      return [
        {
          id: "baguette",
          asset: "baguette",
          x: mouth.x - 78 + offset.x,
          y: mouth.y - 5,
          width: 156,
          height: 24,
          rotation: sim.facing * horizontalOffset,
          opacity: offset.opacity,
        },
      ];
    }
  }
}

// The simulation remains in safe desktop coordinates while the short entrance
// and departure move the complete carried silhouette beyond the display edge.
export function theatreOffset(sim: Pick<SimulationView, "scene" | "time">) {
  const scene = sim.scene;

  if (scene?.kind !== "baguette") {
    return { x: 0, opacity: 1 };
  }

  const progress = clamp((sim.time - scene.phaseStarted) / 0.8, 0, 1);

  switch (scene.phase) {
    case "entrance":
      return { x: -scene.direction * 220 * (1 - progress), opacity: 1 };

    case "departure":
      return { x: scene.direction * 220 * progress, opacity: 1 };

    case "gone":
      return { x: 0, opacity: 0 };

    default:
      return { x: 0, opacity: 1 };
  }
}
