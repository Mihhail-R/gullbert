import { test as base, expect } from "@playwright/test";

const test = base.extend({
  page: async ({ page }, use) => {
    const failures = [];
    page.on("pageerror", (error) => {
      failures.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        failures.push(message.text());
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failures.push(`${response.status()} ${response.url()}`);
      }
    });
    page.on("requestfailed", (request) => {
      failures.push(`${request.url()}: ${request.failure()?.errorText}`);
    });

    await use(page);
    expect(failures, "The application must load without browser or resource errors")
      .toEqual([]);
  },
});

async function openPet(page, path = "/") {
  await page.goto(path);
  const pet = page.frameLocator("iframe");
  await expect(pet.locator("#world"))
    .toBeVisible();
  await expect(pet.locator("#gull"))
    .toHaveAttribute("data-pose", /.+/);
  return pet;
}

test("the playground boots the real pet iframe and displays its sprite", async ({ page }) => {
  const pet = await openPet(page);
  const sprite = pet.locator(".sprite");
  await expect(sprite)
    .toBeVisible();
  await expect(pet.locator("#gull"))
    .toHaveCSS("opacity", "1");
  const imageWidth = await sprite.evaluate(async (element) => {
    const background = getComputedStyle(element).backgroundImage;
    const image = new Image();
    image.src = background.slice(5, -2);
    await image.decode();
    return image.naturalWidth;
  });
  expect(imageWidth)
    .toBeGreaterThanOrEqual(96);
  await expect(page.getByRole("heading", { name: "Meet your next distraction." }))
    .toBeVisible();
});

test("control-room actions and hide/show reach the live pet", async ({ page }) => {
  const pet = await openPet(page, "/index.html");
  await page.locator('#demo [data-action="nap"]')
    .click();
  await expect(pet.locator("#gull"))
    .toHaveClass("nap");
  await page.getByRole("button", { name: "Send him away", exact: true })
    .click();
  await expect(pet.locator("#world"))
    .toBeHidden();
  await expect(page.locator("#visibility-toggle"))
    .toHaveText("Return / resume");
  await page.getByRole("button", { name: "Return / resume", exact: true })
    .click();
  await expect(pet.locator("#world"))
    .toBeVisible();
  await expect(pet.locator(".sprite"))
    .toBeVisible();
  await expect(page.locator("#visibility-toggle"))
    .toHaveText("Send him away");
});

test("target placement creates visible mess and cleanup removes it", async ({ page }) => {
  const pet = await openPet(page);
  await page.getByText("Petty crime", { exact: true })
    .click();
  const target = page.getByRole("button", { name: "Poop here…", exact: true });
  await target.click();
  await expect(pet.getByRole("status"))
    .toContainText("Pick a parking spot.");
  await pet.locator("body")
    .click({ position: { x: 160, y: 240 } });
  await expect(pet.locator("#target-banner"))
    .toBeHidden();
  await expect(pet.locator(".splat"))
    .toHaveCount(1);
  await expect(pet.locator(".splat"))
    .toBeVisible();
  await page.getByRole("button", { name: "Reset scene", exact: true })
    .click();
  await expect(pet.locator(".splat"))
    .toHaveCount(0);
  await expect(pet.locator("#world"))
    .toBeVisible();

  await target.click();
  await expect(pet.locator("#target-banner"))
    .toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pet.locator("#target-banner"))
    .toBeHidden();
  await expect(pet.locator(".splat"))
    .toHaveCount(0);
});
