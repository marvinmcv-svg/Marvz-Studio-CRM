import { LifeBuoy } from "lucide-react";
import { Empty, Meter, PageHeader, Stat, StatusChip } from "@/components/ui";
import { getTables } from "@/lib/data";
import { daysBetween, money, shortDate, usd } from "@/lib/format";
import { mrr } from "@/lib/metrics";

export const metadata = { title: "Care plans" };

export default async function CarePage() {
  const t = await getTables("care_subscriptions", "care_hours_log", "companies", "catalogue_care_plans", "catalogue_terms");
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const plan = new Map(t.catalogue_care_plans.map((p) => [p.code, p]));
  const rate = (t.catalogue_terms.find((x) => x.key === "hourly_rate")?.value as { usd?: number })?.usd ?? 95;
  const m = mrr(t.care_subscriptions);
  const monthStart = new Date().toISOString().slice(0, 8) + "01";
  const subs = [...t.care_subscriptions].sort((a, b) => a.renewal_date.localeCompare(b.renewal_date));
  const due30 = subs.filter((s) => s.status === "active" && daysBetween(s.renewal_date) <= 30).length;

  return (
    <div>
      <PageHeader title="Care plans" icon={<LifeBuoy size={18} className="text-ink-3" />} subtitle={`Renewals and hours used this month · overage billed at ${usd(rate)}/h`} />
      <div className="grid gap-4 p-4 md:p-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Active plans" value={subs.filter((s) => s.status === "active").length} />
          <Stat label="MRR" value={usd(m.billing)} hint={`${usd(m.committed)} committed`} />
          <Stat label="Renewing ≤ 30 days" value={due30} tone={due30 ? "warn" : undefined} />
          <Stat label="Hours this month" value={t.care_hours_log.filter((h) => h.worked_on >= monthStart).reduce((a, h) => a + Number(h.hours), 0).toFixed(1)} />
        </div>
        <div className="card overflow-x-auto">
          {subs.length === 0 ? <Empty title="No care plans yet">Dana starts one after delivery with start_care_plan.</Empty> : (
            <table className="w-full min-w-[760px]">
              <thead><tr className="border-b border-line">{["Client", "Plan", "Status", "Price", "Hours this month", "Free until", "Renews"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {subs.map((s) => {
                  const used = t.care_hours_log.filter((h) => h.subscription_id === s.id && h.worked_on >= monthStart).reduce((a, h) => a + Number(h.hours), 0);
                  const over = used > Number(s.hours_included);
                  const days = daysBetween(s.renewal_date);
                  return (
                    <tr key={s.id} className="table-row">
                      <td className="td font-medium">{company.get(s.company_id)?.name}</td>
                      <td className="td">{plan.get(s.plan_code)?.name}</td>
                      <td className="td"><StatusChip status={s.status} /></td>
                      <td className="td tabular-nums">{money(s.monthly_price, s.currency)}/mo</td>
                      <td className="td w-[200px]"><div className="flex items-center gap-2"><Meter value={used} max={Number(s.hours_included)} tone={over ? "bad" : used / Number(s.hours_included) > 0.75 ? "warn" : "accent"} />
                        <span className={`whitespace-nowrap text-[12px] tabular-nums ${over ? "text-rose-300" : "text-ink-2"}`}>{used}/{Number(s.hours_included)}h</span></div></td>
                      <td className="td text-ink-2">{s.included_until ? shortDate(s.included_until) : "—"}</td>
                      <td className={`td ${days <= 7 ? "text-amber-300" : "text-ink-2"}`}>{shortDate(s.renewal_date)} <span className="text-[11px] text-ink-3">({days >= 0 ? `in ${days}d` : `${-days}d ago`})</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <section className="card">
          <div className="card-h"><span className="card-t">Recent care work</span></div>
          {t.care_hours_log.length === 0 ? <Empty title="No hours logged" /> :
            [...t.care_hours_log].sort((a, b) => b.worked_on.localeCompare(a.worked_on)).slice(0, 20).map((h) => {
              const s = t.care_subscriptions.find((x) => x.id === h.subscription_id);
              return (
                <div key={h.id} className="flex items-center gap-3 border-b border-line/60 px-4 py-2 last:border-0">
                  <span className="w-[60px] text-[12px] text-ink-3">{shortDate(h.worked_on)}</span>
                  <span className="w-[180px] truncate">{company.get(s?.company_id ?? "")?.name}</span>
                  <span className="flex-1 truncate text-ink-2">{h.description}</span>
                  <span className="tabular-nums">{Number(h.hours)}h</span>
                </div>
              );
            })}
        </section>
      </div>
    </div>
  );
}
