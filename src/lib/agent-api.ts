// Which RPCs each squad member uses. Mirrors docs/AGENT_API.md and the
// role checks inside supabase/migrations/*_agent_api.sql.
export const AGENT_RPCS: Record<string, { fn: string; does: string }[]> = {
  hunter: [
    { fn: "create_lead", does: "New lead + company + contact; checks do-not-contact and duplicates first" },
    { fn: "create_leads_bulk", does: "Upload up to 100 leads per call, same checks as create_lead, per-row results" },
    { fn: "find_duplicate_leads", does: "Preview duplicates before creating" },
    { fn: "update_lead", does: "Edit lead fields (not the stage)" },
    { fn: "raise_escalation", does: "Ask Top G for help" },
  ],
  jordan: [
    { fn: "screen_lead", does: "Pass (→ screened) or reject (→ lost) with fit score + notes" },
    { fn: "create_draft", does: "Personalised outreach draft (→ draft ready)" },
    { fn: "submit_draft_batch", does: "Send drafts to Marvin for batch approval" },
    { fn: "log_send", does: "Log a sent message — only for Marvin-approved drafts" },
    { fn: "log_reply", does: "Prospect replied → hand to Quinn" },
    { fn: "add_do_not_contact", does: "Block a business / contact, every matching lead and their unsent drafts" },
  ],
  quinn: [
    { fn: "add_discovery_note", does: "Answer + where it came from (source is mandatory)" },
    { fn: "quote_deal", does: "Price a deal strictly from the catalogue (read-only)" },
    { fn: "create_deal", does: "Save a catalogue-priced deal + payment milestones" },
    { fn: "create_proposal", does: "Scope, deliverables, execution plan (→ proposal)" },
    { fn: "sign_deal", does: "Mark signed, hand to Dana, returns capacity" },
  ],
  dana: [
    { fn: "create_scope", does: "Scope of work for signature, USD lines from the catalogue" },
    { fn: "create_project", does: "Handoff plan: milestones, deliverables, client obligations (capacity enforced)" },
    { fn: "update_milestone", does: "Progress, or flag slippage with a proposed fix" },
    { fn: "update_deliverable", does: "Status + line-by-line verification against scope" },
    { fn: "record_payment", does: "Invoice / paid / overdue" },
    { fn: "complete_project", does: "Delivered + sign-off (all studio items must be verified)" },
    { fn: "record_testimonial", does: "Request / receive testimonial" },
    { fn: "add_referral", does: "Log a referral" },
    { fn: "start_care_plan", does: "Start Basic / Pro / Growth care" },
    { fn: "log_care_hours", does: "Hours used vs. included" },
    { fn: "add_lesson", does: "Anonymised lesson for Hunter & Jordan (privacy-checked)" },
  ],
  top_g: [
    { fn: "dashboard_metrics", does: "One-call overview: MRR, pipeline, escalations, capacity" },
    { fn: "update_escalation", does: "Review, resolve or dismiss routine escalations, or send one to Marvin" },
    { fn: "advance_stage", does: "Stage corrections except marking a signed client lost; reason required" },
    { fn: "get_lead_context", does: "Everything about one lead in one call" },
  ],
  marvin: [
    { fn: "record_approval", does: "Approve or reject outreach batches. Only Marvin can." },
    { fn: "update_escalation", does: "Decide escalations that need the owner" },
    { fn: "(catalogue tables)", does: "Only Marvin can edit prices, markets and terms" },
    { fn: "(agents table)", does: "Only Marvin can edit the team directory" },
  ],
  letty: [],
};
export const SHARED_RPCS = ["advance_stage", "raise_escalation", "get_lead_context", "capacity", "check_do_not_contact"];
