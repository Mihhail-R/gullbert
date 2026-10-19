import test from "node:test";
import assert from "node:assert/strict";
import { RoutineRegistry } from "../web-dist/simulation/registry.js";
import { GiftRoutine } from "../web-dist/simulation/behaviors/gifts.js";
import { routineFixture } from "./routine-fixture.mjs";
import { keepsakeRecallFixture } from "./recall-fixture.mjs";

function keepsakeRegistry() {
  const { belongings } = keepsakeRecallFixture("sock");
  const recall = belongings.reserveRecall(() => 0, ["treasure"]);
  const sim = routineFixture(class extends GiftRoutine {
    constructor(environment) {
      environment.belongings = belongings;
      super(environment);
    }

    startRecall(reservation) {
      const started = super.startRecall(reservation);
      this.startedIdentity = this.identity;
      return started;
    }
  });
  const registry = new RoutineRegistry([sim.routine], new Map([["gift", sim.routine]]));
  return { registry, sim, recall, belongings };
}

test("a recalled routine becomes active without reinstalling its scene", () => {
  const { registry, sim, recall } = keepsakeRegistry();
  assert.equal(registry.startRecall(recall), true);
  assert.equal(registry.active, true);
  assert.equal(registry.scene.purpose, "retrieve-keepsake");
  assert.equal(registry.identity, sim.routine.startedIdentity);

  registry.interrupt();
  assert.equal(registry.active, false);
  assert.equal(sim.routine.scene, null);
});

test("a rejected recall leaves the registry available for a later command", () => {
  const { registry, recall, belongings } = keepsakeRegistry();
  belongings.restore(null);

  assert.equal(registry.startRecall(recall), false);
  assert.equal(registry.active, false);
  assert.equal(registry.scene, null);
  assert.equal(registry.start("bring_gift"), true);
  assert.equal(registry.scene.purpose, "discovery");
});

for (const completion of ["returned", "explicit"]) {
  test(`the routine fixture finalizes ${completion} completion once and stops updates`, () => {
    const calls = [];
    const sim = routineFixture(class {
      constructor(environment) {
        this.environment = environment;
      }

      start(name) {
        return name === "finish";
      }

      update() {
        calls.push("update");

        if (completion === "explicit") {
          this.environment.lifecycle.complete();
        }

        return "complete";
      }

      complete() {
        calls.push("complete");
      }

      interrupt() {}
    });

    sim.action("finish");
    sim.step(0.05);
    sim.step(0.05);
    assert.deepEqual(calls, ["update", "complete"]);
  });
}
