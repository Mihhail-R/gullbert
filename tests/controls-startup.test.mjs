import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

test("native controls retain events received while the startup snapshot is pending", async () => {
  const html = await readFile(new URL("../web-dist/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "https://gullbert.test/" });
  const listeners = new Map();
  const snapshot = Promise.withResolvers();
  const requested = Promise.withResolvers();
  const initialSettings = { paused: false, sound: false, mischief: 1, hat: "none" };
  const latestSettings = { paused: true, sound: true, mischief: 2, hat: "none" };
  dom.window.matchMedia = () => {
    return Object.assign(new dom.window.EventTarget(), { matches: false });
  };
  dom.window.__TAURI__ = {
    core: {
      async invoke(command) {
        switch (command) {
          case "snapshot":
            requested.resolve();
            return snapshot.promise;

          case "request_roommate":
            return;

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
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    localStorage: dom.window.localStorage,
  });

  try {
    const startup = import("../web-dist/ui/controls/controls.js");
    await requested.promise;
    listeners.get("gullbert-settings")({ payload: latestSettings });
    listeners.get("gullbert-visible")({ payload: false });
    snapshot.resolve({ settings: initialSettings, visible: true, shortcut_errors: [] });
    await startup;

    const document = dom.window.document;
    assert.equal(document.querySelector("#paused").checked, true);
    assert.equal(document.querySelector("#sound").checked, true);
    assert.equal(document.querySelector("#mischief").value, "2");
    assert.equal(document.querySelector("#visibility-toggle").dataset.action, "show");
    assert.equal(document.querySelector("#status").textContent, "Away for a little while.");

    listeners.get("gullbert-settings")({ payload: initialSettings });
    listeners.get("gullbert-visible")({ payload: true });
    assert.equal(document.querySelector("#paused").checked, false);
    assert.equal(document.querySelector("#visibility-toggle").dataset.action, "hide");
  } finally {
    dom.window.close();
  }
});
