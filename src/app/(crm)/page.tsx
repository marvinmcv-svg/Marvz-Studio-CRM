import clsx from "clsx";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Bot, CalendarClock, CheckCheck, Clock, DollarSign, Gauge, Plus, ShieldCheck,
  Sparkles, Target, TrendingUp, Zap,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityFeed } from "@/components/activity-feed";
import { AgentAvatar, Chip, Empty, Meter, PageHeader, Sparkline, Stat, StatusChip } from "@/components/ui";
import { STAGES, stageMeta } from "@/lib/constants";
import { getMe, getTables } from "@/lib/data";
import { daysBetween, monthLabel, pct, relTime, shortDate, usd } from "@/lib/format";
import { capacity, capacityLimit, dealStats, isSlipping, mrr, openEscalations } from "@/lib/metrics";
import { isStale, STALE_DAYS } from "@/lib/quality";

export const metadata = { title: "Overview" };

const DAY = 86400000;

/** counts per day for the last `days` days (oldest first) */
function daily(isoDates: (string | null | undefined)[], days: number, now: number) {
  const out = new Array(days).fill(0);
  for (const d of isoDates) {
    if (!d) continue;
    const ago = Math.floor((now - new Date(d).getTime()) / DAY);
    if (ago >= 0 && ago < days) out[days - 1 - ago]++;
  }
  return out;
}

type InboxItem = { key: string; href: string; icon: ReactNode; tone: "violet" | "red" | "amber" | "blue"; title: ReactNode; chips?: ReactNode; detail?: ReactNode };

const TONE_TILE = {
  violet: "bg-violet-400/10 text-violet-300 ring-violet-400/20",
  red: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
  amber: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
  blue: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
};

