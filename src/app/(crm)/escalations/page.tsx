import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { EscalationActions } from "@/components/escalation-actions";
import { AgentAvatar, Empty, PageHeader, StatusChip, Tabs } from "@/components/ui";
import { getMe, getTables } from "@/lib/data";
import { dateTime, relTime } from "@/lib/format";
import type { Escalation } from "@/lib/types";

export const metadata = { title: "Escalations" };

const SEV = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

export default async function EscalationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "open" } = await searchParams;
  const me = await getMe();
  const t = await getTables("escalations", "agents", "leads", "companies", "projects");
  const agent = new Map(t.agents.map((a) => [a.code, a]));
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const lead = new Map(t.leads.map((l) => [l.id, l]));
  const project = new Map(t.projects.map((p) => [p.id, p]));
  const canAct = !me?.demo && (me?.code === "letty" || me?.code === "top_g");

  const groups: Record<string, Escalation[]> = {
    letty: t.escalations.filter((e) => e.status === "with_letty"),
    open: t.escalations.filter((e) => e.status === "open" || e.status === "in_review"),
    closed: t.escalations.filter((e) => e.status === "resolved" || e.status === "dismissed"),
  };
  const list = (tab === "closed" ? groups.closed : tab === "letty" ? groups.letty : [...groups.letty, ...groups.open])
    .sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.created_at.localeCompare(a.created_at));

  return (
    <div>
      <PageHeader title="Escalations" icon={<AlertTriangle size={18} className="text-ink-3" />}
        subtitle="Agent → Top G → Letty. Top G double-checks and only passes to Letty what he can't solve." />
      <Tabs active={tab} tabs={[
        { key: "open", label: "Open", href: "/escalations?tab=open", count: groups.open.length + groups.letty.length },
        { key: "letty", label: "Waiting on Letty", href: "/escalations?tab=letty", count: groups.letty.length },
        { key: "closed", label: "Resolved", href: "/escalations?tab=closed", count: groups.closed.length },
      ]} />
      <div className="grid gap-3 p-4 md:p-6">
        {list.length === 0 && <div className="card"><Empty title="Nothing here" icon={<AlertTriangle />}>No escalations in this view.</Empty></div>}
        {list.map((e) => {
          const l = e.lead_id ? lead.get(e.lead_id) : null;
          const p = e.project_id ? project.get(e.project_id) : null;
          return (
            <article key={e.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] tabular-nums text-ink-3">E-{e.ref}</span>
                <span className="font-semibold">{e.title}</span>
                <StatusChip status={e.severity} />
                <StatusChip status={e.status} />
                <span className="ml-auto text-[12px] text-ink-3" title={dateTime(e.created_at)}>{relTime(e.created_at)}</span>
              </div>
              {/* chain */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
                <AgentAvatar agent={agent.get(e.raised_by)} withName />
                <ArrowRight size={12} />
                <AgentAvatar agent={agent.get("top_g")} withName />
                {(e.status === "with_letty" || e.resolved_by === "letty") && <><ArrowRight size={12} /><AgentAvatar agent={agent.get("letty")} withName /></>}
                {l && <> · <Link href={`/leads/${l.id}`} className="text-ink-2 hover:text-accent-2">{company.get(l.company_id)?.name}</Link></>}
                {p && <> · <Link href={`/projects/${p.id}`} className="text-ink-2 hover:text-accent-2">P-{p.ref}</Link></>}
              </div>
              {e.detail && <p className="mt-2 text-ink-2">{e.detail}</p>}
              {e.proposed_action && <p className="mt-2 text-[12px]"><span className="text-ink-3">Proposed:</span> {e.proposed_action}</p>}
              {e.top_g_notes && <p className="mt-2 rounded-lg bg-violet-400/[0.07] px-3 py-2 text-[12px] text-violet-200">Top G: {e.top_g_notes}</p>}
              {e.resolution_notes && (
                <p className="mt-2 rounded-lg bg-emerald-400/[0.07] px-3 py-2 text-[12px] text-emerald-200">
                  Resolution ({agent.get(e.resolved_by ?? "top_g")?.name}, {relTime(e.resolved_at)}): {e.resolution_notes}
                </p>
              )}
              {canAct && !["resolved", "dismissed"].includes(e.status) && <EscalationActions id={e.id} status={e.status} me={me!.code} />}
            </article>
          );
        })}
      </div>
    </div>
  );
}
