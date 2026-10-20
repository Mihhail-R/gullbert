import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Separate entrypoints isolate the bridge's import-time native detection.
export function roommateRenderingTests(mode) {
  let dom;
  let document;
  let caseNumber = 0;
  let failSave = false;
  const listeners = new Map();
  const commands = [];
  const messages = [];
  const settings = { paused: false, sound: false, mischief: 1, hat: "none" };

  beforeEach(async () => {
    listeners.clear();
    commands.length = 0;
    messages.length = 0;
    failSave = false;
    const html = await readFile(new URL("../web-dist/index.html", import.meta.url), "utf8");
    dom = new JSDOM(html, { url: "https://gullbert.test/" });
    document = dom.window.document;
    dom.window.matchMedia = () => {
      return Object.assign(new dom.window.EventTarget(), { matches: false });
    };
    Object.assign(globalThis, {
      window: dom.window,
      document,
      location: dom.window.location,
      localStorage: dom.window.localStorage,
    });

    if (mode === "native") {
      dom.window.__TAURI__ = {
        core: {
          async invoke(command, args) {
            commands.push({ command, args });

            switch (command) {
              case "update_settings":
                if (failSave) {
                  throw new Error("Disk full");
                }

                return;

              case "act":
              case "cancel_targeting":
              case "request_roommate":
                return;

              case "snapshot":
                return { settings, visible: true, shortcut_errors: [] };

              case "app_version":
                return "0.0.0";

              default:
                throw new Error(`Unexpected native command: ${command}`);
            }
          },
        },
        event: {
          async listen(name, callback) {
            listeners.set(name, callback);
            return () => listeners.delete(name);
          },
        },
      };
    }

    // Re-run the entrypoint so each case gets fresh settings and event handlers.
    await import(`../web-dist/ui/controls/controls.js?case=${++caseNumber}`);
    await settle();
    document.querySelector("iframe").contentWindow.postMessage = (data, origin) => {
      messages.push({ data, origin });
    };
    commands.length = 0;
  });

  afterEach(() => {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    dom.window.close();
  });

  function element(id) {
    return document.getElementById(id);
  }

  function deliver(status) {
    if (mode === "native") {
      listeners.get("gullbert-roommate")({ payload: status });
      return;
    }

    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      origin: dom.window.location.origin,
      source: document.querySelector("iframe").contentWindow,
      data: { type: "roommate", ...status },
    }));
  }

  function savedSettings() {
    if (mode === "native") {
      return commands.findLast((call) => call.command === "update_settings").args.settings;
    }

    return messages.findLast((message) => message.data.type === "settings").data.settings;
  }

  test(`${mode}: roommate updates reach the journal and empty updates clear it`, () => {
    deliver({ mood: "offended", memory: { collection: { sock: 2 } } });
    assert.match(element("mood").textContent, /offended/);
    assert.equal(element("collection-count").textContent, "2");

    deliver({});
    assert.equal(element("collection-items").children.length, 0);
    assert.equal(element("collection-empty").hidden, false);
  });

  // Rendering is shared; exercise its cases once, with the adapter smoke test above in both modes.
  if (mode === "preview") {
    test("completed callbacks appear as natural descriptions in the existing history", () => {
      const episodes = ["snack_spot", "encore:dead", "keepsake:bent_spoon"]
        .map((detail, index) => ({
          id: index + 1,
          kind: "recall",
          detail,
          at: Date.UTC(2026, 9, 18, 12, index),
          location: { x: 100, y: 400, width: 900, height: 600 },
        }));
      deliver({ memory: { version: 3, episodes } });
      assert.match(element("memory-items").textContent, /Revisited his old snack spot/);
      assert.match(element("memory-items").textContent, /Remembered Play dead/);
      assert.match(element("memory-items").textContent, /Brought back his old bent spoon/);
      assert.match(element("today-memories").textContent, /Brought back his old bent spoon/);
    });

    test("journal distinguishes unrewarded performance, learning and practiced tricks", () => {
      deliver({ memory: { performances: { come: 2 } } });
      assert.match(element("lesson-come").textContent, /2 performed.*unrewarded/);
      assert.equal(element("learning-summary").textContent, "No tricks learned yet");

      deliver({ memory: { learned: { tricks: { come: 2, spin: 3, dead: 6 } } } });
      assert.match(element("lesson-come").textContent, /Learning.*2\/3/);
      assert.match(element("lesson-spin").textContent, /Learned.*3\/6/);
      assert.match(element("lesson-dead").textContent, /Practiced/);
      assert.equal(element("learning-summary").textContent, "2 tricks learned");
    });

    test("journal shows when snack and scratch rituals become learned", () => {
      deliver({ memory: { learned: {
        tricks: {}, snackSpot: { meals: 2 }, scratchesAfterPlay: 2,
      } } });
      assert.match(element("snack-ritual").textContent, /2\/3/);
      assert.match(element("scratch-ritual").textContent, /2\/3/);

      deliver({ memory: { learned: {
        tricks: {}, snackSpot: { meals: 3 }, scratchesAfterPlay: 3,
      } } });
      assert.match(element("snack-ritual").textContent, /learned/i);
      assert.match(element("scratch-ritual").textContent, /learned/i);
    });

    test("journal and home show newest memories first and remove stale entries", () => {
      const episodes = Array.from({ length: 14 }, (_, index) => ({
        id: index,
        kind: "trick",
        detail: `example ${index}`,
        // Clock changes must not reorder memories relative to when they were recorded.
        at: Date.UTC(2026, 9, 16, 12, 30 - index),
        location: { x: 100, y: 400, width: 900, height: 600 },
      }));
      deliver({ memory: { episodes } });
      assert.equal(element("memory-summary").textContent, "14 recent memories");
      const journal = [...element("memory-items").children];
      assert.equal(journal.length, 12);
      assert.match(journal[0].textContent, /example 13/);
      assert.match(journal.at(-1).textContent, /example 2/);
      const recent = [...element("today-memories").children];
      assert.equal(recent.length, 3);
      assert.match(recent[0].textContent, /example 13/);
      assert.match(recent.at(-1).textContent, /example 11/);
      assert.equal(
        journal[0].querySelector("time").dateTime,
        new Date(episodes[13].at)
          .toISOString(),
      );
      assert.match(journal[0].textContent, /100, 400/);

      deliver({});
      assert.equal(element("memory-items").children.length, 0);
      assert.equal(element("today-memories").children.length, 0);
      assert.equal(element("memory-empty").hidden, false);
      assert.equal(element("today-memory-empty").hidden, false);
    });

    test("treasures exclude food, unknown items and nonpositive quantities", () => {
      deliver({ memory: { collection: {
        sock: 2, unknown: 8, bottle_cap: 3, chip: 5, bent_spoon: 0, parking_ticket: -1,
      } } });
      const rows = [...element("collection-items").children];
      assert.equal(rows.length, 2);
      assert.match(rows[0].textContent, /One sock.*×2/);
      assert.match(rows[1].textContent, /Bottle cap.*×3/);
      assert.equal(element("collection-count").textContent, "5");
      assert.equal(
        element("today-collection").textContent,
        element("collection-items").textContent,
      );

      deliver({});
      assert.equal(element("today-collection").children.length, 0);
      assert.equal(element("today-collection-empty").hidden, false);
    });

    test("earned favourites appear on both shelves and clear when the item is gone", () => {
      deliver({ memory: {
        collection: { sock: 2, bottle_cap: 1 },
        preferences: { seed: 123, treasureAffection: { sock: 4 } },
      } });
      assert.match(element("collection-items").textContent, /Gullbert’s favourite/);
      assert.match(element("today-collection").textContent, /Gullbert’s favourite/);

      deliver({ memory: {
        collection: { bottle_cap: 1 },
        preferences: { seed: 123, treasureAffection: { sock: 4 } },
      } });
      assert.doesNotMatch(element("collection-items").textContent, /Gullbert’s favourite/);
      assert.doesNotMatch(element("today-collection").textContent, /Gullbert’s favourite/);
    });

    test("a discovered hangout becomes familiar independently of the placed perch", () => {
      deliver({ memory: {
        preferences: { seed: 123, hangout: { x: 0.3, y: 0.6, visits: 1 } },
      } });
      assert.match(element("hangout-summary").textContent, /found himself/);
      assert.equal(element("perch-summary").textContent, "Not chosen yet");

      deliver({ memory: {
        preferences: { seed: 123, hangout: { x: 0.3, y: 0.6, visits: 3 } },
      } });
      assert.match(element("hangout-summary").textContent, /own favourite hangout/);

      deliver({});
      assert.match(element("hangout-summary").textContent, /Still exploring/);
    });

    test("storage errors stay visible alongside memory and clear on recovery", () => {
      deliver({ error: "Disk full", memory: { collection: { sock: 1 } } });
      assert.equal(element("storage-error").textContent, "Disk full");
      assert.equal(element("storage-error").hidden, false);
      assert.equal(element("collection-count").textContent, "1");

      deliver({ memory: { collection: { sock: 1 } } });
      assert.equal(element("storage-error").hidden, true);
    });

    test("home includes the remembered perch and familiar visitors", () => {
      deliver({ memory: { perch: { x: 125, y: 400 }, visits: { pigeon: 2, gull: 1 } } });
      assert.match(element("perch-summary").textContent, /125, 400/);
      assert.match(element("visitor-summary").textContent, /Pigeon: 2.*Other gull: 1/);
    });

    test("navigation opens the chosen page and home links select its subsection", () => {
      document.querySelector('.sidebar [data-page="play"]')
        .click();
      assert.equal(document.querySelector('[data-destination="today"]').hidden, true);
      assert.equal(document.querySelector('[data-destination="play"]').hidden, false);
      assert.equal(document.activeElement.textContent, "Play & learn");

      document.querySelector('[data-page="world"][data-world="treasures"]')
        .click();
      assert.equal(document.querySelector('[data-destination="world"]').hidden, false);
      assert.equal(document.querySelector('[data-world-panel="treasures"]').hidden, false);
      assert.equal(document.querySelector('[data-world-panel="memories"]').hidden, true);
    });

    test("untrusted preview messages cannot alter the journal", () => {
      deliver({ mood: "offended" });

      for (const [origin, source] of [
        ["https://other.test", document.querySelector("iframe").contentWindow],
        [dom.window.location.origin, dom.window],
      ]) {
        dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
          origin, source, data: { type: "roommate", mood: "curious" },
        }));
        assert.match(element("mood").textContent, /offended/);
      }
    });
  }

  test(`${mode}: theme and update channel do not save companion preferences`, async () => {
    element("update-beta")
      .dispatchEvent(new dom.window.Event("change"));
    document.querySelector('button[data-theme="dark"]')
      .click();
    await settle();
    assert.equal(commands.some((call) => call.command === "update_settings"), false);
    assert.equal(messages.some((message) => message.data.type === "settings"), false);
  });

  test(`${mode}: changing the wardrobe preserves pause and updates the portrait`, async () => {
    element("pause-toggle")
      .click();
    await settle();
    assert.equal(element("paused").checked, true);
    element("hat").value = "captain";
    element("hat")
      .dispatchEvent(new dom.window.Event("change"));
    await settle();
    assert.deepEqual(savedSettings(), { ...settings, paused: true, hat: "captain" });
    const hat = document.querySelector(".portrait-hat");
    assert.equal(hat.hidden, false);
    assert.match(hat.src, /captain.svg$/);
  });

  test(`${mode}: demo controls only send actions to the browser preview`, () => {
    document.querySelector('#demo [data-action="nap"]')
      .click();
    assert.equal(commands.length, 0);

    if (mode === "native") {
      assert.equal(element("demo").hidden, true);
      assert.deepEqual(messages, []);
    } else {
      assert.equal(element("demo").hidden, false);
      assert.deepEqual(messages, [{
        data: { type: "action", action: "nap" },
        origin: "https://gullbert.test",
      }]);
    }
  });

  test(`${mode}: preview reset cancels and clears the scene without forgetting memories`, () => {
    element("reset-preview")
      .click();
    assert.equal(commands.length, 0);

    if (mode === "native") {
      assert.deepEqual(messages, []);
    } else {
      assert.deepEqual(messages.map((message) => message.data), [
        { type: "action", action: "cancel" },
        { type: "action", action: "clean" },
        { type: "action", action: "summon" },
      ]);
    }
  });

  if (mode === "native") {
    test("native shutdown failures stay visible after ordinary memory status updates", () => {
      listeners.get("gullbert-shutdown-error")({ payload: "Save failed. Retry Quit." });
      deliver({ mood: "curious" });
      assert.equal(element("error").hidden, false);
      assert.equal(element("error").textContent, "Save failed. Retry Quit.");
    });

    test("native update requests open the update panel", () => {
      element("updates").scrollIntoView = () => {};
      listeners.get("gullbert-open-updates")({ payload: null });
      assert.equal(document.querySelector('[data-destination="settings"]').hidden, false);
      assert.equal(element("updates").open, true);
    });

    test("native placement can be cancelled from the control room", async () => {
      listeners.get("gullbert-target")({ payload: {
        outcome: "started", id: 1, purpose: "feed", preparation: "cancel",
      } });
      assert.equal(element("placement-notice").hidden, false);
      element("cancel-placement")
        .click();
      await settle();
      assert.equal(commands.at(-1).command, "cancel_targeting");
      listeners.get("gullbert-target")({ payload: { outcome: "abandoned", id: 1 } });
      assert.equal(element("placement-notice").hidden, true);
    });

    test("tidy selections keep Done open until the matching terminal notice", async () => {
      const notice = listeners.get("gullbert-target");
      notice({ payload: {
        outcome: "started", id: 1, purpose: "tidy", preparation: "tidy",
      } });
      notice({ payload: { outcome: "abandoned", id: 99 } });
      assert.equal(element("placement-notice").hidden, false);
      notice({ payload: { outcome: "selected", id: 99, point: { x: 1, y: 2 } } });
      assert.equal(element("placement-notice").hidden, false);
      notice({ payload: { outcome: "selected", id: 1, point: { x: 10, y: 20 } } });
      notice({ payload: { outcome: "selected", id: 1, point: { x: 30, y: 40 } } });
      assert.equal(element("placement-notice").hidden, false);
      assert.equal(element("cancel-placement").textContent, "Done");
      element("cancel-placement")
        .click();
      await settle();
      assert.equal(commands.at(-1).command, "cancel_targeting");
      notice({ payload: { outcome: "finished_tidying", id: 1 } });
      assert.equal(element("placement-notice").hidden, true);

      for (const [index, outcome] of [
        "finished_tidying",
        "abandoned",
        "replaced",
      ].entries()) {
        const id = index + 2;
        notice({ payload: {
          outcome: "started", id, purpose: "tidy", preparation: "tidy",
        } });
        notice({ payload: { outcome, id } });
        assert.equal(element("placement-notice").hidden, true);
      }

      notice({ payload: {
        outcome: "started", id: 5, purpose: "feed", preparation: "cancel",
      } });
      notice({ payload: { outcome: "selected", id: 5, point: { x: 50, y: 60 } } });
      assert.equal(element("placement-notice").hidden, true);
    });

    test("failed preference saves restore the previous setting and allow retry", async () => {
      failSave = true;
      element("pause-toggle")
        .click();
      await settle();
      assert.equal(element("paused").checked, false);
      assert.equal(element("pause-toggle").disabled, false);
      assert.match(element("error").textContent, /Could not save preferences/);

      failSave = false;
      element("pause-toggle")
        .click();
      await settle();
      assert.equal(savedSettings().paused, true);
      assert.equal(element("error").hidden, true);
    });
  }
}
