// Lead quality helpers — mirrors public.outreach_blockers() (migration 20261115000010)
// so the UI explains exactly why a lead cannot be drafted or batched yet.
import type { Lead, LeadRelation } from "./types";

export const STALE_DAYS = 30;

export function frozenLeadIds(relations: LeadRelation[]): Set<string> {
  return new Set(relations.filter((r) => r.status === "frozen").map((r) => r.lead_a));
}

export function isStale(lead: Pick<Lead, "last_verified_at" | "stage">, days = STALE_DAYS, now = Date.now()): boolean {
  if (lead.stage === "lost" || lead.stage === "do_not_contact") return false;
  if (!lead.last_verified_at) return true;
  return now - new Date(lead.last_verified_at).getTime() > days * 86_400_000;
}

/** Reasons outreach is blocked for this lead ([] = ready). Same order and wording as the database. */
export function outreachBlockers(lead: Lead, frozen: Set<string>): string[] {
  const out: string[] = [];
  if (lead.stage === "held" || lead.stage === "lost" || lead.stage === "do_not_contact") out.push(`Lead is ${lead.stage.replace(/_/g, " ")}`);
  if (lead.on_hold) out.push(`On hold: ${lead.hold_reason ?? "no reason given"}`);
  if (frozen.has(lead.id)) out.push("Frozen by a duplicate/sister link until Marvin clears it");
  if ((lead.manual_check ?? "PENDING") !== "PASS") out.push(`Marvin's manual check is ${lead.manual_check ?? "PENDING"}`);
  if ((lead.domain_status ?? "UNVERIFIED") === "UNVERIFIED") out.push("Domain not verified (verify it or mark NSC)");
  return out;
}

export const DOMAIN_LABEL: Record<string, string> = { VERIFIED: "Verified", NSC: "No site (confirmed)", UNVERIFIED: "Unverified" };
export const PROBLEM_LABEL: Record<string, string> = { outdated: "Outdated site", non_mobile: "Not mobile-friendly", no_site: "No website" };

export const QUALITY_FILTERS: { value: string; label: string; test: (l: Lead, frozen: Set<string>) => boolean }[] = [
  { value: "ready", label: "Ready for outreach", test: (l, f) => outreachBlockers(l, f).length === 0 },
  { value: "blocked", label: "Blocked", test: (l, f) => outreachBlockers(l, f).length > 0 },
  { value: "check_pending", label: "Awaiting Marvin's check", test: (l) => (l.manual_check ?? "PENDING") === "PENDING" },
  { value: "check_fail", label: "Failed Marvin's check", test: (l) => l.manual_check === "FAIL" },
  { value: "on_hold", label: "On hold", test: (l) => !!l.on_hold },
  { value: "frozen", label: "Frozen (duplicate/sister)", test: (l, f) => f.has(l.id) },
  { value: "stale", label: `Not re-verified in ${STALE_DAYS} days`, test: (l) => isStale(l) },
];
