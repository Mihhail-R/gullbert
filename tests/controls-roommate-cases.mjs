import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

// Separate test entrypoints isolate the bridge's import-time native detection.
export function roommateRenderingTests(mode) {
  let dom;
  let document;
  const listeners = new Map();
  const commands = [];
  const messages = [];
  let failSave = false;
  const settings = { paused: false, sound: false, mischief: 1, hat: "none" };

  before(async () => {
    const html = await readFile(new URL("../web-dist/index.html", import.meta.url), "utf8");
    dom = new JSDOM(html, { url: "https://gullbert.test/" });
    document = dom.window.document;
    dom.window.localStorage.setItem("gullbert.appearance.v1", "dark");
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

              case "caret_access":
                return { available: false, platform: "test" };

              case "vision_status":
                return { supported: false, granted: false, state: "unsupported" };

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
            return () => {
              return listeners.delete(name)
            };
          },
        },
      };
    }

    await import("../web-dist/ui/controls/controls.js");
    const frame = document.querySelector("iframe");
    frame.contentDocument.open();
    frame.contentDocument.write("<!doctype html><html><body></body></html>");
    frame.contentDocument.close();
    frame.contentWindow.postMessage = (data, origin) => {
      messages.push({ data, origin });
    };
  });

  after(() => {
    dom?.window.close();
  });

  function element(id) {
    const node = document.getElementById(id);
    assert.ok(node, `template contains #${id}`);
    return node;
  }

  function deliver(status) {
    if (mode === "native") {
      const receive = listeners.get("gullbert-roommate");
      assert.ok(receive, "native roommate listener registered");
      receive({ payload: status });
      return;
    }

    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      origin: dom.window.location.origin,
      source: document.querySelector("iframe").contentWindow,
      data: { type: "roommate", ...status },
    }));
  }

  test(`${mode}: empty status resets all roommate sections`, () => {
    deliver({});
    assert.equal(element("mood").textContent, "Contentedly gull.");
    assert.equal(element("learning-summary").textContent, "No tricks learned yet");

    for (const trick of ["come", "spin", "dead"]) {
      assert.equal(element(`lesson-${trick}`).textContent, "New trick");
    }

    assert.equal(
      element("snack-ritual").textContent,
      "Feed him in one spot 3 times to teach a snack stop.",
    );
    assert.equal(
      element("scratch-ritual").textContent,
      "Scratch his head after games 3 times to start a ritual.",
    );
    assert.equal(element("memory-summary").textContent, "No memories yet");
    assert.equal(element("memory-empty").hidden, false);
    assert.equal(element("memory-items").children.length, 0);
    assert.equal(element("collection-count").textContent, "0");
    assert.equal(element("belongings-summary").textContent, "No treasures yet");
    assert.equal(element("collection-empty").hidden, false);
    assert.equal(element("collection-items").children.length, 0);
    assert.equal(element("storage-error").textContent, "");
    assert.equal(element("storage-error").hidden, true);
  });

  test(`${mode}: trick and ritual thresholds preserve exact labels`, () => {
    const cases = [
      [0, 0, "New trick"],
      [0, 2, "2 performed · unrewarded"],
      [1, 0, "Learning · 1/3"],
      [2, 4, "Learning · 2/3 · 4 performed"],
      [3, 0, "Learned · 3/6"],
      [5, 8, "Learned · 5/6 · 8 performed"],
      [6, 9, "Practiced · 6/6 · 9 performed"],
    ];

    for (const [count, performed, label] of cases) {
      deliver({ memory: {
        learned: { tricks: { come: count, spin: 0, dead: 0 } },
        performances: { come: performed },
      } });
      assert.equal(element("lesson-come").textContent, label);
      const summary = count >= 3 ? "1 trick learned" : "No tricks learned yet";
      assert.equal(element("learning-summary").textContent, summary);
    }

    deliver({ memory: { learned: { tricks: { come: 3, spin: 6, dead: 2 } } } });
    assert.equal(element("learning-summary").textContent, "2 tricks learned");

    for (const count of [1, 2, 3]) {
      deliver({ memory: { learned: {
        tricks: { come: 0, spin: 0, dead: 0 },
        snackSpot: { meals: count },
        scratchesAfterPlay: count,
      } } });
      const snack = count === 3
        ? "Snack spot learned. He’ll return for food."
        : `Learning a snack spot · ${count}/3 meals here.`;
      const scratch = count === 3
        ? "Scratch ritual learned. He’ll ask after games."
        : `Learning a scratch ritual · ${count}/3 head scratches.`;
      assert.equal(element("snack-ritual").textContent, snack);
      assert.equal(element("scratch-ritual").textContent, scratch);
    }
  });

  test(`${mode}: memories keep total count, reverse array order, dates and node structure`, () => {
    // Descending timestamps make reversing insertion order distinguishable from date sorting.
    const episodes = Array.from({ length: 14 }, (_, index) => {
      return {
        id: index,
        kind: "trick",
        detail: `example ${index}`,
        at: Date.UTC(2026, 9, 16, 12, 30 - index),
        location: { x: 100, y: 400, width: 900, height: 600 },
      }
    });
    deliver({ mood: "offended", memory: { episodes } });
    assert.equal(element("mood").textContent, "Feeling offended.");
    assert.equal(element("memory-summary").textContent, "14 recent memories");
    assert.equal(element("memory-empty").hidden, true);
    const rows = [...element("memory-items").children];
    assert.equal(rows.length, 12);
    assert.deepEqual(
      rows.map((row) => {
        return row.firstElementChild.textContent
      }),
      Array.from({ length: 12 }, (_, index) => {
        return `Performed example ${13 - index}`
      })
    );

    for (const [index, row] of rows.entries()) {
      assert.equal(row.tagName, "LI");
      assert.deepEqual([...row.children].map((node) => {
        return node.tagName
      }), ["STRONG", "SMALL"]);
      const context = row.lastElementChild;
      const time = context.firstElementChild;
      const date = new Date(episodes[13 - index].at);
      assert.equal(time.tagName, "TIME");
      assert.equal(time.dateTime, date.toISOString());
      assert.equal(time.textContent, date.toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      }));
      assert.equal(context.lastChild.textContent, " · middle left · 100, 400");
    }

    deliver({ memory: { episodes: [episodes[0]] } });
    assert.equal(element("memory-summary").textContent, "1 recent memory");
    assert.equal(element("memory-items").children.length, 1);
    assert.equal(rows[0].isConnected, false);
    deliver({});
    assert.equal(element("memory-summary").textContent, "No memories yet");
    assert.equal(element("memory-items").children.length, 0);
    assert.equal(element("memory-empty").hidden, false);
  });

  test(`${mode}: collection filtering preserves quantities, order and markup`, () => {
    deliver({ memory: { collection: {
      sock: 2, unknown: 8, bottle_cap: 3, chip: 5, bent_spoon: 0, parking_ticket: -1,
    } } });
    assert.equal(element("collection-count").textContent, "5");
    assert.equal(element("belongings-summary").textContent, "5 collected");
    assert.equal(element("collection-empty").hidden, true);
    const rows = [...element("collection-items").children];
    assert.equal(rows.length, 2);
    const expected = [
      ["sock", "One sock", "The other one lacked vision.", "×2"],
      ["bottle_cap", "Bottle cap", "A crown. For a very small king.", "×3"],
    ];

    for (const [index, row] of rows.entries()) {
      const [id, name, description, quantity] = expected[index];
      assert.equal(row.tagName, "LI");
      assert.deepEqual([...row.children].map((node) => {
        return node.tagName
      }), ["IMG", "STRONG", "SPAN"]);
      assert.equal(row.children[0].getAttribute("src"), `assets/belongings/${id}.svg`);
      assert.equal(row.children[0].getAttribute("alt"), "");
      assert.equal(row.children[1].firstChild.textContent, name);
      assert.equal(row.children[1].lastElementChild.tagName, "SMALL");
      assert.equal(row.children[1].lastElementChild.textContent, description);
      assert.equal(row.children[2].textContent, quantity);
    }

    deliver({ memory: { collection: { sock: 0, unknown: 1 } } });
    assert.equal(element("collection-items").children.length, 0);
    assert.equal(rows[0].isConnected, false);
    assert.equal(element("collection-count").textContent, "0");
    assert.equal(element("belongings-summary").textContent, "No treasures yet");
    assert.equal(element("collection-empty").hidden, false);
  });

  test(`${mode}: storage errors appear and clear after section updates`, () => {
    deliver({});
    const observer = new dom.window.MutationObserver(() => {});
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    deliver({
      mood: "offended",
      error: "Disk full",
      memory: {
        collection: { sock: 1 },
        episodes: [{
          id: 1,
          kind: "meal",
          detail: "",
          at: 0,
          location: { x: 0, y: 0, width: 900, height: 600 },
        }],
      },
    });
    assert.equal(element("storage-error").textContent, "Disk full");
    assert.equal(element("storage-error").hidden, false);
    const updates = observer.takeRecords()
      .map((record) => {
        return record.target.id
      })
      .filter((id) => {
        return id
      });
    assert.deepEqual([...new Set(updates)], [
      "mood",
      "lesson-come",
      "lesson-spin",
      "lesson-dead",
      "learning-summary",
      "snack-ritual",
      "scratch-ritual",
      "memory-summary",
      "memory-empty",
      "memory-items",
      "today-memory-empty",
      "today-memories",
      "collection-count",
      "belongings-summary",
      "collection-empty",
      "collection-items",
      "today-collection-empty",
      "today-collection",
      "perch-summary",
      "visitor-summary",
      "storage-error",
    ]);
    assert.deepEqual(updates.slice(-2), ["storage-error", "storage-error"]);
    observer.disconnect();
    deliver({ error: "" });
    assert.equal(element("storage-error").textContent, "");
    assert.equal(element("storage-error").hidden, true);
    deliver({ error: "Try again" });
    deliver({});
    assert.equal(element("storage-error").textContent, "");
    assert.equal(element("storage-error").hidden, true);
  });

  test(`${mode}: navigation, home links and appearance preserve the live page`, () => {
    assert.equal(document.body.dataset.theme, "dark", "restores saved appearance");
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
    assert.equal(document.querySelector('.subnav [aria-current]').dataset.world, "treasures");

    document.querySelector('.sidebar [data-page="settings"]')
      .click();
    document.querySelector('[data-theme="light"]')
      .click();
    assert.equal(document.body.dataset.theme, "light");
    assert.equal(localStorage.getItem("gullbert.appearance.v1"), "light");
    assert.equal(document.querySelector('button[data-theme="light"]').ariaPressed, "true");
    assert.equal(document.querySelector('[data-destination="settings"]').hidden, false);
    assert.equal(document.querySelector("iframe").contentDocument.body.dataset.theme, "light");
  });

  test(`${mode}: Home shows real recent memories and keeps its shelf in sync`, () => {
    const episodes = Array.from({ length: 5 }, (_, index) => {
      return {
        id: index,
        kind: "trick",
        detail: `example ${index}`,
        at: Date.UTC(2026, 9, 16, 12, index),
        location: { x: 10, y: 20, width: 900, height: 600 },
      }
    });
    deliver({ memory: {
      episodes,
      collection: { sock: 2, bottle_cap: 3 },
      perch: { x: 125, y: 400 },
      visits: { pigeon: 2, gull: 1 },
    } });
    assert.deepEqual(
      [...element("today-memories")
        .querySelectorAll("strong")].map((row) => {
        return row.textContent
      }),
      ["Performed example 4", "Performed example 3", "Performed example 2"],
    );
    assert.equal(element("today-collection").children.length, 2);
    assert.match(element("today-collection").textContent, /×2/);
    assert.match(element("perch-summary").textContent, /125, 400/);
    assert.match(element("visitor-summary").textContent, /Pigeon: 2 · Other gull: 1/);
    deliver({});
    assert.equal(element("today-memories").children.length, 0);
    assert.equal(element("today-collection").children.length, 0);
    assert.equal(element("today-memory-empty").hidden, false);
    assert.equal(element("today-collection-empty").hidden, false);
    assert.equal(element("perch-summary").textContent, "Not chosen yet");
  });

  test(`${mode}: update channel and appearance do not save companion preferences`, async () => {
    commands.length = 0;
    messages.length = 0;
    element("update-beta")
      .dispatchEvent(new dom.window.Event("change"));
    document.querySelector('button[data-theme="dark"]')
      .click();
    await new Promise((resolve) => {
      return setImmediate(resolve)
    });
    assert.equal(commands.some((call) => {
      return call.command === "update_settings"
    }), false);
    assert.equal(messages.some((message) => {
      return message.data.type === "settings"
    }), false);
  });

  test(`${mode}: pause and wardrobe use real settings; hats use production geometry`, async () => {
    commands.length = 0;
    messages.length = 0;
    element("pause-toggle")
      .click();
    await new Promise((resolve) => {
      return setImmediate(resolve)
    });
    assert.equal(element("paused").checked, true);
    assert.equal(element("pause-label").textContent, "Resume antics");
    assert.equal(
      document.querySelector("#pause-toggle use")
        .getAttribute("href"),
      "ui/icons.svg#play"
    );
    element("hat").value = "captain";
    element("hat")
      .dispatchEvent(new dom.window.Event("change"));
    await new Promise((resolve) => {
      return setImmediate(resolve)
    });
    const saved = mode === "native"
      ? commands.filter((call) => {
        return call.command === "update_settings"
      })
        .at(-1).args.settings
      : messages.filter((message) => {
        return message.data.type === "settings"
      })
        .at(-1).data.settings;
    assert.equal(saved.paused, true);
    assert.equal(saved.hat, "captain");
    assert.equal("theme" in saved, false);

    for (const hat of document.querySelectorAll(".portrait-hat")) {
      assert.equal(hat.hidden, false);
      assert.equal(hat.getAttribute("src"), "assets/theatre/captain.svg");
      assert.equal(hat.style.left, "24px");
      assert.equal(hat.style.top, "-6px");
    }
  });

  test(`${mode}: demo cues stay on the website; deliberate play stays in app`, () => {
    const forced = ["nap", "preen", "poop", "target", "baguette_parade", "eat_cursor"];

    for (const action of forced) {
      assert.equal(document.querySelector(`.room [data-action="${action}"]`), null);
      assert.ok(document.querySelector(`#demo [data-action="${action}"]`));
    }

    for (const action of ["feed", "trick_spin", "play_cap", "place_perch", "clean"]) {
      assert.ok(document.querySelector(`.room [data-action="${action}"]`));
    }

    commands.length = 0;
    messages.length = 0;
    document.querySelector('#demo [data-action="nap"]')
      .click();
    assert.equal(commands.length, 0);

    if (mode === "native") {
      assert.equal(element("demo").hidden, true);
      assert.equal(messages.length, 0);
    } else {
      assert.equal(element("demo").hidden, false);
      assert.deepEqual(messages, [{
        data: { type: "action", action: "nap" },
        origin: "https://gullbert.test",
      }]);
    }
  });

  test(`${mode}: native updates, targeting and failed saves retain safe state`, async () => {
    if (mode !== "native") {
      return;
    }

    element("updates").scrollIntoView = () => {};
    document.querySelector('.sidebar [data-page="today"]')
      .click();
    listeners.get("gullbert-open-updates")({ payload: null });
    assert.equal(document.querySelector('[data-destination="settings"]').hidden, false);
    assert.equal(element("updates").open, true);
    listeners.get("gullbert-target")({ payload: {
      outcome: "started", id: 1, purpose: "feed", preparation: "cancel",
    } });
    assert.equal(element("placement-notice").hidden, false);
    element("cancel-placement")
      .click();
    await new Promise((resolve) => {
      return setImmediate(resolve)
    });
    assert.equal(commands.at(-1).command, "cancel_targeting");
    listeners.get("gullbert-target")({ payload: { outcome: "abandoned", id: 1 } });
    assert.equal(element("placement-notice").hidden, true);
    failSave = true;
    element("pause-toggle")
      .click();
    await new Promise((resolve) => {
      return setImmediate(resolve)
    });
    assert.equal(element("paused").checked, true, "failed save restores the previous state");
    assert.equal(element("pause-toggle").disabled, false);
    assert.match(element("error").textContent, /Could not save preferences/);
    failSave = false;
  });

  test(`${mode}: untrusted preview messages cannot alter the journal`, () => {
    if (mode !== "preview") {
      return;
    }

    deliver({ mood: "offended" });

    for (const [origin, source] of [
      ["https://other.test", document.querySelector("iframe").contentWindow],
      [dom.window.location.origin, dom.window],
    ]) {
      dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
        origin, source, data: { type: "roommate", mood: "curious" },
      }));
      assert.equal(element("mood").textContent, "Feeling offended.");
    }
  });

  test(`${mode}: preview reset uses safe commands without forgetting memories`, () => {
    commands.length = 0;
    messages.length = 0;
    element("reset-preview")
      .click();
    assert.equal(commands.length, 0);

    if (mode === "native") {
      assert.equal(messages.length, 0);
    } else {
      assert.deepEqual(messages.map((message) => {
        return message.data
      }), [
        { type: "action", action: "cancel" },
        { type: "action", action: "clean" },
        { type: "action", action: "summon" },
      ]);
    }
  });

  test(`${mode}: unavailable appearance storage keeps the chosen theme usable`, () => {
    const storagePrototype = dom.window.Storage.prototype;
    const original = storagePrototype.setItem;
    storagePrototype.setItem = () => {
      throw new Error("Storage unavailable");
    };

    try {
      document.querySelector('button[data-theme="light"]')
        .click();
      assert.equal(document.body.dataset.theme, "light");
      assert.equal(element("theme-error").hidden, false);
      assert.match(element("theme-error").textContent, /Could not save appearance/);
    } finally {
      storagePrototype.setItem = original;
    }

    document.querySelector('button[data-theme="dark"]')
      .click();
    assert.equal(element("theme-error").hidden, true);
  });
}
