import { TrendingUp } from "lucide-react";
import { PageHeader, Stat } from "@/components/ui";
import { getTables } from "@/lib/data";
import { pct, usd } from "@/lib/format";
import { dealStats, mrr } from "@/lib/metrics";

export const metadata = { title: "Revenue" };

function Bars({ rows, format }: { rows: { label: string; value: number; hint?: string }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex h-[180px] items-end gap-2 px-4 pb-2 pt-6" role="img" aria-label="Bar chart">
      {rows.map((r) => (
        <div key={r.label} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1.5">
          <span className="pointer-events-none absolute -top-5 whitespace-nowrap rounded bg-panel-3 px-1.5 py-0.5 text-[11px] tabular-nums text-ink opacity-0 transition-opacity group-hover:opacity-100">
            {format(r.value)}{r.hint && ` · ${r.hint}`}
          </span>
          <span className="w-full max-w-[44px] rounded-t-[4px] bg-accent/75 transition-colors group-hover:bg-accent"
            style={{ height: `${r.value ? Math.max(2, (r.value / max) * 100) : 0}%` }} />
          <span className="text-[11px] text-ink-3">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export default async function RevenuePage() {
  const t = await getTables("deals", "care_subscriptions", "catalogue_care_plans", "leads", "payments");
  const m = mrr(t.care_subscriptions);
  const s = dealStats(t.deals);

  const months = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
  const signedBy = months.map((mo) => {
    const ds = t.deals.filter((d) => d.status === "signed" && d.signed_at?.slice(0, 7) === mo);
    return { label: new Date(mo + "-15").toLocaleDateString("en-GB", { month: "short" }), value: ds.reduce((a, d) => a + Number(d.one_off_total_usd), 0), hint: `${ds.length} deals` };
  });
  const cashBy = months.map((mo) => {
    const ps = t.payments.filter((p) => p.status === "paid" && p.paid_at?.slice(0, 7) === mo);
    const usdOf = (p: (typeof ps)[number]) => {
      const d = t.deals.find((x) => x.id === p.deal_id);
      return d && Number(d.one_off_total) ? (Number(p.amount) / Number(d.one_off_total)) * Number(d.one_off_total_usd) : 0;
    };
    return { label: new Date(mo + "-15").toLocaleDateString("en-GB", { month: "short" }), value: ps.reduce((a, p) => a + usdOf(p), 0) };
  });
  const byMarket = [...new Set(t.deals.map((d) => d.market_code))].map((code) => ({
    code, won: t.deals.filter((d) => d.market_code === code && d.status === "signed").reduce((a, d) => a + Number(d.one_off_total_usd), 0),
    open: t.deals.filter((d) => d.market_code === code && ["draft", "quoted", "proposed"].includes(d.status)).reduce((a, d) => a + Number(d.one_off_total_usd), 0),
  })).sort((a, b) => b.won + b.open - (a.won + a.open));
  const mrrByPlan = t.catalogue_care_plans.map((p) => ({
    plan: p.name, n: t.care_subscriptions.filter((x) => x.plan_code === p.code && x.status === "active").length,
    v: t.care_subscriptions.filter((x) => x.plan_code === p.code && x.status === "active").reduce((a, x) => a + Number(x.monthly_usd), 0),
  }));
  const recurringAddons = t.deals.filter((d) => d.status === "signed").reduce((a, d) => a + Number(d.monthly_total_usd), 0);

  return (
    <div>
      <PageHeader title="Revenue" icon={<TrendingUp size={18} className="text-ink-3" />} subtitle="All figures in USD (non-USD deals converted with the catalogue market factor)" />
      <div className="grid gap-4 p-4 md:p-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="MRR · care plans" value={usd(m.billing)} hint={`ARR run-rate ${usd(m.billing * 12)}`} />
          <Stat label="Committed MRR" value={usd(m.committed)} hint="incl. plans in free months" />
          <Stat label="Win rate" value={pct(s.winRate)} hint={`${s.won} won / ${s.lost} lost`} />
          <Stat label="Average deal" value={s.avgDeal ? usd(s.avgDeal) : "—"} hint={`pipeline ${usd(s.pipelineValue)}`} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card">
            <div className="card-h"><span className="card-t">Signed value by month</span><span className="text-[12px] text-ink-3">{usd(signedBy.reduce((a, r) => a + r.value, 0))} · 6 mo</span></div>
            <Bars rows={signedBy} format={(n) => usd(n)} />
          </section>
          <section className="card">
            <div className="card-h"><span className="card-t">Cash collected by month</span><span className="text-[12px] text-ink-3">paid milestones</span></div>
            <Bars rows={cashBy} format={(n) => usd(n)} />
          </section>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card overflow-hidden">
            <div className="card-h"><span className="card-t">By market</span></div>
            <table className="w-full">
              <thead><tr className="border-b border-line"><th className="th">Market</th><th className="th text-right">Won</th><th className="th text-right">Open pipeline</th></tr></thead>
              <tbody>{byMarket.map((r) => (
                <tr key={r.code} className="table-row"><td className="td">{r.code}</td><td className="td text-right tabular-nums">{usd(r.won)}</td><td className="td text-right tabular-nums text-ink-2">{usd(r.open)}</td></tr>
              ))}</tbody>
            </table>
          </section>
          <section className="card overflow-hidden">
            <div className="card-h"><span className="card-t">Recurring revenue mix</span></div>
            <table className="w-full">
              <thead><tr className="border-b border-line"><th className="th">Source</th><th className="th text-right">Active</th><th className="th text-right">Monthly</th></tr></thead>
              <tbody>
                {mrrByPlan.map((r) => <tr key={r.plan} className="table-row"><td className="td">{r.plan} Care</td><td className="td text-right tabular-nums">{r.n}</td><td className="td text-right tabular-nums">{usd(r.v)}</td></tr>)}
                <tr className="table-row"><td className="td">Add-on subscriptions (AI, SEO) on signed deals</td><td className="td" /><td className="td text-right tabular-nums text-ink-2">{usd(recurringAddons)}</td></tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
