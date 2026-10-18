import { test, expect } from "@playwright/test";
import { snackRecallFixture, idleFor } from "../recall-fixture.mjs";
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
