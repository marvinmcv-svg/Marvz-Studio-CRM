import { CheckCheck } from "lucide-react";
import Link from "next/link";
import { BatchReview } from "@/components/batch-review";
import { AgentAvatar, Chip, Empty, PageHeader, StatusChip } from "@/components/ui";
import { getMe, getTables } from "@/lib/data";
import { dateTime, relTime } from "@/lib/format";
import type { AgentCode } from "@/lib/types";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const me = await getMe();
  const t = await getTables("approval_batches", "outreach_drafts", "leads", "companies", "agents");
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const lead = new Map(t.leads.map((l) => [l.id, l]));
  const agent = new Map(t.agents.map((a) => [a.code, a]));
  const canDecide = !me?.demo && (me?.code === "letty" || me?.code === "top_g");

  const batches = [...t.approval_batches].sort((a, b) =>
    (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.submitted_at.localeCompare(a.submitted_at));
  const unbatched = t.outreach_drafts.filter((d) => d.status === "ready" || d.status === "draft");
  const toD = (d: (typeof t.outreach_drafts)[number]) => {
    const l = lead.get(d.lead_id);
    return {
      id: d.id, leadId: d.lead_id, business: company.get(l?.company_id ?? "")?.name ?? "—", code: `SQ-${l?.ref}`,
      channel: d.channel, language: d.language, subject: d.subject, body: d.body, personalisation: d.personalisation,
    };
  };

  return (
    <div>
      <PageHeader title="Outreach approvals" icon={<CheckCheck size={18} className="text-ink-3" />}
        subtitle="Jordan batches drafts → Letty approves (here or in Grokbot) → only approved drafts can be sent" />
      <div className="grid gap-4 p-4 md:p-6">
        {batches.length === 0 && <div className="card"><Empty title="No batches yet" /></div>}
        {batches.map((b) => {
          const drafts = t.outreach_drafts.filter((d) => d.batch_id === b.id);
          return (
            <section key={b.id} className="card">
              <div className="card-h">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Batch #{b.ref}</span>
                  <StatusChip status={b.status} />
                  <span className="text-[12px] text-ink-3">{drafts.length} drafts · submitted {relTime(b.submitted_at)} by</span>
                  <AgentAvatar agent={agent.get(b.submitted_by)} withName />
                </div>
                {b.decided_at && (
                  <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
                    decided {dateTime(b.decided_at)}
                    {b.decided_by && <>by <AgentAvatar agent={agent.get(b.decided_by as AgentCode)} withName />{b.decided_by === "top_g" && " for Letty"}</>}
                  </span>
                )}
              </div>
              {b.note && <div className="border-b border-line px-4 py-2 text-[12px] text-ink-2">“{b.note}”</div>}
              {b.status === "pending" ? (
                <BatchReview batchId={b.id} drafts={drafts.map(toD)} canDecide={canDecide} />
              ) : (
                <ul className="divide-y divide-line/70">
                  {drafts.map((d) => {
                    const x = toD(d);
                    return (
                      <li key={d.id} className="flex items-center gap-2 px-4 py-2">
                        <StatusChip status={d.status} />
                        <Link href={`/leads/${d.lead_id}`} className="hover:text-accent-2">{x.business}</Link>
                        <Chip>{d.channel}</Chip>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{d.body}</span>
                        {d.sent_at && <span className="text-[12px] text-ink-3">sent {relTime(d.sent_at)}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
        {unbatched.length > 0 && (
          <section className="card">
            <div className="card-h"><span className="card-t">Ready, not yet batched</span><span className="text-[12px] text-ink-3">Jordan submits these with submit_draft_batch</span></div>
            <ul className="divide-y divide-line/70">
              {unbatched.map((d) => {
                const x = toD(d);
                return (
                  <li key={d.id} className="flex items-center gap-2 px-4 py-2">
                    <StatusChip status={d.status} />
                    <Link href={`/leads/${d.lead_id}`} className="hover:text-accent-2">{x.business}</Link>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{d.body}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
