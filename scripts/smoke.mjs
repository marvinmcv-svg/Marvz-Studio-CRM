#!/usr/bin/env node
/**
 * Smoke test: every page of a running Squad CRM renders.
 *   SQUAD_ALLOW_DEMO=1 npx next start -p 3100 &   then   node scripts/smoke.mjs http://localhost:3100
 * Checks each route answers 200 with the security headers and without the error
 * screen, that missing records show the not-found screen and unknown URLs give 404. With SMOKE_BROWSER=1 (and
 * Playwright installed) it also opens each page in Chromium and fails on any
 * console error, uncaught exception or CSP violation.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const base = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
const demo = JSON.parse(readFileSync(new URL("../src/lib/demo/data.json", import.meta.url), "utf8"));
const routes = [
  "/", "/pipeline", "/pipeline?view=table", "/approvals", "/escalations", "/activity", "/catalogue", "/deals", "/deals/new",
  "/projects", "/revenue", "/care", "/growth", "/lessons", "/dnc", "/team", "/leads/new",
  `/leads/${demo.leads[0].id}`, `/leads/${demo.leads[0].id}?tab=history`, `/projects/${demo.projects[0].id}`,
];
// Record pages stream behind a loading skeleton, so a missing record renders the
// not-found screen with HTTP 200 (Next.js behaviour); unknown URLs are a real 404.
const missingRecords = ["/leads/00000000-0000-0000-0000-000000000000", "/projects/00000000-0000-0000-0000-000000000000"];
const missingPages = ["/no-such-page"];
const failures = [];

for (const r of routes) {
  const res = await fetch(base + r, { redirect: "manual" });
  const body = await res.text();
  if (res.status !== 200) failures.push(`${r}: HTTP ${res.status}`);
  else if (body.includes("couldn&#x27;t load") || body.includes("couldn't load")) failures.push(`${r}: rendered the error screen`);
  if (!res.headers.get("content-security-policy")) failures.push(`${r}: missing Content-Security-Policy`);
  if (res.headers.get("x-frame-options") !== "DENY") failures.push(`${r}: missing X-Frame-Options`);
}
for (const r of missingRecords) {
  const body = await (await fetch(base + r, { redirect: "manual" })).text();
  if (!body.includes("exist, was removed")) failures.push(`${r}: did not render the not-found screen`);
}
for (const r of missingPages) {
  const res = await fetch(base + r, { redirect: "manual" });
  if (res.status !== 404) failures.push(`${r}: expected 404, got ${res.status}`);
}

if (process.env.SMOKE_BROWSER === "1") {
  const { chromium } = createRequire(import.meta.url)("playwright"); // CommonJS lookup also finds a global install
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  for (const r of routes) {
    errors.length = 0;
    await page.goto(base + r, { waitUntil: "networkidle" });
    for (const e of errors) failures.push(`${r}: browser error: ${e}`);
  }
  await browser.close();
}

if (failures.length) {
  console.error(`✗ smoke test failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`✓ smoke test passed (${routes.length} pages${process.env.SMOKE_BROWSER === "1" ? ", checked in Chromium" : ""})`);