export default async function OverviewPage() {
  const me = await getMe();
  const t = await getTables(
    "agents", "leads", "companies", "deals", "projects", "milestones", "escalations", "approval_batches",
    "outreach_drafts", "care_subscriptions", "activity_log", "catalogue_terms", "lead_relations",
  );
  const now = Date.now();
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const agentBy = new Map(t.agents.map((a) => [a.code, a]));

  const m = mrr(t.care_subscriptions);
  const ds = dealStats(t.deals);
  const cap = capacity(t.projects, capacityLimit(t.catalogue_terms));
  const escalations = openEscalations(t.escalations).sort((a, b) =>
    (a.status === "with_letty" ? 0 : 1) - (b.status === "with_letty" ? 0 : 1) || b.created_at.localeCompare(a.created_at));
  const pendingBatches = t.approval_batches.filter((b) => b.status === "pending");
  const slipping = t.milestones.filter(isSlipping);
  const projectBy = new Map(t.projects.map((p) => [p.id, p]));
  const renewals = t.care_subscriptions.filter((s) => s.status === "active" && daysBetween(s.renewal_date) <= 30);

  // owner queue (lead quality): what is waiting on Marvin
  const live = t.leads.filter((l) => !["lost", "do_not_contact"].includes(l.stage));
  const awaitingCheck = live.filter((l) => (l.manual_check ?? "PENDING") === "PENDING" && l.stage !== "held");
  const heldLeads = live.filter((l) => l.stage === "held");
  const staleLeads = live.filter((l) => isStale(l));
  const leadName = (id: string) => company.get(t.leads.find((l) => l.id === id)?.company_id ?? "")?.name ?? "lead";
  const frozenPairs = t.lead_relations.filter((r) => r.status === "frozen" && r.lead_a < r.lead_b);

  const inbox: InboxItem[] = [
    ...escalations.map((e): InboxItem => ({
      key: e.id, href: "/escalations", icon: <AlertTriangle size={15} />, tone: e.status === "with_letty" ? "red" : "amber",
      title: e.title,
      chips: <>{e.status === "with_letty" ? <Chip tone="red" dot>for Letty</Chip> : <StatusChip status={e.status} />}<StatusChip status={e.severity} /></>,
      detail: <>E-{e.ref} · raised by {agentBy.get(e.raised_by)?.name} {relTime(e.created_at)}{e.proposed_action && <> · proposes: {e.proposed_action}</>}</>,
    })),
    ...pendingBatches.map((b): InboxItem => ({
      key: b.id, href: "/approvals", icon: <CheckCheck size={15} />, tone: "amber",
      title: `Outreach batch #${b.ref} awaits approval`,
      chips: <Chip tone="amber">{t.outreach_drafts.filter((d) => d.batch_id === b.id).length} drafts</Chip>,
      detail: <>Submitted by Jordan {relTime(b.submitted_at)}{b.note && ` · ${b.note}`}</>,
    })),
    ...frozenPairs.map((r): InboxItem => ({
      key: r.id, href: `/leads/${r.lead_a}`, icon: <ShieldCheck size={15} />, tone: "violet",
      title: `${leadName(r.lead_a)} ↔ ${leadName(r.lead_b)}`, chips: <Chip tone="violet" dot>{r.relation} · frozen</Chip>,
      detail: r.note ?? "Linked leads are frozen until Marvin clears the link",
    })),
    ...(awaitingCheck.length ? [{
      key: "check", href: "/pipeline?quality=check_pending&view=table", icon: <ShieldCheck size={15} />, tone: "violet" as const,
      title: `${awaitingCheck.length} lead${awaitingCheck.length > 1 ? "s" : ""} waiting for Marvin's manual check`,
      chips: <Chip tone="violet" dot>PASS / FAIL</Chip>, detail: "Drafting and stage moves stay blocked until they pass",
    }] : []),
    ...(heldLeads.length ? [{
      key: "held", href: "/pipeline?stage=held", icon: <ShieldCheck size={15} />, tone: "violet" as const,
      title: `${heldLeads.length} held lead${heldLeads.length > 1 ? "s" : ""}`, chips: <Chip tone="amber" dot>held</Chip>,
      detail: "Parked or unverified; release them once checked",
    }] : []),
    ...(staleLeads.length ? [{
      key: "stale", href: "/pipeline?quality=stale&view=table", icon: <Clock size={15} />, tone: "violet" as const,
      title: `${staleLeads.length} lead${staleLeads.length > 1 ? "s" : ""} not re-verified in ${STALE_DAYS} days`,
      chips: <Chip tone="slate" dot>stale</Chip>, detail: "Re-check website, phone and evidence before outreach",
    }] : []),
    ...slipping.map((ms): InboxItem => ({
      key: ms.id, href: `/projects/${ms.project_id}`, icon: <Clock size={15} />, tone: "red",
      title: `${projectBy.get(ms.project_id)?.name} · ${ms.title}`, chips: <StatusChip status={ms.status === "slipped" ? "slipped" : "overdue"} />,
      detail: <>Due {shortDate(ms.due_date)}{ms.proposed_fix && ` · Dana proposes: ${ms.proposed_fix}`}</>,
    })),
    ...renewals.map((s): InboxItem => ({
      key: s.id, href: "/care", icon: <CalendarClock size={15} />, tone: "blue",
      title: `${company.get(s.company_id)?.name} care plan renews ${shortDate(s.renewal_date)}`,
      detail: `${s.plan_code} · ${usd(s.monthly_usd)}/mo`,
    })),
  ];

  // pipeline flow
  const counts = STAGES.map((s) => ({ ...s, n: t.leads.filter((l) => l.stage === s.key).length }));
  const totalActive = counts.reduce((a, c) => a + c.n, 0);
  const maxN = Math.max(1, ...counts.map((c) => c.n));
  const lostCount = t.leads.filter((l) => l.stage === "lost" || l.stage === "do_not_contact").length;

  // squad
  const weekAgo = new Date(now - 7 * DAY).toISOString();
  const dayAgo = new Date(now - DAY).toISOString();
  const squad = t.agents.filter((a) => a.kind === "ai").map((a) => {
    const mine = t.activity_log.filter((x) => x.agent_code === a.code);
    return {
      agent: a,
      week: mine.filter((x) => x.created_at >= weekAgo).length,
      trend: daily(mine.map((x) => x.created_at), 14, now),
      owned: t.leads.filter((l) => l.owner_agent === a.code && !["lost", "do_not_contact", "care_plan", "delivered"].includes(l.stage)).length,
      last: mine[0],
      live: !!mine[0] && now - new Date(mine[0].created_at).getTime() < 3600000,
    };
  });
  const moves24h = t.activity_log.filter((x) => x.created_at >= dayAgo && (x.agent_code ? agentBy.get(x.agent_code)?.kind : null) === "ai").length;
  const throughput = daily(t.activity_log.map((x) => x.created_at), 14, now);
  const leadTrend = daily(t.leads.map((l) => l.created_at), 14, now);
  const liveCount = squad.filter((s) => s.live).length;

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          <span className="text-line-2">/</span>
          <span className={clsx("flex items-center gap-1 normal-case tracking-normal", liveCount ? "text-emerald-300" : "text-ink-3")}>
            <span className={clsx("size-1.5 rounded-full", liveCount ? "animate-pulse-dot bg-emerald-400 text-emerald-400" : "bg-ink-3")} />
            {liveCount ? `${liveCount} agent${liveCount > 1 ? "s" : ""} working` : "squad idle"}
          </span>
        </span>}
        title={`${greet}, ${me?.name ?? "team"}`}
        subtitle={<>Your Grok squad made <b className="font-medium text-ink-2">{moves24h} moves</b> in the last 24 hours. {inbox.length ? <><b className="font-medium text-ink-2">{inbox.length} item{inbox.length > 1 ? "s" : ""}</b> need a human.</> : "Nothing needs a human right now."}</>}
        actions={<>
          <Link href="/leads/new" className="btn"><Plus size={14} /> New lead <span className="kbd ml-0.5">n</span></Link>
          <Link href="/deals/new" className="btn-primary"><Sparkles size={14} /> Deal builder <span className="kbd ml-0.5 border-white/20 bg-white/10 text-white/80">b</span></Link>
        </>}
      />

      <div className="grid gap-4 px-4 pb-8 md:px-8">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat icon={<DollarSign />} label="MRR · care plans" value={usd(m.billing)} hint={m.committed > m.billing ? `${usd(m.committed)} committed` : "billing now"} href="/revenue" />
          <Stat icon={<Target />} label="Open pipeline" value={usd(ds.pipelineValue, true)} hint={`${ds.open} open deals`} href="/deals" spark={leadTrend} />
          <Stat icon={<TrendingUp />} label="Win rate" value={pct(ds.winRate)} hint={`${ds.won} won · ${ds.lost} lost`} href="/revenue" />
          <Stat icon={<Zap />} label="Squad throughput" value={throughput.reduce((a, b) => a + b, 0)} hint="agent actions · 14 days" href="/activity" spark={throughput} />
          <Link href="/projects" className="card group col-span-2 block px-4 py-3.5 transition-colors hover:border-line-2 lg:col-span-1">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3"><Gauge size={14} /> Capacity · {monthLabel(cap.month + "-01")}
              <ArrowUpRight size={13} className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" /></div>
            <div className="mt-1.5 flex items-baseline gap-1 text-[24px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
              {cap.used}<span className="text-[13px] font-normal tracking-normal text-ink-3">/ {cap.limit} slots</span>
            </div>
            <div className="mt-3"><Meter value={cap.used} max={cap.limit} tone={cap.remaining === 0 ? "bad" : cap.remaining === 1 ? "warn" : "accent"} /></div>
          </Link>
        </div>

        {/* Pipeline flow */}
        <section className="card overflow-hidden">
          <div className="card-h">
            <span className="card-t">Pipeline flow <span className="font-normal text-ink-3">· {totalActive} active leads</span></span>
            <Link href="/pipeline" className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">Open board <ArrowRight size={12} /></Link>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[760px] grid-flow-col auto-cols-fr">
              {counts.map((c, i) => (
                <Link key={c.key} href={`/pipeline?stage=${c.key}&view=table`} title={`${c.label}: ${c.n} leads`}
                  className={clsx("group flex flex-col justify-end gap-2 px-3 pb-3 pt-4 transition-colors hover:bg-panel-2/60", i > 0 && "border-l border-line")}>
                  <div className="flex h-16 items-end">
                    <div className={clsx("w-full rounded-t-[4px] transition-all group-hover:opacity-100",
                      c.n ? "bg-gradient-to-t from-accent/30 to-accent-2/70 opacity-80" : "bg-panel-3 opacity-60")}
                      style={{ height: c.n ? `${Math.max(8, (c.n / maxN) * 100)}%` : "3px" }} />
                  </div>
                  <div className="text-[18px] font-semibold leading-none tabular-nums">{c.n}</div>
                  <div className="truncate text-[11.5px] text-ink-3 group-hover:text-ink-2">{c.label}</div>
                </Link>
              ))}
            </div>
          </div>
          <div className="border-t border-line px-4 py-2 text-[12px] text-ink-3">+ {lostCount} lost / do-not-contact</div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          {/* Human inbox */}
          <section className="card overflow-hidden">
            <div className="card-h">
              <span className="card-t">Needs a human</span>
              <span className="rounded-[5px] bg-ink/[0.07] px-1.5 text-[11.5px] tabular-nums text-ink-3">{inbox.length}</span>
            </div>
            <ul className="divide-y divide-line">
              {inbox.map((q) => (
                <li key={q.key}>
                  <Link href={q.href} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-panel-2/60">
                    <span className={clsx("mt-px flex size-7 shrink-0 items-center justify-center rounded-[8px] ring-1 ring-inset", TONE_TILE[q.tone])}>{q.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium">{q.title}</span>{q.chips}</div>
                      {q.detail && <div className="mt-0.5 truncate text-[12px] text-ink-3">{q.detail}</div>}
                    </div>
                    <ArrowRight size={14} className="mt-1.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
              {inbox.length === 0 && <Empty title="All clear" icon={<CheckCheck size={16} />}>Nothing needs Top G, Letty or Marvin right now.</Empty>}
            </ul>
          </section>

          {/* Agent squad */}
          <section className="card overflow-hidden">
            <div className="card-h">
              <span className="card-t"><Bot size={14} className="text-accent-2" /> Grok squad</span>
              <Link href="/team" className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">Team & API <ArrowRight size={12} /></Link>
            </div>
            <ul className="divide-y divide-line">
              {squad.map((s) => (
                <li key={s.agent.code}>
                  <Link href={`/activity?agent=${s.agent.code}`} className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-panel-2/60">
                    <AgentAvatar agent={s.agent} size={32} live={s.live} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.agent.name}</span>
                        <span className="truncate text-[12px] text-ink-3">{s.agent.title}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-ink-3">
                        {s.last ? <><span className="text-ink-2">{s.last.summary}</span> · {relTime(s.last.created_at)}</> : "No activity yet"}
                      </div>
                    </div>
                    <div className="hidden w-[120px] text-right sm:block">
                      <Sparkline values={s.trend} className="ml-auto h-6 w-[88px]" />
                      <div className="mt-0.5 text-[11px] tabular-nums text-ink-3">{s.week} actions · {s.owned} owned</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="card overflow-hidden">
          <div className="card-h">
            <span className="card-t">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-emerald-400 text-emerald-400" /> Live activity
            </span>
            <Link href="/activity" className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">Full log <ArrowRight size={12} /></Link>
          </div>
          <div className="max-h-[460px] overflow-y-auto py-1">
            <ActivityFeed items={t.activity_log.slice(0, 16)} agents={t.agents} compact />
          </div>
          <div className="border-t border-line px-4 py-2 text-[12px] text-ink-3">
            Stages: {STAGES.slice(0, 4).map((s) => stageMeta(s.key).label).join(" → ")} → … · every agent call is logged and cannot be edited
          </div>
        </section>
      </div>
    </div>
  );
}
