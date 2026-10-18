import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { setupAppearance } from "../web-dist/ui/controls/appearance.js";

const html = await readFile(new URL("../web-dist/index.html", import.meta.url), "utf8");
const appearanceKey = "gullbert.appearance.v1";

function appearanceFixture(t, { saved, dark = false } = {}) {
  const dom = new JSDOM(html, { url: "https://gullbert.test/" });
  const { window } = dom;
  const media = new window.EventTarget();
  media.matches = dark;
  window.matchMedia = (query) => {
    assert.equal(query, "(prefers-color-scheme: dark)");
    return media;
  };

  if (saved !== undefined) {
    window.localStorage.setItem(appearanceKey, saved);
  }

  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
  });
  setupAppearance();
  t.after(() => {
    window.dispatchEvent(new window.Event("pagehide"));
    window.close();
  });

  function choose(preference) {
    window.document.querySelector(`button[data-theme="${preference}"]`)
      .click();
  }

  function systemChange(matches) {
    media.matches = matches;
    media.dispatchEvent(new window.Event("change"));
  }

  function assertTheme(preference, resolved) {
    assert.equal(window.document.body.dataset.theme, resolved);
    const selected = window.document.querySelectorAll('[data-theme][aria-pressed="true"]');
    assert.equal(selected.length, 1);
    assert.equal(selected[0].dataset.theme, preference);
    const frame = window.document.querySelector("iframe");
    assert.equal(frame.contentDocument.body.dataset.theme, resolved);
  }

  return { window, choose, systemChange, assertTheme };
}

test("System is the default and follows appearance changes without saving an override", (t) => {
  const fixture = appearanceFixture(t);
  fixture.assertTheme("system", "light");
  fixture.systemChange(true);
  fixture.assertTheme("system", "dark");
  fixture.systemChange(false);
  fixture.assertTheme("system", "light");
  assert.equal(fixture.window.localStorage.getItem(appearanceKey), null);
});

test("saved manual themes ignore system changes; choosing System resumes following", (t) => {
  const fixture = appearanceFixture(t, { saved: "light", dark: true });
  fixture.assertTheme("light", "light");
  fixture.systemChange(false);
  fixture.systemChange(true);
  fixture.assertTheme("light", "light");
  fixture.choose("dark");
  fixture.systemChange(false);
  fixture.assertTheme("dark", "dark");
  fixture.choose("system");
  fixture.assertTheme("system", "light");
  assert.equal(fixture.window.localStorage.getItem(appearanceKey), "system");
  fixture.systemChange(true);
  fixture.assertTheme("system", "dark");
});

test("saved System mode resolves the OS theme on startup", (t) => {
  const fixture = appearanceFixture(t, { saved: "system", dark: true });
  fixture.assertTheme("system", "dark");
});

test("invalid preferences and cleared storage fall back to System", (t) => {
  const fixture = appearanceFixture(t, { saved: "unknown", dark: true });
  fixture.assertTheme("system", "dark");
  fixture.choose("light");
  fixture.window.dispatchEvent(new fixture.window.StorageEvent("storage", {
    key: "unrelated",
    newValue: "dark",
  }));
  fixture.assertTheme("light", "light");
  fixture.window.dispatchEvent(new fixture.window.StorageEvent("storage", {
    key: appearanceKey,
    newValue: "dark",
  }));
  fixture.assertTheme("dark", "dark");
  fixture.window.dispatchEvent(new fixture.window.StorageEvent("storage", {
    key: null,
    newValue: null,
  }));
  fixture.assertTheme("system", "dark");
});

test("page cleanup stops listening to OS appearance changes", (t) => {
  const fixture = appearanceFixture(t);
  fixture.window.dispatchEvent(new fixture.window.Event("pagehide"));
  fixture.systemChange(true);
  fixture.assertTheme("system", "light");
});

test("a failed appearance save keeps the chosen theme usable and allows retry", (t) => {
  const fixture = appearanceFixture(t);
  const storage = fixture.window.Storage.prototype;
  const original = storage.setItem;
  storage.setItem = () => {
    throw new Error("Storage unavailable");
  };

  try {
    fixture.choose("dark");
    fixture.assertTheme("dark", "dark");
    const error = fixture.window.document.getElementById("theme-error");
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /Could not save appearance/);
  } finally {
    storage.setItem = original;
  }

  fixture.choose("light");
  assert.equal(fixture.window.localStorage.getItem(appearanceKey), "light");
  assert.equal(fixture.window.document.getElementById("theme-error").hidden, true);
});
