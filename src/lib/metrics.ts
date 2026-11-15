import type { CareSubscription, Deal, Escalation, Milestone, Project, Tables } from "./types";

const today = () => new Date().toISOString().slice(0, 10);

export function mrr(subs: CareSubscription[]) {
  const active = subs.filter((s) => s.status === "active");
  const billing = active.filter((s) => !s.included_until || s.included_until <= today());
  return {
    billing: billing.reduce((a, s) => a + Number(s.monthly_usd), 0),
    committed: active.reduce((a, s) => a + Number(s.monthly_usd), 0),
  };
}

export function dealStats(deals: Deal[]) {
  const won = deals.filter((d) => d.status === "signed");
  const lost = deals.filter((d) => d.status === "lost");
  const open = deals.filter((d) => ["draft", "quoted", "proposed"].includes(d.status));
  return {
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    pipelineValue: open.reduce((a, d) => a + Number(d.one_off_total_usd), 0),
    avgDeal: won.length ? won.reduce((a, d) => a + Number(d.one_off_total_usd), 0) / won.length : null,
    wonValue: won.reduce((a, d) => a + Number(d.one_off_total_usd), 0),
    won: won.length, lost: lost.length, open: open.length,
  };
}

export function capacity(projects: Project[], limit = 4, month = today().slice(0, 7)) {
  const used = projects.filter((p) => p.slot_month.slice(0, 7) === month).length;
  return { month, used, limit, remaining: Math.max(limit - used, 0) };
}

export function isSlipping(m: Milestone) {
  return m.status === "slipped" || (m.status !== "done" && m.due_date < today());
}

export function openEscalations(e: Escalation[]) {
  return e.filter((x) => ["open", "in_review", "with_owner", "with_letty"].includes(x.status));
}

export function capacityLimit(terms: Tables["catalogue_terms"]) {
  const t = terms.find((x) => x.key === "capacity")?.value as { projects_per_month?: number } | undefined;
  return t?.projects_per_month ?? 4;
}
