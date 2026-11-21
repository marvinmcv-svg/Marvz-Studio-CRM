"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, Lock, Pause, Pencil, Play, ShieldCheck, Trash2, Unlink, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  clearLeadLink, deleteLead, linkLeads, setLeadHold, setManualCheck, updateCompanyDetails, updateLeadEvidence,
} from "@/app/actions";
import { relTime, shortDate } from "@/lib/format";
import { DOMAIN_LABEL, PROBLEM_LABEL, STALE_DAYS } from "@/lib/quality";
import type { Company, Contact, ImportBatch, Lead } from "@/lib/types";
import { Chip } from "./ui";

export type RelatedLead = { id: string; code: string; name: string; relation: string; status: "frozen" | "cleared"; note: string | null; clearedNote: string | null };
export type LeadOption = { id: string; label: string };

type Result = { ok: boolean; text: string } | null;

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setResult(r.ok ? { ok: true, text: okText } : { ok: false, text: (r as { error: string }).error });
      if (r.ok) { after?.(); router.refresh(); }
    });
  return { pending, result, setResult, run };
}

function Msg({ result }: { result: Result }) {
  if (!result) return null;
  return <p role="status" className={clsx("mt-2 rounded-[8px] px-3 py-2 text-[12.5px]", result.ok ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300")}>{result.text}</p>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div data-modal-open className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 p-3 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="float max-h-[88dvh] w-full max-w-[520px] overflow-y-auto rounded-[14px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="text-[17px] font-semibold">{title}</div>
          <button className="btn-ghost -mr-2 -mt-1 h-8 w-8 px-0" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** "Sourced" value: the value, plus a link to where it was found and when it was checked. */
function Sourced({ value, source, checked }: { value: ReactNode; source?: string | null; checked?: string | null }) {
  if (value == null || value === "") return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <span>{value}</span>
      {source && <a href={source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11.5px] text-accent hover:underline" aria-label="Source">source<ExternalLink size={10} /></a>}
      {checked && <span className="text-[11.5px] text-ink-3">· checked {shortDate(checked)}</span>}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[118px_minmax(0,1fr)] items-baseline gap-2 py-1.5">
      <div className="text-[12.5px] text-ink-3">{label}</div>
      <div className="min-w-0 break-words text-[13.5px]">{children}</div>
    </div>
  );
}

export function LeadQualityPanel({
  lead, company, contact, blockers, related, importBatch, me, otherLeads,
}: {
  lead: Lead; company: Company; contact: Contact | null; blockers: string[]; related: RelatedLead[];
  importBatch: ImportBatch | null; me: { code: string; demo: boolean }; otherLeads: LeadOption[];
}) {
  const isMarvin = me.code === "marvin";
  const [dialog, setDialog] = useState<null | "check" | "hold" | "link" | "evidence" | "company" | "delete" | { clear: RelatedLead }>(null);
  const close = () => setDialog(null);
  const check = lead.manual_check ?? "PENDING";
  const stale = !lead.last_verified_at || Date.now() - new Date(lead.last_verified_at).getTime() > STALE_DAYS * 86_400_000;
  const frozen = related.filter((r) => r.status === "frozen");

  return (
    <>
      {/* Readiness */}
      <section className="border-t border-line px-4 py-4" aria-labelledby="readiness">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="readiness" className="card-t">Outreach readiness</h2>
          {blockers.length === 0
            ? <Chip tone="green" dot>Ready</Chip>
            : <Chip tone="amber" dot>{blockers.length} blocker{blockers.length > 1 ? "s" : ""}</Chip>}
        </div>
        {blockers.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-emerald-300"><CheckCircle2 size={15} /> Checked by Marvin, domain verified, nothing on hold or frozen.</p>
        ) : (
          <ul className="space-y-1.5">
            {blockers.map((b) => (
              <li key={b} className="flex items-start gap-2 text-[13px] text-ink-2"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />{b}</li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <span className={clsx("inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] font-semibold ring-1 ring-inset",
            check === "PASS" ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25"
              : check === "FAIL" ? "bg-rose-400/10 text-rose-300 ring-rose-400/25" : "bg-ink/[0.06] text-ink-2 ring-ink/10")}>
            <ShieldCheck size={14} /> Manual check: {check}
          </span>
          {isMarvin && <button className="btn h-8" onClick={() => setDialog("check")}>Set check</button>}
          <button className="btn h-8" onClick={() => setDialog("hold")}>
            {lead.on_hold ? <><Play size={13} /> Release hold</> : <><Pause size={13} /> Put on hold</>}
          </button>
        </div>
        {lead.manual_check_at && (
          <p className="mt-2 text-[12px] text-ink-3">Checked {relTime(lead.manual_check_at)}{lead.manual_check_note && ` — “${lead.manual_check_note}”`}</p>
        )}
        {lead.on_hold && <p className="mt-2 rounded-[8px] bg-amber-400/10 px-3 py-2 text-[12.5px] text-amber-300">On hold since {relTime(lead.held_at ?? lead.updated_at)}: {lead.hold_reason}</p>}
      </section>

      {/* Linked leads */}
      <section className="border-t border-line px-4 py-4" aria-labelledby="links">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="links" className="card-t">Linked leads</h2>
          <button className="btn-ghost h-8 px-2 text-accent" onClick={() => setDialog("link")}><Link2 size={14} /> Link</button>
        </div>
        {frozen.length > 0 && (
          <p className="mb-2 flex items-start gap-2 rounded-[8px] bg-violet-400/10 px-3 py-2 text-[12.5px] text-violet-300">
            <Lock size={14} className="mt-0.5 shrink-0" /> Frozen: screening, drafting and batching are blocked for every lead in this group until Marvin clears the link.
          </p>
        )}
        {related.length === 0 ? <p className="text-[13px] text-ink-3">No duplicate, sister or rename links.</p> : (
          <ul className="space-y-2">
            {related.map((r) => (
              <li key={r.id + r.relation} className="rounded-[8px] border border-line bg-panel-2 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`/leads/${r.id}`} className="font-medium hover:text-accent">{r.name}</a>
                  <span className="text-[12px] text-ink-3">{r.code}</span>
                  <Chip tone="violet">{r.relation}</Chip>
                  <Chip tone={r.status === "frozen" ? "amber" : "green"} dot>{r.status}</Chip>
                  {isMarvin && r.status === "frozen" && (
                    <button className="btn-ghost ml-auto h-7 px-2 text-accent" onClick={() => setDialog({ clear: r })}><Unlink size={13} /> Clear</button>
                  )}
                </div>
                {(r.note || r.clearedNote) && <p className="mt-1 text-[12px] text-ink-3">{r.clearedNote ? `Cleared: ${r.clearedNote}` : r.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Evidence */}
      <section className="border-t border-line px-4 py-4" aria-labelledby="evidence">
        <div className="mb-1 flex items-center justify-between">
          <h2 id="evidence" className="card-t">Evidence</h2>
          <button className="btn-ghost h-8 px-2 text-accent" onClick={() => setDialog("evidence")}><Pencil size={13} /> Edit</button>
        </div>
        <Row label="Domain"><Sourced value={DOMAIN_LABEL[lead.domain_status ?? "UNVERIFIED"]} source={lead.domain_proof_url} /></Row>
        <Row label="Website problem">{lead.website_problem_type ? PROBLEM_LABEL[lead.website_problem_type] : <span className="text-ink-3">—</span>}</Row>
        <Row label="Operating since">{lead.operating_evidence_date ? shortDate(lead.operating_evidence_date) : <span className="text-ink-3">—</span>}</Row>
        <Row label="Phone source"><Sourced value={lead.phone_source_url ? "linked" : null} source={lead.phone_source_url} /></Row>
        <Row label="Last verified">
          <span className={clsx(stale && "text-amber-300")}>{lead.last_verified_at ? relTime(lead.last_verified_at) : "never"}{stale && ` · older than ${STALE_DAYS} days`}</span>
        </Row>
        <Row label="Source key">{lead.source_key ?? <span className="text-ink-3">—</span>}</Row>
        <Row label="Import">{importBatch ? <>#{importBatch.ref} · {importBatch.source_file ?? "no file name"} <span className="text-ink-3">({shortDate(importBatch.created_at)})</span></> : <span className="text-ink-3">—</span>}</Row>
      </section>

      {/* Company presence & reputation */}
      <section className="border-t border-line px-4 py-4" aria-labelledby="presence">
        <div className="mb-1 flex items-center justify-between">
          <h2 id="presence" className="card-t">Address, contact & reputation</h2>
          <button className="btn-ghost h-8 px-2 text-accent" onClick={() => setDialog("company")}><Pencil size={13} /> Edit</button>
        </div>
        <Row label="Address">{[company.street, company.city, company.region, company.postcode, company.country].filter(Boolean).join(", ") || <span className="text-ink-3">—</span>}</Row>
        <Row label="Owner"><Sourced value={company.owner_name ? `${company.owner_name}${company.owner_role ? ` (${company.owner_role})` : ""}` : null} source={company.owner_source_url} checked={company.owner_checked_at} /></Row>
        <Row label="WhatsApp"><Sourced value={company.whatsapp} source={company.whatsapp_source_url} checked={company.whatsapp_checked_at} /></Row>
        <Row label="Telegram"><Sourced value={company.telegram} source={company.telegram_source_url} checked={company.telegram_checked_at} /></Row>
        <Row label="Email"><Sourced value={contact?.email} source={contact?.email_source_url} checked={contact?.email_checked_at} /></Row>
        <Row label="Contact form"><Sourced value={company.contact_form_url ? <a className="text-accent hover:underline" href={company.contact_form_url} target="_blank" rel="noreferrer">open form</a> : null} source={company.contact_form_source_url} checked={company.contact_form_checked_at} /></Row>
        <Row label="Socials"><Sourced value={[company.instagram, company.facebook_url && "Facebook", company.tiktok_url && "TikTok", company.linkedin_url && "LinkedIn"].filter(Boolean).join(" · ") || null} source={company.socials_source_url ?? company.instagram_source_url} checked={company.socials_checked_at ?? company.instagram_checked_at} /></Row>
        <Row label="Rating"><Sourced value={company.rating != null ? `★ ${Number(company.rating).toFixed(1)}${company.review_count != null ? ` · ${company.review_count} reviews` : ""}${company.rating_source ? ` · ${company.rating_source}` : ""}` : null} source={company.rating_source_url} checked={company.rating_checked_at} /></Row>
        <Row label="Site language"><Sourced value={company.site_language} source={company.site_language_source_url} checked={company.site_language_checked_at} /></Row>
      </section>

      {isMarvin && (
        <section className="border-t border-line px-4 py-4">
          <button className="btn h-9 w-full justify-center border-rose-400/40 text-rose-300 hover:bg-rose-400/10" onClick={() => setDialog("delete")}>
            <Trash2 size={14} /> Delete lead…
          </button>
          <p className="mt-1.5 text-center text-[11.5px] text-ink-3">Owner only. Asks you to type {`SQ-${lead.ref}`} and keeps a full snapshot in the activity log.</p>
        </section>
      )}

      {dialog === "check" && <CheckDialog lead={lead} onClose={close} />}
      {dialog === "hold" && <HoldDialog lead={lead} onClose={close} />}
      {dialog === "link" && <LinkDialog lead={lead} otherLeads={otherLeads} onClose={close} />}
      {dialog === "evidence" && <EvidenceDialog lead={lead} onClose={close} />}
      {dialog === "company" && <CompanyDialog company={company} onClose={close} />}
      {dialog === "delete" && <DeleteDialog lead={lead} name={company.name} onClose={close} />}
      {dialog && typeof dialog === "object" && <ClearDialog lead={lead} other={dialog.clear} onClose={close} />}
    </>
  );
}

function CheckDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { pending, result, run } = useAction();
  const [value, setValue] = useState<"PASS" | "FAIL" | "PENDING">(lead.manual_check ?? "PENDING");
  const [note, setNote] = useState(lead.manual_check_note ?? "");
  return (
    <Dialog title="Manual check" onClose={onClose}>
      <p className="mb-3 text-[13px] text-ink-2">Only you can set this. Drafting and moving the lead forward need <b className="text-ink">PASS</b>.</p>
      <div className="segmented mb-3 w-full" role="radiogroup" aria-label="Manual check result">
        {(["PASS", "FAIL", "PENDING"] as const).map((v) => (
          <button key={v} role="radio" aria-checked={value === v} data-active={value === v} className="segment flex-1 justify-center" onClick={() => setValue(v)}>{v}</button>
        ))}
      </div>
      <label className="label" htmlFor="check-note">Note (what you checked)</label>
      <textarea id="check-note" rows={3} className="input h-auto py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Site, owner and phone confirmed" />
      <Msg result={result} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={pending} onClick={() => run(() => setManualCheck(lead.id, value, note), `Manual check set to ${value}.`, onClose)}>
          {pending ? "Saving…" : "Save check"}
        </button>
      </div>
    </Dialog>
  );
}

function HoldDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { pending, result, run } = useAction();
  const [reason, setReason] = useState("");
  const holding = !lead.on_hold;
  return (
    <Dialog title={holding ? "Put lead on hold" : "Release hold"} onClose={onClose}>
      {holding ? (
        <>
          <p className="mb-3 text-[13px] text-ink-2">A lead on hold can&apos;t be drafted or batched until it&apos;s released.</p>
          <label className="label" htmlFor="hold-reason">Reason (required)</label>
          <textarea id="hold-reason" rows={3} autoFocus className="input h-auto py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Waiting for the owner's direct number" />
        </>
      ) : <p className="text-[13px] text-ink-2">Currently on hold: {lead.hold_reason}</p>}
      <Msg result={result} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={pending || (holding && !reason.trim())}
          onClick={() => run(() => setLeadHold(lead.id, holding, reason), holding ? "Lead put on hold." : "Hold released.", onClose)}>
          {pending ? "Saving…" : holding ? "Put on hold" : "Release"}
        </button>
      </div>
    </Dialog>
  );
}

function LinkDialog({ lead, otherLeads, onClose }: { lead: Lead; otherLeads: LeadOption[]; onClose: () => void }) {
  const { pending, result, run } = useAction();
  const [other, setOther] = useState("");
  const [relation, setRelation] = useState<"duplicate" | "sister" | "rename">("duplicate");
  const [note, setNote] = useState("");
  return (
    <Dialog title="Link to another lead" onClose={onClose}>
      <p className="mb-3 text-[13px] text-ink-2">Both leads are linked and <b className="text-ink">frozen</b> until Marvin reviews and clears the link.</p>
      <label className="label" htmlFor="link-other">Other lead</label>
      <select id="link-other" className="input mb-3" value={other} onChange={(e) => setOther(e.target.value)}>
        <option value="">Choose a lead…</option>
        {otherLeads.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <div className="label" id="link-type">Relation</div>
      <div className="segmented mb-3 w-full" role="radiogroup" aria-labelledby="link-type">
        {(["duplicate", "sister", "rename"] as const).map((v) => (
          <button key={v} role="radio" aria-checked={relation === v} data-active={relation === v} className="segment flex-1 justify-center capitalize" onClick={() => setRelation(v)}>{v}</button>
        ))}
      </div>
      <label className="label" htmlFor="link-note">Note</label>
      <input id="link-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Same owner and phone; possibly a second branch" />
      <Msg result={result} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={pending || !other} onClick={() => run(() => linkLeads(lead.id, other, relation, note), "Linked and frozen.", onClose)}>
          {pending ? "Linking…" : "Link & freeze"}
        </button>
      </div>
    </Dialog>
  );
}

function ClearDialog({ lead, other, onClose }: { lead: Lead; other: RelatedLead; onClose: () => void }) {
  const { pending, result, run } = useAction();
  const [note, setNote] = useState("");
  return (
    <Dialog title={`Clear ${other.relation} link`} onClose={onClose}>
      <p className="mb-3 text-[13px] text-ink-2">Unfreezes this lead and <b className="text-ink">{other.name}</b> ({other.code}). Record your decision.</p>
      <label className="label" htmlFor="clear-note">Decision (required)</label>
      <textarea id="clear-note" rows={3} autoFocus className="input h-auto py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Different businesses with the same owner — contact separately" />
      <Msg result={result} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={pending || !note.trim()} onClick={() => run(() => clearLeadLink(lead.id, other.id, note), "Link cleared.", onClose)}>
          {pending ? "Clearing…" : "Clear link"}
        </button>
      </div>
    </Dialog>
  );
}

function EvidenceDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { pending, result, run } = useAction();
  const [f, setF] = useState({
    domain_status: lead.domain_status ?? "UNVERIFIED", domain_proof_url: lead.domain_proof_url ?? "",
    website_problem_type: lead.website_problem_type ?? "", operating_evidence_date: lead.operating_evidence_date ?? "",
    phone_source_url: lead.phone_source_url ?? "", source_key: lead.source_key ?? "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const needsProof = f.domain_status === "VERIFIED" && !f.domain_proof_url.trim();
  return (
    <Dialog title="Evidence" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="ev-domain">Domain status</label>
          <select id="ev-domain" className="input" value={f.domain_status} onChange={set("domain_status")}>
            {Object.entries(DOMAIN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ev-problem">Website problem</label>
          <select id="ev-problem" className="input" value={f.website_problem_type} onChange={set("website_problem_type")}>
            <option value="">—</option>
            {Object.entries(PROBLEM_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ev-proof">Domain proof URL {f.domain_status === "VERIFIED" && "(required)"}</label>
          <input id="ev-proof" className="input" type="url" value={f.domain_proof_url} onChange={set("domain_proof_url")} placeholder="https://…" />
        </div>
        <div>
          <label className="label" htmlFor="ev-date">Operating evidence date</label>
          <input id="ev-date" className="input" type="date" value={f.operating_evidence_date} onChange={set("operating_evidence_date")} />
        </div>
        <div>
          <label className="label" htmlFor="ev-key">Source key</label>
          <input id="ev-key" className="input" value={f.source_key} onChange={set("source_key")} placeholder="P527-428" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ev-phone">Phone source URL</label>
          <input id="ev-phone" className="input" type="url" value={f.phone_source_url} onChange={set("phone_source_url")} placeholder="Where the phone number was found" />
        </div>
      </div>
      <p className="mt-2 text-[12px] text-ink-3">Saving marks the lead as verified now.</p>
      <Msg result={result} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={pending || needsProof} onClick={() => run(() => updateLeadEvidence(lead.id, f, "Evidence updated in the CRM"), "Evidence saved.", onClose)}>
          {pending ? "Saving…" : "Save evidence"}
        </button>
      </div>
    </Dialog>
  );
}

const COMPANY_FIELDS: { key: keyof Company; label: string; type?: string; wide?: boolean }[] = [
  { key: "street", label: "Street", wide: true }, { key: "city", label: "City" }, { key: "region", label: "Region" },
  { key: "postcode", label: "Postcode" }, { key: "country", label: "Country" },
  { key: "owner_name", label: "Owner / manager name" }, { key: "owner_role", label: "Owner role" },
  { key: "owner_source_url", label: "Owner source URL", type: "url", wide: true },
  { key: "whatsapp", label: "WhatsApp" }, { key: "whatsapp_source_url", label: "WhatsApp source URL", type: "url" },
  { key: "telegram", label: "Telegram" }, { key: "telegram_source_url", label: "Telegram source URL", type: "url" },
  { key: "contact_form_url", label: "Contact form URL", type: "url" }, { key: "contact_form_source_url", label: "Form source URL", type: "url" },
  { key: "facebook_url", label: "Facebook URL", type: "url" }, { key: "tiktok_url", label: "TikTok URL", type: "url" },
  { key: "linkedin_url", label: "LinkedIn URL", type: "url" }, { key: "socials_source_url", label: "Socials source URL", type: "url" },
  { key: "rating", label: "Rating (0–5)", type: "number" }, { key: "review_count", label: "Review count", type: "number" },
  { key: "rating_source", label: "Rating source" }, { key: "rating_source_url", label: "Rating source URL", type: "url" },
  { key: "site_language", label: "Site language" }, { key: "site_language_source_url", label: "Language source URL", type: "url" },
];

function CompanyDialog({ company, onClose }: { company: Company; onClose: () => void }) {
  const { pending, result, run } = useAction();
  const [f, setF] = useState<Record<string, string>>(() =>
    Object.fromEntries(COMPANY_FIELDS.map((x) => [x.key, company[x.key] == null ? "" : String(company[x.key])])));
  const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== (company[k as keyof Company] == null ? "" : String(company[k as keyof Company]))));
  return (
    <Dialog title="Address, contact & reputation" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        {COMPANY_FIELDS.map((x) => (
          <div key={x.key} className={clsx(x.wide && "sm:col-span-2")}>
            <label className="label" htmlFor={`co-${x.key}`}>{x.label}</label>
            <input id={`co-${x.key}`} className="input" type={x.type ?? "text"} step={x.key === "rating" ? "0.1" : undefined}
              value={f[x.key]} onChange={(e) => setF((v) => ({ ...v, [x.key]: e.target.value }))} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-ink-3">Each changed value gets today&apos;s “checked” date automatically.</p>
      <Msg result={result} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={pending || Object.keys(changed).length === 0}
          onClick={() => run(() => updateCompanyDetails(company.id,
            Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, ["rating", "review_count"].includes(k) && v !== "" ? Number(v) : v])),
            "Edited in the CRM"), "Details saved.", onClose)}>
          {pending ? "Saving…" : `Save ${Object.keys(changed).length || ""} change${Object.keys(changed).length === 1 ? "" : "s"}`}
        </button>
      </div>
    </Dialog>
  );
}

function DeleteDialog({ lead, name, onClose }: { lead: Lead; name: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const code = `SQ-${lead.ref}`;
  return (
    <Dialog title={`Delete ${name}?`} onClose={onClose}>
      <p className="mb-3 text-[13px] text-ink-2">
        This permanently deletes the lead with its drafts, notes and quotes. A full snapshot is kept in the activity log.
        Leads with a signed deal or a project can&apos;t be deleted; mark them lost instead.
      </p>
      <label className="label" htmlFor="del-reason">Reason (required)</label>
      <input id="del-reason" className="input mb-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Created by mistake / duplicate of SQ-…" />
      <label className="label" htmlFor="del-confirm">Type <b className="text-ink">{code}</b> to confirm</label>
      <input id="del-confirm" className="input" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <Msg result={result} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary bg-rose-500 hover:bg-rose-600" disabled={pending || confirm.trim() !== code || !reason.trim()}
          onClick={() => start(async () => {
            const r = await deleteLead(lead.id, confirm.trim(), reason);
            if (r.ok) router.push("/pipeline");
            else setResult({ ok: false, text: r.error });
          })}>
          <Trash2 size={14} /> {pending ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
    </Dialog>
  );
}
