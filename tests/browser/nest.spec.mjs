import { test, expect } from "@playwright/test";
import { Gullbert } from "../../web-dist/simulation/engine.js";
import { reach } from "../simulation-helpers.mjs";

test("nest scenery renders three owned finds below a sleeping gull and disposes cleanly", async (
  { page },
  testInfo,
) => {
  const sim = new Gullbert(800, 600, () => 0);
  sim.configure({ paused: true, mischief: 0, sound: false });
  sim.restoreMemory({ collection: { shell: 1, button: 1, foil_ball: 1 } });
  sim.action("place_nest", { x: 400, y: 360 });
  reach(sim, "sleep");

  await page.route("**/ui/pet/pet.js", (route) => route.fulfill({
    contentType: "text/javascript", body: "",
  }));
  await page.goto("/pet.html");
  await page.addStyleTag({ content: "html { background: #d6edf1 !important; }" });
  await page.evaluate(async (state) => {
    const { createPetRenderer } = await import("/ui/pet/pet-renderer.js");
    window.renderNestTest = createPetRenderer(document.querySelector("#world"));
    window.renderNestTest(state);
  }, sim.present());
  await expect(page.locator("#rubbish-nest"))
    .toBeVisible();
  await expect(page.locator(".nest-treasure:visible"))
    .toHaveCount(3);
  await expect(page.locator("#gull"))
    .toHaveAttribute("data-pose", /^nap-(sleep|wobble)$/);
  await expect.poll(() => page.locator("#rubbish-nest img")
    .evaluateAll((images) => {
      return images.every((image) => image.complete && image.naturalWidth > 0);
    }))
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("nest.png"),
    clip: { x: 260, y: 150, width: 280, height: 260 },
  });

  sim.action("clear_nest");
  await page.evaluate((state) => window.renderNestTest(state), sim.present());
  await expect(page.locator("#rubbish-nest"))
    .toBeHidden();
  await page.evaluate(() => window.renderNestTest.dispose());
  await expect(page.locator("#rubbish-nest"))
    .toHaveCount(0);
});

test("control-room nest placement, movement and removal reach the live pet", async ({ page }) => {
  await page.goto("/index.html");
  const pet = page.frameLocator("iframe");
  await expect(pet.locator("#world"))
    .toBeVisible();
  await page.getByRole("button", { name: "His world", exact: true })
    .click();
  await page.getByRole("button", { name: "Rituals & places", exact: true })
    .click();
  const place = page.getByRole("button", { name: "Place nest…", exact: true });
  await place.click();
  await expect(pet.getByRole("status"))
    .toContainText("Pick a home for his nest.");
  await pet.locator("body")
    .click({ position: { x: 160, y: 240 } });
  const nest = pet.locator("#rubbish-nest");
  await expect(nest)
    .toBeVisible();
  await expect(nest)
    .toHaveCSS("left", "112px");
  await expect(page.locator("#nest-summary"))
    .toHaveText("0 of 3 treasures on display");
  await place.click();
  await pet.locator("body")
    .click({ position: { x: 260, y: 260 } });
  await expect(nest)
    .toHaveCSS("left", "212px");
  await page.getByRole("button", { name: "Remove nest", exact: true })
    .click();
  await expect(nest)
    .toBeHidden();
});

test("nest treasures can be dragged, thrown and returned through real pointer events", async (
  { page },
  testInfo,
) => {
  await page.addInitScript(() => {
    localStorage.setItem("gullbert.roommate.v1", JSON.stringify({
      collection: { shell: 1, button: 1 },
      nest: { x: 200, y: 300, items: ["shell", "button"] },
    }));
  });
  await page.goto("/pet.html");
  await expect(page.locator(".nest-treasure:visible"))
    .toHaveCount(2);
  await page.mouse.move(215, 376);
  await page.mouse.down();
  await page.mouse.move(420, 360, { steps: 8 });
  await expect(page.locator(".nest-treasure:visible"))
    .toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator("#speech"))
    .toContainText("Again.", { timeout: 10000 });
  await expect.poll(() => page.locator('[data-prop="nest-play-treasure"]')
    .evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("nest-fetch.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".nest-treasure:visible"))
    .toHaveCount(2);
  const collection = await page.evaluate(() => {
    return JSON.parse(localStorage.getItem("gullbert.roommate.v1")).collection;
  });
  expect(collection)
    .toEqual({ shell: 1, button: 1 });
});
