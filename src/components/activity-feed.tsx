import clsx from "clsx";
import Link from "next/link";
import { dateTime, relTime } from "@/lib/format";
import type { Activity, Agent } from "@/lib/types";
import { AgentAvatar, Empty } from "./ui";

const ACTION_LABEL: Record<string, string> = {
  create_lead: "created lead", screen_lead: "screened", create_draft: "drafted outreach",
  submit_draft_batch: "submitted batch", record_approval: "recorded approval", log_send: "sent outreach",
  log_reply: "logged reply", add_discovery_note: "discovery note", create_deal: "quoted deal",
  create_proposal: "proposal", sign_deal: "signed", stage_change: "stage change", raise_escalation: "escalated",
  update_escalation: "escalation", create_scope: "scope of work", create_project: "project kickoff",
  update_milestone: "milestone", update_deliverable: "deliverable", record_payment: "payment",
  complete_project: "delivered", record_testimonial: "testimonial", add_referral: "referral",
  start_care_plan: "care plan", log_care_hours: "care hours", add_lesson: "lesson",
  add_do_not_contact: "do not contact", create_lead_blocked: "blocked lead", update_lead: "updated lead",
  create_leads_bulk: "bulk import", set_manual_check: "manual check", link_leads: "linked leads",
  clear_lead_link: "cleared link", hold_lead: "held lead", release_lead: "released lead", delete_lead: "deleted lead",
  set_draft_recipient: "set recipient", hold_draft: "held draft", release_draft: "released draft",
};

const ACTION_TONE: Record<string, string> = {
  sign_deal: "text-emerald-300 bg-emerald-400/10", record_payment: "text-emerald-300 bg-emerald-400/10",
  complete_project: "text-emerald-300 bg-emerald-400/10", log_send: "text-sky-300 bg-sky-400/10",
  log_reply: "text-sky-300 bg-sky-400/10", raise_escalation: "text-rose-300 bg-rose-400/10",
  create_lead_blocked: "text-rose-300 bg-rose-400/10", add_do_not_contact: "text-rose-300 bg-rose-400/10",
  delete_lead: "text-rose-300 bg-rose-400/10", set_manual_check: "text-violet-300 bg-violet-400/10",
};

export function ActivityFeed({ items, agents, compact = false }: { items: Activity[]; agents: Agent[]; compact?: boolean }) {
  const byCode = new Map(agents.map((a) => [a.code, a]));
  if (!items.length) return <Empty title="No activity yet">Every RPC call by every agent shows up here.</Empty>;
  return (
    <ol className="relative">
      {items.map((a, i) => {
        const agent = a.agent_code ? byCode.get(a.agent_code) : null;
        const body = (
          <div className="flex gap-3 px-4 py-2.5">
            <div className="relative flex flex-col items-center">
              <AgentAvatar agent={agent} size={22} />
              {i < items.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
            </div>
            <div className="min-w-0 flex-1 pb-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium">{agent?.name ?? "System"}</span>
                <span className={clsx("rounded-[5px] px-1.5 text-[11px] leading-[18px]", ACTION_TONE[a.action] ?? "bg-ink/[0.06] text-ink-3")}>
                  {ACTION_LABEL[a.action] ?? a.action.replace(/_/g, " ")}
                </span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-3" title={dateTime(a.created_at)}>{relTime(a.created_at)}</span>
              </div>
              <div className={clsx("mt-0.5 text-ink-2", compact && "truncate")}>{a.summary}</div>
            </div>
          </div>
        );
        return (
          <li key={a.id}>
            {a.lead_id ? <Link href={`/leads/${a.lead_id}`} className="block transition-colors hover:bg-panel-2/60">{body}</Link> : body}
          </li>
        );
      })}
    </ol>
  );
}
