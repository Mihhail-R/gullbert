import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Gullbert } from "../web-dist/simulation/engine.js";
import {
  harness,
  pointerEvent,
  settle,
  deferred,
} from "./application-harness.mjs";
import { advance, reach } from "./simulation-helpers.mjs";
import { validateActions } from "../scripts/actions.mjs";

const scenarios = JSON.parse(
  readFileSync(new URL("action-scenarios.json", import.meta.url)),
);
const traces = process.env.GULLBERT_ROUTING_TRACES
  ? JSON.parse(readFileSync(process.env.GULLBERT_ROUTING_TRACES, "utf8"))
  : null;

function bird() {
  return new Gullbert(800, 600, () => 0.5);
}
function check(h, expected) {
  const view = h.simulation.inspect();
  const actual = {
    lessons: h.simulation.exportMemory().learned.tricks.spin,
    chip:
      !!view.crumb ||
      !!h.simulation.present().looseProps?.some((prop) => prop.kind === "chip"),
    tidying: h.simulation.status().tidying,
    visible: h.updates.at(-1).visible,
    targeting: h.updates.at(-1).targeting,
  };

  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value, key);
  }
}

for (const adapter of ["preview", "native"]) {
  for (const [name, steps] of Object.entries(scenarios)) {
    if (adapter === "preview" && steps[0].nativeOnly) {
      continue;
    }

    test(
      `${adapter}: ${name}`,
      { skip: adapter === "native" && !traces },
      async (t) => {
        let current;
        let delivered = false;
        const h = harness({
          native: adapter === "native",
          simulation: bird(),
          invoke(command, args) {
            if (!["act", "target_picked", "cancel_targeting"].includes(command)) {
              return;
            }

            if (!current || delivered) {
              return null;
            }

            if (command === "target_picked") {
              const selection = current.events.find(
                (event) => event.event === "gullbert-target",
              );
              assert.equal(args.id, selection.payload.id);
            }

            deliver();

            if (current.error) {
              return Promise.reject(new Error(current.error));
            }

            return null;
          },
        });
        function deliver() {
          delivered = true;

          for (const event of current.events) {
            h.nativeListeners.get(event.event)({ payload: event.payload });
          }
        }
        t.after(() => h.app.dispose());
        await h.app.start();
        h.simulation.configure({ paused: true, mischief: 0 });

        for (const [index, step] of steps.entries()) {
          current = traces?.[name][index];
          delivered = false;

          if (step.action) {
            if (adapter === "native") {
              const request = h.native.invoke("act", { action: step.action });

              if (step.error) {
                await assert.rejects(request);
              } else {
                await request;
              }
            } else {
              h.emit("message", { type: "action", action: step.action });
            }
          } else if (step.pick) {
            h.emit(
              "pointerdown",
              pointerEvent({ x: step.pick[0], y: step.pick[1] }),
            );
            await settle();
          } else if (step.escape) {
            h.emit("keydown", "Escape");
            await settle();
          } else if (step.deadline) {
            if (adapter === "native") {
              deliver();
            } else {
              const deadline = [...h.timers.values()].find((timer) =>
                [12000, 30000].includes(timer.delay),);
              assert.ok(deadline);
              deadline.callback();
            }
          } else if (step.advance === "reward") {
            reach(h.simulation, "reward");
          } else if (typeof step.advance === "number") {
            advance(h.simulation, step.advance);
          } else if (step.expect) {
            check(h, step.expect);
          }
        }
      },
    );
  }
}

test(
  "stale and duplicate native Targeting outcomes cannot cancel a consumed reward or " +
  "a newer session",
  async (t) => {
    const h = harness({ native: true, simulation: bird() });
    t.after(() => h.app.dispose());
    await h.app.start();
    h.simulation.configure({ paused: true, mischief: 0 });
    const action = (action) =>
      h.nativeListeners.get("gullbert-action")({ payload: { action } });
    const notice = (payload) =>
      h.nativeListeners.get("gullbert-target")({ payload });
    action("trick_spin");
    reach(h.simulation, "reward");
    notice({
      outcome: "started",
      id: 1,
      purpose: "feed_here",
      preparation: "prepare_chip",
    });
    notice({ outcome: "selected", id: 1, point: { x: 500, y: 400 } });
    notice({ outcome: "abandoned", id: 1 });
    notice({ outcome: "selected", id: 1, point: { x: 1, y: 1 } });
    h.emit("keydown", "Escape");
    advance(h.simulation, 8);
    check(h, { lessons: 1 });
    notice({ outcome: "started", id: 3, purpose: "tidy", preparation: "tidy" });

    for (const outcome of ["abandoned", "finished_tidying", "replaced"]) {
      notice({ outcome, id: 1 });
    }

    notice({ outcome: "started", id: 1, purpose: "poop", preparation: "cancel" });
    check(h, { targeting: true, tidying: true });
    notice({ outcome: "finished_tidying", id: 3 });
    action("feed");
    notice({ outcome: "finished_tidying", id: 3 });
    notice({ outcome: "abandoned", id: 3 });
    check(h, { chip: true, targeting: false, tidying: false });
  }
);

