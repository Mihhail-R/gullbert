import test from "node:test";
import assert from "node:assert/strict";
import { Body } from "../web-dist/simulation/body.js";
import { Touch } from "../web-dist/simulation/behaviors/touch.js";
import { Pickup } from "../web-dist/simulation/behaviors/pickup.js";

function owners() {
  const body = new Body(800, 600);
  body.place({ x: 100, y: 100 });
  let time = 0;
  let currentScene = null;
  let available = true;
  let carried = false;
  const sounds = [];
  const lines = [];
  const clock = {
    get now() {
      return time;
    },
  };
  const speech = {
    say(text) {
      lines.push(text);
    },
  };
  const touch = new Touch({
    body,
    clock,
    speech,
    available() {
      return available;
    },
    sleeping() {
      return false;
    },
    rest() {},
  });
  const pickup = new Pickup({
    body,
    clock,
    speech,
    events: {
      emit(sound) {
        sounds.push(sound);
      },
    },
    objects: {
      scatter() {},
      dropRubbish() {},
    },
    random() {
      return 0.9;
    },
    touch,
    settings() {
      return { paused: false, mischief: 2, sound: false, hat: "none" };
    },
    visible() {
      return true;
    },
    tidying() {
      return false;
    },
    visual() {
      return { x: 0, opacity: 1, gone: false };
    },
    pickLoose() {
      return false;
    },
    offend() {},
    beginDragging() {
      pickup.interrupt();
      currentScene = null;
      touch.reset();
    },
    carry() {
      carried = true;
    },
    rest() {
      carried = false;
    },
    install(scene) {
      currentScene = scene;

      if (scene.kind === "relocation") {
        pickup.install(scene);
      } else {
        pickup.clear();
      }
    },
    cancel() {
      currentScene = null;
      pickup.interrupt();
    },
    cursorRetaliation() {
      if (currentScene?.kind === "cursor") {
        return currentScene;
      }

      return null;
    },
    consumeTrail(nextAt) {
      currentScene.trail--;
      currentScene.nextSplat = nextAt;
    },
  });
  return {
    body,
    pickup,
    touch,
    sounds,
    lines,
    advance(delta) {
      time += delta;
    },
    denyTouch() {
      available = false;
    },
    get carried() {
      return carried;
    },
  };
}

test("touch owns pointer samples and freezes observations of reactions and poke history", () => {
  const h = owners();
  const point = { x: 155, y: 130, inside: true };
  h.touch.pointer(point);
  point.x = 300;
  assert.equal(h.touch.snapshot().point.x, 155);
  h.touch.poke({ x: 145, y: 155 });
  const observation = h.touch.snapshot();
  assert.throws(() => {
    observation.point.x = 400;
  }, TypeError);
  assert.throws(() => {
    observation.pokes.push(2);
  }, TypeError);
  h.advance(0.4);
  h.touch.poke({ x: 145, y: 155 });
  assert.equal(observation.pokes.length, 1);
  assert.equal(h.touch.snapshot().pokes.length, 2);
  h.denyTouch();
  assert.equal(h.touch.update(), false);
  assert.equal(h.touch.snapshot().reaction, "");
  h.touch.reset();
  assert.equal(h.touch.snapshot().point, null);
  assert.deepEqual(h.touch.snapshot().pokes, []);
});

test(
  "pickup owns hold transition and snapshots cannot change drag offsets or " +
  "wall-clock history",
  () => {
    const h = owners();
    assert.equal(h.pickup.begin({ x: 140, y: 150 }, 0), true);
    const held = h.pickup.snapshot();
    assert.throws(() => {
      held.held.offset.x = 90;
    }, TypeError);
    h.pickup.move({ x: 250, y: 250 });
    assert.equal(h.carried, true);
    assert.equal(h.pickup.snapshot().held.dragged, true);
    assert.equal(held.held.dragged, false);
    assert.deepEqual({ x: h.body.x, y: h.body.y }, { x: 210, y: 200 });
    h.pickup.finish(100);
    assert.equal(h.pickup.snapshot().held, null);
    assert.deepEqual(h.pickup.snapshot().recent, [100]);
    const history = h.pickup.snapshot();
    assert.throws(() => {
      history.recent.push(900);
    }, TypeError);
    h.pickup.updateClock(300100);
    assert.deepEqual(h.pickup.snapshot().recent, []);
    assert.deepEqual(history.recent, [100]);
    h.pickup.updateClock(NaN);
    assert.equal(h.pickup.snapshot().now, 300100);
  }
);

test(
  "pickup scene installation and observations cannot expose the owned authorization " +
  "state",
  () => {
    const h = owners();
    const scene = {
      kind: "relocation",
      phase: "settle",
      until: 0.7,
      deadline: 10,
      revenge: "chase",
      origin: { x: 100, y: 100 },
      target: { x: 0, y: 100 },
    };
    h.pickup.install(scene);
    const identity = h.pickup.identity;
    const observation = h.pickup.scene;
    scene.origin.x = 700;
    assert.equal(h.pickup.scene.origin.x, 100);
    assert.throws(() => {
      observation.phase = "collect";
    }, TypeError);
    assert.throws(() => {
      observation.origin.y = 500;
    }, TypeError);
    assert.equal(h.pickup.authorize(44), true);
    assert.equal(h.pickup.identity, identity);
    assert.equal(observation.cursorId, undefined);
    assert.equal(h.pickup.scene.cursorId, 44);
    h.pickup.install(scene);
    assert.notEqual(h.pickup.identity, identity);
    h.pickup.interrupt();
    assert.equal(h.pickup.scene, null);
  }
);
