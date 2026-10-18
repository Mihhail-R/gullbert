import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
import {
  normalizeHat,
  hatPlacement,
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

test("carried objects and incompatible poses hide a hat", () => {
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
  }

  assert.equal(hatPlacement(sim).asset, "captain");
  assert.ok(hatPlacement(bird({ scene: { kind: "bath", phase: "exit" } })));
});

test("changing and removing a hat preserves a running show", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ paused: true, mischief: 0 });
  sim.action("blow_bubbles");
  const scene = sim.inspect().scene;

  sim.configure({ hat: "cone" });
  assert.equal(sim.present().hatPlacement.asset, "cone");
  assert.deepEqual(sim.inspect().scene, scene);

  sim.configure({ hat: "none" });
  assert.equal(sim.present().hatPlacement, null);
  assert.deepEqual(sim.inspect().scene, scene);
});

test("a hat hidden by bathing returns when the bath ends", () => {
  const sim = new Gullbert(800, 600, () => 0.5);
  sim.configure({ paused: true, mischief: 0, hat: "captain" });
  sim.action("bath_time");

  for (let tick = 0; tick < 400 && sim.inspect().scene?.phase !== "splash"; tick++) {
    sim.step(0.05);
  }

  assert.equal(sim.inspect().scene?.phase, "splash");
  assert.equal(sim.present().hatPlacement, null);
  sim.action("clean");
  assert.equal(sim.present().hatPlacement.asset, "captain");
});
