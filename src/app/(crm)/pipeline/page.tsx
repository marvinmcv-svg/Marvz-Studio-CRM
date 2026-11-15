import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Board, type BoardCard, type BoardColumn } from "@/components/board";
import { PipelineFilters } from "@/components/pipeline-filters";
import { AgentAvatar, Chip, Empty, PageHeader, StageChip } from "@/components/ui";
import { ALL_STAGES, EXIT_STAGES, STAGES } from "@/lib/constants";
import { getMe, getTables } from "@/lib/data";
import { daysBetween, money, relTime, titleCase, usd } from "@/lib/format";
import { isSlipping } from "@/lib/metrics";
import { DOMAIN_LABEL, frozenLeadIds, isStale, outreachBlockers, PROBLEM_LABEL, QUALITY_FILTERS } from "@/lib/quality";
import type { Stage } from "@/lib/types";

export const metadata = { title: "Pipeline" };

type SP = { view?: string; stage?: string; industry?: string; service?: string; market?: string; agent?: string; q?: string; exits?: string;
  quality?: string; domain?: string; problem?: string };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await getMe();
  const t = await getTables("leads", "companies", "contacts", "agents", "deals", "projects", "milestones", "catalogue_packages", "catalogue_addons", "lead_relations");
  const frozen = frozenLeadIds(t.lead_relations);
  const qualityTest = QUALITY_FILTERS.find((f) => f.value === sp.quality)?.test;
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const contact = new Map(t.contacts.map((c) => [c.id, c]));
  const agent = new Map(t.agents.map((a) => [a.code, a]));
  const serviceName = new Map<string, string>([...t.catalogue_packages.map((p) => [p.code, p.name] as [string, string]), ...t.catalogue_addons.map((a) => [a.code, a.name] as [string, string])]);

  const latestDeal = new Map<string, (typeof t.deals)[number]>();
  for (const d of [...t.deals].sort((a, b) => a.created_at.localeCompare(b.created_at))) latestDeal.set(d.lead_id, d);
  const slippingLeads = new Set(
    t.milestones.filter(isSlipping).map((m) => t.projects.find((p) => p.id === m.project_id)?.lead_id).filter(Boolean) as string[]);

  const q = sp.q?.toLowerCase().trim();
  const leads = t.leads.filter((l) => {
    const c = company.get(l.company_id);
    if (sp.stage && l.stage !== sp.stage) return false;
    if (sp.industry && l.industry !== sp.industry) return false;
    if (sp.service && !l.service_interest.includes(sp.service)) return false;
    if (sp.market && l.market_code !== sp.market) return false;
    if (sp.agent && l.owner_agent !== sp.agent && l.created_by !== sp.agent) return false;
    if (qualityTest && !qualityTest(l, frozen)) return false;
    if (sp.domain && (l.domain_status ?? "UNVERIFIED") !== sp.domain) return false;
    if (sp.problem && l.website_problem_type !== sp.problem) return false;
    if (q && !`${c?.name} ${c?.city} ${l.industry} SQ-${l.ref} ${contact.get(l.contact_id ?? "")?.full_name ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const filters = [
    { key: "quality", any: "Any readiness", label: "Readiness", values: QUALITY_FILTERS.map((f) => ({ value: f.value, label: f.label })) },
    { key: "stage", any: "Any stage", label: "Stage", values: ALL_STAGES.map((s) => ({ value: s.key, label: s.label })) },
    { key: "domain", any: "Any domain status", label: "Domain status", values: Object.entries(DOMAIN_LABEL).map(([value, label]) => ({ value, label })) },
    { key: "problem", any: "Any website problem", label: "Website problem", values: Object.entries(PROBLEM_LABEL).map(([value, label]) => ({ value, label })) },
    { key: "industry", any: "Any industry", label: "Industry", values: [...new Set(t.leads.map((l) => l.industry).filter(Boolean) as string[])].sort().map((v) => ({ value: v, label: v })) },
    { key: "service", any: "Any service", label: "Service", values: [...new Set(t.leads.flatMap((l) => l.service_interest))].sort().map((v) => ({ value: v, label: serviceName.get(v) ?? titleCase(v) })) },
    { key: "market", any: "Any market", label: "Market", values: [...new Set(t.leads.map((l) => l.market_code).filter(Boolean) as string[])].sort().map((v) => ({ value: v, label: v })) },
    { key: "agent", any: "Any owner", label: "Owner", values: t.agents.map((a) => ({ value: a.code, label: a.name })) },
  ];

  const toCard = (l: (typeof t.leads)[number]): BoardCard => {
    const c = company.get(l.company_id);
    const d = latestDeal.get(l.id);
    const o = l.owner_agent ? agent.get(l.owner_agent) : null;
    return {
      id: l.id, code: `SQ-${l.ref}`, name: c?.name ?? "Unknown", city: c?.city ?? null, market: l.market_code,
      industry: l.industry, budget: l.budget_band, channel: l.channel, stage: l.stage,
      daysInStage: Math.max(0, -daysBetween(l.stage_changed_at)),
      value: d && d.status !== "lost" ? money(d.one_off_total, d.currency, { compact: true }) : null,
      owner: o ? { name: o.name, color: o.color, kind: o.kind } : null,
      nextAction: l.next_action, flag: slippingLeads.has(l.id) ? "slipping" : null,
      flags: [
        ...(l.on_hold ? [{ label: "On hold", tone: "amber" as const }] : []),
        ...(frozen.has(l.id) ? [{ label: "Frozen", tone: "violet" as const }] : []),
        ...(l.manual_check === "FAIL" ? [{ label: "Check failed", tone: "red" as const }]
          : (l.manual_check ?? "PENDING") === "PENDING" && !["lost", "do_not_contact"].includes(l.stage) ? [{ label: "Check pending", tone: "slate" as const }] : []),
        ...((l.domain_status ?? "UNVERIFIED") === "UNVERIFIED" && !["lost", "do_not_contact"].includes(l.stage) ? [{ label: "Unverified", tone: "slate" as const }] : []),
      ],
    };
  };

  const showExits = sp.exits === "1" || sp.stage === "lost" || sp.stage === "do_not_contact";
  const columns: BoardColumn[] = [...STAGES, ...(showExits ? EXIT_STAGES : [])]
    .filter((s) => !sp.stage || s.key === sp.stage)
    .map((s) => {
      const cards = leads.filter((l) => l.stage === s.key).map(toCard);
      const dealTotal = leads.filter((l) => l.stage === s.key).reduce((a, l) => {
        const d = latestDeal.get(l.id);
        return a + (d && d.status !== "lost" ? Number(d.one_off_total_usd) : 0);
      }, 0);
      return { key: s.key as Stage, label: s.label, tone: s.tone, cards, total: dealTotal ? usd(dealTotal, true) : null };
    });

  const view = sp.view === "table" ? "table" : "board";
  const exitCount = leads.filter((l) => l.stage === "lost" || l.stage === "do_not_contact").length;

  return (
    <div>
      <PageHeader title="Pipeline" subtitle={`${leads.length} of ${t.leads.length} leads · drag a card to move it (a reason is always required and logged)`}
        actions={<>
          {view === "board" && exitCount > 0 && (
            <Link href={{ query: { ...sp, exits: showExits ? undefined : "1" } }} className="btn-ghost">{showExits ? "Hide" : "Show"} lost / DNC ({exitCount})</Link>
          )}
          <Link href="/leads/new" className="btn-primary"><Plus size={14} /> New lead</Link>
        </>} />
      <Suspense><PipelineFilters filters={filters} /></Suspense>

      {view === "board" ? (
        <Board columns={columns} readOnly={!!me?.demo} agent={me?.code ?? ""} />
      ) : leads.length === 0 ? (
        <Empty title="No leads match these filters" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                {["Lead", "Stage", "Readiness", "Check", "Domain", "Verified", "Industry", "Market", "Channel", "Owner", "Deal", "In stage"].map((h) => <th key={h} className="th">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const c = company.get(l.company_id);
                const d = latestDeal.get(l.id);
                return (
                  <tr key={l.id} className="table-row">
                    <td className="td">
                      <Link href={`/leads/${l.id}`} className="font-medium hover:text-accent-2">{c?.name}</Link>
                      <div className="text-[11px] text-ink-3">SQ-{l.ref} · {c?.city}</div>
                    </td>
                    <td className="td"><StageChip stage={l.stage} /></td>
                    <td className="td">{(() => {
                      const b = outreachBlockers(l, frozen);
                      return b.length === 0 ? <Chip tone="green" dot>Ready</Chip>
                        : <span title={b.join("\n")}><Chip tone="amber" dot>{b.length} blocker{b.length > 1 ? "s" : ""}</Chip></span>;
                    })()}</td>
                    <td className="td"><Chip tone={l.manual_check === "PASS" ? "green" : l.manual_check === "FAIL" ? "red" : "slate"}>{l.manual_check ?? "PENDING"}</Chip></td>
                    <td className="td text-ink-2">{DOMAIN_LABEL[l.domain_status ?? "UNVERIFIED"]}{l.website_problem_type && <div className="text-[11px] text-ink-3">{PROBLEM_LABEL[l.website_problem_type]}</div>}</td>
                    <td className={`td ${isStale(l) ? "text-amber-300" : "text-ink-2"}`}>{l.last_verified_at ? relTime(l.last_verified_at) : "never"}</td>
                    <td className="td text-ink-2">{l.industry}</td>
                    <td className="td text-ink-2">{l.market_code}</td>
                    <td className="td capitalize text-ink-2">{l.channel}</td>
                    <td className="td"><AgentAvatar agent={l.owner_agent ? agent.get(l.owner_agent) : null} withName /></td>
                    <td className="td tabular-nums">{d ? money(d.one_off_total, d.currency) : <span className="text-ink-3">—</span>}</td>
                    <td className="td tabular-nums text-ink-2">{Math.max(0, -daysBetween(l.stage_changed_at))}d</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
