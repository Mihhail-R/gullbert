import test from "node:test";
import assert from "node:assert/strict";
import { Gullbert } from "../web-dist/simulation/engine.js";

function customRuntime({ greedy = false, throwCleanup = false } = {}) {
  const calls = [];
  let capabilities;
  class DemonstrationRoutine {
    #updates = 0;
    start(name) {
      if (!greedy && name !== "demonstration") {
        return false;
      }

      this.#updates = 0;
      calls.push("start");
      capabilities.movement.moveTo({ x: 120, y: 140 });
      capabilities.speech.say("routine started");
      capabilities.props.add({
        asset: "chip",
        x: 20,
        y: 30,
        width: 24,
        height: 18,
      });
      return true;
    }
    update() {
      calls.push("update");
      this.#updates++;

      if (this.#updates === 2) {
        capabilities.events.emit("pop");
        return "complete";
      }

      return "running";
    }
    complete() {
      calls.push("complete");

      if (throwCleanup) {
        throw new Error("cleanup failed");
      }
    }
    interrupt() {
      calls.push("interrupt");

      if (throwCleanup) {
        throw new Error("cleanup failed");
      }
    }
    visibility(visible) {
      calls.push(`visible:${visible}`);
    }
    presentation() {
      return { pose: "tilt" };
    }
  }
  function createRoutine(scope) {
    capabilities = scope;
    return new DemonstrationRoutine();
  }
  const sim = new Gullbert(800, 600, () => 0.5, { routines: [createRoutine] });
  return {
    sim,
    calls,
    get capabilities() {
      return capabilities;
    },
  };
}

function assertRevoked(sim, capabilities) {
  const { x, y, bubble } = sim.present();
  sim.drainSounds();
  capabilities.movement.moveTo({ x: -500, y: -500 });
  capabilities.speech.say("stale callback");
  capabilities.events.emit("squawk");
  capabilities.props.add({ asset: "chip", x: 1, y: 1, width: 24, height: 18 });
  const after = sim.present();
  assert.deepEqual({ x: after.x, y: after.y, bubble: after.bubble }, { x, y, bubble });
  assert.deepEqual(sim.drainSounds(), []);
  assert.deepEqual(after.props, []);
}

test("completing a registered routine releases its props and rejects late effects", () => {
  const fixture = customRuntime();
  const { sim, calls, capabilities } = fixture;
  sim.action("demonstration");
  assert.equal(sim.present().pose, "tilt");
  assert.equal(sim.present().props.length, 1);
  assert.deepEqual({ x: sim.present().x, y: sim.present().y }, { x: 120, y: 140 });
  sim.step(0.05);
  sim.step(0.05);
  assert.deepEqual(calls, ["start", "update", "update", "complete"]);
  assert.deepEqual(sim.drainSounds(), ["pop"]);
  assertRevoked(sim, capabilities);
  sim.step(0.05);
  assert.equal(calls.filter((value) => value === "complete").length, 1);
});

test("hide pauses a routine and its props, then resumes without completing it", () => {
  const { sim, calls, capabilities } = customRuntime();
  sim.action("demonstration");
  sim.step(0.05);
  sim.setVisible(false);
  const hiddenTime = sim.inspect().time;
  sim.step(10);
  assert.equal(sim.inspect().time, hiddenTime);
  assert.equal(sim.present().props.length, 0);
  const hiddenX = sim.inspect().x;
  capabilities.movement.moveTo({ x: 600, y: 500 });
  assert.equal(sim.inspect().x, hiddenX);
  capabilities.props.add({ asset: "chip", x: 1, y: 1, width: 24, height: 18 });
  sim.setVisible(true);
  assert.equal(sim.present().props.length, 1);
  sim.step(0.05);
  assert.deepEqual(calls, [
    "start",
    "update",
    "visible:false",
    "visible:true",
    "update",
    "complete",
  ]);
});

test("command replacement interrupts and revokes a routine without completing it", () => {
  const { sim, calls, capabilities } = customRuntime();
  sim.action("demonstration");
  sim.action("feed");
  assert.deepEqual(calls, ["start", "interrupt"]);
  assert.equal(sim.inspect().mode, "fetch");
  assertRevoked(sim, capabilities);
});

test("core commands retain priority over a routine that claims every command", () => {
  const { sim, calls } = customRuntime({ greedy: true });
  sim.action("feed");
  assert.equal(sim.inspect().mode, "fetch");
  assert.deepEqual(calls, []);
  sim.action("demonstration");
  sim.action("cancel");
  assert.deepEqual(calls, ["start", "interrupt"]);
  assert.equal(sim.inspect().mode, "idle");
});

test("routine cleanup exceptions still release props and effect capabilities", () => {
  for (const outcome of ["complete", "interrupt"]) {
    const { sim, calls, capabilities } = customRuntime({ throwCleanup: true });
    sim.action("demonstration");

    if (outcome === "complete") {
      sim.step(0.05);
      assert.throws(() => {
        sim.step(0.05);
      }, /cleanup failed/);
    } else {
      assert.throws(() => {
        sim.action("cancel");
      }, /cleanup failed/);
    }

    assert.equal(calls.filter((value) => value === outcome).length, 1);
    assertRevoked(sim, capabilities);
  }
});
