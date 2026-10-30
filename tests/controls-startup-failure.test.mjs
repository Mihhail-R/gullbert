import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

// Before startup steps were independent, the failed request stopped startup and this test hung.
const name = "a missing pet cannot stop control startup or save default settings";

test(name, { timeout: 5000 }, async () => {
  const html = await readFile(new URL("../web-dist/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "https://gullbert.test/" });
  const snapshot = Promise.withResolvers();
  const requested = Promise.withResolvers();
  const saved = [];
  const savedSettings = { paused: true, sound: true, mischief: 2, hat: "none" };
  dom.window.matchMedia = () => {
    return Object.assign(new dom.window.EventTarget(), { matches: false });
  };
  dom.window.__TAURI__ = {
    core: {
      async invoke(command, args) {
        switch (command) {
          case "snapshot":
            requested.resolve();
            return snapshot.promise;

          case "request_roommate":
            throw new Error("Gullbert's window is missing");

          case "update_settings":
            saved.push(args.settings);
            return;

          case "app_version":
            return "0.0.0";

          default:
            throw new Error(`Unexpected native command: ${command}`);
        }
      },
    },
    event: {
      async listen() {
        return () => {};
      },
    },
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    localStorage: dom.window.localStorage,
  });

  try {
    const startup = import("../web-dist/ui/controls/controls.js");
    await requested.promise;
    const document = dom.window.document;
    const hat = document.querySelector("#hat");
    assert.equal(hat.disabled, true);
    hat.value = "beanie";
    hat.dispatchEvent(new dom.window.Event("change"));
    assert.deepEqual(saved, []);

    snapshot.resolve({ settings: savedSettings, visible: true, shortcut_errors: [] });
    await startup;

    assert.equal(document.querySelector("#paused").checked, true);
    assert.equal(document.querySelector("#mischief").value, "2");
    assert.equal(hat.disabled, false);
    assert.match(document.querySelector("#error").textContent, /window is missing/);

    const sound = document.querySelector("#sound");
    sound.checked = false;
    sound.dispatchEvent(new dom.window.Event("change"));
    await new Promise((resolve) => setTimeout(resolve));
    assert.deepEqual(saved, [{ ...savedSettings, sound: false }]);
  } finally {
    dom.window.close();
  }
});
