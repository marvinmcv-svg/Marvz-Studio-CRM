export type Stage =
  | "found" | "screened" | "draft_ready" | "approved" | "sent" | "replied"
  | "discovery" | "proposal" | "signed" | "in_delivery" | "delivered" | "care_plan"
  | "lost" | "do_not_contact";

export type AgentCode = "letty" | "marvin" | "top_g" | "hunter" | "jordan" | "quinn" | "dana";
/** Owner: the only approver (mirrors public.is_owner()). */
export const OWNERS: readonly string[] = ["marvin"];
/** Admins: coordination access (mirrors public.is_admin()). Not approvers. */
export const ADMINS: readonly string[] = ["marvin", "top_g"];
export type Channel = "whatsapp" | "email" | "instagram";

export interface Agent {
  code: AgentCode; name: string; kind: "human" | "ai"; title: string;
  description: string | null; color: string; active: boolean;
}
export interface Market { code: string; name: string; currency: string; symbol: string; factor: number; sort: number }
export interface Package {
  code: string; name: string; price_usd: number; weeks_min: number | null; weeks_max: number | null;
  included_care_plan: string | null; included_care_months: number; ai_usage_months: number;
  description: string | null; includes: string[]; sort: number; active: boolean;
}
export interface PackagePrice { package_code: string; market_code: string; price: number }
export interface Addon {
  code: string; name: string; price_usd: number; monthly_usd: number; per_unit: boolean;
  unit_label: string | null; description: string | null; sort: number; active: boolean;
}
export interface CarePlan { code: string; name: string; monthly_usd: number; hours_included: number; description: string | null; sort: number }
export interface Term { key: string; value: unknown; description: string | null }

