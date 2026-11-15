import { expect, test } from "@playwright/test";
import { isMobile, LEAD_NAME } from "./helpers";

test("search finds a lead and opens it", async ({ page }, info) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const box = page.getByRole("textbox", { name: "Search" });
  // retry the shortcut until the page has hydrated and the palette opens
  await expect(async () => {
    if (isMobile(info)) await page.getByRole("button", { name: "Search" }).first().click();
    else await page.keyboard.press("ControlOrMeta+k");
    await expect(box).toBeFocused({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await box.fill(LEAD_NAME.slice(0, 6));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.getByRole("button", { name: new RegExp(LEAD_NAME) }).first().click();
  await expect(page.locator("main h1")).toHaveText(new RegExp(LEAD_NAME));
});

test("keyboard shortcuts navigate (g p, ?)", async ({ page }, info) => {
  test.skip(isMobile(info) || info.project.name === "ipad", "keyboard shortcuts are a desktop feature");
  await page.goto("/");
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page).toHaveURL(/\/pipeline/);
  await page.keyboard.press("Shift+?");
  await expect(page.getByText("Keyboard shortcuts")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Keyboard shortcuts")).toBeHidden();
});

test("deal builder quotes live from the catalogue", async ({ page }) => {
  await page.goto("/deals/new");
  await page.getByRole("button", { name: /Full House/ }).click();
  const total = page.getByTestId("quote-total");
  await expect(total).toHaveText("$5,900");
  await page.getByRole("button", { name: /Rush/ }).click();
  await expect(total).toHaveText("$7,375");
  await page.getByRole("radio", { name: "MX" }).click();
  await expect(page.getByText("Quote · MXN")).toBeVisible();
  await page.getByRole("radio", { name: "40/30/30" }).click();
  await expect(page.getByText("Design approval")).toBeVisible();
});

test("pipeline filter narrows the board and the table view works", async ({ page }) => {
  await page.goto("/pipeline");
  await page.getByPlaceholder("Filter by name, city…").fill(LEAD_NAME);
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByText(/^1 of \d+ leads/)).toBeVisible();
  await page.getByRole("radio", { name: "Table" }).click();
  await expect(page).toHaveURL(/view=table/);
  await expect(page.getByRole("link", { name: LEAD_NAME }).first()).toBeVisible();
});

test("lead record tabs switch", async ({ page }) => {
  await page.goto("/pipeline");
  await page.getByRole("link", { name: new RegExp(LEAD_NAME) }).first().click();
  await expect(page.locator("main h1")).toHaveText(new RegExp(LEAD_NAME));
  await page.getByRole("tab", { name: /Stage history/ }).click();
  await expect(page).toHaveURL(/tab=history/);
  await expect(page.getByRole("tab", { name: /Stage history/ })).toHaveAttribute("aria-selected", "true");
});

test("appearance switch applies and persists", async ({ page }, info) => {
  await page.goto("/");
  if (isMobile(info)) await page.getByRole("button", { name: "Open menu" }).click();
  const scope = isMobile(info) ? page.locator("aside").last() : page.locator("aside").first();
  await scope.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  if (isMobile(info)) await page.getByRole("button", { name: "Open menu" }).click();
  await (isMobile(info) ? page.locator("aside").last() : page.locator("aside").first()).getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bgLight).not.toBe(bgDark);
});

test.describe("phone", () => {
  test.beforeEach(({}, info) => test.skip(!isMobile(info), "phone layout only"));

  test("tab bar navigates and has 44pt touch targets", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    await expect(tabs).toHaveCount(5);
    for (const box of await tabs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    await tabs.filter({ hasText: "Pipeline" }).click();
    await expect(page.locator("main h1")).toHaveText(/Pipeline/);
    await expect(tabs.filter({ hasText: "Pipeline" })).toHaveAttribute("aria-current", "page");
  });

  test("menu drawer opens, navigates and closes", async ({ page }) => {
    await page.goto("/");
    const open = page.getByRole("button", { name: "Open menu" });
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await open.click();
    await page.locator("aside").last().getByRole("link", { name: "Catalogue" }).click();
    await expect(page.locator("main h1")).toHaveText(/catalogue/i);
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveCount(0);
  });

  test("form fields are large enough not to trigger iOS zoom", async ({ page }) => {
    await page.goto("/leads/new");
    const sizes = await page.locator("input.input, select.input, textarea.input").evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
  });
});
