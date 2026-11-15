import { expect, test } from "@playwright/test";

test.describe("installable app (PWA)", () => {
  test("manifest is complete and its icons load", async ({ page, request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const m = await res.json();
    expect(m.name).toContain("Squad CRM");
    expect(m.short_name).toBe("Squad CRM");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBeTruthy();
    for (const icon of m.icons) {
      const r = await request.get(icon.src);
      expect(r.ok(), icon.src).toBeTruthy();
      expect(r.headers()["content-type"]).toContain("image/png");
    }
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon\.png/);
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");
    const vp = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(vp).toContain("viewport-fit=cover");
  });

  test("PWA files are public (no sign-in redirect)", async ({ request }) => {
    for (const p of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-192.png", "/icons/apple-touch-icon.png"]) {
      const r = await request.get(p, { maxRedirects: 0 });
      expect(r.status(), p).toBe(200);
    }
  });

  test("service worker installs, and offline shows the offline screen", async ({ page, context }, info) => {
    test.skip(info.project.name !== "desktop-light" && info.project.name !== "iphone-light", "runs once per form factor");
    await page.goto("/");
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15_000 });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10_000 });

    await context.setOffline(true);
    await page.goto("/pipeline").catch(() => { /* navigation is served by the service worker */ });
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await context.setOffline(false);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("main h1")).toHaveText(/Pipeline/);
  });
});
