import test from "node:test";
import assert from "node:assert/strict";
import { Body } from "../web-dist/simulation/body.js";

test("travel covers the requested distance and faces its destination on arrival", () => {
  const body = new Body(800, 600);
  body.place({ x: 100, y: 100 });
  assert.equal(body.moveToward({ x: 40, y: 180, facing: 1 }, 100, 0.5), false);
  assert.equal(body.x, 70);
  assert.equal(body.y, 140);
  assert.equal(body.facing, -1);
  assert.equal(body.moveToward({ x: 40, y: 180, facing: 1 }, 100, 0.5), true);
  assert.equal(body.x, 40);
  assert.equal(body.y, 180);
  assert.equal(body.facing, 1);
});

test("ordinary travel clamps its destination while scene placement can exit the screen", () => {
  const body = new Body(200, 180);
  body.place({ x: -160, y: 250 });
  assert.equal(body.x, -160);
  assert.equal(body.y, 250);
  assert.equal(body.moveToward({ x: 900, y: -100 }, 10000, 1), true);
  assert.deepEqual({ x: body.x, y: body.y }, { x: 104, y: 0 });
  body.place({ x: 260, y: -80 });
  body.resize(100, 120);
  assert.deepEqual({ x: body.x, y: body.y }, { x: 4, y: 0 });
  body.resize(30, 40);
  assert.deepEqual(body.safePoint({ x: 50, y: 50 }), { x: 0, y: 0 });
});

test("invalid pointer coordinates cannot move the bird offscreen", () => {
  const body = new Body(800, 600);
  body.place({ x: 40, y: 80 });
  body.place({ x: NaN, y: 120 });
  body.place({ x: 50, y: Infinity });
  assert.deepEqual({ x: body.x, y: body.y }, { x: 40, y: 80 });
});