export interface Company {
  id: string; name: string; website: string | null; instagram: string | null; industry: string | null;
  city: string | null; country: string | null; market_code: string | null; notes: string | null;
  created_by: string | null; created_at: string;
}
export interface Contact {
  id: string; company_id: string; full_name: string; role: string | null; email: string | null;
  phone: string | null; languages: string[]; created_at: string;
}
export interface Lead {
  id: string; ref: number; company_id: string; contact_id: string | null; stage: Stage;
  industry: string | null; service_interest: string[]; market_code: string | null; budget_band: string | null;
  timeline: string | null; languages: string[]; source: string | null; channel: Channel | null;
  portfolio_case: string | null; fit_score: number | null; screen_notes: string | null;
  owner_agent: AgentCode | null; next_action: string | null; next_action_at: string | null;
  lost_reason: string | null; stage_changed_at: string; created_by: AgentCode | null; created_at: string; updated_at: string;
}
export interface StageChange { id: number; lead_id: string; from_stage: Stage | null; to_stage: Stage; agent_code: AgentCode | null; reason: string | null; created_at: string }
export interface Batch { id: string; ref: number; status: "pending" | "approved" | "partially_approved" | "rejected"; submitted_by: AgentCode; submitted_at: string; decided_by: string | null; decided_at: string | null; note: string | null }
export interface Draft {
  id: string; lead_id: string; channel: Channel; language: string; subject: string | null; body: string;
  personalisation: string | null; status: "draft" | "ready" | "in_batch" | "approved" | "rejected" | "sent";
  batch_id: string | null; reviewer_note: string | null; created_by: AgentCode | null; approved_at: string | null;
  sent_at: string | null; external_ref: string | null; created_at: string;
}
export interface DiscoveryNote { id: string; lead_id: string; topic: string; question: string | null; answer: string; source: string; source_ref: string | null; recorded_by: AgentCode | null; created_at: string }
export interface Deal {
  id: string; ref: number; lead_id: string; title: string; package_code: string | null; market_code: string; currency: string;
  payment_plan: "50_50" | "40_30_30"; rush: boolean; care_plan_code: string | null; one_off_subtotal: number; rush_fee: number;
  one_off_total: number; monthly_total: number; one_off_total_usd: number; monthly_total_usd: number;
  status: "draft" | "quoted" | "proposed" | "signed" | "lost"; signed_at: string | null; lost_reason: string | null;
  created_by: AgentCode | null; created_at: string;
}
export interface DealItem { id: string; deal_id: string; kind: "package" | "addon" | "care_plan"; code: string; name: string; qty: number; unit_price: number; monthly_price: number; line_total: number }
export interface Proposal { id: string; deal_id: string; lead_id: string; version: number; scope_summary: string; deliverables: string[]; execution_plan: string | null; status: string; sent_at: string | null; created_by: AgentCode | null; created_at: string }
export interface Project {
  id: string; ref: number; deal_id: string | null; lead_id: string | null; company_id: string | null; name: string;
  status: "planning" | "active" | "at_risk" | "delivered" | "closed"; slot_month: string; start_date: string | null;
  target_date: string | null; delivered_at: string | null; signed_off_at: string | null; health_note: string | null; created_at: string;
}
export interface ScopeLine { line: string; code?: string; kind?: string; price_usd: number; monthly_usd?: number; verified: boolean; note?: string }
export interface Scope { id: string; deal_id: string; project_id: string | null; version: number; lines: ScopeLine[]; total: number; currency: string; status: string; sent_at: string | null; signed_at: string | null }
export interface Milestone { id: string; project_id: string; title: string; due_date: string; original_due: string | null; status: "pending" | "in_progress" | "done" | "slipped"; completed_at: string | null; slip_reason: string | null; proposed_fix: string | null; sort: number }
export interface Deliverable { id: string; project_id: string; milestone_id: string | null; title: string; owner: "studio" | "client"; due_date: string | null; status: "pending" | "in_progress" | "done" | "blocked"; scope_line: string | null; verified: boolean; verified_note: string | null }
export interface Payment { id: string; deal_id: string; project_id: string | null; label: string; percent: number; amount: number; currency: string; due_date: string | null; status: "scheduled" | "invoiced" | "paid" | "overdue"; paid_at: string | null }
export interface Escalation {
  id: string; ref: number; lead_id: string | null; project_id: string | null; raised_by: AgentCode; title: string;
  detail: string | null; proposed_action: string | null; severity: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_review" | "with_owner" | "with_letty" | "resolved" | "dismissed"; assigned_to: AgentCode;
  top_g_notes: string | null; resolution_notes: string | null; resolved_by: AgentCode | null; resolved_at: string | null; created_at: string;
}
export interface Activity { id: number; agent_code: AgentCode | null; action: string; entity_type: string | null; entity_id: string | null; lead_id: string | null; summary: string; payload: Record<string, unknown>; created_at: string }
export interface Lesson { id: string; title: string; body: string; category: string; industry: string | null; audience: string[]; created_by: AgentCode | null; created_at: string }
export interface Testimonial { id: string; project_id: string | null; company_id: string | null; status: string; quote: string | null; author_name: string | null; author_role: string | null; rating: number | null; permission_to_publish: boolean; requested_at: string | null; received_at: string | null; created_at: string }
export interface Referral { id: string; from_company_id: string | null; from_project_id: string | null; referred_name: string | null; referred_contact: string | null; status: string; lead_id: string | null; notes: string | null; created_at: string }
export interface CareSubscription { id: string; company_id: string; project_id: string | null; plan_code: string; market_code: string; currency: string; monthly_price: number; monthly_usd: number; hours_included: number; included_until: string | null; start_date: string; renewal_date: string; status: "active" | "paused" | "cancelled"; notes: string | null }
export interface CareHours { id: string; subscription_id: string; worked_on: string; hours: number; description: string; logged_by: AgentCode | null }
export interface DoNotContact { id: string; kind: string; value: string; reason: string | null; lead_id: string | null; added_by: AgentCode | null; created_at: string }

export interface Tables {
  agents: Agent[]; markets: Market[]; catalogue_packages: Package[]; catalogue_package_prices: PackagePrice[];
  catalogue_addons: Addon[]; catalogue_care_plans: CarePlan[]; catalogue_terms: Term[];
  companies: Company[]; contacts: Contact[]; leads: Lead[]; stage_changes: StageChange[];
  approval_batches: Batch[]; outreach_drafts: Draft[]; discovery_notes: DiscoveryNote[];
  deals: Deal[]; deal_items: DealItem[]; proposals: Proposal[]; projects: Project[]; scopes: Scope[];
  milestones: Milestone[]; deliverables: Deliverable[]; payments: Payment[]; escalations: Escalation[];
  activity_log: Activity[]; lessons: Lesson[]; testimonials: Testimonial[]; referrals: Referral[];
  care_subscriptions: CareSubscription[]; care_hours_log: CareHours[]; do_not_contact: DoNotContact[];
}
export type TableName = keyof Tables;
