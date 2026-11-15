// Which RPCs each squad member uses. Mirrors docs/AGENT_API.md and the
// role checks inside supabase/migrations/*_agent_api.sql.
export const AGENT_RPCS: Record<string, { fn: string; does: string }[]> = {
  hunter: [
    { fn: "create_lead", does: "New lead + company + contact; checks do-not-contact and duplicates first" },
    { fn: "create_leads_bulk", does: "Upload up to 100 leads per call, same checks as create_lead, per-row results" },
    { fn: "find_duplicate_leads", does: "Preview duplicates before creating" },
    { fn: "update_lead", does: "Edit lead fields + evidence (refreshes last_verified_at)" },
    { fn: "update_company_details", does: "Address, WhatsApp/Telegram, rating, owner… each with source URL + checked date" },
    { fn: "set_lead_hold", does: "Hold (with reason) or release a lead" },
    { fn: "link_leads", does: "Flag duplicate / sister / rename — freezes both leads until Marvin clears it" },
    { fn: "raise_escalation", does: "Ask Top G for help" },
  ],
  jordan: [
    { fn: "screen_lead", does: "Pass (→ screened) or reject (→ lost) with fit score + notes" },
    { fn: "create_draft", does: "Draft to an exact recipient; needs Marvin's PASS + verified domain (→ draft ready)" },
    { fn: "set_draft_hold", does: "Hold or release a draft before batching" },
    { fn: "set_draft_recipient", does: "Add the exact recipient to an older draft before batching" },
    { fn: "submit_draft_batch", does: "Send drafts to Letty for batch approval" },
    { fn: "log_send", does: "Log a sent message — only for Letty-approved drafts" },
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
    { fn: "update_escalation", does: "Review, send to Letty, resolve or dismiss" },
    { fn: "record_approval", does: "Record Letty's batch decision from Grokbot" },
    { fn: "advance_stage", does: "Any stage change, reason required" },
    { fn: "get_lead_context", does: "Everything about one lead in one call" },
  ],
  marvin: [
    { fn: "set_manual_check", does: "PASS / FAIL / PENDING — gates drafting and stage moves" },
    { fn: "clear_lead_link", does: "Unfreeze a duplicate / sister / rename link (decision note)" },
    { fn: "delete_lead", does: "Delete a lead: type its SQ code; full snapshot kept in the log" },
    { fn: "record_approval", does: "Approve or reject outreach batches" },
  ],
  letty: [
    { fn: "record_approval", does: "Approve / reject outreach batches" },
    { fn: "update_escalation", does: "Resolve what Top G escalates" },
    { fn: "(catalogue tables)", does: "Only Letty can edit prices, markets and terms" },
  ],
};
export const SHARED_RPCS = ["advance_stage", "raise_escalation", "get_lead_context", "capacity", "check_do_not_contact"];
