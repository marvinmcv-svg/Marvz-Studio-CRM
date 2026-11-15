import { AlertTriangle, ArrowRight, CalendarClock, CheckCheck, Clock, Plus } from "lucide-react";
import Link from "next/link";
import { ActivityFeed } from "@/components/activity-feed";
import { AgentAvatar, Chip, Empty, Meter, PageHeader, Stat, StatusChip } from "@/components/ui";
import { STAGES } from "@/lib/constants";
import { getMe, getTables } from "@/lib/data";
import { daysBetween, monthLabel, pct, relTime, shortDate, usd } from "@/lib/format";
import { capacity, capacityLimit, dealStats, isSlipping, mrr, openEscalations } from "@/lib/metrics";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const me = await getMe();
  const t = await getTables(
    "agents", "leads", "companies", "deals", "projects", "milestones", "escalations", "approval_batches",
    "outreach_drafts", "care_subscriptions", "activity_log", "catalogue_terms",
  );
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const agentBy = new Map(t.agents.map((a) => [a.code, a]));

  const m = mrr(t.care_subscriptions);
  const ds = dealStats(t.deals);
  const cap = capacity(t.projects, capacityLimit(t.catalogue_terms));
  const escalations = openEscalations(t.escalations).sort((a, b) =>
    (a.status === "with_owner" || a.status === "with_letty" ? 0 : 1) - (b.status === "with_owner" || b.status === "with_letty" ? 0 : 1) || b.created_at.localeCompare(a.created_at));
  const pendingBatches = t.approval_batches.filter((b) => b.status === "pending");
  const slipping = t.milestones.filter(isSlipping);
  const projectBy = new Map(t.projects.map((p) => [p.id, p]));
  const renewals = t.care_subscriptions.filter((s) => s.status === "active" && daysBetween(s.renewal_date) <= 30);

  const counts = STAGES.map((s) => ({ ...s, n: t.leads.filter((l) => l.stage === s.key).length }));
  const maxN = Math.max(1, ...counts.map((c) => c.n));
  const lostCount = t.leads.filter((l) => l.stage === "lost" || l.stage === "do_not_contact").length;

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const workload = t.agents.filter((a) => a.kind === "ai").map((a) => ({
    agent: a,
    actions: t.activity_log.filter((x) => x.agent_code === a.code && x.created_at >= weekAgo).length,
    owned: t.leads.filter((l) => l.owner_agent === a.code && !["lost", "do_not_contact", "care_plan", "delivered"].includes(l.stage)).length,
    last: t.activity_log.find((x) => x.agent_code === a.code)?.created_at,
  }));
  const maxActions = Math.max(1, ...workload.map((w) => w.actions));

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <PageHeader
        title={`${greet}, ${me?.name ?? "team"}`}
        subtitle={`${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · Top G overview of the whole squad`}
        actions={<>
          <Link href="/leads/new" className="btn"><Plus size={14} /> New lead <span className="kbd ml-1">n</span></Link>
          <Link href="/deals/new" className="btn-primary">Deal builder <span className="kbd ml-1 border-black/20 bg-black/10 text-accent-ink">b</span></Link>
        </>}
      />

      <div className="grid gap-4 p-4 md:p-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="MRR (care plans)" value={usd(m.billing)} hint={m.committed > m.billing ? `${usd(m.committed)} committed incl. free months` : "billing now"} href="/revenue" />
          <Stat label="Open pipeline" value={usd(ds.pipelineValue, true)} hint={`${ds.open} open deals`} href="/deals" />
          <Stat label="Win rate" value={pct(ds.winRate)} hint={`${ds.won} won · ${ds.lost} lost`} href="/revenue" />
          <Stat label="Avg deal size" value={ds.avgDeal ? usd(ds.avgDeal) : "—"} hint="signed deals, USD" href="/revenue" />
          <Link href="/projects" className="card col-span-2 block px-4 py-3.5 transition-colors hover:border-line-2 lg:col-span-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Capacity · {monthLabel(cap.month + "-01")}</div>
            <div className="mt-1.5 flex items-baseline gap-1 text-[22px] font-semibold tabular-nums">
              {cap.used}<span className="text-[14px] text-ink-3">/ {cap.limit} slots</span>
            </div>
            <div className="mt-2"><Meter value={cap.used} max={cap.limit} tone={cap.remaining === 0 ? "bad" : cap.remaining === 1 ? "warn" : "accent"} /></div>
          </Link>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          {/* Needs attention */}
          <section className="card">
            <div className="card-h"><span className="card-t">Needs attention</span>
              <span className="text-[12px] text-ink-3">{escalations.length + pendingBatches.length + slipping.length + renewals.length} items</span></div>
            <ul className="divide-y divide-line/70">
              {escalations.map((e) => (
                <li key={e.id}>
                  <Link href="/escalations" className="flex items-start gap-3 px-4 py-3 hover:bg-panel-2/50">
                    <AlertTriangle size={15} className={e.status === "with_owner" || e.status === "with_letty" ? "mt-0.5 text-rose-300" : "mt-0.5 text-amber-300"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{e.title}</span>
                        {e.status === "with_owner" || e.status === "with_letty" ? <Chip tone="red" dot>for Marvin</Chip> : <StatusChip status={e.status} />}
                        <StatusChip status={e.severity} />
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-ink-3">
                        E-{e.ref} · raised by {agentBy.get(e.raised_by)?.name} {relTime(e.created_at)}
                        {e.proposed_action && <> · proposes: {e.proposed_action}</>}
                      </div>
                    </div>
                    <ArrowRight size={14} className="mt-1 text-ink-3" />
                  </Link>
                </li>
              ))}
              {pendingBatches.map((b) => {
                const n = t.outreach_drafts.filter((d) => d.batch_id === b.id).length;
                return (
                  <li key={b.id}>
                    <Link href="/approvals" className="flex items-start gap-3 px-4 py-3 hover:bg-panel-2/50">
                      <CheckCheck size={15} className="mt-0.5 text-amber-300" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="font-medium">Outreach batch #{b.ref} awaits Marvin</span><Chip tone="amber">{n} drafts</Chip></div>
                        <div className="mt-0.5 truncate text-[12px] text-ink-3">Submitted by Jordan {relTime(b.submitted_at)}{b.note && ` · ${b.note}`}</div>
                      </div>
                      <ArrowRight size={14} className="mt-1 text-ink-3" />
                    </Link>
                  </li>
                );
              })}
              {slipping.map((ms) => {
                const p = projectBy.get(ms.project_id);
                return (
                  <li key={ms.id}>
                    <Link href={`/projects/${ms.project_id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-panel-2/50">
                      <Clock size={15} className="mt-0.5 text-rose-300" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="font-medium">{p?.name} · {ms.title}</span><StatusChip status={ms.status === "slipped" ? "slipped" : "overdue"} /></div>
                        <div className="mt-0.5 truncate text-[12px] text-ink-3">Due {shortDate(ms.due_date)}{ms.proposed_fix && ` · Dana proposes: ${ms.proposed_fix}`}</div>
                      </div>
                      <ArrowRight size={14} className="mt-1 text-ink-3" />
                    </Link>
                  </li>
                );
              })}
              {renewals.map((s) => (
                <li key={s.id}>
                  <Link href="/care" className="flex items-start gap-3 px-4 py-3 hover:bg-panel-2/50">
                    <CalendarClock size={15} className="mt-0.5 text-sky-300" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{company.get(s.company_id)?.name} care plan renews {shortDate(s.renewal_date)}</div>
                      <div className="mt-0.5 text-[12px] text-ink-3">{s.plan_code} · {usd(s.monthly_usd)}/mo</div>
                    </div>
                  </Link>
                </li>
              ))}
              {escalations.length + pendingBatches.length + slipping.length + renewals.length === 0 && (
                <Empty title="All clear">Nothing needs Top G or Marvin right now.</Empty>
              )}
            </ul>
          </section>

          {/* Pipeline funnel */}
          <section className="card">
            <div className="card-h"><span className="card-t">Pipeline by stage</span>
              <Link href="/pipeline" className="text-[12px] text-ink-3 hover:text-ink">Open board →</Link></div>
            <div className="space-y-1 px-4 py-3">
              {counts.map((c) => (
                <Link key={c.key} href={`/pipeline?stage=${c.key}&view=table`} title={`${c.label}: ${c.n} leads`}
                  className="group grid grid-cols-[92px_1fr_28px] items-center gap-3 rounded-md py-0.5">
                  <span className="truncate text-[12px] text-ink-2 group-hover:text-ink">{c.label}</span>
                  <span className="block h-[14px] min-w-0">
                    <span className="block h-full rounded-r-[4px] bg-accent/70 transition-colors group-hover:bg-accent"
                      style={{ width: c.n ? `${Math.max(3, (c.n / maxN) * 100)}%` : "0%" }} />
                  </span>
                  <span className="text-right text-[12px] tabular-nums text-ink-2">{c.n}</span>
                </Link>
              ))}
              <div className="pt-2 text-[12px] text-ink-3">+ {lostCount} lost / do-not-contact</div>
            </div>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
          {/* Agent workload */}
          <section className="card">
            <div className="card-h"><span className="card-t">Squad · last 7 days</span><Link href="/team" className="text-[12px] text-ink-3 hover:text-ink">Team →</Link></div>
            <ul className="divide-y divide-line/70">
              {workload.map((w) => (
                <li key={w.agent.code} className="flex items-center gap-3 px-4 py-2.5">
                  <AgentAvatar agent={w.agent} size={24} />
                  <div className="w-[120px] min-w-0">
                    <div className="font-medium">{w.agent.name}</div>
                    <div className="truncate text-[11px] text-ink-3">{w.agent.title}</div>
                  </div>
                  <div className="flex-1"><Meter value={w.actions} max={maxActions} /></div>
                  <div className="w-[88px] text-right text-[12px] tabular-nums text-ink-2">{w.actions} actions</div>
                  <div className="hidden w-[90px] text-right text-[12px] text-ink-3 sm:block">{w.owned} owned</div>
                  <div className="hidden w-[90px] text-right text-[11px] text-ink-3 md:block">{relTime(w.last)}</div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="card-h"><span className="card-t">Live activity</span><Link href="/activity" className="text-[12px] text-ink-3 hover:text-ink">Full log →</Link></div>
            <div className="max-h-[420px] overflow-y-auto py-1">
              <ActivityFeed items={t.activity_log.slice(0, 14)} agents={t.agents} compact />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
