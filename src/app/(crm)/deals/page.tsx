import { Calculator } from "lucide-react";
import Link from "next/link";
import { AgentAvatar, Empty, PageHeader, Stat, StatusChip } from "@/components/ui";
import { getTables } from "@/lib/data";
import { money, pct, relTime, usd } from "@/lib/format";
import { dealStats } from "@/lib/metrics";

export const metadata = { title: "Deals" };

export default async function DealsPage() {
  const t = await getTables("deals", "leads", "companies", "agents", "payments", "catalogue_packages");
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const lead = new Map(t.leads.map((l) => [l.id, l]));
  const agent = new Map(t.agents.map((a) => [a.code, a]));
  const pkg = new Map(t.catalogue_packages.map((p) => [p.code, p.name]));
  const s = dealStats(t.deals);
  const order = { proposed: 0, quoted: 1, draft: 2, signed: 3, lost: 4 } as const;
  const deals = [...t.deals].sort((a, b) => order[a.status] - order[b.status] || b.created_at.localeCompare(a.created_at));

  return (
    <div>
      <PageHeader title="Deals" icon={<Calculator size={18} className="text-ink-3" />}
        subtitle="Quotes built only from the catalogue: package + add-ons + market + payment plan + rush"
        actions={<Link href="/deals/new" className="btn-primary"><Calculator size={14} /> Deal builder</Link>} />
      <div className="grid gap-4 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Open pipeline" value={usd(s.pipelineValue)} hint={`${s.open} open`} />
          <Stat label="Won (all time)" value={usd(s.wonValue)} hint={`${s.won} signed`} tone="good" />
          <Stat label="Win rate" value={pct(s.winRate)} />
          <Stat label="Avg deal" value={s.avgDeal ? usd(s.avgDeal) : "—"} />
        </div>
        <div className="card overflow-x-auto">
          {deals.length === 0 ? <Empty title="No deals yet" /> : (
            <table className="w-full min-w-[860px]">
              <thead><tr className="border-b border-line">{["Deal", "Status", "Package", "Market", "Plan", "One-off", "Monthly", "USD", "Payments", "By"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {deals.map((d) => {
                  const l = lead.get(d.lead_id);
                  const pays = t.payments.filter((p) => p.deal_id === d.id);
                  return (
                    <tr key={d.id} className="table-row">
                      <td className="td"><Link href={`/leads/${d.lead_id}?tab=deals`} className="font-medium hover:text-accent-2">{company.get(l?.company_id ?? "")?.name}</Link>
                        <div className="text-[11px] text-ink-3">D-{d.ref} · {relTime(d.created_at)}</div></td>
                      <td className="td"><StatusChip status={d.status} /></td>
                      <td className="td text-ink-2">{pkg.get(d.package_code ?? "") ?? "—"}{d.rush && <span className="text-amber-300"> · rush</span>}</td>
                      <td className="td text-ink-2">{d.market_code}</td>
                      <td className="td text-ink-2">{d.payment_plan.replace(/_/g, "/")}</td>
                      <td className="td tabular-nums">{money(d.one_off_total, d.currency)}</td>
                      <td className="td tabular-nums text-ink-2">{d.monthly_total ? `${money(d.monthly_total, d.currency)}/mo` : "—"}</td>
                      <td className="td tabular-nums text-ink-2">{usd(d.one_off_total_usd)}</td>
                      <td className="td"><div className="flex gap-1">{pays.map((p) => <span key={p.id} title={`${p.label} ${p.percent}% · ${p.status}`}
                        className={`h-1.5 w-5 rounded-full ${p.status === "paid" ? "bg-emerald-400" : p.status === "overdue" ? "bg-rose-400" : "bg-panel-3"}`} />)}</div></td>
                      <td className="td"><AgentAvatar agent={agent.get(d.created_by ?? "quinn")} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