test(
  "a late rejected selection and a stale fallback deadline cannot cancel newer " +
  "Targeting",
  async (t) => {
    const pending = deferred();
    const h = harness({
      native: true,
      simulation: bird(),
      invoke(name) {
        if (name === "target_picked") {
          return pending.promise;
        }
      },
    });
    t.after(() => h.app.dispose());
    await h.app.start();
    const notice = (payload) =>
      h.nativeListeners.get("gullbert-target")({ payload });
    notice({
      outcome: "started",
      id: 1,
      purpose: "feed_here",
      preparation: "prepare_chip",
    });
    const stale = [...h.timers.values()].find((timer) => timer.delay === 12000);
    h.emit("pointerdown", pointerEvent());
    notice({ outcome: "started", id: 3, purpose: "tidy", preparation: "tidy" });
    pending.reject(new Error("old delivery"));
    stale.callback();
    await settle();
    check(h, { targeting: true, tidying: true });
    assert.equal(h.errors.length, 0);
  }
);

test("frontend expiry cancels a reward when all native terminal delivery is lost", async (t) => {
  const h = harness({ native: true, simulation: bird() });
  t.after(() => h.app.dispose());
  await h.app.start();
  h.simulation.configure({ paused: true, mischief: 0 });
  h.nativeListeners.get("gullbert-action")({
    payload: { action: "trick_spin" },
  });
  reach(h.simulation, "reward");
  h.nativeListeners.get("gullbert-target")({
    payload: {
      outcome: "started",
      id: 1,
      purpose: "feed_here",
      preparation: "prepare_chip",
    },
  });
  h.emit("pointerdown", pointerEvent());
  const deadline = [...h.timers.values()].find(
    (timer) => timer.delay === 12000,
  );
  assert.ok(
    deadline,
    "placement keeps its fallback until a terminal notice arrives",
  );
  deadline.callback();
  h.nativeListeners.get("gullbert-action")({ payload: { action: "feed" } });
  advance(h.simulation, 3);
  check(h, { lessons: 0, targeting: false });
});

test("preview Summon uses its frame center and Quit explains desktop behavior", async (t) => {
  const h = harness({ simulation: bird() });
  t.after(() => h.app.dispose());
  await h.app.start();
  h.emit("message", { type: "action", action: "summon" });
  assert.equal(h.simulation.inspect().x, 352);
  assert.equal(h.simulation.inspect().y, 252);
  h.emit("message", { type: "action", action: "quit" });
  check(h, { visible: false });
  assert.ok(h.published.some((message) => message.type === "preview-quit"));
});

test("frontend catalog validation rejects malformed definitions and incompatible routes", () => {
  const source = JSON.parse(
    readFileSync(new URL("../src/actions/catalog.json", import.meta.url)),
  );
  validateActions(source);

  for (const mutate of [
    (catalog) => {
      catalog.feed.aliases = ["--place-chip"];
    },
    (catalog) => {
      catalog.feed_here.purpose = "tidy";
    },
    (catalog) => {
      catalog.feed_here.preparation = "cancel";
    },
    (catalog) => {
      catalog.feed_here.visibility = "preserve";
    },
    (catalog) => {
      catalog.feed.purpose = "tidy";
    },
    (catalog) => {
      catalog.feed.variant = "Quit";
    },
    (catalog) => {
      catalog.feed.availability = "unknown";
    },
  ]) {
    const catalog = structuredClone(source);
    mutate(catalog);
    assert.throws(() => validateActions(catalog), /Invalid/);
  }

  for (const catalog of [null, [], {}, { feed: 3 }]) {
    assert.throws(() => validateActions(catalog), /Invalid/);
  }
});

test("preview Escape still releases Pickup, Cursor, and pickup retaliation", async (t) => {
  const sim = new Gullbert(800, 600, () => 0);
  const h = harness({ simulation: sim });
  t.after(() => h.app.dispose());
  await h.app.start();
  sim.configure({ paused: false, mischief: 1 });
  function grab() {
    const rect = sim.pickupRect();
    h.emit(
      "pointerdown",
      pointerEvent({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }),
    );
  }
  grab();
  assert.equal(sim.status().held, true);
  h.emit("keydown", "Escape");
  assert.equal(sim.status().held, false);
  h.emit("message", { type: "action", action: "eat_cursor" });
  assert.ok(sim.cursorEncounter());
  h.emit("keydown", "Escape");
  assert.equal(sim.cursorEncounter(), null);

  for (let pickup = 0; pickup < 3; pickup++) {
    grab();
    h.emit("pointermove", pointerEvent({ x: 200 + pickup * 100, y: 200 }));
    h.emit("pointerup", pointerEvent({ x: 200 + pickup * 100, y: 200 }));
    await settle();
  }

  assert.equal(sim.inspect().scene.revenge, "trash");
  h.emit("keydown", "Escape");
  assert.equal(sim.inspect().scene, null);
});
