// TypeScript mirror of public.quote_deal() for the live Deal Builder preview.
// The database function is the source of truth: saving a deal re-quotes there.
import type { Addon, CarePlan, Market, Package, PackagePrice } from "./types";

export type PaymentPlan = "50_50" | "40_30_30";
export interface QuoteInput {
  packageCode: string | null;
  addons: { code: string; qty: number }[];
  market: string;
  paymentPlan: PaymentPlan;
  rush: boolean;
  carePlan: string | null;
}
export interface QuoteLine { kind: "package" | "addon" | "care_plan"; code: string; name: string; qty: number; unit: number; monthly: number; total: number }
export interface Quote {
  currency: string; lines: QuoteLine[]; subtotal: number; rushFee: number; total: number; monthly: number;
  totalUsd: number; monthlyUsd: number; schedule: { label: string; percent: number; amount: number }[];
  included: string[]; weeks: [number | null, number | null] | null;
}
export interface Catalogue { markets: Market[]; packages: Package[]; prices: PackagePrice[]; addons: Addon[]; carePlans: CarePlan[] }

export function marketPrice(usd: number, market: Market) {
  if (!usd) return 0;
  if (market.code === "US") return usd;
  return Math.round((usd * Number(market.factor)) / 10) * 10;
}

export function quote(input: QuoteInput, cat: Catalogue, rushPercent = 25): Quote {
  const m = cat.markets.find((x) => x.code === input.market) ?? cat.markets[0];
  const lines: QuoteLine[] = [];
  let sub = 0, subUsd = 0, mon = 0, monUsd = 0;
  const included: string[] = [];
  let weeks: Quote["weeks"] = null;

  const pk = cat.packages.find((p) => p.code === input.packageCode);
  if (pk) {
    const local = cat.prices.find((p) => p.package_code === pk.code && p.market_code === m.code)?.price ?? marketPrice(pk.price_usd, m);
    lines.push({ kind: "package", code: pk.code, name: pk.name, qty: 1, unit: Number(local), monthly: 0, total: Number(local) });
    sub += Number(local); subUsd += Number(pk.price_usd);
    weeks = [pk.weeks_min, pk.weeks_max];
    if (pk.included_care_months) included.push(`${pk.included_care_months} month(s) ${pk.included_care_plan === "pro" ? "Pro" : "Basic"} Care`);
    if (pk.ai_usage_months) included.push(`${pk.ai_usage_months} month(s) AI usage`);
  }
  for (const a of input.addons) {
    const ad = cat.addons.find((x) => x.code === a.code);
    if (!ad) continue;
    const qty = ad.per_unit ? Math.max(1, a.qty || 1) : 1;
    const unit = marketPrice(Number(ad.price_usd), m);
    const mu = marketPrice(Number(ad.monthly_usd), m);
    lines.push({ kind: "addon", code: ad.code, name: ad.name, qty, unit, monthly: mu * qty, total: unit * qty });
    sub += unit * qty; subUsd += Number(ad.price_usd) * qty;
    mon += mu * qty; monUsd += Number(ad.monthly_usd) * qty;
  }
  const cp = cat.carePlans.find((c) => c.code === input.carePlan);
  if (cp) {
    const mu = marketPrice(Number(cp.monthly_usd), m);
    lines.push({ kind: "care_plan", code: cp.code, name: `${cp.name} Care`, qty: 1, unit: 0, monthly: mu, total: 0 });
    mon += mu; monUsd += Number(cp.monthly_usd);
  }
  const rushFee = input.rush ? Math.round(sub * rushPercent) / 100 : 0;
  const rushUsd = input.rush ? Math.round(subUsd * rushPercent) / 100 : 0;
  const total = sub + rushFee;
  const split = input.paymentPlan === "40_30_30" ? [40, 30, 30] : [50, 50];
  const labels = input.paymentPlan === "40_30_30" ? ["Kickoff deposit", "Design approval", "Launch"] : ["Kickoff deposit", "Launch"];
  let acc = 0;
  const schedule = split.map((p, i) => {
    const amount = i === split.length - 1 ? Math.round((total - acc) * 100) / 100 : Math.round(total * p) / 100;
    acc += amount;
    return { label: labels[i], percent: p, amount };
  });
  return { currency: m.currency, lines, subtotal: sub, rushFee, total, monthly: mon, totalUsd: subUsd + rushUsd, monthlyUsd: monUsd, schedule, included, weeks };
}
