import { expect, test } from "@playwright/test";
import demo from "../../src/lib/demo/data.json" with { type: "json" };
import { expectNoHorizontalOverflow, isMobile, watchErrors } from "./helpers";

type Row = Record<string, unknown>;
const d = demo as unknown as { leads: Row[]; companies: Row[]; lead_relations: Row[] };
const companyOf = (leadId: string) => d.companies.find((c) => c.id === d.leads.find((l) => l.id === leadId)!.company_id)!;
const frozenLead = d.lead_relations.find((r) => r.status === "frozen")!.lead_a as string;
const readyLead = d.leads.find((l) => l.manual_check === "PASS" && l.domain_status !== "UNVERIFIED" && !l.on_hold
  && !d.lead_relations.some((r) => r.lead_a === l.id && r.status === "frozen") && !["held", "lost", "do_not_contact"].includes(l.stage as string))!;
const heldLead = d.leads.find((l) => l.stage === "held")!;

test("lead page shows readiness, evidence and sourced contact details", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/leads/${readyLead.id}`);
  await expect(page.getByRole("heading", { name: "Outreach readiness" })).toBeVisible();
  await expect(page.getByText("Checked by Marvin, domain verified")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Address, contact & reputation/ })).toBeVisible();
  await expect(page.getByText(/★ \d\.\d/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("frozen lead explains the freeze and lists the linked lead", async ({ page }) => {
  await page.goto(`/leads/${frozenLead}`);
  await expect(page.getByText(/Frozen: screening, drafting and batching are blocked/)).toBeVisible();
  await expect(page.getByText("Frozen by a duplicate/sister link until Marvin clears it")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();   // demo user is Marvin
});

test("Marvin's owner controls: manual check and type-to-confirm delete", async ({ page }) => {
  await page.goto(`/leads/${heldLead.id}`);
  await page.getByRole("button", { name: "Set check" }).click();
  const dialog = page.getByRole("dialog", { name: "Manual check" });
  await expect(dialog.getByRole("radio", { name: "PASS" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: /Delete lead/ }).click();
  const del = page.getByRole("dialog", { name: /Delete/ });
  const go = del.getByRole("button", { name: /Delete permanently/ });
  await expect(go).toBeDisabled();
  await del.getByLabel("Reason (required)").fill("Created by mistake");
  await del.getByLabel(/Type .* to confirm/).fill("SQ-0");
  await expect(go).toBeDisabled();
  await del.getByLabel(/Type .* to confirm/).fill(`SQ-${heldLead.ref}`);
  await expect(go).toBeEnabled();
  await go.click();
  await expect(del.getByRole("status")).toContainText("Demo mode");   // read-only demo: nothing is deleted
});

test("hold dialog requires a reason", async ({ page }) => {
  await page.goto(`/leads/${readyLead.id}`);
  await page.getByRole("button", { name: /Put on hold/ }).click();
  const dlg = page.getByRole("dialog", { name: "Put lead on hold" });
  const save = dlg.getByRole("button", { name: "Put on hold" });
  await expect(save).toBeDisabled();
  await dlg.getByLabel("Reason (required)").fill("Waiting for the owner's number");
  await expect(save).toBeEnabled();
});

test("pipeline: held column, readiness filter and quality columns", async ({ page }) => {
  await page.goto("/pipeline");
  await expect(page.locator("section > header").filter({ hasText: /^Held\s*\d+/ })).toBeVisible();   // board column
  await page.getByRole("combobox", { name: "Readiness" }).selectOption("check_pending");
  await expect(page).toHaveURL(/quality=check_pending/);
  await page.getByRole("radio", { name: "Table" }).click();
  await expect(page.getByRole("columnheader", { name: "Readiness" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Last verified" }).or(page.getByRole("columnheader", { name: "Verified" }))).toBeVisible();
  const checks = await page.locator("tbody tr td:nth-child(4)").allInnerTexts();
  expect(checks.length).toBeGreaterThan(0);
  for (const c of checks) expect(c).toContain("PENDING");
});

test("approvals show the exact recipient of each draft", async ({ page }) => {
  await page.goto("/approvals");
  await expect(page.getByText("To", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/@[a-z0-9.-]+\.[a-z]{2,}|\+\d/).first()).toBeVisible();
});

test("new lead: Santa Cruz guard, address fields and held option", async ({ page }) => {
  await page.goto("/leads/new");
  await page.getByLabel("Business name *").fill("Test Cafe");
  await page.getByLabel("City").fill("Santa Cruz");
  await page.getByLabel("Country").fill("BO");
  await expect(page.getByText("Santa Cruz de la Sierra leads are never stored in the CRM.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Create (held )?lead/ })).toBeDisabled();
  await page.getByLabel("City").fill("Cochabamba");
  await expect(page.getByRole("button", { name: "Create lead" })).toBeEnabled();
  await expect(page.getByLabel("Street address")).toBeVisible();
  await page.getByLabel(/Store as held/).check();
  await expect(page.getByLabel("Hold reason *")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create held lead" })).toBeVisible();
});

test("overview surfaces the owner queue", async ({ page }) => {
  await page.goto("/");
  const frozenName = companyOf(frozenLead).name as string;
  await expect(page.getByText(new RegExp(frozenName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).first()).toBeVisible();
  await expect(page.getByText(/waiting for Marvin's manual check/)).toBeVisible();
  await expect(page.getByText(/^\d+ held leads?$/)).toBeVisible();
});

test("phone: lead quality dialogs fit the screen", async ({ page }, info) => {
  test.skip(!isMobile(info), "phone only");
  await page.goto(`/leads/${readyLead.id}`);
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("dialog", { name: "Evidence" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
