"use server";

import { revalidatePath } from "next/cache";
import { isLive } from "@/lib/supabase/env";
import { supabaseServer } from "@/lib/supabase/server";
import type { Stage } from "@/lib/types";

export type ActionResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string };

const DEMO: ActionResult<never> = {
  ok: false,
  error: "Demo mode: connect Supabase (see README) to save changes. Agents write through the same RPCs.",
};

/** Every UI mutation goes through the same RPC the agents use, so it is permission-checked and logged. */
async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  if (!isLive) return DEMO;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, data: data as T };
}

export async function advanceStage(leadId: string, stage: Stage, reason: string) {
  return rpc("advance_stage", { p_lead_id: leadId, p_to_stage: stage, p_reason: reason });
}

export async function updateEscalation(id: string, action: "review" | "escalate_to_letty" | "resolve" | "dismiss", notes: string) {
  return rpc("update_escalation", { p_escalation_id: id, p_action: action, p_notes: notes || null });
}

export async function recordApproval(batchId: string, approvedIds: string[], rejectedIds: string[], note: string) {
  return rpc("record_approval", {
    p_batch_id: batchId, p_approved_ids: approvedIds, p_rejected_ids: rejectedIds, p_note: note || null,
  });
}

export interface NewLeadInput {
  business: string; contact_name?: string; email?: string; phone?: string; website?: string; instagram?: string;
  industry?: string; city?: string; country?: string; market: string; service_interest: string[];
  budget_band: string; timeline?: string; languages: string[]; source?: string; channel?: string;
  portfolio_case?: string; notes?: string; force?: boolean;
  street?: string; region?: string; postcode?: string; source_key?: string;
  hold?: boolean; hold_reason?: string;
  domain_status?: string; domain_proof_url?: string; website_problem_type?: string;
}

export async function createLead(input: NewLeadInput) {
  const blank = (v?: string) => (v && v.trim() ? v.trim() : null);
  return rpc<{ status: string; lead_id?: string; code?: string; matches?: { code: string; business: string; matched_on: string[]; lead_id: string }[]; message?: string }>(
    "create_lead",
    {
      p_business: input.business, p_contact_name: blank(input.contact_name), p_email: blank(input.email),
      p_phone: blank(input.phone), p_website: blank(input.website), p_instagram: blank(input.instagram),
      p_industry: blank(input.industry), p_city: blank(input.city), p_country: blank(input.country),
      p_market: input.market, p_service_interest: input.service_interest, p_budget_band: input.budget_band,
      p_timeline: blank(input.timeline), p_languages: input.languages, p_source: blank(input.source),
      p_channel: blank(input.channel), p_portfolio_case: blank(input.portfolio_case), p_notes: blank(input.notes),
      p_force: !!input.force,
      p_street: blank(input.street), p_region: blank(input.region), p_postcode: blank(input.postcode),
      p_source_key: blank(input.source_key), p_hold: !!input.hold, p_hold_reason: input.hold ? blank(input.hold_reason) : null,
      p_details: Object.fromEntries(Object.entries({
        domain_status: blank(input.domain_status), domain_proof_url: blank(input.domain_proof_url),
        website_problem_type: blank(input.website_problem_type),
      }).filter(([, v]) => v)),
    },
  );
}

export async function checkDuplicates(input: { business?: string; email?: string; phone?: string; website?: string; instagram?: string; street?: string; city?: string }) {
  if (!isLive) return { ok: true as const, data: { duplicates: [], dnc: [] } };
  const sb = await supabaseServer();
  const args = {
    p_business: input.business || null, p_email: input.email || null, p_phone: input.phone || null,
    p_website: input.website || null, p_instagram: input.instagram || null,
  };
  const [d, n] = await Promise.all([
    sb.rpc("find_duplicate_leads", { ...args, p_street: input.street || null, p_city: input.city || null }),
    sb.rpc("check_do_not_contact", args),
  ]);
  if (d.error || n.error) return { ok: false as const, error: (d.error ?? n.error)!.message };
  return { ok: true as const, data: { duplicates: d.data ?? [], dnc: n.data ?? [] } };
}

export async function createDeal(input: {
  leadId: string; packageCode: string | null; addons: { code: string; qty: number }[]; market: string;
  paymentPlan: string; rush: boolean; carePlan: string | null; title?: string;
}) {
  return rpc<{ deal_id: string; deal_ref: string }>("create_deal", {
    p_lead_id: input.leadId, p_package: input.packageCode, p_addons: input.addons, p_market: input.market,
    p_payment_plan: input.paymentPlan, p_rush: input.rush, p_care_plan: input.carePlan, p_title: input.title || null,
  });
}

export async function addDoNotContact(kind: string, value: string, reason: string) {
  return rpc("add_do_not_contact", { p_kind: kind, p_value: value, p_reason: reason });
}

// ---- lead quality & owner controls (migration 20261115000010) ------------------------------

export async function deleteLead(leadId: string, confirm: string, reason: string) {
  return rpc<{ status: string; code: string }>("delete_lead", { p_lead_id: leadId, p_confirm: confirm, p_reason: reason });
}

export async function setManualCheck(leadId: string, result: "PASS" | "FAIL" | "PENDING", note: string) {
  return rpc("set_manual_check", { p_lead_id: leadId, p_result: result, p_note: note || null });
}

export async function setLeadHold(leadId: string, onHold: boolean, reason: string) {
  return rpc("set_lead_hold", { p_lead_id: leadId, p_on_hold: onHold, p_reason: reason || null });
}

export async function setDraftHold(draftId: string, onHold: boolean, reason: string) {
  return rpc("set_draft_hold", { p_draft_id: draftId, p_on_hold: onHold, p_reason: reason || null });
}

export async function linkLeads(leadA: string, leadB: string, relation: "duplicate" | "sister" | "rename", note: string) {
  return rpc("link_leads", { p_lead_a: leadA, p_lead_b: leadB, p_relation: relation, p_note: note || null });
}

export async function clearLeadLink(leadA: string, leadB: string, note: string) {
  return rpc("clear_lead_link", { p_lead_a: leadA, p_lead_b: leadB, p_note: note });
}

export async function updateLeadEvidence(leadId: string, fields: Record<string, string | null>, reason: string) {
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== ""));
  return rpc("update_lead", { p_lead_id: leadId, p_fields: clean, p_reason: reason || null });
}

export async function updateCompanyDetails(companyId: string, fields: Record<string, string | number | null>, reason: string) {
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== ""));
  return rpc("update_company_details", { p_company_id: companyId, p_fields: clean, p_reason: reason || null });
}
