import { test, expect } from "@playwright/test";
import { Gullbert } from "../../web-dist/simulation/engine.js";

// Render actual screen runoff and remove it through the normal cleanup action.
test("screen stains drip without window observations", async ({ page }, testInfo) => {
  await page.route("**/ui/pet/pet.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: "",
  }));
  await page.goto("/pet.html");
  await page.addStyleTag({ content: "html, body, #world { background: #344754 !important; }" });
  await page.evaluate(async () => {
    const { createPetRenderer } = await import("/ui/pet/pet-renderer.js");
    window.renderStains = createPetRenderer(document.querySelector("#world"));
  });
  const sim = new Gullbert(1000, 700, () => 0.5);
  sim.splat({ x: 300, y: 200 });

  for (let i = 0; i < 80; i++) {
    sim.step(0.1);
  }

  await page.evaluate((state) => window.renderStains(state), sim.present());
  const stain = page.locator(".splat.dripping");
  await expect(stain)
    .toHaveCSS("height", "399px");
  await expect(stain.locator(".splat-impact"))
    .toHaveCSS("height", "30px");
  await expect(stain.locator(".runoff-trail"))
    .toHaveCount(3);
  await expect(stain.locator(".splat-runoff"))
    .toHaveCSS("height", "399px");
  await page.screenshot({ path: testInfo.outputPath("screen-runoff.png") });

  sim.observeWork(null, 9000);
  await page.evaluate((state) => window.renderStains(state), sim.present());
  await expect(stain)
    .toHaveCSS("left", "300px");
  sim.action("direct_pick", { x: 300, y: 450 });
  await page.evaluate((state) => window.renderStains(state), sim.present());
  await expect(page.locator(".splat"))
    .toHaveCount(0);
});
