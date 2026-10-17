import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { buildPages } from "../scripts/build-pages.mjs";

test("Pages publishes only the playground with assets under a project subpath", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "gullbert-pages-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const destination = path.join(directory, "gullbert");
  const nativeEntry = new URL("../web-dist/index.html", import.meta.url);
  const original = await readFile(nativeEntry, "utf8");
  buildPages(destination);
  const html = await readFile(path.join(destination, "index.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://example.test/gullbert/" });
  t.after(() => {
    dom.window.close();
  });
  const document = dom.window.document;
  assert.equal(document.querySelector(".room"), null);
  assert.equal(document.querySelector("nav"), null);
  assert.equal(document.querySelector("main#demo").hidden, false);
  assert.ok(document.querySelector("iframe"));
  assert.ok(document.querySelector('[data-action="preen"]'));
  assert.equal(
    document.querySelector('script[type="module"]')
      .getAttribute("src"),
    "ui/playground.js"
  );

  const assets = ["ui/playground.js", "ui/controls/controls.css", "pet.html", "ui/icons.svg"];

  for (const asset of assets) {
    const url = new URL(asset, dom.window.location.href);
    assert.equal(url.pathname, `/gullbert/${asset}`);
    await access(path.join(directory, url.pathname.slice(1)));
  }

  assert.equal(await readFile(nativeEntry, "utf8"), original);
  assert.match(original, /class="room"/);
});

test("standalone playground starts an active bird and routes its controls", async (t) => {
  const html = await readFile(new URL("../web-dist/playground.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "https://example.test/gullbert/" });
  const { window } = dom;
  const { document } = window;
  const media = new window.EventTarget();
  media.matches = false;
  window.matchMedia = () => {
    return media;
  };
  window.localStorage.setItem("gullbert.preferences.v1", JSON.stringify({ paused: true }));
  Object.assign(globalThis, {
    window,
    document,
    location: window.location,
    localStorage: window.localStorage,
  });
  t.after(() => {
    window.dispatchEvent(new window.Event("pagehide"));
    window.close();
  });
  await import("../web-dist/ui/playground.js");
  const frame = document.querySelector("iframe");
  assert.equal(frame.src, "https://example.test/gullbert/pet.html");
  const messages = [];
  frame.contentWindow.postMessage = (message, origin) => {
    assert.equal(origin, window.location.origin);
    messages.push(message);
  };

  function ready(origin, source) {
    window.dispatchEvent(new window.MessageEvent("message", {
      origin,
      source,
      data: { type: "ready" },
    }));
  }

  ready("https://unrelated.test", frame.contentWindow);
  ready(window.location.origin, window);
  assert.deepEqual(messages, []);
  ready(window.location.origin, frame.contentWindow);
  assert.deepEqual(messages.splice(0), [
    { type: "settings", settings: { paused: false, sound: false, mischief: 1, hat: "none" } },
    { type: "visible", visible: true },
  ]);
  document.querySelector('[data-action="preen"]')
    .click();
  assert.deepEqual(messages.splice(0), [{ type: "action", action: "preen" }]);
  document.querySelector("#reset-preview")
    .click();
  assert.deepEqual(messages.splice(0), [
    { type: "action", action: "cancel" },
    { type: "action", action: "clean" },
    { type: "action", action: "summon" },
  ]);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.deepEqual(messages.splice(0), [{ type: "escape" }]);
  const mischief = document.querySelector("#preview-mischief");
  mischief.value = "2";
  mischief.dispatchEvent(new window.Event("change"));
  assert.equal(messages.at(-1).settings.mischief, 2);
  const sound = document.querySelector("#preview-sound");
  sound.checked = true;
  sound.dispatchEvent(new window.Event("change"));
  assert.deepEqual(messages.at(-1), {
    type: "settings",
    settings: { paused: false, sound: true, mischief: 2, hat: "none" },
  });
});
