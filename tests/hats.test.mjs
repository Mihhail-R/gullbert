import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import {
  normalizeHat,
  hatPlacement,
  hatRemark,
} from "../web-dist/simulation/behaviors/hats.js";

const bird = (extra = {}) => ({
  settings: { hat: "captain" },
  pose: "idle",
  facing: 1,
  ...extra,
});

test("hat settings admit only the supplied hats and none", () => {
  for (const value of [null, undefined, {}, "CAPTAIN", "crown", "none"]) {
    assert.equal(normalizeHat(value), "none");
  }

  for (const hat of ["captain", "cone", "beanie", "paper-crown", "fried-egg"]) {
    assert.equal(normalizeHat(hat), hat);
  }

  assert.equal(hatPlacement(bird({ settings: {} })), null);
});

test("hats follow head movement, mirror locally and retain integer pixel scale", () => {
  const idle = hatPlacement(bird());
  assert.equal(hatPlacement(bird({ pose: "walkLeft" })).y, idle.y - 3);
  assert.equal(hatPlacement(bird({ pose: "crouch" })).y, idle.y + 3);
  const sway = hatPlacement(bird({ pose: "nap-wobble" }));
  const mirrored = hatPlacement(bird({ pose: "nap-wobble", facing: -1 }));
  assert.equal(mirrored.x, 96 - sway.x - sway.width);
  assert.equal(mirrored.flip, true);

  for (const pose of ["idle", "walkRight", "wingUp", "wingDown", "nap-sleep"]) {
    assert.ok(hatPlacement(bird({ pose })));
  }

  for (const n of [idle.x, idle.y, idle.width, idle.height]) {
    assert.equal(Math.abs(n % 3), 0);
  }
});

test("temporary incompatible poses hide a hat without losing its selection", () => {
  const sim = bird();

  for (const extra of [
    { bag: { attached: true } },
    { scene: { kind: "gift", carrying: true } },
    { scene: { kind: "bath", phase: "splash" } },
    { scene: { kind: "bath", phase: "shake" } },
    { pose: "bag-trapped" },
    { pose: "bath-wet" },
    { pose: "theft-grip" },
  ]) {
    assert.equal(hatPlacement({ ...sim, ...extra }), null);
    assert.equal(sim.settings.hat, "captain");
  }

  assert.equal(hatPlacement(sim).asset, "captain");
  assert.ok(hatPlacement(bird({ scene: { kind: "bath", phase: "exit" } })));
});

test("changing or removing a hat leaves the current scene untouched", () => {
  const scene = { kind: "bubble", phase: "chase", started: 2 };
  const sim = bird({ scene });
  sim.settings.hat = "cone";
  assert.equal(hatPlacement(sim).asset, "cone");
  assert.equal(hatRemark(sim), "safety has arrived.");
  sim.settings.hat = "none";
  assert.equal(hatPlacement(sim), null);
  assert.equal(hatRemark(sim), null);
  assert.equal(sim.scene, scene);
  assert.deepEqual(scene, { kind: "bubble", phase: "chase", started: 2 });
});

test("configure changes hats during real scenes without canceling their activity", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ paused: true, mischief: 0 });

  for (const action of [
    "blow_bubbles",
    "bath_time",
    "chip_toss",
    "baguette_parade",
  ]) {
    sim.action(action);
    const scene = sim.inspect().scene;
    const mode = sim.inspect().mode;
    assert.ok(scene);

    for (const hat of [
      "captain",
      "cone",
      "beanie",
      "paper-crown",
      "fried-egg",
      "none",
    ]) {
      sim.configure({ hat });
      assert.equal(sim.inspect().settings.hat, hat);
      assert.deepEqual(sim.inspect().scene, scene);
      assert.equal(sim.inspect().mode, mode);
    }
  }

  sim.configure({ hat: "captain" });
  assert.equal(hatPlacement(sim.inspect()), null);
  sim.action("clean");
  assert.equal(hatPlacement(sim.inspect())?.asset, "captain");
});
