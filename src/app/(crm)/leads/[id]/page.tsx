import { ArrowLeft, Calculator, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityFeed } from "@/components/activity-feed";
import { StageSelect } from "@/components/stage-move";
import { AgentAvatar, Chip, Empty, Field, StageChip, StatusChip, Tabs } from "@/components/ui";
import { stageMeta } from "@/lib/constants";
import { getMe, getTables } from "@/lib/data";
import { dateTime, money, relTime, shortDate, titleCase } from "@/lib/format";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "activity" } = await searchParams;
  const me = await getMe();
  const t = await getTables(
    "leads", "companies", "contacts", "agents", "activity_log", "stage_changes", "outreach_drafts", "discovery_notes",
    "deals", "deal_items", "proposals", "projects", "escalations", "catalogue_packages", "catalogue_addons", "approval_batches",
  );
  const lead = t.leads.find((l) => l.id === id);
  if (!lead) notFound();
  const company = t.companies.find((c) => c.id === lead.company_id)!;
  const contact = t.contacts.find((c) => c.id === lead.contact_id);
  const agent = new Map(t.agents.map((a) => [a.code, a]));
  const serviceName = new Map<string, string>([...t.catalogue_packages.map((p) => [p.code, p.name] as [string, string]), ...t.catalogue_addons.map((a) => [a.code, a.name] as [string, string])]);

  const activity = t.activity_log.filter((a) => a.lead_id === id);
  const history = t.stage_changes.filter((s) => s.lead_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const drafts = t.outreach_drafts.filter((d) => d.lead_id === id);
  const notes = t.discovery_notes.filter((n) => n.lead_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const deals = t.deals.filter((d) => d.lead_id === id);
  const proposals = t.proposals.filter((p) => p.lead_id === id);
  const project = t.projects.find((p) => p.lead_id === id);
  const escalations = t.escalations.filter((e) => e.lead_id === id);

  const base = `/leads/${id}`;
  const tabs = [
    { key: "activity", label: "Activity", href: `${base}?tab=activity`, count: activity.length },
    { key: "history", label: "Stage history", href: `${base}?tab=history`, count: history.length },
    { key: "outreach", label: "Outreach", href: `${base}?tab=outreach`, count: drafts.length },
    { key: "discovery", label: "Discovery", href: `${base}?tab=discovery`, count: notes.length },
    { key: "deals", label: "Deals & proposals", href: `${base}?tab=deals`, count: deals.length },
  ];
  const owner = lead.owner_agent ? agent.get(lead.owner_agent) : null;

  return (
    <div className="flex min-h-[calc(100dvh-48px)] flex-col lg:flex-row">
      {/* Left: record */}
      <aside className="border-b border-line lg:w-[360px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="border-b border-line px-4 py-3">
          <Link href="/pipeline" className="btn-ghost -ml-2 h-7"><ArrowLeft size={14} /> Pipeline</Link>
        </div>
        <div className="px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-panel-3 text-[15px] font-semibold text-ink-2">
              {company.name.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <h1 className="text-[17px] font-semibold leading-tight tracking-tight">{company.name}</h1>
              <div className="mt-0.5 text-[12px] text-ink-3">SQ-{lead.ref} · {[company.city, company.country].filter(Boolean).join(", ")}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StageChip stage={lead.stage} />
            <span className="text-[12px] text-ink-3">since {relTime(lead.stage_changed_at)}</span>
          </div>
          {!me?.demo && (
            <div className="mt-3 flex items-center gap-2">
              <StageSelect leadId={lead.id} leadName={company.name} stage={lead.stage} />
              <Link href={`/deals/new?lead=${lead.id}`} className="btn"><Calculator size={14} /> Quote</Link>
            </div>
          )}
          {me?.demo && (
            <div className="mt-3"><Link href={`/deals/new?lead=${lead.id}`} className="btn"><Calculator size={14} /> Open in deal builder</Link></div>
          )}
        </div>

        <div className="border-t border-line px-4 py-3">
          <div className="card-t mb-1">Contact</div>
          <Field label="Name">{contact?.full_name}</Field>
          <Field label="Email">{contact?.email}</Field>
          <Field label="Phone">{contact?.phone}</Field>
          <Field label="Website">{company.website ? <a className="inline-flex items-center gap-1 text-accent-2 hover:underline" href={`https://${company.website.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer">{company.website}<ExternalLink size={11} /></a> : null}</Field>
          <Field label="Instagram">{company.instagram}</Field>
          <Field label="Channel">{lead.channel ? titleCase(lead.channel) : null}</Field>
          <Field label="Languages">{lead.languages.length ? lead.languages.join(", ").toUpperCase() : null}</Field>
        </div>
        <div className="border-t border-line px-4 py-3">
          <div className="card-t mb-1">Qualification</div>
          <Field label="Industry">{lead.industry}</Field>
          <Field label="Interest">{lead.service_interest.length ? <div className="flex flex-wrap gap-1">{lead.service_interest.map((s) => <Chip key={s}>{serviceName.get(s) ?? s}</Chip>)}</div> : null}</Field>
          <Field label="Market">{lead.market_code}</Field>
          <Field label="Budget">{lead.budget_band}</Field>
          <Field label="Timeline">{lead.timeline}</Field>
          <Field label="Source">{lead.source}</Field>
          <Field label="Case study">{lead.portfolio_case}</Field>
          <Field label="Fit score">{lead.fit_score != null ? `${lead.fit_score}/100` : null}</Field>
          <Field label="Screening">{lead.screen_notes}</Field>
          {lead.lost_reason && <Field label="Lost reason"><span className="text-rose-300">{lead.lost_reason}</span></Field>}
        </div>
        <div className="border-t border-line px-4 py-3">
          <div className="card-t mb-1">Ownership</div>
          <Field label="Owner"><AgentAvatar agent={owner} withName /></Field>
          <Field label="Next action">{lead.next_action ? <>{lead.next_action}{lead.next_action_at && <span className="text-ink-3"> · {shortDate(lead.next_action_at)}</span>}</> : null}</Field>
          <Field label="Created">{dateTime(lead.created_at)} by {agent.get(lead.created_by ?? "hunter")?.name}</Field>
          {project && <Field label="Project"><Link className="text-accent-2 hover:underline" href={`/projects/${project.id}`}>P-{project.ref} · {project.status.replace("_", " ")}</Link></Field>}
        </div>
        {escalations.length > 0 && (
          <div className="border-t border-line px-4 py-3">
            <div className="card-t mb-2">Escalations</div>
            {escalations.map((e) => (
              <Link key={e.id} href="/escalations" className="mb-1.5 flex items-center gap-2 text-[12px] hover:text-ink">
                <StatusChip status={e.status} /> <span className="truncate text-ink-2">{e.title}</span>
              </Link>
            ))}
          </div>
        )}
      </aside>

      {/* Right: tabs */}
      <section className="min-w-0 flex-1">
        <Tabs tabs={tabs} active={tab} />
        <div className="p-4 md:p-6">
          {tab === "activity" && <div className="card py-1"><ActivityFeed items={activity} agents={t.agents} /></div>}

          {tab === "history" && (
            <div className="card divide-y divide-line/70">
              {history.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  {h.from_stage ? <StageChip stage={h.from_stage} /> : <Chip>new</Chip>}
                  <span className="text-ink-3">→</span>
                  <StageChip stage={h.to_stage} />
                  <span className="min-w-0 flex-1 truncate text-ink-2">{h.reason}</span>
                  <AgentAvatar agent={h.agent_code ? agent.get(h.agent_code) : null} withName />
                  <span className="w-[120px] text-right text-[12px] text-ink-3">{dateTime(h.created_at)}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "outreach" && (
            drafts.length === 0 ? <div className="card"><Empty title="No outreach yet">Jordan writes personalised drafts after screening.</Empty></div> :
            <div className="grid gap-3">
              {drafts.map((d) => {
                const b = t.approval_batches.find((x) => x.id === d.batch_id);
                return (
                  <article key={d.id} className="card">
                    <div className="card-h">
                      <div className="flex items-center gap-2">
                        <StatusChip status={d.status} /><Chip>{d.channel}</Chip><Chip>{d.language.toUpperCase()}</Chip>
                        {b && <span className="text-[12px] text-ink-3">Batch #{b.ref}</span>}
                      </div>
                      <span className="text-[12px] text-ink-3">{d.sent_at ? `sent ${relTime(d.sent_at)}` : relTime(d.created_at)}</span>
                    </div>
                    <div className="px-4 py-3">
                      {d.subject && <div className="mb-1 font-medium">{d.subject}</div>}
                      <p className="whitespace-pre-wrap text-ink-2">{d.body}</p>
                      {d.personalisation && <p className="mt-2 text-[12px] text-ink-3">Why it fits: {d.personalisation}</p>}
                      {d.reviewer_note && <p className="mt-2 rounded-lg bg-panel-3 px-3 py-2 text-[12px] text-ink-2">Letty: {d.reviewer_note}</p>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {tab === "discovery" && (
            notes.length === 0 ? <div className="card"><Empty title="No discovery notes">Quinn records each answer together with its source.</Empty></div> :
            <div className="card divide-y divide-line/70">
              {notes.map((n) => (
                <div key={n.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="violet">{n.topic}</Chip>
                    {n.question && <span className="text-ink-2">{n.question}</span>}
                    <span className="ml-auto text-[12px] text-ink-3">{relTime(n.created_at)}</span>
                  </div>
                  <p className="mt-1.5">{n.answer}</p>
                  <div className="mt-1.5 text-[11px] text-ink-3">Source: <span className="text-ink-2">{n.source}</span>{n.source_ref && ` · ${n.source_ref}`} · recorded by {agent.get(n.recorded_by ?? "quinn")?.name}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "deals" && (
            deals.length === 0 ? (
              <div className="card"><Empty title="No deals yet">Quinn builds quotes from the catalogue once discovery is done.
                <div className="mt-3"><Link href={`/deals/new?lead=${lead.id}`} className="btn">Open deal builder</Link></div></Empty></div>
            ) : (
              <div className="grid gap-3">
                {deals.map((d) => (
                  <article key={d.id} className="card">
                    <div className="card-h">
                      <div className="flex items-center gap-2"><span className="font-medium">D-{d.ref} · {d.title}</span><StatusChip status={d.status} /></div>
                      <span className="text-[15px] font-semibold tabular-nums">{money(d.one_off_total, d.currency)}</span>
                    </div>
                    <table className="w-full">
                      <tbody>
                        {t.deal_items.filter((i) => i.deal_id === d.id).map((i) => (
                          <tr key={i.id} className="border-b border-line/60">
                            <td className="td">{i.name}{i.qty > 1 && <span className="text-ink-3"> × {i.qty}</span>} <span className="text-[11px] text-ink-3">{i.kind.replace("_", " ")}</span></td>
                            <td className="td text-right tabular-nums text-ink-2">{i.monthly_price ? `${money(i.monthly_price, d.currency)}/mo` : ""}</td>
                            <td className="td text-right tabular-nums">{i.line_total ? money(i.line_total, d.currency) : "—"}</td>
                          </tr>
                        ))}
                        {d.rush && <tr className="border-b border-line/60"><td className="td">Rush delivery (+25%)</td><td /><td className="td text-right tabular-nums">{money(d.rush_fee, d.currency)}</td></tr>}
                      </tbody>
                    </table>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 py-3 text-[12px] text-ink-3">
                      <span>Market <span className="text-ink-2">{d.market_code}</span></span>
                      <span>Payment <span className="text-ink-2">{d.payment_plan.replace(/_/g, "/")}</span></span>
                      {d.monthly_total > 0 && <span>Recurring <span className="text-ink-2">{money(d.monthly_total, d.currency)}/mo</span></span>}
                      <span>USD equiv. <span className="text-ink-2">{money(d.one_off_total_usd)}</span></span>
                    </div>
                    {proposals.filter((p) => p.deal_id === d.id).map((p) => (
                      <div key={p.id} className="border-t border-line px-4 py-3">
                        <div className="flex items-center gap-2"><span className="font-medium">Proposal v{p.version}</span><StatusChip status={p.status} /><span className="text-[12px] text-ink-3">{relTime(p.created_at)}</span></div>
                        <p className="mt-1 text-ink-2">{p.scope_summary}</p>
                        <ul className="mt-2 grid gap-1 sm:grid-cols-2">{p.deliverables.map((x) => <li key={x} className="text-[12px] text-ink-2">· {x}</li>)}</ul>
                        {p.execution_plan && <p className="mt-2 text-[12px] text-ink-3">Execution: {p.execution_plan}</p>}
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            )
          )}
        </div>
        <div className="px-6 pb-6 text-[11px] text-ink-3">Stage: {stageMeta(lead.stage).label} · last updated {relTime(lead.updated_at)}</div>
      </section>
    </div>
  );
}
