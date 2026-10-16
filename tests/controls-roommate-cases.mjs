import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

// Separate test entrypoints isolate the bridge's import-time native detection.
export function roommateRenderingTests(mode) {
  let dom;
  let document;
  const listeners = new Map();
  const settings = { paused: false, sound: false, mischief: 1, hat: "none" };

  before(async () => {
    const html = await readFile(new URL("../web-dist/index.html", import.meta.url), "utf8");
    dom = new JSDOM(html, { url: "https://gullbert.test/" });
    document = dom.window.document;
    Object.assign(globalThis, {
      window: dom.window,
      document,
      location: dom.window.location,
      localStorage: dom.window.localStorage,
    });

    if (mode === "native") {
      dom.window.__TAURI__ = {
        core: {
          async invoke(command) {
            switch (command) {
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
            return () => listeners.delete(name);
          },
        },
      };
    }

    await import("../web-dist/ui/controls/controls.js");
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
    assert.equal(element("learning-summary").textContent, "Getting to know you");

    for (const trick of ["come", "spin", "dead"]) {
      assert.equal(element(`lesson-${trick}`).textContent, "New trick");
    }

    assert.equal(
      element("snack-ritual").textContent,
      "Feed him in the same spot a few times. He’ll remember.",
    );
    assert.equal(
      element("scratch-ritual").textContent,
      "Scratch his head after cap football or a chip toss to start a ritual.",
    );
    assert.equal(element("memory-summary").textContent, "A fresh start");
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
      [0, 2, "2 performed · no chip rewards yet"],
      [1, 0, "Making the connection · 1/3"],
      [2, 4, "Making the connection · 2/3 · 4 performed"],
      [3, 0, "Learned · 3/6"],
      [5, 8, "Learned · 5/6 · 8 performed"],
      [6, 9, "Professional nuisance · 6/6 · 9 performed"],
    ];

    for (const [count, performed, label] of cases) {
      deliver({ memory: {
        learned: { tricks: { come: count, spin: 0, dead: 0 } },
        performances: { come: performed },
      } });
      assert.equal(element("lesson-come").textContent, label);
      const summary = count >= 3 ? "1 questionable trick learned" : "Getting to know you";
      assert.equal(element("learning-summary").textContent, summary);
    }

    deliver({ memory: { learned: { tricks: { come: 3, spin: 6, dead: 2 } } } });
    assert.equal(element("learning-summary").textContent, "2 questionable tricks learned");

    for (const count of [1, 2, 3]) {
      deliver({ memory: { learned: {
        tricks: { come: 0, spin: 0, dead: 0 },
        snackSpot: { meals: count },
        scratchesAfterPlay: count,
      } } });
      const snack = count === 3
        ? "Snack spot remembered. He’ll occasionally check the usual establishment."
        : `Noticing a snack spot · ${count}/3 meals here.`;
      const scratch = count === 3
        ? "After-play scratches remembered. He’ll present his head after a game."
        : `Learning your after-play ritual · ${count}/3 head scratches.`;
      assert.equal(element("snack-ritual").textContent, snack);
      assert.equal(element("scratch-ritual").textContent, scratch);
    }
  });

  test(`${mode}: memories keep total count, reverse array order, dates and node structure`, () => {
    // Descending timestamps make reversing insertion order distinguishable from date sorting.
    const episodes = Array.from({ length: 14 }, (_, index) => ({
      id: index,
      kind: "trick",
      detail: `example ${index}`,
      at: Date.UTC(2026, 9, 16, 12, 30 - index),
      location: { x: 100, y: 400, width: 900, height: 600 },
    }));
    deliver({ mood: "offended", memory: { episodes } });
    assert.equal(element("mood").textContent, "Feeling offended.");
    assert.equal(element("memory-summary").textContent, "14 recent memories");
    assert.equal(element("memory-empty").hidden, true);
    const rows = [...element("memory-items").children];
    assert.equal(rows.length, 12);
    assert.deepEqual(
      rows.map((row) => row.firstElementChild.textContent),
      Array.from({ length: 12 }, (_, index) => `Performed example ${13 - index}`)
    );

    for (const [index, row] of rows.entries()) {
      assert.equal(row.tagName, "LI");
      assert.deepEqual([...row.children].map((node) => node.tagName), ["STRONG", "SMALL"]);
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
    assert.equal(element("memory-summary").textContent, "A fresh start");
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
      assert.deepEqual([...row.children].map((node) => node.tagName), ["IMG", "STRONG", "SPAN"]);
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
      .map((record) => record.target.id)
      .filter((id) => id);
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
      "collection-count",
      "belongings-summary",
      "collection-empty",
      "collection-items",
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
}
