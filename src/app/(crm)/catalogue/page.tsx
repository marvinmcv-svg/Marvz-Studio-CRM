import clsx from "clsx";
import { Lock, Package } from "lucide-react";
import Link from "next/link";
import { Chip, PageHeader } from "@/components/ui";
import { getTables } from "@/lib/data";
import { money } from "@/lib/format";
import { marketPrice } from "@/lib/quote";

export const metadata = { title: "Catalogue" };

export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const { market: mk = "US" } = await searchParams;
  const t = await getTables("markets", "catalogue_packages", "catalogue_package_prices", "catalogue_addons", "catalogue_care_plans", "catalogue_terms");
  const markets = t.markets.sort((a, b) => a.sort - b.sort);
  const m = markets.find((x) => x.code === mk) ?? markets[0];
  const term = (k: string) => t.catalogue_terms.find((x) => x.key === k)?.value as Record<string, number> | undefined;
  const fmt = (n: number) => money(n, m.currency);

  return (
    <div>
      <PageHeader title="Price catalogue" icon={<Package size={18} className="text-ink-3" />}
        subtitle={<span className="inline-flex items-center gap-1.5"><Lock size={12} /> Read-only for agents · only Letty edits (enforced by RLS) · agents quote exclusively from here</span>} />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5 md:px-8">
        <span className="mr-1 text-[12px] text-ink-3">Market</span>
        {markets.map((x) => (
          <Link key={x.code} href={`/catalogue?market=${x.code}`} className={clsx("btn-ghost h-7", x.code === m.code && "bg-panel-3 text-ink")}>
            {x.code} <span className="text-[11px] text-ink-3">{x.currency}{x.code !== "US" && ` ×${Number(x.factor)}`}</span>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 p-4 md:p-8">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {t.catalogue_packages.sort((a, b) => a.sort - b.sort).map((p) => {
            const local = t.catalogue_package_prices.find((x) => x.package_code === p.code && x.market_code === m.code)?.price ?? marketPrice(p.price_usd, m);
            return (
              <article key={p.code} className={clsx("card flex flex-col p-4", p.code === "full_house" && "border-accent/40")}>
                <div className="flex items-center justify-between"><span className="font-semibold">{p.name}</span>{p.code === "full_house" && <Chip tone="accent">most sold</Chip>}</div>
                <div className="mt-2 text-[24px] font-semibold tracking-tight tabular-nums">{fmt(Number(local))}</div>
                <div className="text-[12px] text-ink-3">{p.weeks_min}–{p.weeks_max} weeks{m.code !== "US" && ` · ${money(p.price_usd)} USD`}</div>
                <p className="mt-2 text-ink-2">{p.description}</p>
                <ul className="mt-3 space-y-1 text-[12px] text-ink-2">{p.includes.map((i) => <li key={i}>· {i}</li>)}</ul>
                <div className="mt-auto pt-3 text-[11px] text-ink-3">code <code className="text-ink-2">{p.code}</code></div>
              </article>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <section className="card overflow-hidden">
            <div className="card-h"><span className="card-t">Add-ons</span><span className="text-[12px] text-ink-3">{t.catalogue_addons.length} items</span></div>
            <table className="w-full">
              <thead><tr className="border-b border-line"><th className="th">Add-on</th><th className="th">Code</th><th className="th text-right">One-off</th><th className="th text-right">Monthly</th></tr></thead>
              <tbody>
                {t.catalogue_addons.sort((a, b) => a.sort - b.sort).map((a) => (
                  <tr key={a.code} className="table-row">
                    <td className="td">{a.name}{a.per_unit && <span className="text-ink-3"> / {a.unit_label}</span>}</td>
                    <td className="td"><code className="text-[12px] text-ink-3">{a.code}</code></td>
                    <td className="td text-right tabular-nums">{a.price_usd ? fmt(marketPrice(a.price_usd, m)) : "—"}</td>
                    <td className="td text-right tabular-nums text-ink-2">{a.monthly_usd ? `${fmt(marketPrice(a.monthly_usd, m))}/mo` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="grid content-start gap-4">
            <section className="card overflow-hidden">
              <div className="card-h"><span className="card-t">Care plans</span></div>
              {t.catalogue_care_plans.sort((a, b) => a.sort - b.sort).map((c) => (
                <div key={c.code} className="flex items-baseline gap-3 border-b border-line/70 px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-[12px] text-ink-3">{c.description}</div>
                  </div>
                  <div className="text-right"><div className="font-semibold tabular-nums">{fmt(marketPrice(c.monthly_usd, m))}<span className="text-ink-3">/mo</span></div>
                    <div className="text-[11px] text-ink-3">{Number(c.hours_included)}h included</div></div>
                </div>
              ))}
            </section>
            <section className="card p-4">
              <div className="card-t mb-2">Terms</div>
              <ul className="space-y-1.5 text-ink-2">
                <li>Payment plans: <span className="text-ink">50/50</span> or <span className="text-ink">40/30/30</span></li>
                <li>Rush delivery: <span className="text-ink">+{term("rush")?.percent ?? 25}%</span> on the one-off total</li>
                <li>Capacity: <span className="text-ink">{term("capacity")?.projects_per_month ?? 4} new projects / month</span></li>
                <li>Hourly rate without a care plan: <span className="text-ink">{money(term("hourly_rate")?.usd ?? 95)}/h</span></li>
                <li className="text-ink-3">Prices exclude tax and payment-processor fees.</li>
                <li className="text-ink-3">Market prices = USD × factor, rounded to 10 (packages have explicit per-market prices).</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
