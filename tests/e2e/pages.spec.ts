import { expect, test } from "@playwright/test";
import { expectNamedControls, expectNoHorizontalOverflow, isMobile, PAGES, watchErrors } from "./helpers";

for (const { path, title } of PAGES) {
  test(`page ${path} renders cleanly`, async ({ page }, info) => {
    const errors = watchErrors(page);
    const res = await page.goto(path, { waitUntil: "networkidle" });
    expect(res?.status(), "HTTP status").toBe(200);
    await expect(page.locator("main h1").first()).toHaveText(title);
    await expect(page.getByText("couldn't load")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNamedControls(page);
    expect(errors, errors.join("\n")).toEqual([]);
    const name = path === "/" ? "overview" : path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    await page.screenshot({ path: `test-results/screens/${info.project.name}/${name}.png`, fullPage: !isMobile(info) });
  });
}

test("unknown pages show a friendly 404", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
  await page.getByRole("link", { name: "Go to Squad CRM" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("missing records show the not-found screen", async ({ page }) => {
  await page.goto("/leads/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText(/doesn.t exist, was removed/)).toBeVisible();
});
