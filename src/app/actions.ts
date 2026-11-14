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
    },
  );
}

export async function checkDuplicates(input: { business?: string; email?: string; phone?: string; website?: string; instagram?: string }) {
  if (!isLive) return { ok: true as const, data: { duplicates: [], dnc: [] } };
  const sb = await supabaseServer();
  const args = {
    p_business: input.business || null, p_email: input.email || null, p_phone: input.phone || null,
    p_website: input.website || null, p_instagram: input.instagram || null,
  };
  const [d, n] = await Promise.all([sb.rpc("find_duplicate_leads", args), sb.rpc("check_do_not_contact", args)]);
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
