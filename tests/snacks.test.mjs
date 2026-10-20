import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";
function bird() {
  const g = new Gullbert(800, 600, () => 0.5);
  g.configure({ paused: true, mischief: 0, sound: false });
  return g;
}
function advance(g, t) {
  for (let i = 0; i < t * 20; i++) {
    g.step(0.05);
  }
}
test(
  "one finite bag replaces the old bag, feeds three servings and fails visibly when " +
  "empty",
  () => {
    const g = bird();
    g.action("place_bag", { x: 300, y: 300 });
    const first = g.inspect().bag.id;
    g.action("place_bag", { x: 500, y: 400 });
    assert.notEqual(g.inspect().bag.id, first);

    for (let i = 0; i < 3; i++) {
      if (i) {
        g.action("search_snack");
      }

      advance(g, 6);
      assert.equal(g.inspect().bag.servings, 2 - i);
    }

    g.action("search_snack");
    advance(g, 3.1);
    assert.match(g.inspect().bubble, /betrayal/);
  }
);
test("missing snack searches terminate and new commands or cleanup cancel approach", () => {
  const g = bird();
  g.action("search_snack");
  advance(g, 3.1);
  assert.match(g.inspect().bubble, /No chips|scandalous/i);
  advance(g, 2.9);
  assert.equal(g.inspect().mode, "idle");
  g.action("place_bag", { x: 0, y: 0 });
  g.action("nap");
  advance(g, 1);
  assert.equal(g.inspect().bag.servings, 3);
  assert.equal(g.inspect().scene, null);
  g.action("search_snack");
  g.action("clean");
  advance(g, 5);
  assert.equal(g.inspect().bag, null);
  assert.equal(g.inspect().scene, null);
});
test("bag placement and resizing stay on tiny displays", () => {
  const g = bird();
  g.action("place_bag", { x: 9999, y: -100 });
  g.resize(100, 100);
  advance(g, 4);
  assert.ok(
    g.inspect().bag.x >= 0 && g.inspect().bag.x + 51 <= g.inspect().width,
  );
  assert.ok(
    g.inspect().bag.y >= 0 && g.inspect().bag.y + 67 <= g.inspect().height,
  );
  g.action("place_bag", { x: 9999, y: 9999 });
  assert.ok(
    g.inspect().bag.x + 51 <= g.inspect().width &&
      g.inspect().bag.y + 67 <= g.inspect().height,
  );
});

test("hiding suspends the bag routine and its finite servings without catch-up", () => {
  const g = bird();
  g.action("place_bag", { x: 20, y: 20 });
  g.setVisible(false);
  const before = {
    x: g.inspect().x,
    y: g.inspect().y,
    time: g.inspect().time,
    servings: g.inspect().bag.servings,
  };
  advance(g, 90);
  assert.deepEqual(
    {
      x: g.inspect().x,
      y: g.inspect().y,
      time: g.inspect().time,
      servings: g.inspect().bag.servings,
    },
    before,
  );
  g.setVisible(true);
  advance(g, 8);
  assert.equal(g.inspect().bag.servings, 2);
  assert.equal(g.inspect().mode, "idle");
});
