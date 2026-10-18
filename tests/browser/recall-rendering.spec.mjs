import { test, expect } from "@playwright/test";
import {
  snackRecallFixture,
  encoreFixture,
  keepsakeRecallFixture,
  idleFor,
} from "../recall-fixture.mjs";
import { reach } from "../simulation-helpers.mjs";

async function renderRecall(page, presentation) {
  await page.route("**/ui/pet/pet.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: "",
  }));
  await page.goto("/pet.html");
  await page.addStyleTag({ content: "body { background: #d6edf1; }" });
  await page.evaluate(async (state) => {
    const { createPetRenderer } = await import("/ui/pet/pet-renderer.js");
    createPetRenderer(document.querySelector("#world"))(state);
  }, presentation);
}

test("an old snack recall renders its head tilt and callback line", async ({ page }, testInfo) => {
  const { sim } = snackRecallFixture();
  idleFor(sim, 121);
  reach(sim, "recall-tilt");
  await renderRecall(page, sim.present());
  await expect(page.locator("#gull"))
    .toHaveAttribute("data-pose", "tilt");
  await expect(page.locator("#speech"))
    .toHaveText("Used to be here.");
  await page.screenshot({ path: testInfo.outputPath("old-snack-tilt.png") });
});

test("an encore renders its pleased look", async ({ page }, testInfo) => {
  const { sim } = encoreFixture("dead");
  idleFor(sim, 121);
  reach(sim, "pleased");
  await renderRecall(page, sim.present());
  await expect(page.locator("#gull"))
    .toHaveAttribute("data-pose", "blink");
  await expect(page.locator("#speech"))
    .toHaveText("Still got it.");
  await expect(page.locator("#bird"))
    .toHaveCSS("--routine-rotation", "0deg");
  await page.screenshot({ path: testInfo.outputPath("encore-pleased.png") });
});

test("a keepsake reveal renders the owned spoon and recall line", async ({ page }, testInfo) => {
  const { sim } = keepsakeRecallFixture();
  idleFor(sim, 121);
  reach(sim, "reveal");
  await renderRecall(page, sim.present());
  await expect(page.locator("#carried-treasure"))
    .toBeVisible();
  await expect(page.locator("#carried-treasure"))
    .toHaveAttribute("data-item", "bent_spoon");
  await expect(page.locator("#speech"))
    .toHaveText("still an excellent spoon.");
  await expect(page.locator("#gull"))
    .toHaveAttribute("data-pose", "blink");
  await page.screenshot({ path: testInfo.outputPath("keepsake-spoon-reveal.png") });
});
