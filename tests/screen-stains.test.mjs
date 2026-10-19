import test from "node:test";
import assert from "node:assert/strict";
import { Props, splatBounds } from "../web-dist/simulation/props.js";
import { cleanupTarget } from "../web-dist/simulation/behaviors/cleanup.js";
import { Gullbert } from "../web-dist/simulation/engine.js";

test("splats drip without window observations and can be cleaned early", () => {
  const props = new Props(1000, 700);
  props.scatter({ x: 200, y: 200 }, 0);
  props.expire(6);
  assert.ok(props.snapshot().splats[0].trailLength > 200);
  props.expire(20);
  const dry = props.snapshot().splats[0];
  assert.equal(dry.trailLength, 483);
  const target = cleanupTarget(props.snapshot(), { x: 200, y: 400 });
  assert.equal(target.id, dry.id);
  props.remove(target.kind, target.id);
  assert.equal(props.snapshot().splats.length, 0);
});

test("resizing the display clips runoff without stretching it", () => {
  const props = new Props(1000, 700);
  props.scatter({ x: 200, y: 200 }, 0);
  props.expire(6);
  const length = props.snapshot().splats[0].trailLength;
  props.resize(800, 300);
  const clipped = props.snapshot().splats[0];
  assert.equal(clipped.trailLength, length);
  const bounds = splatBounds(clipped);
  assert.equal(bounds.y + bounds.height, 300);
});

test("switching or moving windows cannot hide or relocate a screen stain", () => {
  const sim = new Gullbert(1000, 700, () => 0.5);
  sim.splat({ x: 200, y: 200 });

  for (let i = 0; i < 80; i++) {
    sim.step(0.1);
  }

  for (const observation of [
    null,
    {
      window: { id: 42, x: 100, y: 100, width: 600, height: 400 },
      keyDownCount: 0,
      idleSeconds: 0,
    },
    {
      window: { id: 99, x: 150, y: 200, width: 600, height: 400 },
      keyDownCount: 0,
      idleSeconds: 0,
    },
  ]) {
    sim.observeWork(observation, 8000);
    assert.equal(sim.inspect().splats.length, 1);
    assert.equal(sim.inspect().splats[0].x, 200);
    assert.equal(sim.inspect().splats[0].y, 200);
  }

  const point = { x: 200, y: 400 };
  assert.equal(sim.directCleanupAt(point), true);
  sim.action("direct_pick", point);
  sim.observeWork(null, 8100);
  assert.equal(sim.inspect().splats.length, 0);
});

test("screen runoff expires after forty seconds without leaving cleanup targets", () => {
  const props = new Props(1000, 700);
  props.scatter({ x: 200, y: 200 }, 0);
  props.expire(39.9);
  assert.equal(props.snapshot().splats.length, 1);
  props.expire(40);
  assert.equal(props.snapshot().splats.length, 0);
  assert.equal(cleanupTarget(props.snapshot(), { x: 200, y: 400 }), null);
});
