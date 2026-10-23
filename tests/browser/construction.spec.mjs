import { test, expect } from "@playwright/test";
import { Gullbert } from "../../web-dist/simulation/engine.js";
import { advance, reach } from "../simulation-helpers.mjs";

test("chair uses owned artwork and restores both nest copies after interruption", async (
  { page },
  testInfo,
) => {
  const sim = new Gullbert(800, 600, () => 0);
  sim.configure({ paused: true, sound: false });
  sim.restoreMemory({
    collection: { bent_spoon: 1, shell: 1, button: 1 },
    nest: { x: 300, y: 300, items: ["bent_spoon", "shell", "button"] },
  });
  sim.action("build_something");
  await page.route("**/ui/pet/pet.js", (route) => route.fulfill({
    contentType: "text/javascript", body: "",
  }));
  await page.goto("/pet.html");
  await page.addStyleTag({
    content: "html { background: #d6edf1 !important; } #speech { display: none; }",
  });
  await page.evaluate(async () => {
    const { createPetRenderer } = await import("/ui/pet/pet-renderer.js");
    window.renderConstruction = createPetRenderer(document.querySelector("#world"));
  });

  for (const phase of ["inspect", "carry-first", "adjust", "sit", "collapse", "blame"]) {
    reach(sim, phase);
    advance(sim, 1.2);
    await page.evaluate((state) => window.renderConstruction(state), sim.present());
    await expect(page.locator(".nest-treasure:visible"))
      .toHaveCount(3 - sim.present().borrowedNestSlots.length);
    await expect.poll(() => page.locator('[data-prop^="construction-"]')
      .evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${phase}.png`),
      clip: { x: 250, y: 240, width: 300, height: 180 },
    });
  }

  await expect(page.locator("#gull"))
    .toHaveAttribute("data-pose", "nap-accuse");
  sim.action("feed");
  await page.evaluate((state) => window.renderConstruction(state), sim.present());
  await expect(page.locator('[data-prop^="construction-"]'))
    .toHaveCount(0);
  await expect(page.locator(".nest-treasure:visible"))
    .toHaveCount(3);
});

test("Build something in His world starts a chair using the saved nest", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gullbert.roommate.v1", JSON.stringify({
      collection: { shell: 1, button: 1 },
      nest: { x: 200, y: 300, items: ["shell", "button"] },
    }));
  });
  await page.goto("/index.html");
  await page.getByRole("button", { name: "His world", exact: true })
    .click();
  await page.getByRole("button", { name: "Rituals & places", exact: true })
    .click();
  await page.getByRole("button", { name: "Build something", exact: true })
    .click();
  const pet = page.frameLocator("iframe");
  await expect(pet.locator('[data-prop="construction-0"]'))
    .toBeVisible();
  await expect(pet.locator(".nest-treasure:visible"))
    .toHaveCount(1);
});
