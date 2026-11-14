import { describe, expect, it } from "vitest";
import demo from "../demo/data.json";
import { quote, type Catalogue } from "../quote";
import type { Tables } from "../types";

// The demo fixtures are exported from the seeded database, so this is the real catalogue.
const t = demo as unknown as Tables;
const cat: Catalogue = {
  markets: t.markets, packages: t.catalogue_packages, prices: t.catalogue_package_prices,
  addons: t.catalogue_addons, carePlans: t.catalogue_care_plans,
};

// Same cases and numbers as supabase/tests/10_permissions.sql (public.quote_deal),
// so the live Deal Builder preview can't drift from what the database saves.
describe("quote() matches public.quote_deal()", () => {
  it("US full house + add-ons, 40/30/30, rush", () => {
    const q = quote({ packageCode: "full_house", addons: [{ code: "booking_deposits", qty: 1 }, { code: "extra_page", qty: 2 }],
      market: "US", paymentPlan: "40_30_30", rush: true, carePlan: null }, cat);
    expect(q.subtotal).toBe(7480);
    expect(q.rushFee).toBe(1870);
    expect(q.total).toBe(9350);
    expect(q.schedule.map((s) => s.amount)).toEqual([3740, 2805, 2805]);
    expect(q.schedule.reduce((a, s) => a + s.amount, 0)).toBe(q.total);
  });

  it("MX presence + AI assistant + basic care, in pesos", () => {
    const q = quote({ packageCode: "presence", addons: [{ code: "ai_assistant", qty: 1 }], market: "MX",
      paymentPlan: "50_50", rush: false, carePlan: "basic" }, cat);
    expect(q.currency).toBe("MXN");
    expect(q.total).toBe(24070 + 10710);
    expect(q.monthly).toBe(570 + 1070);
  });

  it("ignores codes that are not in the catalogue", () => {
    const q = quote({ packageCode: "mega_package", addons: [{ code: "free_logo", qty: 1 }], market: "US",
      paymentPlan: "50_50", rush: false, carePlan: null }, cat);
    expect(q.lines).toHaveLength(0);
    expect(q.total).toBe(0);
  });
});
