import clsx from "clsx";
import { AlertTriangle, ArrowLeft, Check, Circle, CircleDot } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityFeed } from "@/components/activity-feed";
import { Chip, PageHeader, StatusChip } from "@/components/ui";
import { getLeadHistory, getTables } from "@/lib/data";
import { daysBetween, money, monthLabel, shortDate, usd } from "@/lib/format";
import { isSlipping } from "@/lib/metrics";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTables("projects", "milestones", "deliverables", "payments", "scopes", "companies", "agents", "deals", "testimonials");
  const p = t.projects.find((x) => x.id === id);
  if (!p) notFound();
  const company = t.companies.find((c) => c.id === p.company_id);
  const ms = t.milestones.filter((m) => m.project_id === id).sort((a, b) => a.sort - b.sort);
  const items = t.deliverables.filter((d) => d.project_id === id);
  const PAY_ORDER = ["Kickoff deposit", "Design approval", "Launch"];
  const pays = t.payments.filter((x) => x.deal_id === p.deal_id).sort((a, b) => PAY_ORDER.indexOf(a.label) - PAY_ORDER.indexOf(b.label));
  const scope = t.scopes.filter((s) => s.deal_id === p.deal_id).sort((a, b) => b.version - a.version)[0];
  const deal = t.deals.find((d) => d.id === p.deal_id);
  const activity = (p.lead_id ? (await getLeadHistory(p.lead_id)).activity_log : []).filter((a) => a.entity_type && ["project", "milestone", "deliverable", "payment", "scope", "testimonial", "care_subscription", "referral"].includes(a.entity_type));
  const testimonial = t.testimonials.find((x) => x.project_id === id);

  return (
    <div>
      <div className="border-b border-line px-4 py-2 md:px-6"><Link href="/projects" className="btn-ghost -ml-2 h-7"><ArrowLeft size={14} /> Projects</Link></div>
      <PageHeader title={p.name} subtitle={`P-${p.ref} · ${company?.name} · slot ${monthLabel(p.slot_month)} · started ${shortDate(p.start_date)} · target ${shortDate(p.target_date)}`}
        actions={<><StatusChip status={ms.some(isSlipping) && p.status === "active" ? "at_risk" : p.status} />{p.lead_id && <Link className="btn" href={`/leads/${p.lead_id}`}>Lead record</Link>}</>} />

      <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="grid content-start gap-4">
          <section className="card">
            <div className="card-h"><span className="card-t">Milestones</span><span className="text-[12px] text-ink-3">{ms.filter((m) => m.status === "done").length}/{ms.length} done</span></div>
            <ol className="px-4 py-2">
              {ms.map((m, i) => {
                const slip = isSlipping(m);
                const its = items.filter((d) => d.milestone_id === m.id);
                return (
                  <li key={m.id} className="relative flex gap-3 pb-4">
                    <div className="flex flex-col items-center">
                      <span className={clsx("flex size-6 items-center justify-center rounded-full",
                        m.status === "done" ? "bg-emerald-400/15 text-emerald-300" : slip ? "bg-rose-400/15 text-rose-300" : "bg-panel-3 text-ink-3")}>
                        {m.status === "done" ? <Check size={13} /> : slip ? <AlertTriangle size={12} /> : m.status === "in_progress" ? <CircleDot size={12} /> : <Circle size={10} />}
                      </span>
                      {i < ms.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m.title}</span>
                        <StatusChip status={m.status === "done" ? "done" : slip ? (m.status === "slipped" ? "slipped" : "overdue") : m.status} />
                        <span className="ml-auto text-[12px] tabular-nums text-ink-3">
                          due {shortDate(m.due_date)}
                          {m.original_due && m.original_due !== m.due_date && <span className="text-rose-300"> (was {shortDate(m.original_due)}, +{daysBetween(m.due_date, m.original_due)}d)</span>}
                        </span>
                      </div>
                      {m.slip_reason && <p className="mt-1.5 text-[12px] text-rose-200">Slip: {m.slip_reason}</p>}
                      {m.proposed_fix && <p className="mt-1 rounded-lg bg-panel-2 px-3 py-2 text-[12px] text-ink-2">Dana proposes: {m.proposed_fix}</p>}
                      {its.length > 0 && (
                        <ul className="mt-2 grid gap-1">
                          {its.map((d) => (
                            <li key={d.id} className="flex items-center gap-2 text-[12px]">
                              <Chip tone={d.owner === "client" ? "amber" : "slate"}>{d.owner === "client" ? "client owes" : "studio"}</Chip>
                              <span className={clsx("flex-1", d.status === "done" && "text-ink-3 line-through")}>{d.title}</span>
                              {d.owner === "studio" && (d.verified ? <span className="text-emerald-300">✓ verified</span> : <span className="text-ink-3">not verified</span>)}
                              {d.owner === "client" && d.status !== "done" && <span className={d.due_date && d.due_date < new Date().toISOString().slice(0, 10) ? "text-rose-300" : "text-ink-3"}>due {shortDate(d.due_date)}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {scope && (
            <section className="card">
              <div className="card-h"><span className="card-t">Scope of work v{scope.version} · line-by-line check</span><StatusChip status={scope.status} /></div>
              <table className="w-full">
                <tbody>
                  {scope.lines.map((l, i) => {
                    const verified = l.verified || items.some((d) => d.scope_line && l.line.startsWith(d.scope_line) && d.verified);
                    return (
                      <tr key={i} className="border-b border-line/60">
                        <td className="td w-6">{verified ? <Check size={14} className="text-emerald-300" /> : <Circle size={10} className="text-ink-3" />}</td>
                        <td className="td">{l.line}</td>
                        <td className="td text-right tabular-nums text-ink-2">{l.monthly_usd ? `${usd(l.monthly_usd)}/mo` : ""}</td>
                        <td className="td text-right tabular-nums">{l.price_usd ? usd(l.price_usd) : "—"}</td>
                      </tr>
                    );
                  })}
                  <tr><td /><td className="td font-medium">Total (USD, from catalogue)</td><td /><td className="td text-right font-semibold tabular-nums">{usd(scope.total)}</td></tr>
                </tbody>
              </table>
            </section>
          )}
        </div>

        <div className="grid content-start gap-4">
          <section className="card">
            <div className="card-h"><span className="card-t">Payments</span>{deal && <span className="text-[12px] text-ink-3">{deal.payment_plan.replace(/_/g, "/")} · {money(deal.one_off_total, deal.currency)}</span>}</div>
            {pays.map((x) => (
              <div key={x.id} className="flex items-center gap-2 border-b border-line/60 px-4 py-2.5 last:border-0">
                <span className="flex-1">{x.label} <span className="text-ink-3">{Number(x.percent)}%</span></span>
                <StatusChip status={x.status} />
                <span className="w-[96px] text-right tabular-nums">{money(x.amount, x.currency)}</span>
              </div>
            ))}
          </section>
          <section className="card">
            <div className="card-h"><span className="card-t">After delivery</span></div>
            <div className="grid gap-1 px-4 py-3 text-ink-2">
              <div>Signed off: <span className="text-ink">{p.signed_off_at ? shortDate(p.signed_off_at) : "not yet"}</span></div>
              <div>Testimonial: {testimonial ? <StatusChip status={testimonial.status} /> : <span className="text-ink-3">not requested</span>}</div>
              {p.health_note && <div className="text-[12px] text-ink-3">Note: {p.health_note}</div>}
            </div>
          </section>
          <section className="card">
            <div className="card-h"><span className="card-t">Delivery activity</span></div>
            <div className="max-h-[420px] overflow-y-auto py-1"><ActivityFeed items={activity} agents={t.agents} compact /></div>
          </section>
        </div>
      </div>
    </div>
  );
}
